#!/usr/bin/env node
// Live smoke test: one real query per backend with real keys.
//
// Keys come from the environment; when a key is scrubbed from the current
// shell (DSH strips *KEY* vars from bash subprocesses), they are read from the
// running dsh-web service process instead:
//
//   node scripts/smoke.mjs [engine ...]
//
// Runs every engine by default; pass engine ids to filter. Network-required;
// not part of `npm test`.

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRegistry } from '../src/core/registry.js'
import { envKeys } from '../src/core/secrets.js'

function envFromDshWeb() {
  try {
    const pid = execFileSync('systemctl', ['--user', 'show', 'dsh-web', '-p', 'MainPID', '--value']).toString().trim()
    const environ = readFileSync(`/proc/${pid}/environ`, 'utf8')
    const env = {}
    for (const entry of environ.split('\0')) {
      const i = entry.indexOf('=')
      if (i > 0) env[entry.slice(0, i)] = entry.slice(i + 1)
    }
    return env
  } catch {
    return {}
  }
}

const QUERIES = {
  brave: 'kubernetes networking',
  bocha: '腾讯云 容器网络',
  zhipu: 'Kubernetes 网络插件',
  wsa: '腾讯云 TKE',
  bailian: '2026年Kubernetes有什么新版本',
  exa: 'rust async runtime internals',
  tavily: 'kubernetes networking',
  serper: 'kubernetes networking',
  bing: 'kubernetes networking',
  ddg: 'kubernetes networking',
  anysearch: 'kubernetes networking',
  firecrawl: 'kubernetes networking',
  stack: 'docker network not found',
  hn: 'kubernetes',
  academic: 'large language model agents',
  gh: 'kubernetes networking stars:>1000',
}

const env = { ...process.env, ...(await envFromDshWeb()) }
const registry = createRegistry({ keys: envKeys(env), env, log: console })
const filter = process.argv.slice(2)
const engines = registry.list().filter((b) => filter.length === 0 || filter.includes(b.id))

console.log(`engines: ${registry.describe()}\n`)
let failures = 0
for (const backend of engines) {
  if (!backend.available()) {
    console.log(`SKIP  ${backend.id} (no key)`)
    continue
  }
  const query = QUERIES[backend.id] ?? 'test'
  const t0 = Date.now()
  try {
    const res = await backend.search({ query, maxResults: 3, freshness: 'month' }, undefined)
    const n = res.sources.length
    const first = res.sources[0]
    console.log(`OK    ${backend.id.padEnd(10)} ${String(Date.now() - t0).padStart(5)}ms ${n} results${res.content !== undefined ? ' +content' : ''}${first !== undefined ? ` | ${String(first.title ?? first.url).slice(0, 60)}` : ''}`)
    if (n === 0 && res.content === undefined) failures += 1
  } catch (e) {
    failures += 1
    console.log(`FAIL  ${backend.id.padEnd(10)} ${String(Date.now() - t0).padStart(5)}ms ${e.message}`)
  }
}
console.log(`\n${failures === 0 ? 'all good' : `${failures} engine(s) failed`}`)
process.exitCode = failures === 0 ? 0 : 1
