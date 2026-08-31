import { strict as assert } from 'node:assert'
import { test } from 'node:test'

// Each test installs a fake global fetch capturing the request, then asserts
// the backend built the right URL/headers/body and parsed the canned payload.

const calls = []

function installFetch(handler) {
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const { status, body } = handler(String(url), init)
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => body,
    }
  }
}

function jsonBody(init) {
  return JSON.parse(init.body)
}

test('bocha builds the request and parses webPages', async () => {
  const { create } = await import('../src/backends/bocha.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ data: { webPages: { value: [{ name: 't', url: 'https://a.com', snippet: 's', datePublished: '2026-08-01' }] } } }),
  }))
  const b = create({ keys: { bocha: 'k' } })
  const res = await b.search({ query: '中文', maxResults: 3, freshness: 'week' }, undefined)
  assert.equal(calls[0].url, 'https://api.bochaai.com/v1/web-search')
  assert.equal(calls[0].init.headers.authorization, 'Bearer k')
  assert.deepEqual(jsonBody(calls[0].init), { query: '中文', count: 3, freshness: 'oneWeek' })
  assert.equal(res.sources[0].publishedAt, '2026-08-01')
})

test('bocha is unavailable without a key', async () => {
  const { create } = await import('../src/backends/bocha.js')
  assert.equal(create({ keys: {} }).available(), false)
})

test('zhipu maps freshness and include sites', async () => {
  const { create } = await import('../src/backends/zhipu.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ search_result: [{ title: 't', link: 'https://z.com', content: 'c', publish_date: '2026-01-01' }] }),
  }))
  const b = create({ keys: { zhipu: 'k' } })
  await b.search({ query: 'q', freshness: 'day', includeSites: ['a.com'] }, undefined)
  assert.deepEqual(jsonBody(calls[0].init), {
    search_query: 'q', count: 5, search_engine: 'search_pro', search_recency_filter: 'oneDay', search_domain_filter: ['a.com'],
  })
})

test('zhipu surfaces API error envelopes', async () => {
  const { create } = await import('../src/backends/zhipu.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ error: { code: 1002, message: 'bad key' } }) }))
  const b = create({ keys: { zhipu: 'k' } })
  await assert.rejects(() => b.search({ query: 'q' }, undefined), /bad key/)
})

test('wsa parses the JSON-string Pages array', async () => {
  const { create } = await import('../src/backends/wsa.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ Response: { Pages: [JSON.stringify({ title: 't', url: 'https://w.com', passage: 'p' })] } }),
  }))
  const b = create({ keys: { wsa: 'k' } })
  const res = await b.search({ query: 'q', maxResults: 3, freshness: 'day' }, undefined)
  const body = jsonBody(calls[0].init)
  assert.equal(body.Cnt, 10)
  assert.ok(Number.isFinite(body.FromTime))
  assert.equal(res.sources[0].url, 'https://w.com')
})

test('tavily requests an answer and maps it to content', async () => {
  const { create } = await import('../src/backends/tavily.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ answer: 'the answer', results: [{ title: 't', url: 'https://t.com', content: 'c', published_date: '2026-02-03' }] }),
  }))
  const b = create({ keys: { tavily: 'k' } })
  const res = await b.search({ query: 'q', topic: 'news', freshness: 'week' }, undefined)
  const body = jsonBody(calls[0].init)
  assert.equal(body.topic, 'news')
  assert.equal(body.time_range, 'week')
  assert.equal(body.include_answer, true)
  assert.equal(res.content, 'the answer')
  assert.equal(res.sources[0].publishedAt, '2026-02-03')
})

test('serper folds site operators into the query and uses the news endpoint', async () => {
  const { create } = await import('../src/backends/serper.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ organic: [{ title: 't', link: 'https://s.com', snippet: 's' }] }) }))
  const b = create({ keys: { serper: 'k' } })
  await b.search({ query: 'q', includeSites: ['a.com', 'b.com'], excludeSites: ['c.com'], topic: 'news', language: 'zh', region: 'cn' }, undefined)
  assert.equal(calls[0].url, 'https://google.serper.dev/news')
  const body = jsonBody(calls[0].init)
  assert.equal(body.q, 'q (site:a.com OR site:b.com) -site:c.com')
  assert.equal(body.hl, 'zh')
  assert.equal(body.gl, 'cn')
})

test('brave builds web/news URLs with freshness and site_filter', async () => {
  const { create } = await import('../src/backends/brave.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ web: { results: [{ title: 't', url: 'https://b.com', description: 'd' }] } }) }))
  const b = create({ keys: { brave: 'k' } })
  await b.search({ query: 'q', freshness: 'day', includeSites: ['docs.a.com'], maxResults: 5 }, undefined)
  assert.ok(calls[0].url.startsWith('https://api.search.brave.com/res/v1/web/search?'))
  assert.ok(calls[0].url.includes('freshness=pd'))
  assert.ok(calls[0].url.includes('site_filter=docs.a.com'))
  assert.equal(calls[0].init.headers['x-subscription-token'], 'k')
})

test('bing parses RSS items and resolves pubDate', async () => {
  const { create } = await import('../src/backends/bing.js')
  const rss = '<?xml version="1.0"?><rss><channel>' +
    '<item><title>A &amp; B</title><link>https://b.com/1</link><description><![CDATA[desc]]></description><pubDate>Mon, 25 Aug 2026 10:00:00 GMT</pubDate></item>' +
    '<item><title>C</title><link>https://b.com/2</link></item>' +
    '</channel></rss>'
  installFetch(() => ({ status: 200, body: rss }))
  const b = create()
  const res = await b.search({ query: 'q' }, undefined)
  assert.equal(res.sources.length, 2)
  assert.equal(res.sources[0].title, 'A & B')
  assert.equal(res.sources[0].publishedAt, '2026-08-25T10:00:00.000Z')
  assert.ok(calls[0].url.includes('format=rss'))
})

test('ddg parses result anchors and resolves uddg redirects', async () => {
  const { create } = await import('../src/backends/ddg.js')
  const html = '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fa.com%2F1&amp;rut=abc">Title</a>' +
    '<a class="result__snippet" href="x">Snip</a>' +
    '<a rel="nofollow" class="result__a" href="https://b.com/2">Two</a>'
  installFetch(() => ({ status: 200, body: html }))
  const b = create()
  const res = await b.search({ query: 'q' }, undefined)
  assert.equal(res.sources[0].url, 'https://a.com/1')
  assert.equal(res.sources[0].snippet, 'Snip')
  assert.equal(res.sources[1].url, 'https://b.com/2')
})

test('stack decodes entities and builds advanced-search params', async () => {
  const { create } = await import('../src/backends/stack.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ items: [{ title: 'Tom&#39;s error', link: 'https://s.com/q', score: 12, answer_count: 2, is_answered: true, tags: ['go'], creation_date: 1756300800 }], quota_remaining: 200 }),
  }))
  const b = create()
  const res = await b.search({ query: 'q', extra: { tagged: 'go', answered: true } }, undefined)
  assert.equal(res.sources[0].title, "Tom's error")
  assert.ok(calls[0].url.includes('tagged=go'))
  assert.ok(calls[0].url.includes('accepted=true'))
  assert.match(res.sources[0].snippet, /12 · 2 answers · accepted/)
})

test('hn builds numericFilters from days and maps Ask-HN links', async () => {
  const { create } = await import('../src/backends/hn.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ hits: [{ title: null, story_title: 'Ask HN: x', objectID: '42', points: 3, num_comments: 4, created_at: '2026-08-01T00:00:00Z', url: null }] }),
  }))
  const b = create()
  const res = await b.search({ query: 'q', extra: { days: 7, type: 'comment' } }, undefined)
  assert.equal(res.sources[0].url, 'https://news.ycombinator.com/item?id=42')
  assert.equal(res.sources[0].title, 'Ask HN: x')
  assert.ok(calls[0].url.includes('numericFilters=created_at_i%3E'))
})

test('academic s2 maps authors into snippets', async () => {
  const { create } = await import('../src/backends/academic.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ data: [{ title: 'Paper', url: 'https://s2.com/p', authors: [{ name: 'A' }, { name: 'B' }], year: 2025, citationCount: 9 }] }),
  }))
  const b = create({ keys: {} })
  const res = await b.search({ query: 'q', extra: { year: 2024 } }, undefined)
  assert.ok(calls[0].url.includes('year=2024-'))
  assert.equal(res.sources[0].snippet, 'A, B · 2025 · 9 citations')
})

test('academic arxiv parses Atom entries', async () => {
  const { create } = await import('../src/backends/academic.js')
  const atom = '<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/2601.00001v1</id>' +
    '<title>Paper Title</title><published>2026-01-02T00:00:00Z</published>' +
    '<author><name>Alice</name></author><author><name>Bob</name></author><summary>abs</summary></entry></feed>'
  installFetch(() => ({ status: 200, body: atom }))
  const b = create({ keys: {} })
  const res = await b.search({ query: 'q', extra: { provider: 'arxiv' } }, undefined)
  assert.equal(res.sources[0].url, 'http://arxiv.org/abs/2601.00001v1')
  assert.equal(res.sources[0].publishedAt, '2026-01-02')
})

test('gh maps repo search items and appends issue qualifiers', async () => {
  const { create } = await import('../src/backends/gh.js')
  installFetch(() => ({
    status: 200,
    body: JSON.stringify({ items: [{ full_name: 'o/r', html_url: 'https://github.com/o/r', description: 'd', stargazers_count: 100, language: 'Go', pushed_at: '2026-08-01T00:00:00Z' }] }),
  }))
  const b = create({ keys: {}, env: { GITHUB_TOKEN: 'tok' } })
  const res = await b.search({ query: 'q stars:>50', extra: { kind: 'repos' } }, undefined)
  assert.equal(calls[0].init.headers.authorization, 'Bearer tok')
  assert.ok(calls[0].url.includes('q=q+stars%3A%3E50'))
  assert.equal(res.sources[0].snippet, '100 stars · Go · d')
})

test('anysearch sends optional auth and rejects error envelopes', async () => {
  const { create } = await import('../src/backends/anysearch.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ code: 0, data: { results: [{ title: 't', url: 'https://an.com', content: 'c' }] } }) }))
  const b = create({ keys: { anysearch: 'k' } })
  const res = await b.search({ query: 'q', extra: { tag: 'code.doc' } }, undefined)
  assert.equal(jsonBody(calls[0].init).tag, 'code.doc')
  assert.equal(calls[0].init.headers.authorization, 'Bearer k')
  assert.equal(res.sources[0].snippet, 'c')

  installFetch(() => ({ status: 200, body: JSON.stringify({ code: 1001, message: 'boom', request_id: 'r1' }) }))
  await assert.rejects(() => b.search({ query: 'q' }, undefined), /boom.*request_id: r1/)
})

test('exa uses findSimilar when similar_to is set', async () => {
  const { create } = await import('../src/backends/exa.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ results: [{ title: 't', url: 'https://e.com', highlights: ['h1', 'h2'], publishedDate: '2026-03-04' }] }) }))
  const b = create({ keys: { exa: 'k' } })
  await b.search({ query: 'q', similarTo: 'https://tokio.rs' }, undefined)
  assert.equal(calls[0].url, 'https://api.exa.ai/findSimilar')
  assert.equal(jsonBody(calls[0].init).url, 'https://tokio.rs')
})

test('bailian maps the completion content', async () => {
  const { create } = await import('../src/backends/bailian.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ choices: [{ message: { content: '答案' } }] }) }))
  const b = create({ keys: { bailian: 'k' } })
  const res = await b.search({ query: 'q' }, undefined)
  assert.equal(res.content, '答案')
  assert.equal(res.sources.length, 0)
})

test('firecrawl accepts both response shapes', async () => {
  const { create } = await import('../src/backends/firecrawl.js')
  installFetch(() => ({ status: 200, body: JSON.stringify({ data: { web: [{ title: 't', url: 'https://f.com', description: 'd' }] } }) }))
  const b = create({ keys: { firecrawl: 'k' } })
  let res = await b.search({ query: 'q', topic: 'news' }, undefined)
  assert.deepEqual(jsonBody(calls[0].init).sources, ['news', 'web'])
  assert.equal(res.sources[0].url, 'https://f.com')
  installFetch(() => ({ status: 200, body: JSON.stringify({ data: [{ title: 't2', url: 'https://f2.com' }] }) }))
  res = await b.search({ query: 'q' }, undefined)
  assert.equal(res.sources[0].url, 'https://f2.com')
})
