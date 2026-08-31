// Backend registry: resolve keys (config literal > env var), apply disables,
// instantiate every backend. A backend without its key stays registered but
// reports available() === false and drops out of every routing chain.

import * as academic from '../backends/academic.js'
import * as anysearch from '../backends/anysearch.js'
import * as bailian from '../backends/bailian.js'
import * as bing from '../backends/bing.js'
import * as bocha from '../backends/bocha.js'
import * as brave from '../backends/brave.js'
import * as ddg from '../backends/ddg.js'
import * as exa from '../backends/exa.js'
import * as firecrawl from '../backends/firecrawl.js'
import * as gh from '../backends/gh.js'
import * as hn from '../backends/hn.js'
import * as serper from '../backends/serper.js'
import * as stack from '../backends/stack.js'
import * as tavily from '../backends/tavily.js'
import * as wsa from '../backends/wsa.js'
import * as zhipu from '../backends/zhipu.js'
import { ENGINE_INFO } from './engines.js'

const FACTORIES = {
  brave: brave.create,
  bocha: bocha.create,
  zhipu: zhipu.create,
  wsa: wsa.create,
  bailian: bailian.create,
  exa: exa.create,
  tavily: tavily.create,
  serper: serper.create,
  bing: bing.create,
  ddg: ddg.create,
  anysearch: anysearch.create,
  firecrawl: firecrawl.create,
  stack: stack.create,
  hn: hn.create,
  academic: academic.create,
  gh: gh.create,
}

/**
 * @param {{disable?: string[], keys?: Object<string, string>, defaults?: object}} config
 * @param {Record<string, string|undefined>} env — usually process.env
 */
export function createRegistry({ config = {}, env = process.env, log } = {}) {
  const disabled = new Set(Array.isArray(config.disable) ? config.disable : [])
  const keys = {}
  for (const [id, info] of Object.entries(ENGINE_INFO)) {
    const literal = config.keys?.[id]
    keys[id] = typeof literal === 'string' && literal !== ''
      ? literal
      : (info.keyEnv !== undefined ? env[info.keyEnv] : undefined) || undefined
  }
  const map = new Map()
  for (const [id, factory] of Object.entries(FACTORIES)) {
    if (disabled.has(id)) continue
    try {
      const backend = factory({ keys, config, env })
      if (backend !== undefined && backend.id === id) map.set(id, backend)
    } catch (e) {
      log?.warn?.(`backend ${id} failed to initialize: ${e?.message ?? e}`)
    }
  }
  return {
    /** @returns {undefined | {id: string, available(): boolean, search(object, AbortSignal): Promise<object>}} */
    get: (id) => map.get(id),
    ids: () => [...map.keys()],
    list: () => [...map.values()],
    hasUsable: () => [...map.values()].some((b) => b.available()),
    /** Human-readable availability summary for logs and diagnostics. */
    describe: () => [...map.values()].map((b) => `${b.id}:${b.available() ? 'ok' : 'no-key'}`).join(' '),
  }
}
