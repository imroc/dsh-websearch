// Brave Search API — web + news endpoints. Key: BRAVE_SEARCH_API_KEY.

import { fetchJson, qs } from '../core/http.js'
import { clamp, freshnessBrave, toIsoDate } from '../core/util.js'

const BASE = 'https://api.search.brave.com/res/v1'

function headers(key) {
  return { accept: 'application/json', 'accept-encoding': 'gzip', 'x-subscription-token': key }
}

export function create({ keys }) {
  return {
    id: 'brave',
    available: () => Boolean(keys.brave),
    async search(req, signal) {
      const news = req.topic === 'news'
      const fresh = freshnessBrave(req.freshness)
      const params = {
        q: req.query,
        count: clamp(req.maxResults ?? 10, 1, 20),
        ...(req.region !== undefined ? { country: req.region.toUpperCase() } : {}),
        ...(req.language !== undefined ? { search_lang: req.language } : {}),
        ...(fresh !== undefined ? { freshness: fresh } : {}),
        // Brave's site_filter takes a single domain; further domains fall back
        // to query operators (best-effort).
        ...(!news && req.includeSites?.[0] !== undefined ? { site_filter: req.includeSites[0] } : {}),
      }
      const data = await fetchJson('brave', `${BASE}/${news ? 'news' : 'web'}/search?${qs(params)}`, { headers: headers(keys.brave), signal })
      // Web search nests under `web.results`; the News endpoint puts `results`
      // at the TOP LEVEL (verified against the live API + official API
      // reference 2026-08-31) — there is no `news` wrapper. The `data?.news`
      // lookup is only a defensive fallback for older shapes.
      const results = (news ? data?.results ?? data?.news?.results : data?.web?.results) ?? []
      return {
        sources: results.map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.description,
          ...(toIsoDate(r.age ?? r.page_age ?? r.date) !== undefined ? { publishedAt: toIsoDate(r.age ?? r.page_age ?? r.date) } : {}),
        })),
      }
    },
  }
}
