import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { autoChain, fanOutQuery, mergeResults, orchestrate, runQuery } from '../src/core/router.js'
import { BackendError } from '../src/core/http.js'

function backend(id, behavior) {
  return { id, available: () => true, search: async (req, signal) => behavior(req, signal) }
}

function registry(...backends) {
  const map = new Map(backends.map((b) => [b.id, b]))
  return { get: (id) => map.get(id), hasUsable: () => map.size > 0 }
}

test('autoChain prefers Chinese engines for CJK queries', () => {
  const reg = registry(
    backend('bocha', () => ({ sources: [] })),
    backend('brave', () => ({ sources: [] })),
    backend('ddg', () => ({ sources: [] })),
  )
  const cjk = autoChain('腾讯云 容器网络', reg)
  const latin = autoChain('kubernetes networking', reg)
  assert.equal(cjk[0], 'bocha')
  assert.equal(latin[0], 'brave')
})

test('autoChain filters unavailable engines', () => {
  const reg = registry(
    { id: 'bocha', available: () => false, search: async () => ({ sources: [] }) },
    backend('ddg', () => ({ sources: [] })),
  )
  assert.deepEqual(autoChain('中文查询', reg), ['ddg'])
})

test('runQuery falls through hard errors to the next engine', async () => {
  const reg = registry(
    backend('brave', () => { throw new BackendError('brave', 'HTTP 429: quota exceeded') }),
    backend('tavily', () => ({ sources: [{ url: 'https://example.com/1', title: 'ok' }] })),
  )
  const { result, attempts } = await runQuery({ query: 'anything' }, reg, {})
  assert.equal(result.sources.length, 1)
  assert.equal(attempts.length, 2)
  assert.equal(attempts[0].ok, false)
  assert.equal(attempts[1].ok, true)
  assert.match(attempts[1].via, /brave/)
})

test('runQuery treats empty results as soft failure on the auto path', async () => {
  const reg = registry(
    backend('brave', () => ({ sources: [] })),
    backend('tavily', () => ({ sources: [{ url: 'https://example.com/1' }] })),
  )
  const { result } = await runQuery({ query: 'q' }, reg, {})
  assert.equal(result.sources.length, 1)
})

test('runQuery returns empty immediately for an explicit engine', async () => {
  let ddgCalls = 0
  const reg = registry(
    backend('stack', () => ({ sources: [] })),
    backend('ddg', () => { ddgCalls += 1; return { sources: [{ url: 'https://example.com/dg' }] } }),
  )
  const { result } = await runQuery({ query: 'q' }, reg, { explicitEngine: 'stack' })
  assert.equal(result.sources.length, 0)
  assert.equal(ddgCalls, 0)
})

test('runQuery throws an aggregated error when every engine fails', async () => {
  const reg = registry(backend('ddg', () => { throw new BackendError('ddg', 'network error: down') }))
  await assert.rejects(
    () => runQuery({ query: 'q' }, reg, {}),
    (e) => e instanceof BackendError && /\[ddg\] network error: down/.test(e.message),
  )
})

test('mergeResults interleaves by rank and dedups URLs', () => {
  const merged = mergeResults([
    { sources: [{ url: 'https://a.com/1' }, { url: 'https://a.com/2' }] },
    { sources: [{ url: 'https://b.com/1' }, { url: 'https://a.com/1' }] },
  ])
  assert.deepEqual(merged.sources.map((s) => s.url), ['https://a.com/1', 'https://b.com/1', 'https://a.com/2'])
})

test('mergeResults merges content and caps sources', () => {
  const merged = mergeResults(
    [
      { content: 'first', sources: [{ url: 'https://a.com/1' }] },
      { content: 'second', sources: [{ url: 'https://b.com/1' }] },
    ],
    1,
  )
  assert.equal(merged.content, 'first\n\nsecond')
  assert.equal(merged.sources.length, 1)
  assert.equal(merged.truncated, true)
})

test('fanOutQuery merges concurrent engine results and tolerates failures', async () => {
  const reg = registry(
    backend('brave', () => { throw new BackendError('brave', 'HTTP 500') }),
    backend('bocha', () => ({ sources: [{ url: 'https://a.com/1', engine: 'bocha' }] })),
  )
  const { result, attempts } = await fanOutQuery({ query: 'q' }, reg, { engines: ['brave', 'bocha'] })
  assert.equal(result.sources.length, 1)
  assert.equal(attempts.find((a) => a.engine === 'brave').ok, false)
  assert.equal(attempts.find((a) => a.engine === 'bocha').ok, true)
})

test('orchestrate routes each batch query independently and merges', async () => {
  const reg = registry(
    backend('bocha', (req) => ({ sources: [{ url: `https://cn.example/${req.query}` }] })),
    backend('brave', (req) => ({ sources: [{ url: `https://en.example/${req.query}` }] })),
    backend('ddg', (req) => ({ sources: [{ url: `https://dg.example/${req.query}` }] })),
  )
  const { result, attempts } = await orchestrate(
    { queries: [{ query: '中文' }, { query: 'english', engine: 'brave' }] },
    reg,
  )
  assert.equal(result.sources.length, 2)
  assert.ok(attempts.every((a) => a.ok))
  assert.deepEqual([...new Set(attempts.map((a) => a.engine))].sort(), ['bocha', 'brave'])
})

test('orchestrate rejects unknown engines loudly', async () => {
  const reg = registry(backend('ddg', () => ({ sources: [] })))
  await assert.rejects(
    () => orchestrate({ queries: [{ query: 'q', engine: 'nope' }] }, reg),
    /unknown engine "nope"/,
  )
})
