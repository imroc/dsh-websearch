// GitHub search — free; token optional (env GITHUB_TOKEN/GH_TOKEN or gh CLI's
// hosts.yml). Token raises the search rate limit from 10/min to 30/min.
// extra.kind = 'repos' | 'issues' | 'prs' | 'code' (default repos); qualifiers
// (stars:>100, language:go, is:open…) go directly in the query text.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BackendError, fetchJson, qs } from '../core/http.js'
import { toIsoDate } from '../core/util.js'

function tokenFromGhHosts() {
  try {
    const text = readFileSync(join(process.env.HOME ?? '/root', '.config', 'gh', 'hosts.yml'), 'utf8')
    // hosts.yml may inline the token in flow style (`user: {oauth_token: gho_x}`)
    // — capture only token characters, not the closing brace.
    const m = /oauth_token:\s*([A-Za-z0-9_-]+)/.exec(text)
    return m === null ? undefined : m[1]
  } catch {
    return undefined
  }
}

export function create({ keys, env }) {
  // hosts.yml is re-read per call (not snapshotted) so a token change (gh
  // auth login) applies without a restart, matching the live keys map.
  const currentToken = () => keys.gh ?? env.GITHUB_TOKEN ?? env.GH_TOKEN ?? tokenFromGhHosts()
  return {
    id: 'gh',
    available: () => true,
    async search(req, signal) {
      const token = currentToken()
      const kind = req.extra?.kind ?? 'repos'
      const endpoints = { repos: '/search/repositories', issues: '/search/issues', prs: '/search/issues', code: '/search/code' }
      const endpoint = endpoints[kind]
      if (endpoint === undefined) {
        throw new BackendError('gh', `extra.kind must be one of ${Object.keys(endpoints).join('|')}`)
      }
      if (kind === 'code' && token === undefined) {
        // GitHub rejects anonymous code search with a bare 401 — fail early
        // with an actionable message instead.
        throw new BackendError('gh', 'code search requires a token (GITHUB_TOKEN, or gh CLI login) — GitHub rejects anonymous code search')
      }
      const headers = {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(token !== undefined ? { authorization: `Bearer ${token}` } : {}),
      }
      let q = req.query
      if (kind === 'issues') q += ' is:issue'
      if (kind === 'prs') q += ' is:pr'
      const params = {
        q,
        per_page: Math.min(Math.max(req.maxResults ?? 10, 1), 30),
        ...(typeof req.extra?.sort === 'string' ? { sort: req.extra.sort } : {}),
        ...(typeof req.extra?.order === 'string' ? { order: req.extra.order } : {}),
      }
      const data = await fetchJson('gh', `https://api.github.com${endpoint}?${qs(params)}`, { headers, signal })
      const items = data?.items ?? []
      const sources = items.map((it) => {
        if (kind === 'repos') {
          return {
            url: it.html_url,
            title: it.full_name,
            snippet: `${it.stargazers_count ?? 0} stars${it.language !== undefined ? ` · ${it.language}` : ''}${it.description !== undefined ? ` · ${it.description}` : ''}`,
            ...(toIsoDate(it.pushed_at) !== undefined ? { publishedAt: toIsoDate(it.pushed_at) } : {}),
          }
        }
        if (kind === 'code') {
          const repo = typeof it.repository?.full_name === 'string' ? it.repository.full_name : 'repo'
          return { url: it.html_url, title: `${repo}/${it.name}`, snippet: it.path }
        }
        const repo = typeof it.repository_url === 'string' ? it.repository_url.split('repos/')[1] : undefined
        return {
          url: it.html_url,
          title: it.title,
          snippet: `${it.state ?? ''}${it.comments !== undefined ? ` · ${it.comments} comments` : ''}${repo !== undefined ? ` · ${repo}` : ''}`,
          ...(toIsoDate(it.updated_at) !== undefined ? { publishedAt: toIsoDate(it.updated_at) } : {}),
        }
      })
      return { sources }
    },
  }
}
