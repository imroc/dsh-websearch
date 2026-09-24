# dsh-websearch — 设计定稿

日期：2026-09-06 · 状态：v0.2.4 · 适用：DSH 0.1.1-rc.2 装机实测（源码 master `0a53fb5` 仅作对照，API 有差异见 §8）

> **v0.2.4 增量（2026-08-31 全量验证 + 评审修复）**：全量实测发现两处**上游 API 漂移**并修复其影响——① zhipu 响应的 `link` 字段对时效/新闻类查询全空（技术类查询正常，实测对照；router 过滤后恒 0 条）→ adapter 在全部条目无 link 时 throw 触发降级 + count 客户端截断（API 忽略 count，3 要 47 回）；② brave News 端点 `results` 在顶层无 `news` 包装（官方 API Reference 确认）→ 解析改 `data?.results`。评审修复：arXiv 多词查询加引号（不加引号被 OR 展开，60 万条无关命中）、Google tbs 日期区间改 `cdr:1,cd_min:…,cd_max:…`（`qdr:c:from..to` 是非法词汇被静默忽略）、bing/ddg 格式异常从静默空结果改为 BackendError、ddg snippet 按邻近配对（原按序号配对会错位）+ 属性顺序无关解析、exa findSimilar 补 freshness/sites、http.js 超时可重试 + 外部 abort 不重试不包装、fanOutQuery 取消传播、stack 删除 `truncated` 挪用（配额告警污染合并结果）、arXiv `extra.year` 实现（submittedDate 区间，与 S2 同为起始年语义）、bing mkt 区域映射表 + ddg kl 全形态、gh 补 `keyEnv`（卡片可管理 token）+ 匿名 code search 提前报错、卡片补 4 个免 key 引擎开关 + toggleEngine 容错 + ENGINES 表与 engines.js 一致性单测。66 单测全绿。

> **v0.2.x 增量（密钥配置 UI 化 + rc.2 兼容）**：宿主侧注册 settings section（namespace `dsh-websearch`，schema `{disable: string[], keys: dict(secret)}`）+ key 走 `credentials.resolve(credentialRef(refName))` 惰性解析（层叠：字面量 config > credentials 服务[内部 env > .credentials.yaml > .env] > process env）；`credentials/reference-updated` 事件与 settings scope watch 触发 refreshKeys，写入 live keys map（后端每次调用现读，热生效）。浏览器半边 `client.js`（`dsh.client.platform: web` + `exports["./client"]`）在 `settings.plugin.item` keyed slot（key=namespace）注册卡片：credentials remote 管密钥（明文永不上行回显）、settings scope 管 disable 复选框。**关键告警：进程 env 遮蔽 UI 存储**——credentials 层叠 env 优先，服务进程 env 已有的同名 key 会遮蔽 UI 写入值（卡片对 writable=false 的引擎标注「env 提供」并禁用输入）。

## 8. 版本演进与坑位记录（0.2.x，任何 rc.2 部署都会踩）

以下差异全部**静默失败**（无报错、无日志、部分功能悄悄消失），已全部修复，勿回退成单版本写法：

| # | 差异点 | rc.2（装机） | master（源码） | 失败形态 |
|---|---|---|---|---|
| 1 | settings 注册 | 顶层函数 `installSettingsSection(ctx, ns, schema, entry, hooks)`（内部= `settings.register(ns, schema, {base})` + `scope.get/watch`） | 服务方法 `settings.installSection(...)` | 子 fiber 静默死亡：section 不注册、设置页无卡片，但 provider 照常（极具迷惑性） |
| 2 | 包定位 | client-modules 用 `require.resolve('<pkg>/package.json')`；包一旦声明 exports 映射**必须显式含 `"./package.json"`** | 同 | client 半边静默退出 boot 图（404、无卡片、无报错） |
| 3 | client bundle 契约 | classic `<script>` 加载，必须 `window.__ModuleLoader__.load({id, factory})` closure-factory，react 从 `require('react')` 取 | 同 | raw ESM（`import`）语法错误 → **整个 Web UI 无法加载** |
| 4 | credentials remote | 挂在 `ctx.get('connection').api.credentials`；`describe({refs}) → result.value.credentials`、`set({ref, value})` | 独立注入服务 `remote.credentials`；`describe(refs) → value`、`set(ref, value)` | 调用静默 TypeError：徽标恒默认值、保存无效 |
| 5 | 客户端服务名 | inject 列表无 `remote.credentials`（注入它=永远等待） | 有 | 客户端插件永不激活 |

**排障工具箱**：boot 图 `curl -s http://127.0.0.1:3080/ | grep dsh-websearch`（rev 变化=HMR 生效）；宿主内部态用动态诊断插件读 `settings.describe()`/`clientModules.graph()` 并以 `throw` 带回结果；web seam pin 验证=注册一次性探针 provider 后调 `ctx.web.search`。完整排障过程见 dsh-agent 知识库（`knowledge/dev/20260906-自建dsh-websearch插件设计与实现.md`）。

## 9. 0.1.7 迁移（0.2.5）

| # | 差异点 | ≤0.1.5 | 0.1.7 | 处理 |
|---|---|---|---|---|
| 1 | agent 生命周期边 | `agent/session-start`（emit） | **已删除**，改为 serial 的 `agent/created`（首个模型请求 await 每个监听器） | 两个边都订阅、共用同一 handler，`handled` WeakSet 去重；handler 显式 `return undefined` |
| 2 | settings 注册 | `settings.register(ns, schema, {base})` | **`register` 与 `installSection` 双双退役**：插件的设置就是它自己的 Loader 条目 config，由 `Config` schema 自动生成表单，改动重挂行 | 探测 `typeof settings?.register === 'function'`，不命中则跳过注册并 `refreshKeys()`；组合行 config 成为唯一来源 |
| 3 | 设置卡片 | 客户端服务 `settingsScope` + `settings.plugin.item` 槽位 | 两者都删除（改为 `plugins.*` 一族 + form API） | **待办**：客户端半边在 0.1.7 不激活（`exports.inject` 里的 `settingsScope` 永不出现），卡片消失；provider / `web_search_pro` / 注入提示词不受影响，引擎 key 仍走 env 与 credentials |
| 4 | client 共享包 | `dsh.client.inject` 含已停发的 `@deepseek-ai/dsh-client-runtime` | 该包不存在 | 从 inject 列表移除 |

**结论**：0.1.7 上「搜索能力」完整（provider + 工具 + prompt 引导 + env/credentials 取 key），丢的是设置卡片；卡片重写要对着真实 0.1.7 UI 迭代。

## 1. 目标与决策记录

把原 websearch 技能（16 渠道 bash 脚本）的能力收进一个 DSH 插件，实现「丰富的搜索后端 + AI 按需搜索」。

| # | 决策 | 结论 |
|---|---|---|
| 1 | 归宿 | 自用优先，按可开源标准写；npm 为主分发渠道（2026-09-01 发布 0.2.4，账号 imrocchan，包名 **dsh-plugin-websearch**——裸名 dsh-websearch 与 dsh-websearch-plugin 均被 npm 混淆名保护政策拒绝：已存在无关三方包 dsh-web-search / dsh-web-search-plugin，审查忽略连字符），GitHub 仓库与本地路径为备选安装源；插件内部身份（settings namespace、卡片标题、日志前缀）仍用 dsh-websearch |
| 2 | 分层 | 全部收进插件：能力+策略都在工具描述与 prompt section 中 |
| 3 | 成本 | 多后端可配置、免费优先；有 key 自动解锁付费后端 |
| 4 | 范围 | 只做搜索：读页面归官方 `web_fetch`；deep-research/extract 编排由模型自行多步编排 |
| 5 | 工具面 | 聚合 provider（接管 `web.searchProvider`，官方 `web_search` 受益且不再烧 LLM token）+ 1 个增强工具 `web_search_pro` |
| 6 | v1 矩阵 | 全量 16 渠道 + Serper(Google)/Bing 新增，共 16 个引擎 id（academic 内含 s2/arxiv 两数据源） |
| 7 | 路由 | 自动路由（中文→bocha，其它→brave）+ 顺序降级链（尾部 AnySearch 匿名 + DDG 永远免费可用）；fan-out 仅显式要求 |
| 8 | SearXNG | 不做，不预留 |
| 9 | 旧技能 | 已移除（2026-08-31）：插件装进 web + dsh-tui 双 profile 后，skills 仓的 websearch 技能（16 渠道 bash 脚本）git rm 退役，reach 技能路由改指插件工具 |
| 10 | 部署 | 动态插件原型验证接缝 → 静态包落 `~/.dsh/profiles/web` + `~/.dsh/profiles/dsh-tui`；稳定后两 profile 均切 npm 版本 `dsh-plugin-websearch`（`^` range），`file:` 仅开发期临时挂载 |

## 2. 架构

```
                       ┌────────────────────────────────────────────────┐
官方 web_search 工具 ──▶│ ctx.web (dsh-web seam)                        │
(queries 数组, schema   │   searchProvider: websearch  ← bundle patch 钉 │
 不变)                  │        │                                      │
                       │        ▼                                      │
web_search_pro 工具 ──▶│  聚合 provider id=websearch                    │
(engine/fan_out/批量/   │   └─ orchestrator (router.js)                 │
 垂直/参数面)           │       ├─ 自动路由: CJK? bocha : brave          │
                       │       ├─ 顺序降级: tavily→exa→bocha→zhipu→     │
                       │       │   anysearch→ddg (按可用性过滤)          │
                       │       ├─ fan-out: 多引擎并发+URL 去重交错合并    │
                       │       └─ 批量: ≤5 条查询独立路由后合并           │
                       │  registry.js → 16 个后端 adapter               │
                       └────────────────────────────────────────────────┘
```

- **provider 路径**：单 query → orchestrator 自动路由+降级，返回官方 `WebSearchResult` 规范形（content/sources/truncated）。
- **工具路径**：`web_search_pro` 直接调 orchestrator（绕过 provider 单选），暴露 engine/参数面/批量/fan-out。
- **prompt 引导**：`agent/session-start` 时在 `agent.ctx.systemPrompt` 注册 `tool:web_search_pro` section（场景→引擎路由表），WeakSet 防重复注册（dsh-project-prompt 已验证的姿势）。

### 关键接缝事实（源码依据）

- `ctx.web.registerSearchProvider({id, available(), search(req, signal)})`，返回 disposer，fiber-scoped（`packages/web/web/src/index.ts:103`）。
- provider 选择永不依赖注册顺序：配置 id → 唯一可用自动选 → 多可用抛 `WEB_PROVIDER_AMBIGUOUS`；故必须用 bundle patch 钉 `searchProvider`（`resolveProvider`，同文件:172）。
- 模型工具经 `ctx.tools.register(defineTool(...))`，effect-scoped 自动清理（`docs/cookbook/adding-a-tool.md`）；tools registry 全局注册 + scope 过滤视图，host 级注册对 agent 会话可见。
- 同名 tool 同 scope 重复注册抛错——新工具必须用新名字（`web_search_pro`）。
- web 行 config 整键替换：覆盖时必须重申 `fetchProvider: http`（base bundle `packages/bundle/base/cordis.patch.yml:450`）。
- 插件内 `import '@deepseek-ai/dsh-tools'` 依赖 `~/.dsh/profiles/node_modules/@deepseek-ai/*` → 全局 dsh 安装的符号链接（同身份，防 Service 分叉）；**插件必须装进 profile 目录树内**。

## 3. 引擎矩阵（16）

| id | 后端 | 端点 | key（env） | 免费 | 垂直 | 支持能力 |
|---|---|---|---|---|---|---|
| brave | Brave Search API | api.search.brave.com/res/v1/{web,news}/search | BRAVE_SEARCH_API_KEY | ✗ | — | freshness, sites(include 首个, site_filter), language, region, news |
| bocha | 博查 | api.bochaai.com/v1/web-search | BOCHA_API_KEY | ✗ | 中文 | freshness(oneDay…) |
| zhipu | 智谱 web-search | open.bigmodel.cn/api/paas/v4/web_search | ZHIPU_API_KEY | ✗ | 中文 | freshness, sites(include), extra.engine=search_pro/std |
| wsa | 腾讯云 WSA | api.wsa.cloud.tencent.com/SearchPro | WSAPI_KEY | ✗ | 中文 | sites, freshness→FromTime/ToTime |
| bailian | 阿里百炼联网问答 | dashscope…/compatible-mode/v1/chat/completions | DASHSCOPE_API_KEY（或 ~/.bailian/config.json） | ✗ | 中文答案引擎 | 无 sources，仅 content |
| exa | Exa 语义搜索 | api.exa.ai/{search,findSimilar} | EXA_API_KEY | ✗ | 语义 | freshness→startPublishedDate, sites(include), similar_to, extra.searchType/category |
| tavily | Tavily | api.tavily.com/search | TAVILY_API_KEY | ✗ | AI 搜索 | freshness(time_range), sites, news(topic), content=answer |
| serper | Serper(Google) | google.serper.dev/{search,news} | SERPER_API_KEY | ✗ | Google SERP | freshness(tbs), sites(query 语法), language(hl), region(gl), news |
| bing | Bing RSS | bing.com/search?format=rss | — | ✓ | — | language(setlang), region(mkt), news(rss), sites(query 语法) |
| ddg | DuckDuckGo HTML | html.duckduckgo.com/html/ | — | ✓ | 兜底 | region(kl)；有限流 |
| anysearch | AnySearch | api.anysearch.com/v1/search | ANYSEARCH_API_KEY（可选，匿名可用） | ✓ | 垂直 tag | zone(cn/intl), language, extra.tag/params |
| firecrawl | Firecrawl search | api.firecrawl.dev/v2/search | FIRECRAWL_API_KEY | ✗ | web/news | freshness(tbs), news(sources) |
| stack | StackExchange | api.stackexchange.com/2.3/search/advanced | — | ✓ | 编程问答 | extra.site/tagged/sort/answered |
| hn | Hacker News(Algolia) | hn.algolia.com/api/v1/{search,search_by_date} | — | ✓ | 技术社区 | extra.type/sort/days |
| academic | S2 + arXiv | api.semanticscholar.org / export.arxiv.org | — | ✓ | 学术 | extra.provider=s2/arxiv, year(两家生效,起始年), field；arXiv 多词必须加引号防 OR 展开 |
| gh | GitHub Search | api.github.com/search/{repositories,issues,code} | GITHUB_TOKEN/GH_TOKEN 或 gh hosts.yml（可选） | ✓ | 代码/仓库 | extra.kind/sort；限定符直接写进 query；code search 必须有 token |

## 4. 路由与降级语义

- **自动路由**（`engine` 省略）：query 含 CJK → 首选链 `[bocha, zhipu, wsa, brave, serper, tavily, exa]`；否则 `[brave, serper, tavily, exa, bocha]`；随后拼接技能时代的降级尾 `tavily→exa→bocha→zhipu→anysearch→ddg`，去重后按 `available()` 过滤。
- **失败降级**：后端硬错误（网络/HTTP/解析）→ 试下一家；**空结果**在自动路径算软失败继续换家，在显式 engine 路径算有效答案立即返回。
- **显式 engine**：也带降级（失败才降级），attempts 遥测暴露实际应答者与降级轨迹。
- **fan_out**：默认 `[brave, bocha, tavily, exa]` ∩ 可用，上限 4 家并发，`Promise.allSettled`，按 rank 交错 + URL 去重合并（tool-web 的 merge 语义）。
- **批量**：≤5 条查询各自独立路由/降级，content 按 `### query` 分节，sources 交错去重合并，总量按 `max_results × 查询数` 封顶。
- 全部失败 → 抛 `WEB_PROVIDER_ERROR` 风格错误（列全部尝试）；免费引擎兜底保证能力不归零。

## 5. web_search_pro 工具

参数（DSL schema）：`queries[]`（1–5 项，每项 `{query, engine?}`，必填）、`engine`（缺省引擎）、`fan_out`、`max_results`（默认 8，≤20）、`freshness`（day|week|month|year|YYYY-MM-DDtoYYYY-MM-DD）、`language`、`region`、`include_sites[]`、`exclude_sites[]`、`topic`（general|news）、`similar_to`（exa findSimilar）、`extra`（引擎特定透传对象）。

canonical 输出：`{content?, sources[{url,title?,snippet?,publishedAt?,engine}], truncated, attempts[{engine,query,ok,elapsedMs,count,error?,via?}]}`；render 输出 = 信任边界前缀 + content + Sources 列表 + 一行遥测（`[websearch] brave ✓ 320ms/8 · tavily ✗ 429`）+ 引用指令；presentationMeta 与官方 WebSearchMeta 兼容（web 卡片复用）；presentCall/presentResult 镜像 tool-web（generic search 卡 / web search 卡）。

## 6. 配置（cordis.patch.yml 行覆盖，无 schema、手工校验）

```yaml
- id: websearch
  config:
    disable: [bing]        # 禁用引擎 id 列表
    keys:                  # 字面量 key（优先于 env）
      brave: xxx
    defaults:
      maxResults: 8
      timeoutMs: 15000
      fanOutEngines: [brave, bocha, tavily, exa]
```

key 解析顺序：`config.keys.<id>` > 各引擎 env（见矩阵）> 不可用（available()=false，自动从链中消失，缺 key 不崩溃）。anysearch/gh/bing/ddg/stack/hn/academic 无 key 也可用。

## 7. 风险与对策

- **DSH 迭代快**（rc.2 vs master alpha.2）：接缝以官方 exa provider 为样板；`@deepseek-ai/dsh-tools` 为 optional peer，只在 profile 内解析。
- **Bing/DDG 抓取脆弱**：RSS/HTML 解析，限流即降级，永远排在链尾。
- **firecrawl v2 search 响应形态**：以冒烟测试实测为准（解析兼容多形态）。
- **web 行 patch 整键替换**：升级 DSH 后若 base 的 web 行 config 增加新键，本 patch 会丢键——升级时复查 `packages/bundle/base/cordis.patch.yml` 的 web 行。
