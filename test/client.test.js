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
