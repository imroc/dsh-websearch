# dsh-websearch

Multi-engine web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH): one aggregated `ctx.web` search provider with automatic routing and fallback, plus a `web_search_pro` model tool that lets the agent pick engines on demand — fan out across engines, batch independent queries, and search verticals (StackOverflow, Hacker News, papers, GitHub).

## Why

DSH's built-in `web_search` goes through exactly one search provider (`deepseek-official` by default — every search is a full LLM call). The official seam (`ctx.web`) deliberately has no multi-backend routing, fallback, or fan-out. This plugin fills that gap:

- **`web_search` keeps its official schema** but routes through an orchestrator: Chinese queries go to Bocha, others to Brave, failures fall back down a chain that always terminates on free engines — search keeps working when paid quota is exhausted, and no longer burns LLM tokens per query.
- **`web_search_pro`** exposes the engine matrix to the model: per-query engine choice, up to 5 batched queries, `fan_out` for merged multi-engine coverage, normalized parameters (freshness / site filters / language / region / news topic), and engine-specific extras. Output carries per-engine telemetry (`[websearch] brave ✓ 320ms/8 · tavily ✗ 429`) so the model can self-diagnose quota issues.

## Engines (16)

| id | backend | key (env) | free | notes |
|---|---|---|---|---|
| `brave` | Brave Search API | `BRAVE_SEARCH_API_KEY` | — | best general default for English/technical |
| `bocha` | Bocha 博查 | `BOCHA_API_KEY` | — | best Chinese web search |
| `zhipu` | Zhipu web-search | `ZHIPU_API_KEY` | — | Chinese, structured citations |
| `wsa` | Tencent WSA | `WSAPI_KEY` | — | Chinese, site/time filters |
| `bailian` | Bailian Q&A | `DASHSCOPE_API_KEY` | — | Chinese answer engine (content, no sources) |
| `exa` | Exa | `EXA_API_KEY` | — | semantic search + `similar_to` (findSimilar) |
| `tavily` | Tavily | `TAVILY_API_KEY` | — | AI search with generated answer |
| `serper` | Serper (Google SERP) | `SERPER_API_KEY` | — | Google results |
| `bing` | Bing RSS | — | ✓ | scrape-based, may break |
| `ddg` | DuckDuckGo HTML | — | ✓ | rate-limited safety net |
| `anysearch` | AnySearch | `ANYSEARCH_API_KEY` (optional) | ✓ | anonymous-capable, vertical tags |
| `firecrawl` | Firecrawl search | `FIRECRAWL_API_KEY` | — | web/news |
| `stack` | StackExchange | — | ✓ | programming Q&A |
| `hn` | Hacker News (Algolia) | — | ✓ | tech community discussion |
| `academic` | Semantic Scholar / arXiv | `S2_API_KEY` (optional) | ✓ | papers (`extra.provider`; `extra.year` filters both providers, from-year semantics) |
| `gh` | GitHub Search | `GITHUB_TOKEN` / `GH_TOKEN` / gh CLI token (optional) | ✓ | repos/issues/PRs/code (code search requires a token) |

Keys resolve as `config.keys.<id>` (literal) → credentials service (which itself layers env > `~/.dsh/.credentials.yaml` > `.env`) → environment variable. Missing keys never crash: the engine just drops out of every routing chain.

> Freshness note: the `YYYY-MM-DDtoYYYY-MM-DD` range form is fully honored by brave (native), exa (start date), wsa (FromTime/ToTime) and Google-backed engines (serper/firecrawl, via `tbs` `cdr`); tavily widens any range to "past year" and bocha/zhipu drop the filter — those APIs have no custom-range vocabulary.

## Install

```bash
dsh plugin --profile web add dsh-websearch
# or straight from the GitHub repository:
dsh plugin --profile web add github:imroc/dsh-websearch
# or from a local checkout:
dsh plugin --profile web add /path/to/dsh-websearch
```

Then add the bundle to the profile's `package.json` (the `dsh.profile.bundles` array):

```json
"dsh": { "profile": { "bundles": [ "...", "dsh-websearch" ] } }
```

and restart DSH. The bundle patch mounts the plugin and pins `web.searchProvider: websearch`, so the built-in `web_search` tool routes through the orchestrator. To undo the pin (keep the plugin, restore another provider), override the `web` row again in `$DSH_HOME/cordis.patch.yml` or the profile's patch layer — later layers win.

> The plugin imports `@deepseek-ai/dsh-tools` as an optional peer dependency and must be installed inside a DSH profile directory (that is how it resolves the host's package — one identity, no duplicate services).

## Configure

**API keys** — three layers, first match wins:

1. Literal keys in the plugin row config (`cordis.patch.yml`) — avoid, secrets in files.
2. The **credentials service**: Settings → Plugins → **Web Search (dsh-websearch)** in the Web UI. Keys are written through the credentials domain into `~/.dsh/.credentials.yaml`, never echoed back, and hot-apply (no restart).
3. Environment variables (`BRAVE_SEARCH_API_KEY`, `BOCHA_API_KEY`, `ZHIPU_API_KEY`, `WSAPI_KEY`, `DASHSCOPE_API_KEY`, `EXA_API_KEY`, `TAVILY_API_KEY`, `SERPER_API_KEY`, `FIRECRAWL_API_KEY`, optional `ANYSEARCH_API_KEY` / `S2_API_KEY` / `GITHUB_TOKEN`).

> **Env shadows the UI store**: the credentials layering is `process environment > ~/.dsh/.credentials.yaml > .env`. If dsh-web inherits a key as a real environment variable, a value saved in the Web UI cannot take effect until that variable is removed from the service environment (the card marks such engines "env-provided" and disables the input).

The Plugins card also carries per-engine enable/disable checkboxes for all 16 engines (keyless ones included) — the `disable` array of the `dsh-websearch` settings section, hot-applied. The same field can be edited in `~/.dsh/settings.yaml`:

```yaml
dsh-websearch:
  disable:
    - bing
```

Missing keys never crash: the engine just drops out of every routing chain. `anysearch`/`gh`/`bing`/`ddg`/`stack`/`hn`/`academic` work without any key.

## The web_search_pro tool

```
queries:      1–5 items of {query, engine?}   (required)
engine:       default engine for queries without one; omit = auto-route
fan_out:      query several engines concurrently, merge + dedup
max_results:  per-query source cap (default 8, max 20)
freshness:    'day' | 'week' | 'month' | 'year' | 'YYYY-MM-DDtoYYYY-MM-DD'
language:     e.g. zh / en          region: e.g. cn / us
include_sites / exclude_sites: domain filters (engines that support them)
topic:        'general' (default) | 'news'
similar_to:   URL — find similar pages (exa findSimilar)
extra:        engine-specific options, e.g.
              {"provider":"arxiv","year":2024}          academic
              {"site":"superuser","tagged":"docker"}    stack
              {"type":"comment","days":7}               hn
              {"tag":"code.doc","params":{}}            anysearch
              {"searchType":"neural","category":"publication"} exa
              {"depth":"advanced"}                      tavily
              {"engine":"search_std"}                   zhipu
              {"kind":"issues","sort":"updated"}        gh
              {"model":"qwen-plus"}                     bailian
```

Auto-routing: CJK queries → `bocha`, otherwise `brave`; hard failures fall back along the skill-era chain `tavily → exa → bocha → zhipu → anysearch → ddg` (availability-filtered). Empty results try the next engine on the auto path but are returned as-is when an engine was chosen explicitly.

## Development

```bash
npm test                     # 66 unit tests (no network)
node scripts/smoke.mjs       # one live query per backend with real keys
```

Design notes and the decision record live in [docs/DESIGN.md](docs/DESIGN.md).

## License

MIT
