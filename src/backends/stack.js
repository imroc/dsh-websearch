// StackExchange advanced search — free, no key, daily quota. The precise tool
// for programming error messages. Ported from the skill's `stack` script.

import { BackendError, fetchJson, qs } from '../core/http.js'
import { clamp, decodeHtmlEntities, toIsoDate } from '../core/util.js'

const BASE = 'https://api.stackexchange.com/2.3/search/advanced'

export function create() {
  return {
    id: 'stack',
    available: () => true,
    async search(req, signal) {
      const params = {
        order: 'desc',
        sort: ['relevance', 'votes', 'creation', 'activity'].includes(req.extra?.sort) ? req.extra.sort : 'relevance',
        q: req.query,
        site: typeof req.extra?.site === 'string' ? req.extra.site : 'stackoverflow',
        pagesize: clamp(req.maxResults ?? 5, 1, 30),
        filter: 'default',
      }
      if (typeof req.extra?.tagged === 'string') params.tagged = req.extra.tagged
      if (req.extra?.answered === true) params.accepted = 'true'
      const data = await fetchJson('stack', `${BASE}?${qs(params)}`, { signal })
      if (data?.error_message !== undefined) {
        throw new BackendError('stack', `HTTP error: ${data.error_message}`)
      }
      const items = data?.items ?? []
      return {
        sources: items.map((it) => ({
          url: it.link,
          title: decodeHtmlEntities(it.title),
          snippet: `score ${it.score} · ${it.answer_count} answers${it.is_answered ? ' · accepted answer' : ''}${Array.isArray(it.tags) && it.tags.length > 0 ? ` · [${it.tags.join(',')}]` : ''}`,
          ...(toIsoDate(it.creation_date) !== undefined ? { publishedAt: toIsoDate(it.creation_date) } : {}),
        })),
        // `truncated` stays reserved for actual result truncation — a low API
        // quota is not "truncated" and would pollute merged fan-out results.
      }
    },
  }
}
