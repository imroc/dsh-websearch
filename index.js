// dsh-websearch — multi-engine web search for DeepSeek Harness.
//
// Mounting (this bundle's cordis.patch.yml): inserts the plugin row AND pins
// the `web` seam's searchProvider to the aggregated provider registered here,
// so the built-in web_search tool routes through the orchestrator too.
//
// Contributions (all fiber-scoped, disposed with the plugin):
//   1. ctx.web search provider `websearch` — auto-routing + sequential
//      fallback across every configured backend (free engines terminate the
//      chain, so search survives paid-quota exhaustion).
//   2. Model tool `web_search_pro` — per-query engine choice, batch (≤5),
//      fan-out, normalized parameter surface (freshness/sites/language/…),
//      engine-specific extras, and per-attempt telemetry.
//   3. Per-agent system-prompt section `tool:web_search_pro` with the
//      scenario → engine routing guide (registered on agent/session-start,
//      WeakSet-deduplicated because the event can re-fire on clear/compact).

import { defineTool } from '@deepseek-ai/dsh-tools'
import { ENGINE_IDS, ENGINE_INFO } from './src/core/engines.js'
import { EXTERNAL_WEB_CONTENT_NOTICE, formatProOutput } from './src/core/format.js'
import { orchestrate } from './src/core/router.js'
import { createRegistry } from './src/core/registry.js'
import { clamp } from './src/core/util.js'

export const name = 'dsh-websearch'

export const inject = ['web', 'tools', 'systemPrompt']

const MAX_QUERIES = 5
const DEFAULT_MAX_RESULTS = 8
const HARD_MAX_RESULTS = 20
const TOOL_TIMEOUT_MS = 60_000

const GUIDE_TEXT = `## Web search guide (web_search_pro)

web_search_pro searches ${ENGINE_IDS.length} engines: ${ENGINE_IDS.map((id) => `${id} (${ENGINE_INFO[id].note})`).join('; ')}.

Engine selection:
- Omit \`engine\` to auto-route: Chinese queries go to bocha, others to brave, with automatic fallback down a chain that always ends on free engines (anysearch, ddg) — search keeps working when paid quota is exhausted.
- Chinese content: bocha; Chinese answer-style questions: bailian (returns a generated answer, no source list).
- Semantic/exploratory research or finding pages similar to a known good URL: exa (similar_to).
- Programming errors: stack (free, precise, shows accepted answers). GitHub repos/issues/PRs/code: gh. Tech community discussion/sentiment: hn.
- Papers: academic (extra {"provider":"arxiv"} for preprints, extra {"year":2024} to filter).
- News: topic "news". Broad multi-engine coverage: fan_out true. Multiple independent queries: up to 5 items in queries[].

Engine-specific options go in \`extra\`. Results carry URLs — cite them as markdown links; use web_fetch to read full pages when snippets are not enough. The output ends with a telemetry line showing which engines actually answered.`

/** Validate + normalize raw row config; throws loudly on bad shapes. */
function validateConfig(raw) {
  const config = raw ?? {}
  if (config.disable !== undefined && !Array.isArray(config.disable)) {
    throw new Error('[dsh-websearch] config.disable must be an array of engine ids')
  }
  for (const id of config.disable ?? []) {
    if (!ENGINE_IDS.includes(id)) throw new Error(`[dsh-websearch] config.disable references unknown engine "${id}"`)
  }
  if (config.keys !== undefined && (typeof config.keys !== 'object' || Array.isArray(config.keys))) {
    throw new Error('[dsh-websearch] config.keys must be an object of engine id → key string')
  }
  return config
}

/** Validate model-generated web_search_pro arguments beyond the schema DSL. */
function validateArgs(args) {
  if (!Array.isArray(args.queries) || args.queries.length === 0) {
    throw new Error('queries must be an array with at least one query')
  }
  if (args.queries.length > MAX_QUERIES) {
    throw new Error(`queries accepts at most ${MAX_QUERIES} items`)
  }
  const queries = args.queries.map((q, i) => {
    if (typeof q?.query !== 'string' || q.query.trim() === '') {
      throw new Error(`queries[${i}].query must be a non-empty string`)
    }
    const engine = q.engine === undefined || q.engine === null || q.engine === '' ? undefined : q.engine
    if (engine !== undefined && !ENGINE_IDS.includes(engine)) {
      throw new Error(`queries[${i}].engine "${engine}" is unknown; available engines: ${ENGINE_IDS.join(', ')}`)
    }
    return { query: q.query, ...(engine !== undefined ? { engine } : {}) }
  })
  const engine = args.engine === undefined || args.engine === null || args.engine === '' ? undefined : args.engine
  if (engine !== undefined && !ENGINE_IDS.includes(engine)) {
    throw new Error(`engine "${engine}" is unknown; available engines: ${ENGINE_IDS.join(', ')}`)
  }
  const maxResults = args.max_results === undefined ? DEFAULT_MAX_RESULTS : clamp(args.max_results, 1, HARD_MAX_RESULTS)
  if (args.freshness !== undefined && !/^(day|week|month|year|\d{4}-\d{2}-\d{2}to\d{4}-\d{2}-\d{2})$/.test(args.freshness)) {
    throw new Error("freshness must be 'day'|'week'|'month'|'year' or 'YYYY-MM-DDtoYYYY-MM-DD'")
  }
  if (args.topic !== undefined && args.topic !== 'general' && args.topic !== 'news') {
    throw new Error("topic must be 'general' or 'news'")
  }
  for (const key of ['include_sites', 'exclude_sites']) {
    if (args[key] !== undefined && (!Array.isArray(args[key]) || args[key].some((s) => typeof s !== 'string'))) {
      throw new Error(`${key} must be an array of domain strings`)
    }
  }
  if (args.extra !== undefined && (typeof args.extra !== 'object' || Array.isArray(args.extra))) {
    throw new Error('extra must be an object of engine-specific options')
  }
  return {
    queries,
    ...(engine !== undefined ? { engine } : {}),
    ...(args.fan_out === true ? { fanOut: true } : {}),
    maxResults,
    ...(args.freshness !== undefined ? { freshness: args.freshness } : {}),
    ...(args.language !== undefined ? { language: args.language } : {}),
    ...(args.region !== undefined ? { region: args.region } : {}),
    ...(args.include_sites !== undefined ? { includeSites: args.include_sites } : {}),
    ...(args.exclude_sites !== undefined ? { excludeSites: args.exclude_sites } : {}),
    ...(args.topic !== undefined ? { topic: args.topic } : {}),
    ...(args.similar_to !== undefined ? { similarTo: args.similar_to } : {}),
    ...(args.extra !== undefined ? { extra: args.extra } : {}),
  }
}

const SOURCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    url: { type: 'string', required: true },
    title: { type: 'string' },
    snippet: { type: 'string' },
    publishedAt: { type: 'string' },
    engine: { type: 'string' },
  },
}

const ATTEMPT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    engine: { type: 'string', required: true },
    query: { type: 'string' },
    ok: { type: 'boolean', required: true },
    count: { type: 'number', required: true },
    elapsedMs: { type: 'number' },
    error: { type: 'string' },
    via: { type: 'string' },
  },
}

function presentProCall(args) {
  const title = Array.isArray(args?.queries) ? args.queries.map((q) => q?.query ?? '').join(', ') : 'web_search_pro'
  return { card: 'generic', title, kind: 'search', rawInput: title }
}

function presentProResult(args, result) {
  if (result.isError) return undefined
  const meta = result.meta
  if (typeof meta !== 'object' || meta === null || !Array.isArray(meta.sources)) return undefined
  const title = Array.isArray(args?.queries) ? args.queries.map((q) => q?.query ?? '').join(', ') : 'web_search_pro'
  return {
    card: 'web',
    kind: 'search',
    title,
    sources: meta.sources,
    truncated: meta.truncated === true,
    ...(typeof meta.answer === 'string' ? { answer: meta.answer } : {}),
  }
}

export function apply(ctx, rawConfig) {
  const config = validateConfig(rawConfig)
  const logger = ctx.logger('dsh-websearch')
  const registry = createRegistry({ config, env: process.env, log: logger })
  logger.info(`engines: ${registry.describe()}`)

  // 1) Aggregated provider behind the official web_search tool.
  ctx.web.registerSearchProvider({
    id: 'websearch',
    available: () => registry.hasUsable(),
    async search(request, signal) {
      const { result } = await orchestrate(
        { queries: [{ query: request.query }], maxResults: request.maxResults ?? DEFAULT_MAX_RESULTS, signal },
        registry,
      )
      return {
        ...(result.content !== undefined ? { content: result.content } : {}),
        sources: result.sources,
        truncated: result.truncated,
      }
    },
  })

  // 2) The web_search_pro model tool.
  ctx.tools.register(defineTool({
    name: 'web_search_pro',
    description: `Enhanced multi-engine web search (${ENGINE_IDS.length} engines). Omit engine to auto-route (Chinese→bocha, otherwise→brave) with automatic fallback that always ends on free engines. Pick engines explicitly per query: ${ENGINE_IDS.map((id) => `${id}=${ENGINE_INFO[id].note}`).join('; ')}. Pass up to ${MAX_QUERIES} independent queries in queries[], fan_out=true for merged multi-engine coverage, topic="news" for the news vertical, similar_to for pages like a known URL, extra for engine-specific options. Returns sources with URLs plus an engine telemetry line; cite URLs as markdown links and use web_fetch for full pages.`,
    parameters: {
      queries: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            query: { type: 'string', required: true, description: 'Search query text.' },
            engine: { type: 'string', description: `Engine id for this query (${ENGINE_IDS.join('|')}); omit to auto-route.` },
          },
        },
        description: `1–${MAX_QUERIES} independent search queries; each may target its own engine.`,
      },
      engine: { type: 'string', description: 'Default engine id for queries that do not set one; omit for auto-routing.' },
      fan_out: { type: 'boolean', description: 'Query several engines concurrently and merge/dedup their results (broader coverage, more quota).' },
      max_results: { type: 'number', description: `Max sources per query (default ${DEFAULT_MAX_RESULTS}, max ${HARD_MAX_RESULTS}).` },
      freshness: { type: 'string', description: "Time filter: 'day' | 'week' | 'month' | 'year' or 'YYYY-MM-DDtoYYYY-MM-DD'." },
      language: { type: 'string', description: 'Result language hint, e.g. zh / en.' },
      region: { type: 'string', description: 'Result region/market hint, e.g. cn / us.' },
      include_sites: { type: 'array', items: { type: 'string' }, description: 'Restrict results to these domains (engines that support it).' },
      exclude_sites: { type: 'array', items: { type: 'string' }, description: 'Drop results from these domains (engines that support it).' },
      topic: { type: 'string', description: "'general' (default) or 'news'." },
      similar_to: { type: 'string', description: 'URL — find pages similar to it (exa findSimilar).' },
      extra: {
        type: 'object',
        additionalProperties: true,
        description: 'Engine-specific options, e.g. {"provider":"arxiv","year":2024} academic, {"site":"superuser","tagged":"docker"} stack, {"type":"comment","days":7} hn, {"tag":"code.doc","params":{}} anysearch, {"searchType":"neural"} exa, {"depth":"advanced"} tavily, {"engine":"search_std"} zhipu, {"kind":"issues","sort":"updated"} gh, {"model":"qwen-plus"} bailian.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string' },
          sources: { type: 'array', required: true, items: SOURCE_SCHEMA },
          truncated: { type: 'boolean', required: true },
          attempts: { type: 'array', required: true, items: ATTEMPT_SCHEMA },
        },
      },
      render: (_args, value) => [{ type: 'text', text: formatProOutput(value) }],
      presentationMeta: (_args, value) => ({
        sources: value.sources,
        truncated: value.truncated,
        ...(value.content !== undefined ? { answer: value.content } : {}),
      }),
    },
    timeoutMs: TOOL_TIMEOUT_MS,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const spec = validateArgs(args)
      const { result, attempts } = await orchestrate({ ...spec, signal: exec.signal }, registry)
      return {
        ...(result.content !== undefined ? { content: result.content } : {}),
        sources: result.sources,
        truncated: result.truncated,
        attempts,
      }
    },
    presentCall: presentProCall,
    presentResult: presentProResult,
  }))

  // 3) Per-agent prompt guide. agent/session-start can re-fire (clear,
  //    compact); the WeakSet keeps one registration per agent object.
  const handled = new WeakSet()
  ctx.on('agent/session-start', ({ agent }) => {
    if (agent === undefined || handled.has(agent)) return
    handled.add(agent)
    try {
      agent.ctx.systemPrompt.section({ name: 'tool:web_search_pro', order: 150, text: GUIDE_TEXT })
    } catch (e) {
      logger.warn(`failed to register prompt guide: ${e?.message ?? e}`)
    }
  })
}

export { EXTERNAL_WEB_CONTENT_NOTICE }
