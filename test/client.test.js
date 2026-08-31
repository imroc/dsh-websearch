import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

test('client bundle follows the DSH ModuleLoader contract', async () => {
  const registrations = []
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  })

  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, 'dsh-websearch')
  assert.equal(typeof registrations[0].factory, 'function')

  const react = { createElement: () => null, useState: () => ['', () => {}] }
  const client = registrations[0].factory((specifier) => {
    assert.equal(specifier, 'react')
    return react
  })

  assert.equal(client.name, 'dsh-websearch-client')
  assert.deepEqual(Array.from(client.inject), ['slots', 'remote', 'settingsScope'])
  assert.equal(typeof client.apply, 'function')
})

test('card engine table stays consistent with the host engine metadata', async () => {
  const { ENGINE_INFO } = await import('../src/core/engines.js')
  const registrations = []
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (registration) => registrations.push(registration) } },
  })
  const react = { createElement: () => null, useState: () => ['', () => {}] }
  const client = registrations[0].factory(() => react)

  // Every credential-bearing host engine must appear on the card with the
  // same credential ref — this is the guard for the hand-maintained copy.
  for (const [id, info] of Object.entries(ENGINE_INFO)) {
    const row = client.ENGINES.find((e) => e.id === id)
    assert.ok(row !== undefined, `engine "${id}" is missing from the settings card`)
    if (info.keyEnv !== undefined) assert.equal(row.ref, info.keyEnv, `card ref for "${id}" must match keyEnv`)
    else assert.equal(row.ref, undefined, `keyless engine "${id}" must not carry a ref`)
  }
  for (const row of client.ENGINES) {
    if (row.ref !== undefined) {
      assert.equal(ENGINE_INFO[row.id]?.keyEnv, row.ref, `card ref "${row.ref}" has no matching host engine`)
    }
  }
})
