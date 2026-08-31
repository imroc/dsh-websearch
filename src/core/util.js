// Shared helpers: freshness mapping, URL normalization, HTML entity decode,
// date coercion, CJK detection. Pure functions, no dependencies.

const DAY = 86400_000

/**
 * Whether the text contains CJK ideographs — deliberately Chinese-only (no
 * kana/hangul): the Chinese-first routing exists because bocha/zhipu/wsa are
 * Chinese-market engines, not because the detector claims full CJK coverage.
 */
export function isCJK(text) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text ?? '')
}

/** Clamp n into [lo, hi]. */
export function clamp(n, lo, hi) {
  const v = Math.trunc(Number(n))
  if (!Number.isFinite(v)) return lo
  return Math.min(hi, Math.max(lo, v))
}

// ---- freshness ------------------------------------------------------------
// Normalized freshness: 'day' | 'week' | 'month' | 'year' | 'YYYY-MM-DDtoYYYY-MM-DD'.

const WORD_TO_DAYS = { day: 1, week: 7, month: 30, year: 365 }

/**
 * Parse the normalized freshness value.
 * @returns {{days:number}|{from:string,to:string}|null} window in days, or an
 *   explicit date range; null when absent/unrecognized.
 */
export function parseFreshness(f) {
  if (typeof f !== 'string' || f === '') return null
  if (WORD_TO_DAYS[f] !== undefined) return { days: WORD_TO_DAYS[f] }
  const m = /^(\d{4}-\d{2}-\d{2})to(\d{4}-\d{2}-\d{2})$/.exec(f)
  if (m !== null) return { from: m[1], to: m[2] }
  return null
}

/** Bocha/Zhipu freshness vocabulary. */
export function freshnessBocha(f) {
  const p = parseFreshness(f)
  if (p === null) return undefined
  if (p.days !== undefined) {
    return { 1: 'oneDay', 7: 'oneWeek', 30: 'oneMonth', 365: 'oneYear' }[p.days]
  }
  return 'noLimit'
}

/** Tavily time_range vocabulary. */
export function freshnessTavily(f) {
  const p = parseFreshness(f)
  if (p === null) return undefined
  if (p.days !== undefined) {
    return { 1: 'day', 7: 'week', 30: 'month', 365: 'year' }[p.days]
  }
  return 'year'
}

/** Brave freshness vocabulary (pd/pw/pm/py or date range). */
export function freshnessBrave(f) {
  const p = parseFreshness(f)
  if (p === null) return undefined
  if (p.days !== undefined) {
    return { 1: 'pd', 7: 'pw', 30: 'pm', 365: 'py' }[p.days]
  }
  return `${p.from}to${p.to}`
}

/** Google tbs parameter (Serper/Firecrawl). */
export function freshnessTbs(f) {
  const p = parseFreshness(f)
  if (p === null) return undefined
  if (p.days !== undefined) {
    return { 1: 'qdr:d', 7: 'qdr:w', 30: 'qdr:m', 365: 'qdr:y' }[p.days]
  }
  // Custom ranges use the cdr (custom date range) vocabulary with MM/DD/YYYY
  // bounds — Google silently ignores anything else (e.g. `qdr:c:from..to`).
  const us = (iso) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
    return m === null ? iso : `${m[2]}/${m[3]}/${m[1]}`
  }
  return `cdr:1,cd_min:${us(p.from)},cd_max:${us(p.to)}`
}

/** Exa startPublishedDate: ISO date of the window start. */
export function freshnessStartISO(f) {
  const p = parseFreshness(f)
  if (p === null) return undefined
  if (p.from !== undefined) return p.from
  return new Date(Date.now() - p.days * DAY).toISOString().slice(0, 10)
}

/** Epoch-seconds range for WSA / HN. */
export function freshnessUnixRange(f) {
  const p = parseFreshness(f)
  if (p === null) return undefined
  if (p.from !== undefined) {
    return { from: Math.floor(new Date(`${p.from}T00:00:00Z`).getTime() / 1000), to: Math.floor(new Date(`${p.to}T23:59:59Z`).getTime() / 1000) }
  }
  return { from: Math.floor((Date.now() - p.days * DAY) / 1000) }
}

// ---- URLs and text --------------------------------------------------------

const TRACKING_PARAMS = /^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$|ref$|spm$|vd_source$)/i

/** Canonicalize a URL for cross-engine dedup: drop hash, tracking params, trailing slash. */
export function normalizeUrlForDedup(url) {
  try {
    const u = new URL(url)
    const params = [...u.searchParams].filter(([k]) => !TRACKING_PARAMS.test(k))
    u.search = ''
    for (const [k, v] of params) u.searchParams.append(k, v)
    u.hash = ''
    if (u.pathname !== '/') u.pathname = u.pathname.replace(/\/+$/, '')
    return u.toString().toLowerCase()
  } catch {
    return String(url).toLowerCase()
  }
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', middot: '·' }

/** Decode common HTML entities (named + numeric) — StackExchange titles, RSS descriptions. */
export function decodeHtmlEntities(s) {
  if (typeof s !== 'string') return s
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => HTML_ENTITIES[name.toLowerCase()] ?? m)
}

function safeCodePoint(code) {
  try { return String.fromCodePoint(code) } catch { return '' }
}

/** Strip HTML tags and collapse whitespace (snippets from scraped sources). */
export function stripHtml(s) {
  if (typeof s !== 'string') return undefined
  const out = decodeHtmlEntities(s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')).trim()
  return out === '' ? undefined : out
}

/** RFC 822 pubDate (RSS) → ISO date string. */
export function rfc822ToISO(s) {
  if (typeof s !== 'string' || s === '') return undefined
  const t = Date.parse(s)
  return Number.isNaN(t) ? undefined : new Date(t).toISOString()
}

/** Coerce a provider date value (epoch seconds / ISO string / YYYY-MM-DD) to an ISO-ish string. */
export function toIsoDate(v) {
  if (v === undefined || v === null || v === '') return undefined
  if (typeof v === 'number') {
    const ms = v < 1e12 ? v * 1000 : v
    return new Date(ms).toISOString()
  }
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}/.test(s)) {
    const norm = s.replace(' ', 'T')
    const t = Date.parse(norm.endsWith('Z') ? norm : `${norm}Z`)
    if (!Number.isNaN(t)) return new Date(t).toISOString()
    const t2 = Date.parse(norm)
    if (!Number.isNaN(t2)) return new Date(t2).toISOString()
  }
  if (/^\d{10}$/.test(s)) return new Date(Number(s) * 1000).toISOString()
  return undefined
}

/** Hostname of a URL (label fallback), never throws. */
export function hostOf(url) {
  try { return new URL(url).hostname } catch { return String(url) }
}
