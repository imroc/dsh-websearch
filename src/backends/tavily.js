// Tavily search — AI-optimized results plus an optional generated answer.
// Key: TAVILY_API_KEY. Ported from the websearch skill's `tavily` script.

import { bearer, fetchJson } from '../core/http.js'
import { clamp, freshnessTavily, toIsoDate } from '../core/util.js'

const ENDPOINT = 'https://api.tavily.com/search'

export function create({ keys }) {
  const apiKey = keys.tavily
  return {
    id: 'tavily',
    available: () => Boolean(apiKey),
    async search(req, signal) {
      const body = {
        query: req.query,
        max_results: clamp(req.maxResults ?? 5, 1, 20),
        search_depth: req.extra?.depth === 'advanced' ? 'advanced' : 'basic',
        topic: req.topic === 'news' ? 'news' : 'general',
        include_answer: true,
      }
      const tr = freshnessTavily(req.freshness)
      if (tr !== undefined) body.time_range = tr
      if (req.includeSites !== undefined && req.includeSites.length > 0) body.include_domains = req.includeSites
      if (req.excludeSites !== undefined && req.excludeSites.length > 0) body.exclude_domains = req.excludeSites
      const data = await fetchJson('tavily', ENDPOINT, { method: 'POST', headers: bearer(apiKey), body, signal })
      const results = data?.results ?? []
      return {
        ...(typeof data?.answer === 'string' && data.answer !== '' ? { content: data.answer } : {}),
        sources: results.map((r) => ({
          url: r.url,
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.content !== undefined ? { snippet: r.content } : {}),
          ...(toIsoDate(r.published_date) !== undefined ? { publishedAt: toIsoDate(r.published_date) } : {}),
        })),
      }
    },
  }
}
