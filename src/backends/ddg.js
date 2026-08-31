// DuckDuckGo HTML endpoint — free, no key, rate-limited. The final safety net
// of every fallback chain. Parses the html.duckduckgo.com result anchors and
// resolves the uddg= redirect wrappers (approach validated by community plugins).

import { fetchText } from '../core/http.js'
import { decodeHtmlEntities, stripHtml } from '../core/util.js'

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

export function create() {
  return {
    id: 'ddg',
    available: () => true,
    async search(req, signal) {
      const params = new URLSearchParams({ q: req.query })
      if (typeof req.region === 'string' && req.region !== '') params.set('kl', req.region)
      const html = await fetchText('ddg', ENDPOINT, {
        method: 'POST',
        headers: { 'user-agent': UA, 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
        body: params.toString(),
        signal,
      })
      const limit = req.maxResults ?? 10
      const sources = []
      const seen = new Set()
      const anchorRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
      for (let m = anchorRe.exec(html); m !== null && sources.length < limit; m = anchorRe.exec(html)) {
        const url = resolveHref(m[1])
        if (!url.startsWith('http') || seen.has(url)) continue
        seen.add(url)
        const title = stripHtml(m[2])
        sources.push({ url, ...(title !== undefined ? { title } : {}) })
      }
      // Attach snippets by ordinal position of result blocks.
      const snippetRe = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g
      let i = 0
      for (let m = snippetRe.exec(html); m !== null && i < sources.length; m = snippetRe.exec(html)) {
        const snippet = stripHtml(m[1])
        if (snippet !== undefined) sources[i].snippet = snippet.slice(0, 300)
        i++
      }
      return { sources }
    },
  }
}
