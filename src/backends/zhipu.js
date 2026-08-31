// Zhipu web-search (search_pro/search_std). Key: ZHIPU_API_KEY.
// Ported from the websearch skill's `zhipu-search` script.

import { BackendError, bearer, fetchJson } from '../core/http.js'
import { clamp, freshnessBocha, toIsoDate } from '../core/util.js'

const ENDPOINT = 'https://open.bigmodel.cn/api/paas/v4/web_search'

export function create({ keys }) {
  return {
    id: 'zhipu',
    available: () => Boolean(keys.zhipu),
    async search(req, signal) {
      const body = {
        search_query: req.query,
        count: clamp(req.maxResults ?? 5, 1, 50),
        search_engine: req.extra?.engine === 'search_std' ? 'search_std' : 'search_pro',
      }
      const f = freshnessBocha(req.freshness)
      if (f !== undefined && f !== 'noLimit') body.search_recency_filter = f
      if (req.includeSites !== undefined && req.includeSites.length > 0) {
        body.search_domain_filter = req.includeSites
      }
      const data = await fetchJson('zhipu', ENDPOINT, { method: 'POST', headers: bearer(keys.zhipu), body, signal })
      if (data?.error !== undefined) {
        throw new BackendError('zhipu', `HTTP error: ${data.error.message ?? data.error.code ?? 'unknown'}`)
      }
      const items = data?.search_result ?? []
      return {
        sources: items.map((it) => ({
          url: it.link,
          title: it.title,
          snippet: it.content,
          ...(toIsoDate(it.publish_date) !== undefined ? { publishedAt: toIsoDate(it.publish_date) } : {}),
        })),
      }
    },
  }
}
