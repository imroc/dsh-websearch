// Bing via RSS (format=rss) — free, no key. Scrape-based and may break; kept
// low in every chain. News uses bing.com/news/search?format=rss.

import { BackendError, fetchText, qs } from '../core/http.js'
import { decodeHtmlEntities, rfc822ToISO } from '../core/util.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/** Extract <item> blocks from an RSS document (attributes on <item> allowed). */
function rssItems(xml) {
  const items = []
  const re = /<item[^>]*>([\s\S]*?)<\/item>/g
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

// Bing markets (mkt) are language-COUNTRY pairs. Known regions map directly;
// an unknown 2-letter region combines with the language hint; anything else
// falls back to en-US (an unpinned market returns localized junk).
const MKT_BY_REGION = {
  cn: 'zh-CN', tw: 'zh-TW', hk: 'zh-HK', mo: 'zh-MO', sg: 'zh-SG',
  us: 'en-US', gb: 'en-GB', uk: 'en-GB', au: 'en-AU', ca: 'en-CA', in: 'en-IN', nz: 'en-NZ', ie: 'en-IE', za: 'en-ZA',
  jp: 'ja-JP', kr: 'ko-KR', de: 'de-DE', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pt: 'pt-PT', br: 'pt-BR',
  ru: 'ru-RU', nl: 'nl-NL', pl: 'pl-PL', se: 'sv-SE', no: 'nb-NO', dk: 'da-DK', fi: 'fi-FI', tr: 'tr-TR',
  mx: 'es-MX', ar: 'es-AR', cl: 'es-CL', id: 'id-ID', th: 'th-TH', vn: 'vi-VN', ph: 'en-PH', my: 'en-MY',
}

function mktOf(region, language) {
  if (typeof region === 'string' && region !== '') {
    const key = region.toLowerCase()
    if (MKT_BY_REGION[key] !== undefined) return MKT_BY_REGION[key]
    if (/^[a-z]{2}-[a-z]{2}$/.test(key)) {
      const [lang, country] = key.split('-')
      return `${lang}-${country.toUpperCase()}` // normalize full forms to xx-XX
    }
    if (/^[a-z]{2}$/.test(key) && typeof language === 'string' && /^[a-z]{2}$/.test(language)) {
      return `${language}-${key}`.toUpperCase()
    }
  }
  if (typeof language === 'string' && language.toLowerCase().startsWith('zh')) return 'zh-CN'
  return 'en-US'
}

export function create() {
  return {
    id: 'bing',
    available: () => true,
    async search(req, signal) {
      const news = req.topic === 'news'
      // Without an explicit market Bing RSS returns unrelated localized junk —
      // always pin a market (region/language-aware, else en-US).
      const params = {
        q: applySiteOperators(req.query, req.includeSites, req.excludeSites),
        format: 'rss',
        mkt: mktOf(req.region, req.language),
        ...(req.language !== undefined ? { setlang: req.language } : {}),
      }
      const xml = await fetchText('bing', `https://www.bing.com/${news ? 'news/search' : 'search'}?${qs(params)}`, {
        headers: { 'user-agent': UA, accept: 'application/rss+xml, application/xml, text/xml' },
        signal,
      })
      // A consent/anti-bot/rate-limit page comes back as 200 + HTML — that is
      // an error, not "no results" (an explicit engine would otherwise return
      // a misleading empty answer instead of falling back).
      if (!/<(rss|channel)[\s>]/i.test(xml)) {
        throw new BackendError('bing', 'non-RSS response (rate limited or blocked)')
      }
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
