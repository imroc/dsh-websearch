// DuckDuckGo HTML endpoint — free, no key, rate-limited. The final safety net
// of every fallback chain. Parses the html.duckduckgo.com result anchors and
// resolves the uddg= redirect wrappers (approach validated by community plugins).

import { BackendError, fetchText } from '../core/http.js'
import { stripHtml } from '../core/util.js'

const ENDPOINT = 'https://html.duckduckgo.com/html/'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Resolve DDG redirect hrefs (//duckduckgo.com/l/?uddg=<encoded>) to real URLs. */
function resolveHref(href) {
  let url = href
  if (url.startsWith('//')) url = `https:${url}`
  try {
    const u = new URL(url)
    if (u.hostname.endsWith('duckduckgo.com') && u.pathname === '/l/') {
      const uddg = u.searchParams.get('uddg')
      if (uddg !== null) return decodeURIComponent(uddg)
    }
    return u.toString()
  } catch {
    return url
  }
}

/** Attribute value of an anchor tag, independent of attribute order. */
function attr(attrs, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs)
  return m === null ? undefined : m[1]
}

export function create() {
  return {
    id: 'ddg',
    available: () => true,
    async search(req, signal) {
      const params = new URLSearchParams({ q: req.query })
      // kl takes a full 'cc-ll' market form (us-en, wt-wt…); a bare country
      // code is ignored, so combine with the language hint.
      if (typeof req.region === 'string' && req.region !== '') {
        params.set('kl', /^[a-z]{2}-[a-z]{2}$/i.test(req.region) ? req.region : `${req.region}-${req.language ?? 'en'}`)
      }
      const html = await fetchText('ddg', ENDPOINT, {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
        body: params.toString(),
        signal,
      })
      // A challenge/consent/structure-changed page carries none of DDG's
      // result markers — that is an error, not "no results" (it would
      // otherwise silently poison every fallback chain that ends here).
      if (!/result__(a|snippet)/.test(html)) {
        throw new BackendError('ddg', 'unrecognized response (rate limited or page structure changed)')
      }
      const limit = req.maxResults ?? 10
      const sources = []
      const seen = new Set()
      // Pair each result anchor with the snippet that FOLLOWS it (before the
      // next result anchor). Ordinal-index pairing mis-assigns snippets as
      // soon as any anchor is filtered out (ads, duplicate URLs).
      let last = null
      for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)) {
        const cls = attr(m[1], 'class') ?? ''
        if (/\bresult__a\b/.test(cls)) {
          const url = resolveHref(attr(m[1], 'href') ?? '')
          if (!url.startsWith('http') || seen.has(url)) { last = null; continue }
          seen.add(url)
          const title = stripHtml(m[2])
          last = { url, ...(title !== undefined ? { title } : {}) }
          if (sources.length < limit) sources.push(last)
        } else if (/\bresult__snippet\b/.test(cls) && last !== null && last.snippet === undefined) {
          const snippet = stripHtml(m[2])
          if (snippet !== undefined) last.snippet = snippet.slice(0, 300)
        }
      }
      return { sources }
    },
  }
}
