// Serper.dev — Google SERP. Key: SERPER_API_KEY (serper.dev, free 2500 on signup).

import { fetchJson } from '../core/http.js'
import { clamp, freshnessTbs, toIsoDate } from '../core/util.js'

const BASE = 'https://google.serper.dev'

/** Fold include/exclude sites into Google query operators. */
function applySiteOperators(query, includeSites, excludeSites) {
  let q = query
  if (includeSites !== undefined && includeSites.length > 0) {
    const sites = includeSites.map((s) => `site:${s}`)
    q = `${q} ${sites.length === 1 ? sites[0] : `(${sites.join(' OR ')})`}`
  }
  for (const site of excludeSites ?? []) q += ` -site:${site}`
  return q
}

export function create({ keys }) {
  return {
    id: 'serper',
    available: () => Boolean(keys.serper),
    async search(req, signal) {
      const news = req.topic === 'news'
      const body = {
        q: applySiteOperators(req.query, req.includeSites, req.excludeSites),
        num: clamp(req.maxResults ?? 10, 1, 20),
        ...(req.language !== undefined ? { hl: req.language } : {}),
        ...(req.region !== undefined ? { gl: req.region } : {}),
        ...(freshnessTbs(req.freshness) !== undefined ? { tbs: freshnessTbs(req.freshness) } : {}),
      }
      const data = await fetchJson('serper', `${BASE}/${news ? 'news' : 'search'}`, {
        method: 'POST',
        headers: { 'x-api-key': keys.serper },
        body,
        signal,
      })
      const organic = news ? data?.news : data?.organic
      const results = organic ?? []
      return {
        sources: results.map((r) => ({
          url: r.link,
          ...(r.title !== undefined ? { title: r.title } : {}),
          ...(r.snippet !== undefined ? { snippet: r.snippet } : {}),
          ...(toIsoDate(r.date) !== undefined ? { publishedAt: toIsoDate(r.date) } : {}),
        })),
      }
    },
  }
}
