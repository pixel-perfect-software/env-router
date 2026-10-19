// The MCP server library as the window edits it: one-line summaries, an editable draft of a
// server, and the config changes that rename or remove one everywhere it's used.

import { KNOWN_TOOLS, toolLabel } from './tools'
import type { ConfigState, McpServer, McpValue, Profile } from './types'

export type Transport = McpServer['transport']

export const TRANSPORTS: [Transport, string][] = [
  ['stdio', 'Command'],
  ['http', 'HTTP'],
  ['sse', 'SSE'],
]

/** The rule `config::is_file_name` enforces: the name becomes a file and part of `mcp__<server>__<tool>`. */
export const SERVER_NAME = /^[A-Za-z0-9_-]{1,64}$/

export const isSecret = (value: McpValue): value is { secret: string } => typeof value !== 'string'

const shown = (value: McpValue) => (isSecret(value) ? '•••' : /\s/.test(value) ? `"${value}"` : value)

/** What the server runs or connects to, on one line: `npx -y @playwright/mcp` or the URL. */
export const serverSummary = (server: McpServer) =>
  server.transport === 'stdio' ? [server.command, ...server.args.map(shown)].join(' ') : server.url

/** The agents that load a profile's servers, by label, for the line under the checklist. */
export const mcpAgentLabels = () => KNOWN_TOOLS.filter((t) => t.mcp).map((t) => toolLabel(t.command))

export const profilesUsing = (config: ConfigState, name: string): Profile[] => config.profiles.filter((p) => p.mcpServers[name])

/**
 * A value in the form: plain text, a secret already in the Keychain (`{ secret }`), or one typed
 * since the last save (`{ secret, value }`), which goes to the Keychain when the server is saved.
 */
export type DraftValue = McpValue | { secret: string; value: string }

export const isPending = (value: DraftValue): value is { secret: string; value: string } => typeof value !== 'string' && 'value' in value

/** Names that usually hold a credential; a new value under one starts out headed for the Keychain. */
export const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL|COOKIE/i

/** A fresh secret id: uppercase hex, as `config::is_secret_id` requires. */
export const newSecretId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()

export interface Pair {
  key: string
  value: DraftValue
  /** What to type, where the catalog knows: `Bearer github_pat_…`. */
  hint?: string
}

/** The form's state. Both transports' fields are kept, so switching back and forth loses nothing. */
export interface ServerDraft {
  name: string
  transport: Transport
  command: string
  args: DraftValue[]
  env: Pair[]
  url: string
  headers: Pair[]
}

const pairs = (values: Record<string, McpValue>): Pair[] => Object.entries(values).map(([key, value]) => ({ key, value }))

export function draftOf(name: string, server: McpServer | undefined): ServerDraft {
  const draft: ServerDraft = { name, transport: server?.transport ?? 'stdio', command: '', args: [], env: [], url: '', headers: [] }
  if (server?.transport === 'stdio') return { ...draft, command: server.command, args: server.args, env: pairs(server.env) }
  if (server) return { ...draft, url: server.url, headers: pairs(server.headers) }
  return draft
}

/** The server a draft describes and the secrets typed into it, or the first thing to fix, worded for the inspector footer. */
export function serverOf(draft: ServerDraft): { server: McpServer; secrets: Record<string, string> } | { error: string } {
  const secrets: Record<string, string> = {}
  /** The stored form of a value; a typed secret is set aside for the Keychain. */
  const stored = (value: DraftValue, what: string): McpValue | { error: string } => {
    if (!isPending(value)) return value
    if (!value.value) return { error: `Enter a value for ${what}, or remove it.` }
    secrets[value.secret] = value.value
    return { secret: value.secret }
  }
  const blank = (value: DraftValue) => (isPending(value) ? !value.value : typeof value === 'string' && !value.trim())
  const named = (rows: Pair[], what: string): Record<string, McpValue> | string => {
    const out: Record<string, McpValue> = {}
    for (const row of rows) {
      const key = row.key.trim()
      if (!key && blank(row.value)) continue
      if (!key) return `Give each ${what} a name.`
      if (key in out) return `${key} is set twice.`
      const value = stored(row.value, key)
      if (typeof value !== 'string' && 'error' in value) return value.error
      out[key] = value
    }
    return out
  }
  if (draft.transport === 'stdio') {
    if (!draft.command.trim()) return { error: 'Enter the command that starts the server.' }
    const env = named(draft.env, 'variable')
    if (typeof env === 'string') return { error: env }
    const args: McpValue[] = []
    for (const [i, arg] of draft.args.entries()) {
      if (arg === '') continue
      const value = stored(arg, `argument ${i + 1}`)
      if (typeof value !== 'string' && 'error' in value) return value
      args.push(value)
    }
    return { server: { transport: 'stdio', command: draft.command.trim(), args, env }, secrets }
  }
  if (!/^https?:\/\/\S/.test(draft.url.trim())) return { error: 'Enter a URL starting with https:// or http://.' }
  const headers = named(draft.headers, 'header')
  if (typeof headers === 'string') return { error: headers }
  return { server: { transport: draft.transport, url: draft.url.trim(), headers }, secrets }
}

/**
 * A draft whose credential-looking values (by name, as `SECRET_NAME` decides) are headed for
 * the Keychain. Imports use it: a token found in a plain file shouldn't stay plain. A value
 * that's only a `${VAR}` reference stays as it is.
 */
export function withSecretsLocked(draft: ServerDraft): ServerDraft {
  const lock = (row: Pair): Pair =>
    typeof row.value === 'string' && row.value && SECRET_NAME.test(row.key) && !/^\$\{[^}]+\}$/.test(row.value.trim())
      ? { ...row, value: { secret: newSecretId(), value: row.value } }
      : row
  return { ...draft, env: draft.env.map(lock), headers: draft.headers.map(lock) }
}

/** A new server's draft from a catalog entry: its secret fields empty, headed for the Keychain, with a hint. */
export function draftFromCatalog(name: string, server: McpServer, secrets: Record<string, string>): ServerDraft {
  const draft = draftOf(name, server)
  const seal = (row: Pair): Pair => (row.key in secrets ? { key: row.key, value: { secret: newSecretId(), value: '' }, hint: secrets[row.key] } : row)
  return { ...draft, env: draft.env.map(seal), headers: draft.headers.map(seal) }
}

/** A name not yet `taken`: the name itself, else `name-2`, `name-3`… */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  for (let n = 2; ; n++) if (!taken.has(`${name}-${n}`)) return `${name}-${n}`
}

/** `config` with the server stored under `name`, renamed from `previous` in the library and every profile. */
export function withServer(config: ConfigState, previous: string | null, name: string, server: McpServer): ConfigState {
  const mcpServers = { ...config.mcpServers }
  if (previous && previous !== name) delete mcpServers[previous]
  mcpServers[name] = server
  const profiles =
    previous && previous !== name
      ? config.profiles.map((p) => {
          if (!p.mcpServers[previous]) return p
          const { [previous]: using, ...rest } = p.mcpServers
          return { ...p, mcpServers: { ...rest, [name]: using } }
        })
      : config.profiles
  return { ...config, mcpServers, profiles }
}

/** `config` without the server, in the library or any profile. */
export function withoutServer(config: ConfigState, name: string): ConfigState {
  const { [name]: _, ...mcpServers } = config.mcpServers
  const profiles = config.profiles.map((p) => {
    if (!p.mcpServers[name]) return p
    const { [name]: __, ...rest } = p.mcpServers
    return { ...p, mcpServers: rest }
  })
  return { ...config, mcpServers, profiles }
}
