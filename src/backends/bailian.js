// Alibaba Bailian Q&A search — a chat-completions call with enable_search.
// Key: DASHSCOPE_API_KEY (or ~/.bailian/config.json, matching the skill script).
// Answer engine: returns generated content, no structured sources.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BackendError, bearer, fetchJson } from '../core/http.js'

const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

function keyFromConfigFile() {
  try {
    const raw = JSON.parse(readFileSync(join(process.env.HOME ?? '/root', '.bailian', 'config.json'), 'utf8'))
    return typeof raw.api_key === 'string' ? raw.api_key : undefined
  } catch {
    return undefined
  }
}

export function create({ keys }) {
  const apiKey = keys.bailian ?? keyFromConfigFile()
  return {
    id: 'bailian',
    available: () => Boolean(apiKey),
    async search(req, signal) {
      const body = {
        model: typeof req.extra?.model === 'string' ? req.extra.model : 'qwen-turbo',
        messages: [{ role: 'user', content: req.query }],
        enable_search: true,
      }
      const data = await fetchJson('bailian', ENDPOINT, { method: 'POST', headers: bearer(apiKey), body, signal, timeoutMs: 30_000 })
      const content = data?.choices?.[0]?.message?.content
      if (data?.error !== undefined) {
        throw new BackendError('bailian', `HTTP error: ${data.error.message ?? 'unknown'}`)
      }
      if (typeof content !== 'string' || content === '') {
        throw new BackendError('bailian', 'empty chat completion response')
      }
      return { content, sources: [] }
    },
  }
}
