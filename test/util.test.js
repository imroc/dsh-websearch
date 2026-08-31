import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import {
  decodeHtmlEntities,
  freshnessBocha,
  freshnessBrave,
  freshnessStartISO,
  freshnessTavily,
  freshnessTbs,
  freshnessUnixRange,
  isCJK,
  normalizeUrlForDedup,
  rfc822ToISO,
  stripHtml,
  toIsoDate,
} from '../src/core/util.js'

test('isCJK detects Chinese but not plain ASCII', () => {
  assert.equal(isCJK('Kubernetes 网络插件'), true)
  assert.equal(isCJK('kubernetes networking'), false)
})

test('freshness vocabulary mapping', () => {
  assert.equal(freshnessBocha('day'), 'oneDay')
  assert.equal(freshnessBocha('year'), 'oneYear')
  assert.equal(freshnessBocha('2026-01-01to2026-02-01'), 'noLimit')
  assert.equal(freshnessBocha('bogus'), undefined)
  assert.equal(freshnessTavily('week'), 'week')
  assert.equal(freshnessBrave('day'), 'pd')
  assert.equal(freshnessBrave('2026-01-01to2026-02-01'), '2026-01-01to2026-02-01')
  assert.equal(freshnessTbs('month'), 'qdr:m')
  // Custom ranges use Google's cdr vocabulary (qdr:c:from..to is ignored).
  assert.equal(freshnessTbs('2026-01-01to2026-02-01'), 'cdr:1,cd_min:01/01/2026,cd_max:02/01/2026')
})

test('freshnessStartISO returns a date string', () => {
  assert.match(freshnessStartISO('week'), /^\d{4}-\d{2}-\d{2}$/)
  assert.equal(freshnessStartISO('2026-01-01to2026-02-01'), '2026-01-01')
})

test('freshnessUnixRange computes epoch bounds', () => {
  const range = freshnessUnixRange('day')
  assert.ok(range.from <= Date.now() / 1000)
  assert.ok(range.from > Date.now() / 1000 - 86401)
})

test('normalizeUrlForDedup drops tracking params and trailing slash', () => {
  assert.equal(
    normalizeUrlForDedup('https://Example.com/docs/?utm_source=x&id=2'),
    normalizeUrlForDedup('https://example.com/docs?id=2'),
  )
})

test('decodeHtmlEntities decodes named and numeric entities', () => {
  assert.equal(decodeHtmlEntities('Tom&#39;s &quot;cache&quot; &amp; more'), 'Tom\'s "cache" & more')
})

test('stripHtml removes tags', () => {
  assert.equal(stripHtml('<b>Hello</b>  <i>world</i>'), 'Hello world')
})

test('rfc822ToISO parses RSS dates', () => {
  assert.equal(rfc822ToISO('Mon, 25 Aug 2026 10:00:00 GMT'), '2026-08-25T10:00:00.000Z')
})

test('toIsoDate coerces epoch seconds and date strings', () => {
  assert.equal(toIsoDate(1756300800), '2025-08-27T13:20:00.000Z')
  assert.equal(toIsoDate('2026-01-02'), '2026-01-02')
  assert.equal(toIsoDate('garbage'), undefined)
})
