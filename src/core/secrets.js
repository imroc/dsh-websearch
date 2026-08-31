// Key resolution for every engine, mirroring web-search-deepseek's official
// pattern: literal composition config > credentials service (which itself
// layers process env > the managed ~/.dsh/.credentials.yaml store > .env
// files) > process env when no credentials service exists.
//
// The returned map is applied onto a LIVE keys object the backends read at
// call time, so a key written in the Web UI hot-applies without rebuilding
// the registry — no restart, no re-registration.

import { ENGINE_INFO } from './engines.js'

/**
 * Resolve the key map from config + credentials + env.
 *
 * @param {{keys?: Object<string,string>}} config - composition-layer config;
 *   literal keys win over everything (never enters the settings UI schema).
 * @param {Record<string,string|undefined>} env - usually process.env.
 * @param {(refName: string) => Promise<string|undefined>|undefined} resolveCredential
 *   - async resolver built on ctx.get('credentials'); absent = env only.
 * @returns {Promise<Object<string,string|undefined>>} engine id → key.
 */
export async function resolveKeys({ config, env, resolveCredential }) {
  const keys = Object.create(null)
  for (const [id, info] of Object.entries(ENGINE_INFO)) {
    const literal = config?.keys?.[id]
    if (typeof literal === 'string' && literal !== '') {
      keys[id] = literal
      continue
    }
    if (info.keyEnv === undefined) {
      keys[id] = undefined
      continue
    }
    let value
    if (typeof resolveCredential === 'function') {
      try {
        value = await resolveCredential(info.keyEnv)
      } catch {
        value = undefined
      }
    }
    if (value === undefined || value === '') {
      value = env?.[info.keyEnv] || undefined
    }
    keys[id] = value ?? undefined
  }
  return keys
}

/**
 * Synchronous env-only fill — the initial state before the first async
 * credentials resolution lands (identical outcome whenever no stored
 * credential exists, because env wins inside the credentials layering too).
 */
export function envKeys(env) {
  const keys = Object.create(null)
  for (const [id, info] of Object.entries(ENGINE_INFO)) {
    if (info.keyEnv !== undefined) keys[id] = env?.[info.keyEnv] || undefined
  }
  return keys
}

/** Merge a freshly resolved map onto the live keys object (deleting gaps). */
export function applyKeys(target, next) {
  for (const id of Object.keys(ENGINE_INFO)) {
    if (next[id] !== undefined) target[id] = next[id]
    else delete target[id]
  }
}
