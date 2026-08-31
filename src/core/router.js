// Routing, fallback, fan-out, and the query orchestrator shared by the
// aggregated ctx.web provider and the web_search_pro tool.

import { CJK_FIRST, DEFAULT_FANOUT, FALLBACK_TAIL, LATIN_FIRST } from './engines.js'
import { BackendError } from './http.js'
import { isCJK, normalizeUrlForDedup } from './util.js'

/**
 * Auto-routed engine chain for one query: first-choice list by language, then
 * the skill-era fallback tail, de-duplicated and availability-filtered.
 * Vertical engines (stack/hn/academic/gh) never enter the auto chain.
 */
export function autoChain(query, registry) {
  const first = isCJK(query) ? CJK_FIRST : LATIN_FIRST
  const chain = [...first, ...FALLBACK_TAIL]
  return [...new Set(chain)].filter((id) => {
    const backend = registry.get(id)
    return backend !== undefined && backend.available()
  })
}

/** Normalize a raw backend result: engine-tagged sources, client-side cap. */
function normalizeResult(engine, raw, cap) {
  const limit = cap ?? 10
  let sources = (raw?.sources ?? [])
    .filter((s) => typeof s?.url === 'string' && s.url.startsWith('http'))
    .map((s) => ({
      url: s.url,
      ...(s.title !== undefined && s.title !== '' ? { title: s.title } : {}),
      ...(s.snippet !== undefined && s.snippet !== '' ? { snippet: s.snippet } : {}),
      ...(s.publishedAt !== undefined ? { publishedAt: s.publishedAt } : {}),
      engine,
    }))
  let truncated = Boolean(raw?.truncated)
  if (sources.length > limit) {
    sources = sources.slice(0, limit)
    truncated = true
  }
  return {
    ...(raw?.content !== undefined && raw.content !== '' ? { content: raw.content } : {}),
    sources,
    truncated,
  }
}

function isEmpty(result) {
  return result.sources.length === 0 && result.content === undefined
}

/**
 * Run one query down its chain.
 *
 * Semantics: a hard error (BackendError) moves to the next engine. An empty
 * result is a soft failure on the auto path (try the next engine) but a valid
 * answer on the explicit-engine path (return immediately — the caller chose
 * that engine). All engines failing hard throws an aggregated BackendError.
 *
 * @returns {{result:object, attempts:Array}} normalized result plus telemetry.
 */
export async function runQuery(req, registry, { signal, explicitEngine } = {}) {
  const chain = explicitEngine !== undefined
    ? [explicitEngine, ...FALLBACK_TAIL.filter((id) => id !== explicitEngine)]
    : autoChain(req.query, registry)
  const attempts = []
  let lastEmpty
  let lastError
  for (const engine of chain) {
    const backend = registry.get(engine)
    if (backend === undefined || !backend.available()) continue
    const t0 = Date.now()
    try {
      const raw = await backend.search(req, signal)
      const result = normalizeResult(engine, raw, req.maxResults)
      const failedBefore = attempts.filter((a) => !a.ok).map((a) => a.engine)
      attempts.push({ engine, ok: true, count: result.sources.length, elapsedMs: Date.now() - t0, ...(failedBefore.length > 0 ? { via: `after ${failedBefore.join(' → ')}` } : {}) })
      if (!isEmpty(result)) return { result, attempts }
      lastEmpty = result
      if (explicitEngine !== undefined) return { result, attempts }
    } catch (e) {
      if (signal?.aborted) throw e
      attempts.push({ engine, ok: false, count: 0, elapsedMs: Date.now() - t0, error: e?.message ?? String(e) })
      lastError = e
    }
  }
  if (lastEmpty !== undefined) return { result: lastEmpty, attempts }
  if (attempts.length === 0) {
    throw new BackendError(explicitEngine ?? 'auto', 'no available search engine is configured (check API keys)')
  }
  throw new BackendError(explicitEngine ?? 'auto', `all engines failed: ${attempts.map((a) => `${a.engine} (${a.error ?? '?'})`).join('; ')}`)
}

/**
 * Fan one query out to several engines concurrently; merge with rank
 * interleave + URL dedup (tool-web merge semantics).
 */
export async function fanOutQuery(req, registry, { signal, engines } = {}) {
  const wanted = engines ?? DEFAULT_FANOUT
  const backends = [...new Set(wanted)]
    .map((id) => registry.get(id))
    .filter((b) => b !== undefined && b.available())
    .slice(0, 4)
  if (backends.length === 0) {
    throw new BackendError('fan_out', 'no available engine for fan-out')
  }
  const attempts = []
  const t0 = Date.now()
  const settled = await Promise.allSettled(backends.map(async (b) => {
    const raw = await b.search(req, signal)
    return { engine: b.id, result: normalizeResult(b.id, raw, req.maxResults) }
  }))
  const results = []
  for (let i = 0; i < settled.length; i++) {
    const s = settled[i]
    const elapsedMs = Date.now() - t0
    if (s.status === 'fulfilled') {
      attempts.push({ engine: s.value.engine, ok: true, count: s.value.result.sources.length, elapsedMs })
      results.push(s.value.result)
    } else {
      attempts.push({ engine: backends[i].id, ok: false, count: 0, elapsedMs, error: s.reason?.message ?? String(s.reason) })
    }
  }
  // A cancelled call is a cancellation, not an engine failure — propagate the
  // abort reason instead of reporting "all engines failed".
  if (settled.some((s) => s.status === 'rejected') && signal?.aborted) {
    const reason = signal.reason
    throw reason instanceof Error ? reason : new BackendError('fan_out', 'aborted')
  }
  const okResults = results.filter((r) => !isEmpty(r))
  if (okResults.length === 0 && results.length === 0) {
    throw new BackendError('fan_out', `all engines failed: ${attempts.map((a) => `${a.engine} (${a.error ?? '?'})`).join('; ')}`)
  }
  return { result: mergeResults(okResults.length > 0 ? okResults : results), attempts }
}

/** Round-robin interleave + URL dedup across per-engine (or per-query) results. */
export function mergeResults(results, cap = Number.POSITIVE_INFINITY) {
  const seen = new Set()
  const sources = []
  let dropped = false
  const maxRank = Math.max(0, ...results.map((r) => r.sources.length))
  merge:
  for (let rank = 0; rank < maxRank; rank++) {
    for (const result of results) {
      const source = result.sources[rank]
      if (source === undefined) continue
      const key = normalizeUrlForDedup(source.url)
      if (seen.has(key)) continue
      seen.add(key)
      if (sources.length >= cap) { dropped = true; break merge }
      sources.push(source)
    }
  }
  const content = results
    .map((r) => r.content)
    .filter((c) => c !== undefined && c !== '')
    .join('\n\n')
  return {
    ...(content !== '' ? { content } : {}),
    sources,
    truncated: dropped || results.some((r) => r.truncated),
  }
}

/**
 * The orchestrator entry shared by the provider and the tool.
 *
 * @param {object} spec - { queries: [{query, engine?}], engine?, fan_out?,
 *   maxResults?, freshness?, language?, region?, includeSites?, excludeSites?,
 *   topic?, similarTo?, extra?, fanOutEngines?, signal? }
 * @returns {Promise<{result:object, attempts:Array}>} merged result across
 *   queries (content sectioned per query) plus flattened telemetry.
 */
export async function orchestrate(spec, registry) {
  const { queries, signal } = spec
  const common = {
    maxResults: spec.maxResults,
    freshness: spec.freshness,
    language: spec.language,
    region: spec.region,
    includeSites: spec.includeSites,
    excludeSites: spec.excludeSites,
    topic: spec.topic,
    similarTo: spec.similarTo,
    extra: spec.extra,
  }
  const runs = await Promise.all(queries.map(async (q) => {
    const req = { ...common, query: q.query }
    const explicit = q.engine ?? spec.engine
    if (explicit !== undefined) {
      const known = typeof registry.knows === 'function' ? registry.knows(explicit) : registry.get(explicit) !== undefined
      if (!known) throw new BackendError(explicit, `unknown engine "${explicit}"`)
      if (registry.get(explicit) === undefined || !registry.get(explicit).available()) {
        throw new BackendError(explicit, `engine "${explicit}" is unavailable (missing API key or disabled)`)
      }
    }
    const run = spec.fanOut === true
      ? await fanOutQuery(req, registry, { signal, engines: spec.fanOutEngines })
      : await runQuery(req, registry, { signal, explicitEngine: explicit })
    return { query: q.query, ...run }
  }))
  const perQuery = runs.map((r) => r.result)
  const merged = mergeResults(perQuery, (spec.maxResults ?? 8) * queries.length)
  // Section multi-query answers by query, mirroring tool-web's merge.
  if (queries.length > 1) {
    const sections = runs
      .map((r) => (r.result.content !== undefined ? `### ${r.query}\n\n${r.result.content}` : undefined))
      .filter((s) => s !== undefined)
    if (sections.length > 0) merged.content = sections.join('\n\n')
  }
  const attempts = runs.flatMap((r) => r.attempts.map((a) => ({ ...a, query: r.query })))
  return { result: merged, attempts }
}
