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

export interface Pair {
  key: string
  value: McpValue
}

/** The form's state. Both transports' fields are kept, so switching back and forth loses nothing. */
export interface ServerDraft {
  name: string
  transport: Transport
  command: string
  args: McpValue[]
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

/** The server a draft describes, or the first thing to fix, worded for the inspector footer. */
export function serverOf(draft: ServerDraft): { server: McpServer } | { error: string } {
  const filled = (rows: Pair[]) => rows.filter((row) => row.key.trim() || (isSecret(row.value) ? true : row.value.trim()))
  const named = (rows: Pair[], what: string): Record<string, McpValue> | string => {
    const out: Record<string, McpValue> = {}
    for (const row of filled(rows)) {
      const key = row.key.trim()
      if (!key) return `Give each ${what} a name.`
      if (key in out) return `${key} is set twice.`
      out[key] = row.value
    }
    return out
  }
  if (draft.transport === 'stdio') {
    if (!draft.command.trim()) return { error: 'Enter the command that starts the server.' }
    const env = named(draft.env, 'variable')
    if (typeof env === 'string') return { error: env }
    const args = draft.args.filter((arg) => isSecret(arg) || arg !== '')
    return { server: { transport: 'stdio', command: draft.command.trim(), args, env } }
  }
  if (!/^https?:\/\/\S/.test(draft.url.trim())) return { error: 'Enter a URL starting with https:// or http://.' }
  const headers = named(draft.headers, 'header')
  if (typeof headers === 'string') return { error: headers }
  return { server: { transport: draft.transport, url: draft.url.trim(), headers } }
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
