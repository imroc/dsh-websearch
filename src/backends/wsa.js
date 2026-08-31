// Tencent Cloud WSA (Web Search API). Key: WSAPI_KEY.
// Ported from the websearch skill's `wsa` script — note Response.Pages holds
// JSON-encoded STRINGS, each parsed separately.

import { BackendError, bearer, fetchJson } from '../core/http.js'
import { clamp, freshnessUnixRange } from '../core/util.js'

const ENDPOINT = 'https://api.wsa.cloud.tencent.com/SearchPro'
const CNT_STEPS = [10, 20, 30, 40, 50]

export function create({ keys }) {
  return {
    id: 'wsa',
    available: () => Boolean(keys.wsa),
    async search(req, signal) {
      const wanted = clamp(req.maxResults ?? 10, 1, 50)
      const cnt = CNT_STEPS.find((step) => step >= wanted) ?? 50
      const body = { Query: req.query, Cnt: cnt }
      if (req.includeSites?.[0] !== undefined) body.Site = req.includeSites[0]
      const range = freshnessUnixRange(req.freshness)
      if (range !== undefined) {
        // WSA validates FromTime/ToTime as a pair; omitting ToTime is rejected.
        body.FromTime = range.from
        body.ToTime = range.to ?? Math.floor(Date.now() / 1000)
      }
      const data = await fetchJson('wsa', ENDPOINT, { method: 'POST', headers: bearer(keys.wsa), body, signal })
      const response = data?.Response ?? {}
      if (response.Error !== undefined) {
        throw new BackendError('wsa', `HTTP error: ${JSON.stringify(response.Error)}`)
      }
      const sources = []
      for (const page of response.Pages ?? []) {
        let d
        try { d = typeof page === 'string' ? JSON.parse(page) : page } catch { continue }
        if (typeof d?.url === 'string') {
          sources.push({
            url: d.url,
            ...(d.title !== undefined ? { title: d.title } : {}),
            ...(d.passage !== undefined ? { snippet: String(d.passage).slice(0, 300) } : {}),
          })
        }
      }
      return { sources: sources.slice(0, wanted) }
    },
  }
}
