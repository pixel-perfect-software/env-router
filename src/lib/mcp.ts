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

/**
 * Names that usually hold a credential; a new value under one starts out headed for the Keychain.
 * `_PWD` (Redis's `REDIS_PWD`) counts, but not a bare `PWD`, which is the shell's working folder.
 */
export const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|_PWD(?![A-Z])|AUTH|CREDENTIAL|COOKIE|CONNECTION_STRING/i

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

/** A profile as the Used by toggles show it. */
export interface ProfileChip {
  id: string
  name: string
  color: string
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
      // An empty credential would start the server without it, quietly; ask for one instead.
      if (blank(row.value) && SECRET_NAME.test(key)) return `Enter a value for ${key}, or remove it.`
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

/** A URL that carries a password, as a database connection string does: `postgres://user:pass@host`. */
const URL_WITH_PASSWORD = /^[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:[^\s/@]+@/i

/** Prefixes vendors give their tokens, and an Authorization scheme with its credential. */
const TOKEN_SHAPE =
  /^(sk[-_]|pk_live_|rk_live_|ghp_|gho_|ghs_|github_pat_|glpat-|xox[abpr]-|AKIA[0-9A-Z]{12}|AIza|pplx-|fc-|ntn_|hf_)|\b(Bearer|Basic) \S/

/** A word in an option's name that says its value is a credential: `--api-key`, `--auth-token`. */
const CREDENTIAL_WORD = /key|token|secret|passw(or)?d|[a-z0-9][-_]pwd\b|auth|credential/i

/** Whether a value itself looks like a credential, whatever it's called. */
export const looksLikeCredential = (value: string) => URL_WITH_PASSWORD.test(value.trim()) || TOKEN_SHAPE.test(value.trim())

const isReference = (value: string) => /^\$\{[^}]+\}$/.test(value.trim())

/**
 * Where a draft holds what looks like a credential in plain text that saving won't lock: an
 * argument (by its option's name or its own shape) or the URL (a password, or a key in the query).
 * Arguments aren't locked for the user, since Copilot doesn't expand a stored secret there.
 * Named for the editor and the import review: `argument 3`, `the URL`.
 */
export function plainCredentials(draft: ServerDraft): string[] {
  if (draft.transport !== 'stdio') {
    const url = draft.url.trim()
    const inQuery = /[?&][\w-]*(key|token|secret|password|auth)[\w-]*=[^&\s]/i.test(url)
    return url && (URL_WITH_PASSWORD.test(url) || /^[a-z]+:\/\/[^/@\s]+@/i.test(url) || inQuery) ? ['the URL'] : []
  }
  return draft.args.flatMap((arg, i) => {
    if (typeof arg !== 'string' || !arg.trim() || isReference(arg)) return []
    const option = arg.match(/^--?([\w-]+)=(.+)$/)
    const previous = draft.args[i - 1]
    const afterOption = typeof previous === 'string' && /^--?[\w-]+$/.test(previous) && CREDENTIAL_WORD.test(previous)
    const plain = (option && CREDENTIAL_WORD.test(option[1]) && !isReference(option[2])) || looksLikeCredential(option?.[2] ?? arg) || afterOption
    return plain ? [`argument ${i + 1}`] : []
  })
}

/** The warning for `plainCredentials`, as one line: "Argument 3 looks like a credential…". */
export function plainNote(where: string[]): string {
  const list = where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}` : where[0]
  const first = list.charAt(0).toUpperCase() + list.slice(1)
  const fix = where.includes('the URL')
    ? 'use a header if the server takes one'
    : 'pass it in an env var if the server takes one, or lock it (Claude Code only)'
  return `${first} ${where.length > 1 ? 'look' : 'looks'} like a credential and would be saved as plain text: ${fix}.`
}

/** `text` made into a name agents accept: other characters become `-`. */
export const asServerName = (text: string) =>
  text
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'server'

/**
 * A draft whose credential-looking env and header values are headed for the Keychain: by name,
 * as `SECRET_NAME` decides, or by shape (a URL with a password, a vendor's token prefix, a
 * `Bearer` credential). Imports and pastes use it: a token found in a plain file shouldn't stay
 * plain. A value that's only a `${VAR}` reference stays as it is. Arguments stay too: Copilot
 * doesn't expand a stored secret there, so `plainCredentials` flags them instead.
 */
export function withSecretsLocked(draft: ServerDraft): ServerDraft {
  const lock = (row: Pair): Pair =>
    typeof row.value === 'string' && row.value && (SECRET_NAME.test(row.key) || looksLikeCredential(row.value)) && !isReference(row.value)
      ? { ...row, value: { secret: newSecretId(), value: row.value } }
      : row
  return { ...draft, env: draft.env.map(lock), headers: draft.headers.map(lock) }
}

/**
 * Where `--init` goes in a `docker run` or `podman run` command that doesn't have it (right after
 * `run`), or null. Without it the server is the container's first process, which ignores the
 * SIGTERM an agent stops it with, so the container keeps running after every session.
 */
export function initSlot(command: string, args: DraftValue[]): number | null {
  if (!/(^|\/)(docker|podman)$/.test(command.trim())) return null
  const words = args.map((arg) => (typeof arg === 'string' ? arg.trim() : ''))
  const run = words[0] === 'run' ? 1 : words[0] === 'container' && words[1] === 'run' ? 2 : null
  // Any --init counts, --init=false too: that one is a choice.
  if (run === null || words.some((word) => word === '--init' || word.startsWith('--init='))) return null
  return run
}

/** `args` with `--init` at `slot`. */
export const withInit = <T extends DraftValue>(args: T[], slot: number): (T | string)[] => [...args.slice(0, slot), '--init', ...args.slice(slot)]

/** The server with `--init` added, where `initSlot` says it's missing; otherwise the server itself. */
export function serverWithInit(server: McpServer): McpServer {
  if (server.transport !== 'stdio') return server
  const slot = initSlot(server.command, server.args)
  return slot === null ? server : { ...server, args: withInit(server.args, slot) }
}

/** A new server's draft from a catalog entry: its secret fields empty, headed for the Keychain, with a hint. */
export function draftFromCatalog(name: string, server: McpServer, secrets: Record<string, string>): ServerDraft {
  const draft = draftOf(name, server)
  const seal = (row: Pair): Pair => (row.key in secrets ? { key: row.key, value: { secret: newSecretId(), value: '' }, hint: secrets[row.key] } : row)
  return { ...draft, env: draft.env.map(seal), headers: draft.headers.map(seal) }
}

/**
 * A new server's draft copied from a saved one, under a free name. A stored secret never comes
 * back to the window, so each keeps its place and name but starts empty, headed for the Keychain.
 */
export function duplicateDraft(name: string, server: McpServer, taken: Set<string>): ServerDraft {
  const draft = draftOf(freeName(name, taken), server)
  const empty = (value: DraftValue): DraftValue => (typeof value === 'string' ? value : { secret: newSecretId(), value: '' })
  // Not "Saved to the Keychain", the usual placeholder: nothing is saved yet.
  const emptyRow = (row: Pair): Pair => (typeof row.value === 'string' ? row : { ...row, value: empty(row.value), hint: 'Enter a value' })
  return { ...draft, args: draft.args.map(empty), env: draft.env.map(emptyRow), headers: draft.headers.map(emptyRow) }
}

/** Words in a command line that never name the server. */
const NOT_A_NAME = new Set(['run', 'exec', 'start', 'mcp', 'server', 'container', 'stdio', 'dlx', 'x'])

/** `docker run` and `podman run` options that take the next word as their value. */
const VALUE_OPTIONS = new Set([
  '-e',
  '--env',
  '-v',
  '--volume',
  '--mount',
  '-p',
  '--publish',
  '--name',
  '--label',
  '-l',
  '--network',
  '-w',
  '--workdir',
  '--entrypoint',
  '-u',
  '--user',
  '--platform',
])

/**
 * A name for a server pasted without one: the host's own label for a URL (`mcp.linear.app` is
 * `linear`), or the package or image it runs, without scope, version or MCP affixes
 * (`@upstash/context7-mcp@latest` is `context7`). `server` when nothing fits.
 */
export function suggestName(server: McpServer): string {
  const clean = (text: string) => {
    const name = text
      .toLowerCase()
      .replace(/^(mcp-server-|server-|mcp-)/, '')
      .replace(/(-mcp-server|-mcp|-server)$/, '')
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return SERVER_NAME.test(name) ? name : null
  }
  if (server.transport !== 'stdio') {
    try {
      const host = new URL(server.url).hostname
      // An address or localhost names nothing.
      if (/^[\d.]+$|^\[|^localhost$/.test(host)) return 'server'
      const labels = host.split('.')
      const own = (labels.length > 1 ? labels.slice(0, -1) : labels).filter((l) => !['mcp', 'www', 'api'].includes(l))
      return clean(own[own.length - 1] ?? '') ?? 'server'
    } catch {
      return 'server'
    }
  }
  // The value after an option like `-v` or `-e` is a path or a variable, never the server.
  const words = server.args.filter(
    (a, i): a is string => typeof a === 'string' && !a.startsWith('-') && !NOT_A_NAME.has(a) && !VALUE_OPTIONS.has(String(server.args[i - 1] ?? '')),
  )
  // A package or image says so with a scope, a path or a version; otherwise the first plain word.
  const pick = words.find((w) => /[/@:]|==/.test(w)) ?? words[0]
  const base = pick
    ?.replace(/(@[^@/]+|==.*|:[^/]+)$/, '')
    .split('/')
    .pop()
  return (base && clean(base)) ?? clean(server.command.split('/').pop() ?? '') ?? 'server'
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

/**
 * `config` with exactly `profileIds` loading the server: each profile switched on keeps the tools
 * it had turned off, one switched on afresh starts with all of them.
 */
export function withUsedBy(config: ConfigState, name: string, profileIds: string[]): ConfigState {
  const profiles = config.profiles.map((p) => {
    const using = p.mcpServers[name]
    const wanted = profileIds.includes(p.id)
    if (wanted && !using) return { ...p, mcpServers: { ...p.mcpServers, [name]: { disabledTools: [] } } }
    if (!wanted && using) {
      const { [name]: _, ...rest } = p.mcpServers
      return { ...p, mcpServers: rest }
    }
    return p
  })
  return { ...config, profiles }
}

/** Whether two servers reach the same thing: the same command and arguments, or the same URL. */
export function sameEndpoint(a: McpServer, b: McpServer): boolean {
  if (a.transport !== b.transport) return false
  if (a.transport === 'stdio' && b.transport === 'stdio') {
    const words = (s: McpServer & { transport: 'stdio' }) => [s.command, ...s.args.filter((x) => typeof x === 'string')].join(' ')
    return words(a) === words(b)
  }
  const url = (s: McpServer) => ('url' in s ? s.url.trim().replace(/\/+$/, '') : '')
  return url(a) === url(b)
}

/**
 * Whether `found` (read from an agent's file, so every value is plain) is the server `saved` in
 * the library. A value the library keeps as a secret can't be read back to compare, so it matches
 * whatever stands in its place: the same server, once imported with its token moved to the store,
 * still counts as already there.
 */
export function sameDefinition(saved: McpServer | undefined, found: McpServer): boolean {
  if (!saved || saved.transport !== found.transport) return false
  const same = (a: McpValue | undefined, b: McpValue | undefined) =>
    a !== undefined && b !== undefined && (isSecret(a) || JSON.stringify(a) === JSON.stringify(b))
  const sameTable = (a: Record<string, McpValue>, b: Record<string, McpValue>) =>
    Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((key) => same(a[key], b[key]))
  if (saved.transport === 'stdio' && found.transport === 'stdio') {
    return (
      saved.command === found.command &&
      saved.args.length === found.args.length &&
      saved.args.every((arg, i) => same(arg, found.args[i])) &&
      sameTable(saved.env, found.env)
    )
  }
  return 'url' in saved && 'url' in found && saved.url === found.url && sameTable(saved.headers, found.headers)
}
