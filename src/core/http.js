// HTTP layer for backends: combined abort+timeout signals, 429/5xx retry with
// Retry-After, JSON/text helpers, and BackendError with an engine tag.

const DEFAULT_TIMEOUT_MS = 15_000

/** A backend-tagged error. `retryable` marks 429/5xx/network failures. */
export class BackendError extends Error {
  constructor(engine, message, { status, retryable } = {}) {
    super(`[${engine}] ${message}`)
    this.name = 'BackendError'
    this.engine = engine
    this.status = status
    this.retryable = retryable ?? false
  }
}

/** Combine an outer signal and a timeout into one controller (Node 18 compatible). */
function withTimeout(engine, signal, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new BackendError(engine, `timeout after ${timeoutMs}ms`)), timeoutMs)
  const onOuterAbort = () => controller.abort(signal.reason)
  if (signal !== undefined) {
    if (signal.aborted) onOuterAbort()
    else signal.addEventListener('abort', onOuterAbort, { once: true })
  }
  const clear = () => {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener('abort', onOuterAbort)
  }
  return { signal: controller.signal, clear }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Extract a human message from an error response body (JSON or text). */
function messageFromBody(body) {
  if (body === undefined || body === '') return undefined
  try {
    const data = JSON.parse(body)
    for (const key of ['message', 'error', 'detail', 'msg', 'error_description']) {
      const v = data?.[key]
      if (typeof v === 'string' && v !== '') return v
      if (v !== null && typeof v === 'object' && typeof v.message === 'string') return v.message
    }
    return body.slice(0, 200)
  } catch {
    return body.slice(0, 200)
  }
}

async function fetchWithRetry(engine, url, { method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries = 1 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const { signal: combined, clear } = withTimeout(engine, signal, timeoutMs)
    try {
      const res = await fetch(url, { method, headers, body, signal: combined })
      if (res.ok) {
        const text = await res.text()
        clear()
        return text
      }
      const bodyText = await res.text().catch(() => '')
      clear()
      const retryable = res.status === 429 || res.status === 408 || res.status >= 500
      if (retryable && attempt < retries) {
        const ra = Number(res.headers.get('retry-after'))
        await sleep(Number.isFinite(ra) && ra > 0 && ra < 30 ? ra * 1000 : 700 * (attempt + 1))
        continue
      }
      throw new BackendError(engine, `HTTP ${res.status}${messageFromBody(bodyText) !== undefined ? `: ${messageFromBody(bodyText)}` : ''}`, { status: res.status, retryable })
    } catch (e) {
      clear()
      if (e instanceof BackendError) throw e
      if (e?.name === 'AbortError') {
        throw signal?.aborted ? e : new BackendError(engine, 'request timed out', { retryable: true })
      }
      if (attempt < retries) {
        await sleep(700 * (attempt + 1))
        continue
      }
      throw new BackendError(engine, `network error: ${e?.message ?? String(e)}`, { retryable: true })
    }
  }
}

/** GET/POST JSON; returns the parsed body; throws BackendError on failure. */
export async function fetchJson(engine, url, { method = 'GET', headers = {}, body, timeoutMs, signal, retries } = {}) {
  const text = await fetchWithRetry(engine, url, {
    method,
    headers: { accept: 'application/json', ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    timeoutMs, signal, retries,
  })
  try {
    return JSON.parse(text)
  } catch {
    throw new BackendError(engine, `invalid JSON response: ${text.slice(0, 160)}`)
  }
}

/** GET/POST returning raw text (RSS/HTML backends). */
export async function fetchText(engine, url, { method = 'GET', headers = {}, body, timeoutMs, signal, retries } = {}) {
  return fetchWithRetry(engine, url, { method, headers, body, timeoutMs, signal, retries })
}

/** Bearer auth header helper. */
export function bearer(key) {
  return { authorization: `Bearer ${key}` }
}

/** URL-encode + build a query string from a flat object (skips undefined/null/''). */
export function qs(params) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    sp.set(k, String(v))
  }
  return sp.toString()
}
