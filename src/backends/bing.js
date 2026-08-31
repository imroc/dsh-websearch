// Bing via RSS (format=rss) — free, no key. Scrape-based and may break; kept
// low in every chain. News uses bing.com/news/search?format=rss.

import { fetchText, qs } from '../core/http.js'
import { decodeHtmlEntities, rfc822ToISO } from '../core/util.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Extract <item> blocks from an RSS document. */
function rssItems(xml) {
  const items = []
  const re = /<item>([\s\S]*?)<\/item>/g
  for (let m = re.exec(xml); m !== null; m = re.exec(xml)) items.push(m[1])
  return items
}

function tag(block, name) {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block)
  if (m === null) return undefined
  let v = m[1]
  if (v.startsWith('<![CDATA[')) v = v.slice(9, -3)
  return decodeHtmlEntities(v).trim()
}

function applySiteOperators(query, includeSites, excludeSites) {
  let q = query
  for (const site of includeSites ?? []) q += ` site:${site}`
  for (const site of excludeSites ?? []) q += ` -site:${site}`
  return q
}

export function create() {
  return {
    id: 'bing',
    available: () => true,
    async search(req, signal) {
      const news = req.topic === 'news'
      // Without an explicit market Bing RSS returns unrelated localized junk —
      // always pin a market (region when given, else en-US).
      const params = {
        q: applySiteOperators(req.query, req.includeSites, req.excludeSites),
        format: 'rss',
        mkt: (req.region ?? 'us').toUpperCase() === 'CN' ? 'zh-CN' : 'en-US',
        ...(req.language !== undefined ? { setlang: req.language } : {}),
      }
      const xml = await fetchText('bing', `https://www.bing.com/${news ? 'news/search' : 'search'}?${qs(params)}`, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' },
        signal,
      })
      if (!/<item[\s>]/i.test(xml)) return { sources: [] }
      const limit = req.maxResults ?? 10
      return {
        sources: rssItems(xml).slice(0, limit).map((item) => {
          const source = { url: tag(item, 'link'), title: tag(item, 'title') }
          const snippet = tag(item, 'description')
          if (snippet !== undefined && snippet !== '') source.snippet = snippet.slice(0, 300)
          const pub = rfc822ToISO(tag(item, 'pubDate') ?? '')
          if (pub !== undefined) source.publishedAt = pub
          return source
        }).filter((s) => typeof s.url === 'string' && s.url.startsWith('http')),
      }
    },
  }
}
