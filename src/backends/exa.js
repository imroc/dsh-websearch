// Exa semantic search + findSimilar. Key: EXA_API_KEY.
// Ported from the websearch skill's `exa` script.

import { bearer, fetchJson } from '../core/http.js'
import { clamp, freshnessStartISO } from '../core/util.js'

const BASE = 'https://api.exa.ai'

export function create({ keys }) {
  return {
    id: 'exa',
    available: () => Boolean(keys.exa),
    async search(req, signal) {
      const contents = {
        highlights: req.extra?.highlights !== false,
        text: req.extra?.text === true,
        summary: req.extra?.summary === true,
      }
      let url
      let body
      if (req.similarTo !== undefined) {
        url = `${BASE}/findSimilar`
        body = { url: req.similarTo, numResults: clamp(req.maxResults ?? 5, 1, 50), contents }
      } else {
        url = `${BASE}/search`
        body = {
          query: req.query,
          type: typeof req.extra?.searchType === 'string' ? req.extra.searchType : 'auto',
          numResults: clamp(req.maxResults ?? 5, 1, 50),
          contents,
        }
        if (typeof req.extra?.category === 'string') body.category = req.extra.category
        const since = freshnessStartISO(req.freshness)
        if (since !== undefined) body.startPublishedDate = since
        if (req.includeSites !== undefined && req.includeSites.length > 0) body.includeDomains = req.includeSites
      }
      const data = await fetchJson('exa', url, { method: 'POST', headers: bearer(keys.exa), body, signal })
      const results = data?.results ?? []
      return {
        ...(typeof data?.output === 'string' && data.output !== '' ? { content: data.output } : {}),
        sources: results.map((r) => ({
          url: r.url,
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(Array.isArray(r.highlights) && r.highlights.length > 0 ? { snippet: r.highlights.join(' … ') } : {}),
          ...(Array.isArray(r.summary) ? { snippet: r.summary.join(' ') } : {}),
          ...(typeof r.summary === 'string' && !Array.isArray(r.highlights) ? { snippet: r.summary } : {}),
          ...(r.publishedDate !== undefined ? { publishedAt: r.publishedDate } : {}),
        })),
      }
    },
  }
}
