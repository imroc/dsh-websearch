// Bocha 博查 — Chinese web search. Key: BOCHA_API_KEY.
// Ported from the websearch skill's `bocha` script (api.bochaai.com/v1/web-search).

import { bearer, fetchJson } from '../core/http.js'
import { clamp, freshnessBocha, toIsoDate } from '../core/util.js'

const ENDPOINT = 'https://api.bochaai.com/v1/web-search'

export function create({ keys }) {
  const apiKey = keys.bocha
  return {
    id: 'bocha',
    available: () => Boolean(apiKey),
    async search(req, signal) {
      const body = { query: req.query, count: clamp(req.maxResults ?? 10, 1, 50) }
      const f = freshnessBocha(req.freshness)
      if (f !== undefined && f !== 'noLimit') body.freshness = f
      const data = await fetchJson('bocha', ENDPOINT, { method: 'POST', headers: bearer(apiKey), body, signal })
      const items = data?.data?.webPages?.value ?? []
      return {
        sources: items.map((it) => ({
          url: it.url,
          title: it.name,
          snippet: it.snippet,
          ...(toIsoDate(it.datePublished ?? it.dateLastCrawled) !== undefined ? { publishedAt: toIsoDate(it.datePublished ?? it.dateLastCrawled) } : {}),
        })),
      }
    },
  }
}
