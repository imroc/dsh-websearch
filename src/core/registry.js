// Backend registry. `keys` is a LIVE map (engine → key) owned by the plugin:
// backends read it at call time, so credential updates hot-apply without
// rebuilding anything. `isDisabled` is likewise live, fed from the settings
// section. A backend without its key stays registered but reports
// available() === false and drops out of every routing chain.

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
 * @param {object} options
 * @param {Object<string,string|undefined>} options.keys - LIVE engine→key map.
 * @param {Record<string,string|undefined>} [options.env] - usually process.env.
 * @param {(id: string) => boolean} [options.isDisabled] - live disable check.
 * @param {{warn?: (msg: string) => void}} [options.log]
 */
export function createRegistry({ keys, env = process.env, isDisabled = () => false, log } = {}) {
  const map = new Map()
  for (const [id, factory] of Object.entries(FACTORIES)) {
    try {
      const backend = factory({ keys, env })
      if (backend !== undefined && backend.id === id) map.set(id, backend)
    } catch (e) {
      log?.warn?.(`backend ${id} failed to initialize: ${e?.message ?? e}`)
    }
  }
  return {
    /**
     * The backend for `id`, or undefined when unknown or disabled.
     * @returns {undefined | {id: string, available(): boolean, search(object, AbortSignal): Promise<object>}}
     */
    get: (id) => (isDisabled(id) ? undefined : map.get(id)),
    /** Whether the engine exists at all (independent of disable state). */
    knows: (id) => map.has(id),
    ids: () => [...map.keys()].filter((id) => !isDisabled(id)),
    list: () => [...map.values()].filter((b) => !isDisabled(b.id)),
    hasUsable: () => [...map.values()].some((b) => !isDisabled(b.id) && b.available()),
    /** Human-readable availability summary for logs and diagnostics. */
    describe: () => [...map.values()]
      .map((b) => `${b.id}:${isDisabled(b.id) ? 'off' : b.available() ? 'ok' : 'no-key'}`)
      .join(' '),
  }
}
