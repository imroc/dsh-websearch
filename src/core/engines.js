// Engine metadata: static facts shared by routing, the tool description, and
// argument validation. Backends live in src/backends/.

/**
 * @typedef {Object} EngineInfo
 * @property {string} label      — human label
 * @property {'general'|'chinese'|'semantic'|'answer'|'vertical'} kind
 * @property {string} [keyEnv]   — env var holding the API key (absent = keyless)
 * @property {boolean} free      — usable without any key (possibly rate-limited)
 * @property {string} note       — one-line capability note for the model
 */

export const ENGINE_INFO = {
  brave: { label: 'Brave', kind: 'general', keyEnv: 'BRAVE_SEARCH_API_KEY', free: false, note: 'high-quality general web search (best default for English/technical)' },
  bocha: { label: 'Bocha 博查', kind: 'chinese', keyEnv: 'BOCHA_API_KEY', free: false, note: 'best Chinese web search' },
  zhipu: { label: 'Zhipu web-search', kind: 'chinese', keyEnv: 'ZHIPU_API_KEY', free: false, note: 'Chinese web search, structured citations (extra.engine=search_pro|search_std)' },
  wsa: { label: 'Tencent WSA', kind: 'chinese', keyEnv: 'WSAPI_KEY', free: false, note: 'Chinese web search with site/time filters' },
  bailian: { label: 'Bailian Q&A', kind: 'answer', keyEnv: 'DASHSCOPE_API_KEY', free: false, note: 'Chinese answer engine: returns a model-generated answer with live web info, no source list' },
  exa: { label: 'Exa', kind: 'semantic', keyEnv: 'EXA_API_KEY', free: false, note: 'semantic/neural search for exploratory queries; similar_to finds pages like a known good URL (extra.searchType=auto|keyword|neural, extra.category)' },
  tavily: { label: 'Tavily', kind: 'general', keyEnv: 'TAVILY_API_KEY', free: false, note: 'AI-optimized search returning an answer plus ranked sources (extra.depth=basic|advanced)' },
  serper: { label: 'Serper (Google)', kind: 'general', keyEnv: 'SERPER_API_KEY', free: false, note: 'Google SERP results' },
  bing: { label: 'Bing', kind: 'general', free: true, note: 'free Bing via RSS (scrape-based, may break)' },
  ddg: { label: 'DuckDuckGo', kind: 'general', free: true, note: 'free no-key fallback, rate-limited — final safety net' },
  anysearch: { label: 'AnySearch', kind: 'general', keyEnv: 'ANYSEARCH_API_KEY', free: true, note: 'anonymous-capable; vertical tags via extra.tag (e.g. code.doc, academic.preprint) + extra.params, zone cn|intl' },
  firecrawl: { label: 'Firecrawl search', kind: 'general', keyEnv: 'FIRECRAWL_API_KEY', free: false, note: 'web/news search (extra.sources)' },
  stack: { label: 'StackExchange', kind: 'vertical', free: true, note: 'programming Q&A — precise for error messages (extra.site, extra.tagged, extra.sort, extra.answered)' },
  hn: { label: 'Hacker News', kind: 'vertical', free: true, note: 'tech community discussion and sentiment (extra.type=story|comment, extra.sort=relevance|date, extra.days)' },
  academic: { label: 'Semantic Scholar / arXiv', kind: 'vertical', keyEnv: 'S2_API_KEY', free: true, note: 'papers (extra.provider=s2|arxiv, extra.year, extra.field e.g. cs.AI); optional S2_API_KEY raises the strict anonymous rate limit' },
  gh: { label: 'GitHub', kind: 'vertical', free: true, note: 'repos/issues/PRs/code search; qualifiers go in the query (extra.kind=repos|issues|prs|code, extra.sort)' },
}

export const ENGINE_IDS = Object.keys(ENGINE_INFO)

/** Engines fanned out by default when fan_out=true (availability-filtered at runtime). */
export const DEFAULT_FANOUT = ['brave', 'bocha', 'tavily', 'exa']

/** The fallback chain from the original websearch skill, free-terminated. */
export const FALLBACK_TAIL = ['tavily', 'exa', 'bocha', 'zhipu', 'anysearch', 'ddg']

/** First-choice preferences per query language. */
export const CJK_FIRST = ['bocha', 'zhipu', 'wsa', 'brave', 'serper', 'tavily', 'exa']
export const LATIN_FIRST = ['brave', 'serper', 'tavily', 'exa', 'bocha']
