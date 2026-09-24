// Browser half of dsh-websearch: the plugin's configuration card.
//
// Where the card lives depends on the release:
//   0.1.7+  Plugins page → the `dsh-plugin-websearch` package → the `websearch`
//           row → Configure (`plugins.row.config`, keyed `<package>#<row id>`);
//           the settings namespace is that row id.
//   ≤ 0.1.5 Settings → Plugins (`settings.plugin.item`, keyed by the
//           `dsh-websearch` section the host half registers).
// The card registers into both seats; each waits for its slot to be declared,
// so the unknown one stays inert.
//
// The card does two jobs, mirroring the official web-search card:
//   1. Per-engine credential fields — written through the credentials domain
//      (`remote.credentials.set`), so the literal lands in
//      ~/.dsh/.credentials.yaml, never in the settings document, and never
//      rides a response back to the browser. The card only learns whether a
//      reference is configured and whether it is writable (an env-sourced key
//      is read-only from here).
//   2. Engine enable/disable toggles — the `disable` array of the
//      `dsh-websearch` settings section, hot-applied on the Host.
//
// The Host half registers the settings namespace (index.js installSection);
// the Plugins tab enumerates it and dispatches to this card by key.
//
// DSH client bundles are classic scripts with a closure-factory contract:
// execution must register a factory via window.__ModuleLoader__.load. The
// factory receives a module-table require; platform modules such as React are
// available through it. A raw ES module is served as a classic script and
// fails before registration with "loaded without registering ...".

window.__ModuleLoader__.load({
  id: 'dsh-plugin-websearch',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const { createElement, useState } = require('react')

    exports.name = 'dsh-websearch-client'

// Only services EVERY supported release serves belong here: a blocking inject
// of a service the host does not serve leaves the whole entry pending, and one
// pending entry aborts the entire web boot sweep (the UI never mounts — seen
// on 0.1.7, which retires `settingsScope` in favour of `configForms`). Both
// settings services, and `remote.credentials` (its own injectable service only
// on master; a plain sub-object of `remote` on rc.2), are resolved defensively
// in apply() instead.
    exports.inject = ['slots', 'remote']

/** Settings namespace on releases whose host half registers one (≤ 0.1.5). */
const NS = 'dsh-websearch'
/** Settings namespace on 0.1.7+: the profile entry (row) id from cordis.patch.yml. */
const ROW_ID = 'websearch'
/** Namespaces the card accepts, newest first — whichever the host serves. */
const NAMESPACES = [ROW_ID, NS]
/** `plugins.row.config` key on 0.1.7+: `<bundle package name>#<row id>`. */
const ROW_CONFIG_KEY = 'dsh-plugin-websearch#websearch'
/** Settings slot of ≤ 0.1.5 (keyed by namespace); gone on 0.1.7. */
const LEGACY_SLOT = 'settings.plugin.item'
/** Plugins-page row slot of 0.1.7+, declared by @deepseek-ai/dsh-client-ui-plugin-manager. */
const ROW_SLOT = 'plugins.row.config'

// Browser-safe copy of the engine table (a client package must not depend on
// a Host package). `optional` engines work without a key; `keyless` engines
// have no credential at all — the row only carries the enable/disable toggle.
// test/client.test.js cross-checks this table against src/core/engines.js so
// the hand-maintained copy cannot drift silently.
const ENGINES = [
  { id: 'brave', label: 'Brave', ref: 'BRAVE_SEARCH_API_KEY' },
  { id: 'bocha', label: 'Bocha 博查', ref: 'BOCHA_API_KEY' },
  { id: 'zhipu', label: 'Zhipu 智谱', ref: 'ZHIPU_API_KEY' },
  { id: 'wsa', label: 'Tencent WSA', ref: 'WSAPI_KEY' },
  { id: 'bailian', label: 'Bailian 百炼', ref: 'DASHSCOPE_API_KEY' },
  { id: 'exa', label: 'Exa', ref: 'EXA_API_KEY' },
  { id: 'tavily', label: 'Tavily', ref: 'TAVILY_API_KEY' },
  { id: 'serper', label: 'Serper (Google)', ref: 'SERPER_API_KEY' },
  { id: 'firecrawl', label: 'Firecrawl', ref: 'FIRECRAWL_API_KEY' },
  { id: 'anysearch', label: 'AnySearch', ref: 'ANYSEARCH_API_KEY', optional: true },
  { id: 'academic', label: 'Semantic Scholar', ref: 'S2_API_KEY', optional: true },
  { id: 'gh', label: 'GitHub', ref: 'GITHUB_TOKEN', optional: true },
  { id: 'bing', label: 'Bing', keyless: true },
  { id: 'ddg', label: 'DuckDuckGo', keyless: true },
  { id: 'stack', label: 'StackExchange', keyless: true },
  { id: 'hn', label: 'Hacker News', keyless: true },
]

/** Minimal snapshot store (getSnapshot/subscribe) for the slot's useX hook. */
function createStore(initial) {
  let state = initial
  const listeners = new Set()
  return {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set(next) {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

    function apply(ctx) {
  // Live settings source, adopted from whichever service the host serves:
  // 0.1.7+ `configForms` (namespaced by the profile row id, registered through
  // `whileServed`) or ≤ 0.1.5 `settingsScope` (bound to the registered
  // namespace). Both expose `getSnapshot()/subscribe()/set(field, value)`, so
  // the card is written against that shared surface. Null until one arrives.
  /** @type {null | { getSnapshot: () => any, subscribe: (fn: () => void) => (() => void), set: (field: string, value: unknown) => unknown }} */
  let settings = null
  let detachSettings = null

  function adoptSettings(next) {
    detachSettings?.()
    detachSettings = null
    settings = next ?? null
    if (settings !== null) {
      const unsubscribe = settings.subscribe(projectSettings)
      detachSettings = () => { unsubscribe?.() }
    }
    projectSettings()
  }

  // The credentials remote API lives in a different place per release:
  //   master:     injectable service 'remote.credentials' — describe(refs) → {ok, value}
  //   0.1.1-rc.2: ctx.get('connection').api.credentials — describe({refs}) → {result: {ok, value: {credentials}}}
  // (evidence: rc.2 ui-settings-plugins does `const { api } = ctx.get("connection")`
  // then `api.credentials.describe(...)`). ctx.get reads optional services
  // without declaring injects, so both releases resolve here.
  const credentials = ctx.get('remote.credentials')
    ?? ctx.get('connection')?.api?.credentials
    ?? ctx.remote?.credentials
  const store = createStore({
    loaded: false,
    engines: ENGINES.map((e) => ({ ...e, configured: false, writable: true })),
    disable: [],
    settingsStatus: 'loading',
    settingsWritable: false,
  })

  function projectSettings() {
    if (settings === null) {
      const prev = store.getSnapshot()
      store.set({ ...prev, disable: [], settingsStatus: 'unavailable', settingsWritable: false })
      return
    }
    const snap = settings.getSnapshot() ?? {}
    const prev = store.getSnapshot()
    store.set({
      ...prev,
      disable: Array.isArray(snap.value?.disable) ? snap.value.disable : [],
      settingsStatus: snap.status ?? 'loading',
      settingsWritable: snap.writable === true && snap.status === 'ready',
    })
  }

  // The credentials remote changed shape between releases:
  //   0.1.1-rc.2: describe({refs}) → {result: {ok, value: {credentials: {ref: info}}}}, set({ref, value})
  //   master:     describe(refs)  → {ok, value: {ref: info}},                          set(ref, value)
  // Probe both arg shapes and normalize the envelope; remember which one
  // answered so writes use the matching shape.
  let credentialsShape = null

  async function describeCredentials(refs) {
    for (const arg of [{ refs }, refs]) {
      try {
        const response = await credentials.describe(arg)
        const result = response?.result
        if (result !== undefined) {
          credentialsShape = arg === refs ? 'positional' : 'object'
          return result.ok === true ? result.value?.credentials ?? {} : {}
        }
        if (response?.ok !== undefined) {
          credentialsShape = arg === refs ? 'positional' : 'object'
          return response.ok === true ? response.value ?? {} : {}
        }
      } catch { /* try the other arg shape */ }
    }
    return {}
  }

  async function setCredential(ref, value) {
    if (credentialsShape !== 'positional') {
      try {
        await credentials.set({ ref, value })
        return
      } catch { /* fall through to the positional shape */ }
    }
    await credentials.set(ref, value)
  }

  async function readCredentials() {
    const refs = ENGINES.map((e) => e.ref).filter((r) => r !== undefined)
    const view = await describeCredentials(refs)
    if (Object.keys(view).length === 0 && !store.getSnapshot().loaded) {
      // Nothing answered yet — keep the loading state; a later invalidation
      // (or scope change) re-reads.
      return
    }
    store.set({
      ...store.getSnapshot(),
      loaded: true,
      engines: ENGINES.map((e) => ({
        ...e,
        configured: e.keyless === true ? true : view[e.ref]?.configured ?? false,
        writable: e.keyless === true ? false : view[e.ref]?.writable ?? true,
      })),
    })
  }

  // 0.1.7+: the settings service projects each profile entry's Config, and the
  // namespace is that entry's id — discovered from the served set so a row id
  // override still resolves (`whileServed` registers only while the host
  // serves one of the candidates).
  ctx.inject(['configForms'], (settingsCtx) => {
    const forms = settingsCtx.configForms
    settingsCtx.effect(() => forms.whileServed(NAMESPACES, (served) => {
      const namespace = NAMESPACES.find((candidate) => served.has(candidate))
      if (namespace === undefined) return () => {}
      adoptSettings(forms.get(namespace))
      return () => { adoptSettings(null) }
    }), 'dsh-websearch: settings form')
  })

  // ≤ 0.1.5: the host half registers a settings section and the scope is bound
  // to that namespace.
  ctx.inject(['settingsScope'], (settingsCtx) => {
    const legacy = settingsCtx.get('webUiSettings') ?? settingsCtx.settingsScope
    if (typeof legacy?.bind !== 'function') return
    adoptSettings(legacy.bind({ namespace: NS }))
    settingsCtx.effect(() => () => { adoptSettings(null) }, 'dsh-websearch: legacy settings scope')
  })

  projectSettings()
  void readCredentials()
  // A key written on another surface (or an external .credentials.yaml edit —
  // the file watcher hot-publishes) refreshes the badges.
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', () => {
    void readCredentials()
  }), 'dsh-websearch: credential invalidations')

  async function setKey(ref, value) {
    await setCredential(ref, value)
    await readCredentials()
  }

  async function toggleEngine(id) {
    if (settings === null) return
    const snap = settings.getSnapshot() ?? {}
    if (snap.writable !== true || snap.status !== 'ready') return
    const current = Array.isArray(snap.value?.disable) ? snap.value.disable : []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    try {
      await settings.set('disable', next)
    } catch (e) {
      // Same rule as the key save path: never let a failed write become an
      // unhandled rejection the user only sees as "nothing happened".
      console.error('[dsh-websearch] toggle engine failed:', e)
    }
  }

  // Card seats, one per release: 0.1.7+ renders a bundle row's configuration
  // from `plugins.row.config` (keyed `<package>#<row id>`), ≤ 0.1.5 from the
  // settings page's `settings.plugin.item` (keyed by namespace). `slots.inject`
  // waits for a declaration and never fires for a slot the host does not
  // declare, so registering both is inert where one is unknown.
  const cardInject = () => ({ hooks: { dshWebsearch: store }, setKey, toggleEngine })
  ctx.slots.inject(ROW_SLOT, () => ctx.slots.register({
    name: ROW_SLOT,
    key: ROW_CONFIG_KEY,
    inject: cardInject,
  }, WebsearchCard))
  ctx.slots.inject(LEGACY_SLOT, () => ctx.slots.register({
    name: LEGACY_SLOT,
    key: NS,
    inject: cardInject,
  }, WebsearchCard))
}

// ---- card component --------------------------------------------------------

const h = createElement

const VAR = (name, fallback) => `var(${name}, ${fallback})`

const cardStyle = {
  listStyle: 'none',
  border: `1px solid ${VAR('--dsw-alias-border-l2', 'rgba(128,128,128,.35)')}`,
  borderRadius: 12,
  background: VAR('--dsw-alias-bg-layer-3', 'transparent'),
  padding: '14px 16px',
  marginBottom: 10,
}

const titleStyle = { fontSize: 14, fontWeight: 600 }
const descStyle = { fontSize: 12, opacity: 0.65, marginTop: 2 }
const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  padding: '7px 0', borderTop: '1px solid rgba(128,128,128,.18)',
}
const nameStyle = { fontSize: 13, fontWeight: 500, minWidth: 150 }
const refStyle = { fontSize: 11, opacity: 0.55, fontFamily: 'var(--dsw-mono-font, monospace)' }
const inputStyle = {
  flex: '1 1 160px', minWidth: 140, fontSize: 12, padding: '4px 8px',
  borderRadius: 6, border: '1px solid rgba(128,128,128,.4)',
  background: 'transparent', color: 'inherit',
}
const buttonStyle = {
  fontSize: 12, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
  border: '1px solid rgba(128,128,128,.4)', background: 'transparent', color: 'inherit',
}
const badge = (color) => ({ fontSize: 11, padding: '2px 7px', borderRadius: 999, border: `1px solid ${color}`, color })

function EngineRow({ engine, disabled, canToggle, onToggle, onSetKey }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const status = engine.keyless === true
    ? h('span', { style: badge('rgba(70,130,220,.8)') }, '免 key')
    : engine.configured
      ? h('span', { style: badge('rgba(46,160,67,.9)') }, engine.writable ? '已配置' : 'env 提供')
      : h('span', { style: badge('rgba(128,128,128,.5)') }, engine.optional ? '免 key 可用' : '未配置')
  return h('div', { style: rowStyle, key: engine.id },
    h('label', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
      canToggle
        ? h('input', {
            type: 'checkbox',
            checked: !disabled,
            onChange: () => onToggle(engine.id),
            title: disabled ? '启用该引擎' : '禁用该引擎',
          })
        : null,
      h('span', { style: nameStyle }, engine.label),
    ),
    engine.keyless === true ? null : h('span', { style: refStyle }, engine.ref),
    status,
    engine.keyless === true ? null : h('input', {
      type: 'password',
      style: { ...inputStyle, ...(engine.writable ? {} : { opacity: 0.4 }), ...(error ? { borderColor: 'rgba(220,80,80,.9)' } : {}) },
      placeholder: engine.writable ? (error ? '保存失败，重试或查看 console' : '粘贴 API key…') : '由环境变量提供，UI 不可覆盖',
      value,
      disabled: !engine.writable,
      onChange: (e) => { setValue(e.target.value); setError(false) },
    }),
    engine.keyless === true ? null : h('button', {
      style: buttonStyle,
      disabled: !engine.writable || saving || value.trim() === '',
      onClick: async () => {
        setSaving(true)
        setError(false)
        try {
          await onSetKey(engine.ref, value.trim())
          setValue('')
        } catch (e) {
          setError(true)
          console.error('[dsh-websearch] save key failed:', e)
        } finally {
          setSaving(false)
        }
      },
    }, saving ? '保存中…' : '保存'),
  )
}

function WebsearchCard(props) {
  const state = props.useDshWebsearch((s) => s)
  // The Plugins page asks for a one-liner first and the form only once the
  // row's configuration page is open (0.1.7+); the ≤ 0.1.5 settings page
  // renders the card straight away and passes no `view`.
  if (props.view === 'summary') {
    return '多引擎搜索：引擎凭据（credentials，不进设置文档）+ 各引擎启停。'
  }
  const canToggle = state.settingsWritable
  return h('li', { style: cardStyle },
    h('div', { style: titleStyle }, 'Web Search（dsh-websearch）'),
    h('div', { style: descStyle },
      '多引擎搜索：密钥经 credentials 服务存入 ~/.dsh/.credentials.yaml（不回显、不进 settings 文档）；复选框启停引擎。'
      + (state.settingsStatus === 'unavailable' ? '（settings 不可用：仅密钥管理生效）' : '')),
    h('div', { style: { marginTop: 6 } },
      state.engines.map((engine) => h(EngineRow, {
        key: engine.id,
        engine,
        disabled: state.disable.includes(engine.id),
        canToggle,
        onToggle: props.toggleEngine,
        onSetKey: props.setKey,
      })),
    ),
  )
}

    exports.apply = apply
    // Exposed for the unit-test cross-check against src/core/engines.js —
    // the plugin itself never reads this field.
    exports.ENGINES = ENGINES
    return module.exports
  },
})
