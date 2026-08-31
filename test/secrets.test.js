import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { applyKeys, envKeys, resolveKeys } from '../src/core/secrets.js'

test('resolveKeys: literal config wins over credentials and env', async () => {
  const keys = await resolveKeys({
    config: { keys: { brave: 'literal' } },
    env: { BRAVE_SEARCH_API_KEY: 'env-value' },
    resolveCredential: async () => 'cred-value',
  })
  assert.equal(keys.brave, 'literal')
})

test('resolveKeys: credentials beat env (the service layers env itself; env only fills gaps)', async () => {
  const keys = await resolveKeys({
    config: {},
    env: { BOCHA_API_KEY: 'env-value' },
    resolveCredential: async (ref) => (ref === 'BOCHA_API_KEY' ? 'cred-value' : undefined),
  })
  assert.equal(keys.bocha, 'cred-value')
  assert.equal(keys.brave, undefined) // no env, no credentials → unavailable
})

test('resolveKeys: env fills in when the credentials service is absent or misses', async () => {
  const keys = await resolveKeys({
    config: {},
    env: { TAVILY_API_KEY: 'env-value' },
    resolveCredential: undefined,
  })
  assert.equal(keys.tavily, 'env-value')
  const keys2 = await resolveKeys({
    config: {},
    env: { TAVILY_API_KEY: 'env-value' },
    resolveCredential: async () => undefined,
  })
  assert.equal(keys2.tavily, 'env-value')
})

test('resolveKeys: keyless engines and credential failures degrade safely', async () => {
  const keys = await resolveKeys({
    config: {},
    env: {},
    resolveCredential: async () => { throw new Error('credentials down') },
  })
  assert.equal(keys.ddg, undefined) // free engine: no keyEnv at all
  assert.equal(keys.bocha, undefined) // failed resolution → unavailable, no throw
})

test('envKeys prefills synchronously from env only', () => {
  const keys = envKeys({ BOCHA_API_KEY: 'x', SERPER_API_KEY: '' })
  assert.equal(keys.bocha, 'x')
  assert.equal(keys.serper, undefined)
  assert.equal(keys.ddg, undefined)
})

test('applyKeys merges onto the live object and deletes gaps', () => {
  const live = Object.create(null)
  live.bocha = 'old'
  live.ddg = 'stale'
  applyKeys(live, { bocha: 'new', tavily: 'fresh' })
  assert.equal(live.bocha, 'new')
  assert.equal(live.tavily, 'fresh')
  assert.equal(live.ddg, undefined)
  assert.ok(!('ddg' in live))
})
