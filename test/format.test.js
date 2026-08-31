import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { formatProOutput } from '../src/core/format.js'

test('formatProOutput renders trust notice, sources, telemetry and cite rule', () => {
  const text = formatProOutput({
    content: 'An answer.',
    sources: [
      { url: 'https://a.com/x', title: 'A', snippet: 'sa', publishedAt: '2026-08-01T00:00:00Z', engine: 'brave' },
      { url: 'https://b.com/y', engine: 'bocha' },
    ],
    truncated: false,
    attempts: [
      { engine: 'brave', ok: true, count: 2, elapsedMs: 320 },
      { engine: 'tavily', ok: false, count: 0, error: '[tavily] HTTP 429: quota exceeded' },
    ],
  })
  assert.ok(text.startsWith('External web content follows.'))
  assert.ok(text.includes('An answer.'))
  assert.ok(text.includes('- [A](https://a.com/x) — sa (2026-08-01) [brave]'))
  assert.ok(text.includes('[websearch] brave ✓ 320ms/2 · tavily ✗ [tavily] HTTP 429: quota exceeded'))
  assert.ok(text.endsWith('Cite the relevant URLs above as markdown links in your answer.'))
})

test('formatProOutput renders No results found without sources', () => {
  const text = formatProOutput({ sources: [], truncated: false, attempts: [{ engine: 'ddg', ok: true, count: 0, elapsedMs: 50 }] })
  assert.ok(text.includes('No results found.'))
})
