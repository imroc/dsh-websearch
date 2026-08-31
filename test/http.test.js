import { strict as assert } from 'node:assert'
import { test } from 'node:test'

import { BackendError, fetchJson } from '../src/core/http.js'

const calls = []

/** A fetch that never resolves until aborted — mimics a hanging connection. */
function installHangingFetch() {
  calls.length = 0
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    return new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')))
    })
  }
}

function installOkFetch(body) {
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body }
  }
}

test('a timeout is retried like any other transient failure', async () => {
  let hung = true
  calls.length = 0
  globalThis.fetch = (url, init) => {
    calls.push({ url: String(url), init })
    if (hung) {
      return new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason ?? new Error('aborted')))
      })
    }
    return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: async () => '{"ok":true}' })
  }
  // First attempt hangs past the 40ms timeout, second answers.
  const first = fetchJson('t', 'https://t.example/1', { timeoutMs: 40, retries: 1 })
  setTimeout(() => { hung = false }, 60)
  const data = await first
  assert.deepEqual(data, { ok: true })
  assert.equal(calls.length, 2)
})

test('a timeout that exhausts retries throws a retryable BackendError', async () => {
  installHangingFetch()
  await assert.rejects(
    () => fetchJson('t', 'https://t.example/1', { timeoutMs: 40, retries: 1 }),
    (e) => e instanceof BackendError && /timed out after 40ms/.test(e.message) && e.retryable === true,
  )
  assert.equal(calls.length, 2)
})

test('an externally aborted signal is never retried or wrapped', async () => {
  installHangingFetch()
  const controller = new AbortController()
  const reason = new Error('user cancelled')
  const promise = fetchJson('t', 'https://t.example/1', { timeoutMs: 5000, retries: 2, signal: controller.signal })
  controller.abort(reason)
  await assert.rejects(promise, (e) => e === reason)
  assert.equal(calls.length, 1)
})

test('a Retry-After header marks non-5xx responses retryable (e.g. GitHub 403 limits)', async () => {
  let limited = true
  calls.length = 0
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (limited) {
      limited = false
      return { ok: false, status: 403, headers: { get: () => '1' }, text: async () => JSON.stringify({ message: 'rate limit exceeded' }) }
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '{"ok":true}' }
  }
  const data = await fetchJson('t', 'https://t.example/1', { retries: 1 })
  assert.deepEqual(data, { ok: true })
  assert.equal(calls.length, 2)
})
