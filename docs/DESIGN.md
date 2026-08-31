# dsh-websearch — 设计定稿

日期：2026-09-06 · 状态：v1 定稿（三轮需求 grill 收敛）· 适用：DSH 0.1.1-rc.2（源码 master `0a53fb5` 验证接缝）

## 1. 目标与决策记录

把原 websearch 技能（16 渠道 bash 脚本）的能力收进一个 DSH 插件，实现「丰富的搜索后端 + AI 按需搜索」。

| # | 决策 | 结论 |
|---|---|---|
| 1 | 归宿 | 自用优先，按可开源标准写（git 依赖起步，后发 npm） |
| 2 | 分层 | 全部收进插件：能力+策略都在工具描述与 prompt section 中 |
| 3 | 成本 | 多后端可配置、免费优先；有 key 自动解锁付费后端 |
| 4 | 范围 | 只做搜索：读页面归官方 `web_fetch`；deep-research/extract 编排由模型自行多步编排 |
| 5 | 工具面 | 聚合 provider（接管 `web.searchProvider`，官方 `web_search` 受益且不再烧 LLM token）+ 1 个增强工具 `web_search_pro` |
| 6 | v1 矩阵 | 全量 16 渠道 + Serper(Google)/Bing 新增，共 16 个引擎 id（academic 内含 s2/arxiv 两数据源） |
| 7 | 路由 | 自动路由（中文→bocha，其它→brave）+ 顺序降级链（尾部 AnySearch 匿名 + DDG 永远免费可用）；fan-out 仅显式要求 |
| 8 | SearXNG | 不做，不预留 |
| 9 | 旧技能 | 暂不动（并行过渡，稳定后再处置） |
| 10 | 部署 | 动态插件原型验证接缝 → 静态 npm 包落 `~/.dsh/profiles/web` |

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
| academic | S2 + arXiv | api.semanticscholar.org / export.arxiv.org | — | ✓ | 学术 | extra.provider=s2/arxiv, year, field |
| gh | GitHub Search | api.github.com/search/{repositories,issues,code} | GITHUB_TOKEN/GH_TOKEN 或 gh hosts.yml（可选） | ✓ | 代码/仓库 | extra.kind/sort；限定符直接写进 query |

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
