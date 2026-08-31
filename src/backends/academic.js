// Academic search: Semantic Scholar (default) + arXiv — both free.
// extra.provider = 's2' | 'arxiv'; extra.year (s2, from-year); extra.field
// (arxiv category, e.g. cs.AI). Ported from the skill's `academic` script.

import { BackendError, fetchJson, fetchText, qs } from '../core/http.js'
import { clamp, decodeHtmlEntities } from '../core/util.js'

const S2 = 'https://api.semanticscholar.org/graph/v1/paper/search'
const ARXIV = 'https://export.arxiv.org/api/query'

async function searchS2(req, signal, apiKey) {
  const params = {
    query: req.query,
    limit: clamp(req.maxResults ?? 5, 1, 25),
    fields: 'title,authors,year,citationCount,url',
  }
  const year = Number(req.extra?.year)
  if (Number.isFinite(year) && year > 1900) params.year = `${Math.trunc(year)}-`
  const data = await fetchJson('academic', `${S2}?${qs(params)}`, {
    ...(apiKey !== undefined ? { headers: { 'x-api-key': apiKey } } : {}),
    signal,
    retries: 2,
  })
  if (data?.message !== undefined && !Array.isArray(data?.data)) {
    throw new BackendError('academic', `s2 error: ${data.message}`)
  }
  return {
    sources: (data?.data ?? []).map((p) => ({
      url: p.url,
      title: p.title,
      snippet: `${(p.authors ?? []).slice(0, 5).map((a) => a.name).join(', ')}${p.year !== undefined && p.year !== null ? ` · ${p.year}` : ''}${p.citationCount !== undefined ? ` · ${p.citationCount} citations` : ''}`,
    })),
  }
}

async function searchArxiv(req, signal) {
  let searchQuery = `all:${req.query}`
  if (typeof req.extra?.field === 'string' && req.extra.field !== '') {
    searchQuery = `cat:${req.extra.field} AND all:${req.query}`
  }
  const params = { search_query: searchQuery, max_results: clamp(req.maxResults ?? 5, 1, 50), sortBy: 'relevance' }
  const xml = await fetchText('academic', `${ARXIV}?${qs(params)}`, {
    headers: { 'user-agent': 'research-agent/1.0 (academic search)' },
    signal,
    timeoutMs: 60_000,
    retries: 2,
  })
  // Rate-limited arXiv returns an HTML page instead of Atom XML.
  if (!xml.includes('<feed')) {
    throw new BackendError('academic', 'arxiv returned a non-Atom response (rate limited)')
  }
  const sources = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  for (let m = entryRe.exec(xml); m !== null; m = entryRe.exec(xml)) {
    const block = m[1]
    const pick = (name) => {
      const t = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`).exec(block)
      return t === null ? undefined : decodeHtmlEntities(t[1].replace(/\s+/g, ' ').trim())
    }
    const id = pick('id')
    if (id === undefined) continue
    const authors = []
    const nameRe = /<name>([\s\S]*?)<\/name>/g
    for (let a = nameRe.exec(block); a !== null; a = nameRe.exec(block)) authors.push(decodeHtmlEntities(a[1].trim()))
    const published = pick('published')
    sources.push({
      url: id,
      title: pick('title'),
      snippet: authors.slice(0, 5).join(', '),
      ...(published !== undefined ? { publishedAt: published.slice(0, 10) } : {}),
    })
  }
  return { sources }
}

export function create({ keys }) {
  // Optional Semantic Scholar key — the anonymous pool is heavily rate-limited.
  const s2Key = keys.academic
  return {
    id: 'academic',
    available: () => true,
    async search(req, signal) {
      return req.extra?.provider === 'arxiv' ? searchArxiv(req, signal) : searchS2(req, signal, s2Key)
    },
  }
}
