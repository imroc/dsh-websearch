// Hacker News via the Algolia API — free, no key. Tech community discussion
// and sentiment. Ported from the skill's `hn` script.

import { fetchJson, qs } from '../core/http.js'
import { clamp, toIsoDate } from '../core/util.js'

const BASE = 'https://hn.algolia.com/api/v1'

export function create() {
  return {
    id: 'hn',
    available: () => true,
    async search(req, signal) {
      const byDate = req.extra?.sort === 'date'
      const params = { query: req.query, hitsPerPage: clamp(req.maxResults ?? 10, 1, 50) }
      if (req.extra?.type === 'story' || req.extra?.type === undefined) params.tags = 'story'
      else if (req.extra?.type === 'comment') params.tags = 'comment'
      const days = Number(req.extra?.days)
      if (Number.isFinite(days) && days > 0) {
        params.numericFilters = `created_at_i>${Math.floor(Date.now() / 1000) - Math.trunc(days) * 86400}`
      }
      const data = await fetchJson('hn', `${BASE}/${byDate ? 'search_by_date' : 'search'}?${qs(params)}`, { signal })
      const hits = (data?.hits ?? []).filter((h) => h.title !== undefined || h.story_title !== undefined)
      return {
        sources: hits.map((h) => ({
          url: typeof h.url === 'string' && h.url.startsWith('http') ? h.url : `https://news.ycombinator.com/item?id=${h.objectID}`,
          title: h.title ?? h.story_title,
          snippet: `${h.points ?? 0} points · ${h.num_comments ?? 0} comments`,
          ...(toIsoDate(h.created_at) !== undefined ? { publishedAt: toIsoDate(h.created_at) } : {}),
        })),
      }
    },
  }
}
