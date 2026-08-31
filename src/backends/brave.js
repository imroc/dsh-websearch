// Brave Search API — web + news endpoints. Key: BRAVE_SEARCH_API_KEY.

import { fetchJson, qs } from '../core/http.js'
import { clamp, freshnessBrave, toIsoDate } from '../core/util.js'

const BASE = 'https://api.search.brave.com/res/v1'

function headers(key) {
  return { accept: 'application/json', 'accept-encoding': 'gzip', 'x-subscription-token': key }
}

export function create({ keys }) {
  const apiKey = keys.brave
  return {
    id: 'brave',
    available: () => Boolean(apiKey),
    async search(req, signal) {
      const news = req.topic === 'news'
      const params = {
        q: req.query,
        count: clamp(req.maxResults ?? 10, 1, 20),
        ...(req.region !== undefined ? { country: req.region.toUpperCase() } : {}),
        ...(req.language !== undefined ? { search_lang: req.language } : {}),
        ...(freshnessBrave(req.freshness) !== undefined ? { freshness: freshnessBrave(req.freshness) } : {}),
        // Brave's site_filter takes a single domain; further domains fall back
        // to query operators (best-effort).
        ...(!news && req.includeSites?.[0] !== undefined ? { site_filter: req.includeSites[0] } : {}),
      }
      const data = await fetchJson('brave', `${BASE}/${news ? 'news' : 'web'}/search?${qs(params)}`, { headers: headers(apiKey), signal })
      const results = (news ? data?.news?.results : data?.web?.results) ?? []
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
