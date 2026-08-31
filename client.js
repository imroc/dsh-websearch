// Browser half of dsh-websearch: the plugin's card in Settings → Plugins.
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

import { createElement, useState } from 'react'

export const name = 'dsh-websearch-client'

export const inject = ['slots', 'settingsScope', 'remote', 'remote.credentials']

const NS = 'dsh-websearch'

// Browser-safe copy of the credential-bearing engine table (a client package
// must not depend on a Host package). `optional` engines work without a key.
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

export function apply(ctx) {
  const scope = ctx.settingsScope.bind({ namespace: NS })
  const store = createStore({
    loaded: false,
    engines: ENGINES.map((e) => ({ ...e, configured: false, writable: true })),
    disable: [],
    settingsStatus: 'loading',
    settingsWritable: false,
  })

  function projectScope() {
    const snap = scope.getSnapshot()
    const prev = store.getSnapshot()
    store.set({
      ...prev,
      disable: Array.isArray(snap.value?.disable) ? snap.value.disable : [],
      settingsStatus: snap.status,
      settingsWritable: snap.writable === true && snap.status === 'ready',
    })
  }

  async function readCredentials() {
    const refs = ENGINES.map((e) => e.ref)
    let view = {}
    try {
      const response = await ctx.remote.credentials.describe(refs)
      if (response.ok) view = response.value ?? {}
    } catch {
      return // keep the last answer; a later invalidation re-reads
    }
    store.set({
      ...store.getSnapshot(),
      loaded: true,
      engines: ENGINES.map((e) => ({
        ...e,
        configured: view[e.ref]?.configured ?? false,
        writable: view[e.ref]?.writable ?? true,
      })),
    })
  }

  scope.subscribe(projectScope)
  projectScope()
  void readCredentials()
  // A key written on another surface (or an external .credentials.yaml edit —
  // the file watcher hot-publishes) refreshes the badges.
  ctx.effect(() => ctx.remote.$on('credentials/reference-updated', () => {
    void readCredentials()
  }), 'dsh-websearch: credential invalidations')

  async function setKey(ref, value) {
    await ctx.remote.credentials.set(ref, value)
    await readCredentials()
  }

  async function toggleEngine(id) {
    const snap = scope.getSnapshot()
    if (snap.writable !== true) return
    const current = Array.isArray(snap.value?.disable) ? snap.value.disable : []
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    await scope.set('disable', next)
  }

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    inject: () => ({ hooks: { dshWebsearch: store }, setKey, toggleEngine }),
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
  const status = engine.configured
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
    h('span', { style: refStyle }, engine.ref),
    status,
    h('input', {
      type: 'password',
      style: { ...inputStyle, ...(engine.writable ? {} : { opacity: 0.4 }) },
      placeholder: engine.writable ? '粘贴 API key…' : '由环境变量提供，UI 不可覆盖',
      value,
      disabled: !engine.writable,
      onChange: (e) => setValue(e.target.value),
    }),
    h('button', {
      style: buttonStyle,
      disabled: !engine.writable || saving || value.trim() === '',
      onClick: async () => {
        setSaving(true)
        try {
          await onSetKey(engine.ref, value.trim())
          setValue('')
        } finally {
          setSaving(false)
        }
      },
    }, saving ? '保存中…' : '保存'),
  )
}

function WebsearchCard(props) {
  const state = props.useDshWebsearch((s) => s)
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
