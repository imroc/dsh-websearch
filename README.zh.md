# dsh-websearch

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）的多引擎网页搜索插件：一个带自动路由与降级的聚合 `ctx.web` search provider，加一个让 agent 按需点菜的 `web_search_pro` 模型工具——多引擎并发、批量查询、垂直搜索（StackOverflow / Hacker News / 论文 / GitHub）。

## 为什么做

DSH 内置 `web_search` 每次只走一个 provider（默认 `deepseek-official`——每次搜索都是一次完整 LLM 调用）。官方接缝（`ctx.web`）刻意不做多后端路由、降级与 fan-out。本插件补上这一层：

- **`web_search` schema 不变**，但背后是编排器：中文查询走博查、其它走 Brave，失败沿降级链回退，链尾永远是免费引擎——付费额度耗尽搜索能力不归零，也不再为每次搜索烧 LLM token。
- **`web_search_pro`** 把引擎矩阵暴露给模型：按查询指定引擎、最多 5 条批量、`fan_out` 多引擎合并去重、归一化参数（时效/站点过滤/语言/地区/新闻）、引擎特定透传。输出带每引擎遥测（`[websearch] brave ✓ 320ms/8 · tavily ✗ 429`），模型可自行诊断额度问题。

## 引擎（16 个）

| id | 后端 | key（env） | 免费 | 说明 |
|---|---|---|---|---|
| `brave` | Brave Search API | `BRAVE_SEARCH_API_KEY` | — | 英文/技术类默认首选 |
| `bocha` | 博查 | `BOCHA_API_KEY` | — | 中文质量最好 |
| `zhipu` | 智谱 web-search | `ZHIPU_API_KEY` | — | 中文，结构化引用 |
| `wsa` | 腾讯云 WSA | `WSAPI_KEY` | — | 中文，站点/时间过滤 |
| `bailian` | 阿里百炼联网问答 | `DASHSCOPE_API_KEY` | — | 中文答案引擎（只有 content 无 sources） |
| `exa` | Exa | `EXA_API_KEY` | — | 语义搜索 + `similar_to` 找相似页 |
| `tavily` | Tavily | `TAVILY_API_KEY` | — | AI 搜索，带生成答案 |
| `serper` | Serper（Google SERP） | `SERPER_API_KEY` | — | Google 结果 |
| `bing` | Bing RSS | — | ✓ | 抓取实现，可能失效 |
| `ddg` | DuckDuckGo HTML | — | ✓ | 有限流的兜底 |
| `anysearch` | AnySearch | `ANYSEARCH_API_KEY`（可选） | ✓ | 匿名可用，垂直 tag |
| `firecrawl` | Firecrawl search | `FIRECRAWL_API_KEY` | — | web/新闻 |
| `stack` | StackExchange | — | ✓ | 编程问答 |
| `hn` | Hacker News（Algolia） | — | ✓ | 技术社区讨论 |
| `academic` | Semantic Scholar / arXiv | `S2_API_KEY`（可选） | ✓ | 论文（`extra.provider`；`extra.year` 对两家都生效，起始年语义） |
| `gh` | GitHub Search | `GITHUB_TOKEN` / `GH_TOKEN` / gh CLI token（可选） | ✓ | 仓库/issue/PR/代码（code search 必须有 token） |

key 解析顺序：`config.keys.<id>`（字面量）→ credentials 服务（其内部层叠：env > `~/.dsh/.credentials.yaml` > `.env`）→ 环境变量。缺 key 永不崩溃：该引擎自动退出所有路由链。

> 时效（freshness）说明：`YYYY-MM-DDtoYYYY-MM-DD` 区间格式在 brave（原生）、exa（起始日期）、wsa（FromTime/ToTime）与 Google 系引擎（serper/firecrawl，经 `tbs` 的 `cdr`）上完整生效；tavily 会把任意区间放宽为「过去一年」，bocha/zhipu 直接丢弃过滤——这几家 API 没有自定义区间词汇。

## 安装

npm 包名为 `dsh-plugin-websearch`（更自然的 `dsh-websearch` / `dsh-websearch-plugin` 名字均因 npm 混淆名保护政策被无关的第三方包占用）：

```bash
dsh plugin --profile web add dsh-plugin-websearch
# 或直接从 GitHub 仓库安装：
dsh plugin --profile web add github:imroc/dsh-websearch
# 或本地目录：
dsh plugin --profile web add /path/to/dsh-websearch
```

再把包名加进 profile 的 `package.json`（`dsh.profile.bundles` 数组）：

```json
"dsh": { "profile": { "bundles": [ "...", "dsh-plugin-websearch" ] } }
```

重启 DSH 生效。bundle patch 会挂载插件并把 `web.searchProvider` 钉到 `websearch`，内置 `web_search` 工具即走编排器。想撤销钉选（保留插件、换回其它 provider），在 `$DSH_HOME/cordis.patch.yml` 或 profile 的 patch 层再覆盖一次 `web` 行即可——后层生效。

> 插件以 optional peer dependency 引入 `@deepseek-ai/dsh-tools`，必须装在 DSH profile 目录内（这样才解析到宿主同一份包——同一身份，不产生重复 Service）。

## 配置

**API key** —— 三层解析，先到先得：

1. 插件行 config 里的字面量 key（`cordis.patch.yml`）——不建议，密钥落配置文件。
2. **credentials 服务**：Web UI 的**插件页 → `dsh-plugin-websearch` → `websearch` 行 → 配置**（0.1.7 起；0.1.5 及更早为 设置 → 插件 → **Web Search（dsh-websearch）**）。密钥经 credentials 域写入 `~/.dsh/.credentials.yaml`，永不回显，保存即热生效（无需重启）。
3. 环境变量（`BRAVE_SEARCH_API_KEY`、`BOCHA_API_KEY`、`ZHIPU_API_KEY`、`WSAPI_KEY`、`DASHSCOPE_API_KEY`、`EXA_API_KEY`、`TAVILY_API_KEY`、`SERPER_API_KEY`、`FIRECRAWL_API_KEY`，可选 `ANYSEARCH_API_KEY` / `S2_API_KEY` / `GITHUB_TOKEN`）。

> **env 会遮蔽 UI 存储**：credentials 层叠为 `进程环境变量 > ~/.dsh/.credentials.yaml > .env`。若 dsh-web 进程继承了这个 key 的环境变量，UI 里保存的值不会生效，直到该变量从服务环境中移除（卡片会把这类引擎标为「env 提供」并禁用输入框）。

插件卡片还提供每引擎的启用/禁用复选框（16 个引擎全有，含免 key 引擎）——即 `websearch` 条目 config 的 `disable` 数组（0.1.7 起标了 `.volatile()`，改完热生效不重挂；设置页里的同名字段与卡片写的是同一份值）。同样的字段也可以直接编辑 profile 的 `cordis.patch.yml`（≤0.1.5 走 `~/.dsh/settings.yaml` 的 `dsh-websearch` 段）：

```yaml
dsh-websearch:
  disable:
    - bing
```

缺 key 永不崩溃：该引擎自动退出所有路由链。`anysearch`/`gh`/`bing`/`ddg`/`stack`/`hn`/`academic` 无 key 也可用。

## web_search_pro 工具

```
queries:      1–5 项 {query, engine?}（必填）
engine:       未指定引擎查询的默认引擎；省略 = 自动路由
fan_out:      多引擎并发，合并去重
max_results:  每查询条数上限（默认 8，最大 20）
freshness:    'day' | 'week' | 'month' | 'year' | 'YYYY-MM-DDtoYYYY-MM-DD'
language:     如 zh / en          region: 如 cn / us
include_sites / exclude_sites: 域名过滤（支持的引擎生效）
topic:        'general'（默认）| 'news'
similar_to:   URL——找相似页面（exa findSimilar）
extra:        引擎特定选项，例如：
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

自动路由：CJK 查询 → `bocha`，否则 `brave`；硬失败沿 `tavily → exa → bocha → zhipu → anysearch → ddg` 降级（按可用性过滤）。自动路径上空结果会换下一家；显式指定引擎时空结果直接返回。

## 开发

```bash
npm test                     # 66 个单测（无网络）
node scripts/smoke.mjs       # 每个后端一条真实查询
```

设计说明与决策记录见 [docs/DESIGN.md](docs/DESIGN.md)。

## 许可

MIT
