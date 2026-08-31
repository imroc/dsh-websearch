// AnySearch — agent-oriented search, anonymous-capable (key optional and only
// raises rate limits). Vertical tags via extra.tag/extra.params. Ported from
// the websearch skill's `anysearch` script (protocol aligned with official CLI).

import { BackendError, fetchJson } from '../core/http.js'

const ENDPOINT = 'https://api.anysearch.com/v1/search'
const CLIENT = 'dsh-websearch/0.2.4'

export function create({ keys }) {
  return {
    id: 'anysearch',
    available: () => true,
    async search(req, signal) {
      const body = { query: req.query, max_results: Math.min(Math.max(req.maxResults ?? 5, 1), 10) }
      if (typeof req.extra?.tag === 'string') body.tag = req.extra.tag
      if (req.extra?.params !== undefined && typeof req.extra.params === 'object') body.params = req.extra.params
      if (typeof req.extra?.zone === 'string') body.zone = req.extra.zone
      if (req.language !== undefined) body.language = req.language
      const headers = { 'x-anysearch-client': CLIENT, ...(keys.anysearch !== undefined ? { authorization: `Bearer ${keys.anysearch}` } : {}) }
      const data = await fetchJson('anysearch', ENDPOINT, { method: 'POST', headers, body, signal, timeoutMs: 40_000 })
      const code = data?.code ?? 0
      if (code !== 0) {
        throw new BackendError('anysearch', `${data?.message ?? 'API error'}${data?.request_id !== undefined ? ` (request_id: ${data.request_id})` : ''}`)
      }
      const results = data?.data?.results ?? []
      return {
        sources: results.map((r) => {
          const snippet = r.content ?? r.snippet
          return {
            url: r.url,
            ...(r.title !== undefined ? { title: r.title } : {}),
            ...(snippet !== undefined ? { snippet } : {}),
          }
        }),
      }
    },
  }
}
