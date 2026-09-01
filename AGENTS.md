# AGENTS.md — instructions for AI agents working in this repository

You are contributing to **dsh-websearch**, a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH) profile-bundle plugin that brings multi-engine web search to the harness through three contributions:

1. an **aggregated `ctx.web` search provider** (id `websearch`) — auto-routing (CJK → bocha, otherwise → brave) with sequential fallback down a chain that always terminates on free engines, so the built-in `web_search` tool keeps its official schema, stops burning LLM tokens per search, and survives paid-quota exhaustion;
2. a **`web_search_pro` model tool** — per-query engine choice, batch (≤5), fan-out with merge/dedup, a normalized parameter surface (freshness / sites / language / region / topic / similar_to), engine-specific `extra` options, and per-attempt telemetry;
3. a **browser settings card** (Settings → Plugins) — per-engine credential fields written through the credentials domain (never echoed back), plus engine enable/disable toggles.

16 engines are wired: brave, bocha, zhipu, wsa, bailian, exa, tavily, serper, bing, ddg, anysearch, firecrawl, stack, hn, academic (S2 + arXiv), gh. `docs/DESIGN.md` holds the design decisions, the engine matrix, and the parameter mapping — read it before changing routing or adapters.

## Naming

The **npm package is `dsh-plugin-websearch`**, not `dsh-websearch`: the natural names `dsh-websearch` and `dsh-websearch-plugin` are both blocked by npm's confusable-name policy (unrelated third-party packages `dsh-web-search` and `dsh-web-search-plugin` exist; the check ignores hyphens). Everything else keeps the `dsh-websearch` identity — repo name, plugin display name, settings namespace (and therefore `~/.dsh/settings.yaml` keys and saved credentials), card title, log prefixes. The package name appears in exactly four places that must stay in sync: `package.json` `name`, the `name:` of the inserted row in `cordis.patch.yml`, the ModuleLoader `id` in `client.js`, and the profile dependency/bundles entries.

## Layout

```
index.js            host half: provider + tool + settings section + per-agent prompt guide
client.js           browser half — NOT raw ESM; see the client bundle contract below
src/core/           engines.js (metadata) · registry.js · router.js (routing/fallback/merge)
                    · secrets.js (key resolution) · format.js · http.js · util.js
src/backends/       16 engine adapters, one file each
test/               node --test suite; test/client.test.js enforces the bundle registration contract
scripts/smoke.mjs   one LIVE query per backend with real keys (network required)
cordis.patch.yml    bundle layer: inserts the plugin row + pins web.searchProvider: websearch
docs/DESIGN.md      architecture, decision record, engine matrix, pitfalls
README.md / README.zh.md   bilingual user docs (EN is the source of truth; keep zh in sync)
```

## Hard constraints — do not relax these

1. **Target the INSTALLED DSH, not the master source.** The local harness checkout is master and the deployment runs an older release (0.1.1-rc.2 when this was written); **five silent API divergences have already shipped bugs here** (settings registration, exports map, credentials remote shape and location, client service names — see `docs/DESIGN.md` "结论演进"-style history and the dsh-expert knowledge base). Before relying on any `@deepseek-ai/*` API, verify it against the installed packages — on this machine under `/home/linuxbrew/.linuxbrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/<pkg>/lib/` — not against the checkout.
2. **Client bundle contract:** `client.js` is served as a classic `<script>` and MUST register via `window.__ModuleLoader__.load({ id: 'dsh-plugin-websearch', factory: (require) => {...} })` — the id is the loader entry name, which MUST equal the npm package name in `package.json` (the test derives it from there). React comes from the injected `require('react')`; `import` statements are a syntax error in this context and previously broke the whole Web UI. No build step — the closure-factory form is hand-written on purpose.
3. **`package.json` `exports` must keep `"./package.json": "./package.json"`.** client-modules locates a bundle package via `require.resolve('<pkg>/package.json')`; without that subpath export the client half silently drops out of the boot graph (no error, no card).
4. **Cross-version call sites are defensive on purpose.** Settings registration uses the plain `settings.register(ns, schema, { base })` + `scope.get()/watch()` API shared by both releases; the credentials remote is resolved as `ctx.get('remote.credentials') ?? ctx.get('connection')?.api?.credentials ?? ctx.remote?.credentials`, and describe/set probe both argument shapes. Do not "simplify" these to a single-release form.
5. **Keys live in a mutable map read per call** (`src/core/secrets.js` + backends reading `keys.<engine>` live). Credential and settings changes hot-apply through `refreshKeys()` (triggered by `credentials/reference-updated` and the settings scope watch). Never snapshot keys into backends at creation time.
6. **Docs move with the code.** A behavior or decision change updates `docs/DESIGN.md` and both READMEs in the same commit. DSH-generic conclusions (not plugin-specific) belong in the DSH knowledge base — on this machine `~/dev/dsh-expert/knowledge/` (see its AGENTS.md); record them as you discover them.

## Development loop

```bash
npm test                        # full unit suite, no network
node scripts/smoke.mjs [engine…]  # one live query per backend; reads keys from the
                                 # running dsh-web process env when the shell scrubbed them
```

The local deployment runs the **released npm version** (`~/.dsh/profiles/web` and `~/.dsh/profiles/dsh-tui`, both `^` ranges of `dsh-plugin-websearch`). To test uncommitted changes, temporarily point a profile at this checkout (a `file:` dependency — **`pnpm update` does NOT refresh it**; always remove + add):

```bash
cd ~/.dsh/profiles/web && pnpm remove dsh-plugin-websearch && pnpm add file:<this-repo-path>
```

After the change ships, publish and restore the registry dependency in both profiles (or use `dsh plugin --profile <name> add dsh-plugin-websearch@^<version>`, which also reconciles the `bundles` array):

```bash
npm publish                                        # from the repo root, after committing
cd ~/.dsh/profiles/web && pnpm add dsh-plugin-websearch@^<version>
cd ~/.dsh/profiles/dsh-tui && pnpm add dsh-plugin-websearch@^<version>
```

- `client.js` changes: HMR picks them up (the boot graph `rev` changes — verify with `curl -s http://127.0.0.1:3080/ | grep dsh-websearch`); the browser just needs a refresh.
- Host-side changes (`index.js`, `src/`): restart the dsh-web service (`systemctl --user restart dsh-web` — it interrupts running sessions' turns; pick an idle moment).
- `~/.dsh/.credentials.yaml` is the UI-managed key store; note the credentials layering: **the process environment shadows it** — a key present in the dsh-web service env always wins over a UI-saved value.

## Engine adapter rules

- Normalize every backend result to `{ content?, sources[{url, title?, snippet?, publishedAt?}], truncated? }`. Engine tagging of sources happens in the router (`normalizeResult`), not in backends.
- Failures throw `BackendError(engine, message)`; the router owns fallback semantics — a hard error moves to the next engine, an empty result is a soft failure on the auto-routed path but a valid answer when an engine was chosen explicitly.
- Shared parameter mapping (freshness vocabularies, site operators, date coercion) lives in `src/core/util.js`; engine-specific options flow through the `extra` object (documented in the READMEs).
- Adding an engine: adapter in `src/backends/`, metadata in `src/core/engines.js`, factory in `src/core/registry.js`, README matrix + `docs/DESIGN.md` entry, unit tests with a mocked `fetch`, and a `QUERIES` row in `scripts/smoke.mjs`. Validate the live API with a real call before shipping (canned assumptions have been wrong before: zhipu ignores `count`, WSA requires FromTime/ToTime as a pair, Bing RSS needs an explicit `mkt`, the brave **news** endpoint puts `results` at the top level with no `news` wrapper, zhipu started returning an empty `link` field, arXiv OR-expands unquoted multi-word queries). Engine news/shape changes are exactly why `test/client.test.js` cross-checks the card's ENGINES table against `engines.js`.

## Conventions

- Plain ESM JavaScript, no build step, no runtime dependencies; `@deepseek-ai/*` stay optional peer dependencies resolved from the running harness (the plugin must be installed inside a DSH profile directory).
- Commit messages: Chinese subject line, imperative (matching this repo's history).
- Bump `version` in `package.json` on every change; every release is published to npm (`npm publish` from the repo root — the committed source is the shipped artifact, no build step). The GitHub repo and local paths remain alternative install sources.
- Never commit secrets: tests mock `fetch`, smoke queries are harmless, keys come from the environment.
