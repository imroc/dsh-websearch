// Firecrawl v2 search. Key: FIRECRAWL_API_KEY.
// The v2 response shape is validated by the live smoke test; parsing accepts
// both `data.web/news` arrays and a flat top-level array of results.

import { bearer, fetchJson } from '../core/http.js'
import { clamp, freshnessTbs, toIsoDate } from '../core/util.js'

const ENDPOINT = 'https://api.firecrawl.dev/v2/search'

function collect(data) {
  if (data === null || typeof data !== 'object') return []
  if (Array.isArray(data)) return data
  const d = data.data ?? data
  if (Array.isArray(d)) return d
  const buckets = []
  for (const key of ['web', 'news', 'results', 'organic']) {
    const v = d?.[key]
    if (Array.isArray(v)) buckets.push(...v)
  }
  return buckets
}

export function create({ keys }) {
  const apiKey = keys.firecrawl
  return {
    id: 'firecrawl',
    available: () => Boolean(apiKey),
    async search(req, signal) {
      const body = { query: req.query, limit: clamp(req.maxResults ?? 5, 1, 100) }
      if (req.topic === 'news') {
        body.sources = Array.isArray(req.extra?.sources) ? req.extra.sources : ['news', 'web']
      } else if (Array.isArray(req.extra?.sources)) {
        body.sources = req.extra.sources
      }
      const tbs = freshnessTbs(req.freshness)
      if (tbs !== undefined) body.tbs = tbs
      if (req.region !== undefined) body.country = req.region
      const data = await fetchJson('firecrawl', ENDPOINT, { method: 'POST', headers: bearer(apiKey), body, signal, timeoutMs: 30_000 })
      return {
        sources: collect(data).map((r) => ({
          url: r.url ?? r.link,
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.description ?? r.snippet !== undefined ? { snippet: r.description ?? r.snippet } : {}),
          ...(toIsoDate(r.publishedDate ?? r.date) !== undefined ? { publishedAt: toIsoDate(r.publishedDate ?? r.date) } : {}),
        })).filter((s) => typeof s.url === 'string' && s.url.startsWith('http')),
      }
    },
  }
}
