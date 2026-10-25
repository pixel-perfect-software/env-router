// Development only: lets the frontend run in a plain browser for design review, with the
// Tauri commands answered from memory the way `crates/ops` answers them (same checks, same
// messages, fresh objects each call). main.tsx loads it only when `import.meta.env.DEV` and no
// Tauri runtime is present, so it never ships. URL parameters pick the state:
// - `?scenario=` first-run (default), populated, mcp (populated, with an MCP server library),
//   shadowed (a function in the checked shell's startup file shadows the tool), newer (config.json
//   is from a newer EnvRouter: it can't be read, and Start Over isn't offered for it), or broken
//   (config.json can't be parsed until "Open config.json" is clicked, which stands in for fixing it, or
//   "Back Up and Start Over…" is confirmed, which backs it up and empties the config), or
//   unrouted (populated, but no profile sets any agent, so a check finds the agent on PATH untouched).
// - `&platform=linux` answers as a Linux desktop would (home in /home, bash as the login shell,
//   ~/.config editor settings, a keyring); `&platform=wsl` as a WSL distro (bash reading
//   .profile and .bashrc, VS Code Server's machine settings, Windows editors connected remotely).
// - `&check=` forces what Check Folder finds: routed (default: worked out from the config),
//   managed (an admin's managed-mcp.json turns the profile's MCP servers off), alias (the run
//   goes through `alias claude='claude --model opus'`), shadowedOnPath,
//   byPromptHook, shadowedByShell (an alias, so no origin), notFound,
//   notInstalled, owned (the owner sets no config for the agent), unowned (no profile owns the folder), shimFailed (empty message, as when macOS kills a shim), timeout or noPath (the
//   two ways the shell itself fails). Use it with a populated scenario, where the shell is on.
// - `&shim=stale`: the installed shim doesn't match the app's, until a save reinstalls it.
// - `&store=off`: there's no secret store, so saving a secret (or checking a server that needs
//   a saved one) fails as it does there, and a save that drops a secret goes through with a warning. Off macOS the setup status says so up front
//   (`secretStoreProblem`); on macOS nothing can tell until a save, so it stays null.
// - `&fail=home|status|shell|editor|reveal|uninstall`: the home folder can't be found (the unloaded banner, with no file to open),
//   the setup status can't be read (the error banner), turning a shell on fails (an error
//   banner with Dismiss), or no editor opens a file (use it with `?scenario=broken`: the unloaded
//   banner's Open config.json fails and Reveal takes the accent; `reveal` makes every reveal fail (and every help link, as with no
//   launcher to start): the banner's, a folder's, the menu bar's and the Shells popover's), or
//   Uninstall EnvRouter… stops (VS Code's and Cursor's settings can't be read and name the shim: the banner
//   shows why, a line each, with Try Again, and the shells are already off). It keeps failing until `window.__mockFix()` is called, the way a
//   permission or a missing file keeps failing until the user fixes it.
// Uninstall EnvRouter… (Shells) works through to its end here: it clears what it changed, and then, as the app does, every command
// but the quit ones answers "EnvRouter is uninstalled. Quit it to finish." while the window waits to quit (logged as "quit").
// The mcp library has a server named `slow` whose check times out. `window.__mockDrop(path, x, y)`
// simulates a Finder drop. `window.__mockEditConfig(edit)` changes config.json as the CLI or a
// hand edit would, behind the window's back, so a save from an open editor meets it, and
// `window.__mockDeleteConfig()` deletes it the same way. `window.__mockQuit()` quits as the menu
// bar's Quit does: it asks only while an editor holds unsaved edits, and a quit that goes
// ahead logs "quit" to the console. npm knows
// every package (at 1.4.0, `next` at 2.0.0-beta.2) except one whose name ends in `-nope`.
// The profile card's context menu and a folder row's "…" menu pop up as a DOM stand-in, at the position `popup(at)` names or else at the
// pointer (where it last was: a menu opened from the keyboard on Linux opens there too), and give focus back to where it was when closed
// by Escape or a choice, as a native menu leaves it. `window.__mockMenuReveal(place)` reveals as the menu bar's items do, without the
// window, and emits `reveal-failed` when that fails (not once an uninstall has begun, as the tray drops it). `window.__mockMenuHelp(link)`
// is the Help menu's item, opening the link and telling a failure the same way.

import { emit } from '@tauri-apps/api/event'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import helpLinks from '../lib/helpLinks.json'
import { isSecret } from '../lib/mcp'
import platformWords from '../lib/platformWords.json'
import { ideHooks, withAgents } from '../lib/tools'
import type {
  AgentDef,
  ConfigFault,
  ConfigState,
  Editor,
  EditorStatus,
  FolderCheck,
  HelpLink,
  IdeHook,
  ImportCandidate,
  McpDialect,
  McpServer,
  McpValue,
  Pasted,
  Place,
  Platform,
  Profile,
  RevealFailed,
  SaveOutcome,
  ServerCheck,
  SetupStatus,
  Shell,
  ShellStatus,
  ToolInfo,
  UninstallReport,
} from '../lib/types'

const params = new URLSearchParams(location.search)
const platform: Platform = params.get('platform') === 'linux' ? 'linux' : params.get('platform') === 'wsl' ? 'wsl' : 'macos'
const macos = platform === 'macos'
const wsl = platform === 'wsl'
const HOME = macos ? '/Users/sam' : '/home/sam'
const scenario = params.get('scenario') ?? 'first-run'
const forcedCheck = params.get('check')
const storeOff = params.get('store') === 'off'
/** What `&fail=` breaks, until `window.__mockFix()`. */
let failing: string | null = ['home', 'status', 'shell', 'editor', 'reveal', 'uninstall'].includes(params.get('fail') ?? '')
  ? params.get('fail')
  : null

/** `config::CONFIG_VERSION`: every save writes it. */
const CONFIG_VERSION = 5

/** What each platform's store says when it can't be used (`crates/keychain/src/store/`). */
const storeError = {
  macos: 'the Keychain said: User interaction is not allowed.',
  linux: "there's no Secret Service to keep secrets in (GNOME Keyring or KWallet). Install or start one, then try again",
  wsl: "couldn't reach the Windows Credential Manager (No such file or directory (os error 2)). Install EnvRouter's Windows helper, or turn on WSL interop",
  windows: "there's no secret store EnvRouter can use on this system",
}[platform]

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
/** A record's entries in key order, as Rust's `BTreeMap` iterates them. */
const sorted = <T>(record: Record<string, T>) => Object.entries(record).sort(([a], [b]) => cmp(a, b))
const sortedKeys = (record: object) => Object.keys(record).sort(cmp)
const has = (record: object, key: string) => Object.keys(record).includes(key)
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)

/** Structural equality, as Rust's `PartialEq` compares two definitions: key order doesn't count. */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  return (
    ka.length === Object.keys(b).length && ka.every((k) => has(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  )
}

// Paths, as `std::path` and `config` treat them.

const segments = (path: string) => path.split('/').filter((s) => s && s !== '.')
/** `Path::cmp`: component by component, so `/a/b/x` sorts before `/a/b-c/x`. */
const comparePaths = (a: string, b: string) => {
  const [sa, sb] = [segments(a), segments(b)]
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) if (sa[i] !== sb[i]) return cmp(sa[i], sb[i])
  return sa.length - sb.length
}
const join = (dir: string, file: string) => `/${[...segments(dir), file].join('/')}`

/** `config::expand_home`: a leading `~` becomes the home folder, dropping repeated and trailing slashes after it. */
const expandHome = (path: string, home = HOME) => {
  if (path !== '~' && !path.startsWith('~/')) return path
  const parts = segments(path.slice(1))
  return home === '/' ? `/${parts.join('/')}` : [home, ...parts].join('/')
}

/** `config::tool_dir`: the folder a tool's variable is set to, or null unless it's absolute without `..`. */
const toolDir = (raw: string, home = HOME) => {
  const dir = expandHome(raw.trim(), home)
  return dir.startsWith('/') && !dir.split('/').includes('..') ? dir : null
}

/** `config::trigger_base`: the folder a trigger covers. Throws its message for one it can't match. */
const triggerBase = (raw: string) => {
  const trimmed = raw.trim()
  const suffix = ['/**', '/*'].find((s) => trimmed.endsWith(s))
  const withoutGlob = suffix ? trimmed.slice(0, -suffix.length) : trimmed
  if (withoutGlob.includes('*')) throw `Trigger path "${raw}" has a wildcard EnvRouter can't match. Only a trailing /* is supported.`
  const base = expandHome(withoutGlob)
  if (!base.startsWith('/')) throw `Trigger path "${raw}" must be absolute or start with ~.`
  if (base.split('/').includes('..')) throw `Trigger path "${raw}" can't contain "..".`
  return `/${segments(base).join('/')}`
}
const triggerBaseOrNull = (raw: string) => {
  try {
    return triggerBase(raw)
  } catch {
    return null
  }
}

// The data.

const shell = (name: Shell, files: string[], available: boolean, installed: boolean, isDefault = false): ShellStatus => ({
  shell: name,
  available,
  installed,
  isDefault,
  startupFiles: files.map((f) => `${HOME}/${f}`),
})

const profile = (id: string, name: string, triggerPaths: string[], configDir?: string, extra: Profile['tools'] = {}): Profile => ({
  id,
  name,
  triggerPaths,
  tools: { ...(configDir ? { claude: { envVar: 'CLAUDE_CONFIG_DIR', path: configDir } } : {}), ...extra },
  mcpServers: {},
})

const populated = scenario !== 'first-run'
/** `?scenario=unrouted`: the profiles own folders but set no agent. */
const unrouted = scenario === 'unrouted'
let configBroken = scenario === 'broken' || scenario === 'newer'
/** Secret ids a Start Over backup names, which the store keeps. */
const backedUp = new Set<string>()
/** How many times the broken config.json was backed up and replaced: `config.json.bak`, then `.bak-2`, … */
let backups = 0
/** config.json was deleted behind the window's back; the next read creates an empty one. */
let configMissing = false
/** An uninstall finished: `UNINSTALLED` in src-tauri, which refuses every command that reaches the home folder. */
let uninstalled = false
/** `quit::UNSAVED` and `quit::ASKED`. */
let unsaved = false
let quitAsked = false
const withLibrary = scenario === 'mcp'
const library: Record<string, McpServer> = withLibrary
  ? {
      github: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: { secret: '7F3A09C2' } },
      },
      playwright: { transport: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: {} },
      linear: { transport: 'http', url: 'https://mcp.linear.app/mcp', headers: {} },
      sentry: { transport: 'http', url: 'https://mcp.sentry.dev/mcp', headers: {} },
      postgres: {
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://localhost/acme_dev'],
        env: {},
      },
      // Its check times out: Docker is still pulling the image.
      slow: { transport: 'stdio', command: 'docker', args: ['run', '-i', '--rm', 'mcp/fetch'], env: {} },
    }
  : {}
const tool = (name: string, description: string | null = null): ToolInfo => ({ name, description })
/** What a check lists for each server, as `mcp_probe::check` would. */
const serverTools: Record<string, ToolInfo[]> = {
  github: [
    tool('create_issue', 'Create a new issue in a GitHub repository'),
    tool('create_pull_request', 'Create a new pull request in a GitHub repository'),
    tool('delete_repository', 'Delete a repository you own'),
    tool('fork_repository', 'Fork a GitHub repository to your account'),
    tool('get_file_contents', 'Get the contents of a file or directory'),
    tool('list_issues', 'List issues in a repository with filtering options'),
    tool('merge_pull_request', 'Merge a pull request'),
    tool('push_files', 'Push multiple files in a single commit'),
    tool('search_code', 'Search for code across GitHub repositories'),
  ],
  playwright: [
    tool('browser_click', 'Perform click on a web page'),
    tool('browser_navigate', 'Navigate to a URL'),
    tool('browser_snapshot', 'Capture accessibility snapshot of the current page'),
    tool('browser_take_screenshot'),
  ],
  sentry: [tool('find_issues', 'Find issues in Sentry'), tool('get_issue_details'), tool('search_events')],
}
/**
 * `~/.envrouter/mcp-tools.json`: each good check's tools with the definition they came from.
 * `get_mcp_tools` offers a list only while that definition is still the saved one.
 */
const toolCache = new Map<string, { server: McpServer; tools: ToolInfo[] }>(
  withLibrary ? ['github', 'playwright'].map((name) => [name, { server: structuredClone(library[name]), tools: serverTools[name] }]) : [],
)
const using = (...names: string[]) => (withLibrary ? Object.fromEntries(names.map((n) => [n, { disabledTools: [] }])) : {})
let config: ConfigState = withAgents({
  version: CONFIG_VERSION,
  mcpServers: library,
  agents: {},
  profiles: populated
    ? [
        { ...profile('p1', 'Personal', ['~/dev', '~/notes'], unrouted ? undefined : '~/.claude-personal'), mcpServers: using('playwright') },
        {
          ...profile('p2', 'Work', ['~/dev/work/*', '~/Documents/Acme'], unrouted ? undefined : '~/.claude-work', {
            ...(unrouted ? {} : { copilot: { envVar: 'COPILOT_HOME', path: '~/.copilot-work' } }),
          }),
          mcpServers: withLibrary
            ? { ...using('linear', 'sentry', 'postgres'), github: { disabledTools: ['delete_repository', 'fork_repository'] } }
            : {},
        },
        profile('p3', 'Northwind', ['~/clients/northwind'], unrouted ? undefined : '~/.claude-northwind', {
          ...(unrouted ? {} : { copilot: { envVar: 'COPILOT_HOME', path: '~/.copilot-northwind' } }),
        }),
        { ...profile('p4', 'Scratch', ['~/dev/scratch']), mcpServers: using('playwright') },
      ]
    : [],
})

/** `McpServer::values`: every value a secret can stand in. */
const valuesOf = (server: McpServer): McpValue[] =>
  server.transport === 'stdio' ? [...server.args, ...Object.values(server.env)] : Object.values(server.headers)
const secretIdsOf = (server: McpServer) => valuesOf(server).flatMap((v) => (isSecret(v) ? [v.secret] : []))
/** `config::secret_ids` */
const secretIds = (cfg: ConfigState) => new Set(Object.values(cfg.mcpServers).flatMap(secretIdsOf))
/** The ids the secret store holds: what the config named when the mock started, unless there's no store. */
let stored = storeOff ? new Set<string>() : secretIds(config)
let shimInstalled = params.get('shim') !== 'stale'

/** `Platform::secret_store_name`, `sealed_label`, `file_manager` and `reveal_verb`, from the file a Rust test holds to `platform.rs`. */
const { secretStore: storeName, sealedLabel, fileManager, revealVerb } = platformWords[platform]

/** `paths::shim_binary` */
const SHIM = `${HOME}/.envrouter/bin/envrouter-shim`
/** `paths::config_file` */
const CONFIG_FILE = `${HOME}/.envrouter/config.json`

const setup: Omit<SetupStatus, 'shimInstalled'> = {
  platform,
  secretStore: storeName,
  sealedLabel,
  // `store::usable`: the Keychain is never asked (it would prompt), so only the others report a missing store.
  secretStoreProblem: storeOff && !macos ? storeError : null,
  fileManager,
  revealVerb,
  shimsDir: `${HOME}/.envrouter/shims`,
  shimPath: SHIM,
  // `shell::status`, with bash's files as `bash_startup_files` picks them for each platform.
  shells: macos
    ? [
        shell('zsh', ['.zshrc'], true, populated, true),
        shell('bash', ['.bash_profile', '.bashrc'], true, false),
        shell('fish', ['.config/fish/config.fish'], false, false),
      ]
    : [
        shell('zsh', ['.zshrc'], !wsl, false),
        shell('bash', wsl ? ['.profile', '.bashrc'] : ['.bashrc'], true, populated, true),
        shell('fish', ['.config/fish/config.fish'], false, false),
      ],
}
/** `Shell::binary`: the login shell, then `/etc/shells`. Named in a timeout's message. */
const shellBinary = (name: Shell) => ({ zsh: '/bin/zsh', bash: '/bin/bash', fish: macos ? '/opt/homebrew/bin/fish' : '/usr/bin/fish' })[name]

/** Where `editors::Editor` looks, and what's there: VS Code and Insiders with Claude Code (Insiders through the user's own wrapper), Cursor without it. In WSL, the Windows editors' remote servers instead. */
interface EditorSpot {
  editor: Editor
  label: string
  settingsFile: string
  available: boolean
  extensions: string[]
}
const appConfig = macos ? `${HOME}/Library/Application Support` : `${HOME}/.config`
/** A desktop editor keeps user settings under the app config folder; a remote server, machine settings in its own. */
const spot = (editor: Editor, label: string, settingsFile: string, available: boolean, claude: boolean): EditorSpot => ({
  editor,
  label,
  settingsFile,
  available,
  extensions: claude ? ['anthropic.claude-code'] : [],
})
const desktop = (dir: string) => `${appConfig}/${dir}/User/settings.json`
const remote = (dir: string) => `${HOME}/${dir}/data/Machine/settings.json`
const editorSpots: EditorSpot[] = [
  spot('code', 'VS Code', desktop('Code'), !wsl, !wsl),
  spot('codeInsiders', 'VS Code Insiders', desktop('Code - Insiders'), !wsl, !wsl),
  spot('cursor', 'Cursor', desktop('Cursor'), !wsl, false),
  spot('windsurf', 'Windsurf', desktop('Windsurf'), false, false),
  spot('codium', 'VSCodium', desktop('VSCodium'), false, false),
  spot('remoteCode', 'VS Code Server', remote('.vscode-server'), wsl, wsl),
  spot('remoteCodeInsiders', 'VS Code Insiders Server', remote('.vscode-server-insiders'), false, false),
  spot('remoteCursor', 'Cursor Server', remote('.cursor-server'), wsl, false),
  spot('remoteWindsurf', 'Windsurf Server', remote('.windsurf-server'), false, false),
]
/** The wrapper each settings file names, keyed by file and setting. */
const wrappers = new Map<string, string>(
  wsl ? [] : [[`${appConfig}/Code - Insiders/User/settings.json claudeCode.claudeProcessWrapper`, `${HOME}/bin/claude-wrap`]],
)
const editorStatus = (spot: EditorSpot, command: string, hook: IdeHook): EditorStatus => {
  const wrapper = wrappers.get(`${spot.settingsFile} ${hook.setting}`) ?? null
  return {
    editor: spot.editor,
    label: spot.label,
    command,
    available: spot.available,
    extensionInstalled: spot.extensions.includes(hook.extension),
    settingsFile: spot.settingsFile,
    wrapper,
    installed: wrapper === SHIM,
  }
}

/**
 * The agents' own MCP files in this home, as `serde_json` reads them. Import finds what the
 * payload's agents and profiles point it at; the first run has none.
 */
const agentFiles: Record<string, unknown> = populated
  ? {
      [`${HOME}/.claude.json`]: {
        numStartups: 212,
        mcpServers: {
          github: {
            type: 'stdio',
            command: 'docker',
            args: ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' },
          },
          mcpmux: { type: 'http', url: 'http://localhost:45818/mcp' },
        },
        projects: {
          [`${HOME}/dev/work/billing-api`]: {
            allowedTools: [],
            mcpServers: {
              supabase: {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@supabase/mcp-server-supabase', '--read-only'],
                env: { SUPABASE_ACCESS_TOKEN: 'sbp_example' },
              },
            },
          },
        },
      },
      [`${HOME}/.claude-work/.claude.json`]: {
        mcpServers: {
          github: {
            type: 'stdio',
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' },
          },
          mcpmux: { type: 'http', url: 'http://localhost:45818/mcp' },
        },
      },
      [`${HOME}/clients/northwind/.mcp.json`]: { mcpServers: { sentry: { type: 'http', url: 'https://mcp.sentry.dev/mcp' } } },
      [`${HOME}/.copilot-work/mcp-config.json`]: {
        mcpServers: { playwright: { type: 'local', command: 'npx', args: ['@playwright/mcp@latest'], tools: ['*'] } },
      },
    }
  : {}

try {
  if (populated) localStorage.setItem('envrouter.checkedOnce', '1')
  else localStorage.removeItem('envrouter.checkedOnce')
} catch {
  // Storage unavailable; first-run state still renders.
}

/** Longest-prefix owner, as the Rust resolver decides it. */
const owner = (cfg: ConfigState, folder: string) => {
  let best: { depth: number; profile: Profile } | null = null
  for (const p of cfg.profiles) {
    for (const t of p.triggerPaths) {
      const base = triggerBaseOrNull(t)
      if (base && (folder === base || folder.startsWith(`${base}/`))) {
        const depth = base.split('/').length
        if (!best || depth > best.depth) best = { depth, profile: p }
      }
    }
  }
  return best?.profile ?? null
}

/** The profile's settings for a tool, if it sets one: an empty path means unset, as `Profile::tool` treats it. */
const setTool = (p: Profile | null, tool: string) => {
  const settings = p?.tools[tool]
  return settings?.path.trim() ? settings : undefined
}

/** `mcp::servers_for`: the library servers a profile hands a tool that takes them. */
const mcpFor = (cfg: ConfigState, p: Profile | null, tool: string) =>
  p && cfg.agents[tool]?.mcp ? sortedKeys(p.mcpServers).filter((name) => has(cfg.mcpServers, name)) : []

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// `config::validate`, check for check and message for message, in its order.

const isFileName = (s: string) => /^[A-Za-z0-9_-]{1,64}$/.test(s)
const isMcpToolName = (s: string) => /^[A-Za-z0-9_.-]{1,128}$/.test(s)
const isSecretId = (s: string) => /^[0-9A-F]{1,64}$/.test(s)
const isHeaderName = (s: string) => /^[A-Za-z0-9_-]+$/.test(s)
const isEnvVarName = (s: string) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
const isCommandName = (s: string) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(s)

const validateServer = (name: string, server: McpServer) => {
  const invalid = (problem: string) => `MCP server "${name}" ${problem}`
  if (!isFileName(name)) throw invalid('needs a name made of letters, digits, - and _.')
  if (server.transport === 'stdio') {
    if (!server.command.trim()) throw invalid('needs a command to run.')
    const key = sortedKeys(server.env).find((k) => !isEnvVarName(k))
    if (key !== undefined) throw invalid(`sets "${key}", which isn't a valid environment variable name.`)
  } else {
    const { url } = server
    const rest = url.startsWith('https://') ? url.slice(8) : url.startsWith('http://') ? url.slice(7) : null
    if (rest === null || !rest.trim()) throw invalid(`has the URL "${url}". It must start with https:// or http://.`)
    const key = sortedKeys(server.headers).find((k) => !isHeaderName(k))
    if (key !== undefined) throw invalid(`has a header named "${key}", which isn't valid.`)
  }
  const bad = secretIdsOf(server).find((id) => !isSecretId(id))
  if (bad !== undefined) throw invalid(`refers to a secret with a malformed id, "${bad}".`)
}

const validateAgent = (name: string, agent: AgentDef) => {
  if (!isCommandName(name)) throw `"${name}" in the agent list isn't a valid command name.`
  const files = agent.mcpFiles
  if (files) {
    // Plain file names, joined onto folders; never a path that climbs out of one.
    const plain = (f: string) => f !== '' && !f.includes('/') && f !== '.' && f !== '..'
    if (!plain(files.userFile) || (typeof files.projectFile === 'string' && !plain(files.projectFile)) || !toolDir(files.defaultDir, '/'))
      throw `The MCP file locations for ${name} aren't plain file names in an absolute or ~ folder.`
  }
  if (!agent.mcp) return
  const isPrefix = (arg: string) => arg.startsWith('-') && arg.indexOf('=') > 1 && !/\s/.test(arg)
  if (!isPrefix(agent.mcp.configArg) || (agent.mcp.denyArg !== null && !isPrefix(agent.mcp.denyArg)))
    throw `The MCP arguments for ${name} must each be one option of the form --flag=.`
  if (agent.mcp.skipIfPresent.some((path) => !path.startsWith('/'))) throw `The files that turn MCP servers off for ${name} must be absolute paths.`
}

const validate = (cfg: ConfigState) => {
  const ids = new Map<string, Profile>()
  for (const p of cfg.profiles) {
    if (!p.id.trim()) throw `Profile "${p.name}" has no id. Give it one in config.json.`
    const other = ids.get(p.id)
    if (other) throw `Profiles "${other.name}" and "${p.name}" both have the id "${p.id}". Give each its own id in config.json.`
    ids.set(p.id, p)
  }
  const owners = new Map<string, Profile>()
  for (const p of cfg.profiles) {
    for (const [name, settings] of sorted(p.tools)) {
      if (!isCommandName(name)) throw `"${name}" in profile "${p.name}" isn't a valid command name.`
      if (!settings.path.trim()) continue
      if (!isEnvVarName(settings.envVar)) throw `"${settings.envVar}" in profile "${p.name}" isn't a valid environment variable name.`
      if (!toolDir(settings.path))
        throw `The ${name} folder "${settings.path.trim()}" in profile "${p.name}" must be an absolute path or start with ~, without "..".`
    }
    const uses = sorted(p.mcpServers)
    if (uses.length > 0 && !isFileName(p.id))
      throw `Profile "${p.name}" has the id "${p.id}", which can't name a folder. Use letters, digits, - and _.`
    for (const [server, use] of uses) {
      if (!has(cfg.mcpServers, server)) throw `Profile "${p.name}" uses the MCP server "${server}", which isn't in the server list.`
      const bad = use.disabledTools.find((t) => !isMcpToolName(t))
      if (bad !== undefined) throw `"${bad}" in profile "${p.name}" isn't a valid MCP tool name.`
    }
    for (const raw of p.triggerPaths) {
      const folder = triggerBase(raw)
      const other = owners.get(folder)
      owners.set(folder, p)
      if (other && other.id !== p.id)
        throw `${folder} is a trigger path in both "${other.name}" and "${p.name}". A folder can belong to only one profile.`
    }
  }
  for (const [name, server] of sorted(cfg.mcpServers)) validateServer(name, server)
  for (const [name, agent] of sorted(cfg.agents)) validateAgent(name, agent)
}

// `mcp_import`: entries in the shape Claude and Copilot share, from files or pasted text.

/** `mcp_import::parse_entry`. Numbers and flags become text; anything else EnvRouter can't represent drops the entry. */
const parseEntry = (value: unknown): McpServer | null => {
  const entry = obj(value)
  if (!entry) return null
  const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)
  const strings = (v: unknown): Record<string, string> | null => {
    if (v === undefined || v === null) return {}
    const map = obj(v)
    if (!map) return null
    const out: Record<string, string> = {}
    for (const key of sortedKeys(map)) {
      const t = text(map[key])
      if (t === null) return null
      out[key] = t
    }
    return out
  }
  const kind = typeof entry.type === 'string' ? entry.type : null
  if (typeof entry.command === 'string') {
    if (kind !== null && kind !== 'stdio' && kind !== 'local') return null
    let args: string[] = []
    if (Array.isArray(entry.args)) {
      const texts = entry.args.map(text)
      if (texts.some((t) => t === null)) return null
      args = texts as string[]
    } else if (entry.args !== undefined && entry.args !== null) return null
    const env = strings(entry.env)
    return env && { transport: 'stdio', command: entry.command, args, env }
  }
  if (typeof entry.url !== 'string') return null
  // A server that signs in with its own OAuth client or a headers helper couldn't connect without it.
  if (Object.entries(entry).some(([key, v]) => (key.startsWith('oauth') || key === 'headersHelper') && v !== null && v !== undefined)) return null
  const headers = strings(entry.headers)
  if (!headers) return null
  if (kind === null || kind === 'http' || kind === 'streamable-http') return { transport: 'http', url: entry.url, headers }
  return kind === 'sse' ? { transport: 'sse', url: entry.url, headers } : null
}

/** What `jsonc_parser` takes beyond JSON, made plain: comments go, and so do commas before a closing bracket. */
const stripJsonc = (text: string) => {
  // Each pass copies strings as they are, so `//` in a URL is never a comment.
  const scan = (input: string, outside: (i: number) => { skip: number; emit?: string } | null) => {
    let out = ''
    let i = 0
    while (i < input.length) {
      if (input[i] === '"') {
        let j = i + 1
        while (j < input.length && input[j] !== '"') j += input[j] === '\\' ? 2 : 1
        out += input.slice(i, j + 1)
        i = j + 1
        continue
      }
      const step = outside(i)
      if (step) {
        out += step.emit ?? ''
        i += step.skip
      } else {
        out += input[i]
        i += 1
      }
    }
    return out
  }
  const uncommented = scan(text, (i) => {
    if (text.startsWith('//', i)) {
      const end = text.indexOf('\n', i)
      return { skip: (end === -1 ? text.length : end) - i }
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      return end === -1 ? null : { skip: end + 2 - i, emit: ' ' }
    }
    return null
  })
  return scan(uncommented, (i) => (uncommented[i] === ',' && /^\s*[}\]]/.test(uncommented.slice(i + 1)) ? { skip: 1 } : null))
}

/** `mcp_import::parse_pasted`: the same shapes, entries and messages. */
const parsePasted = (text: string): Pasted => {
  if (!text.trim()) throw "Paste a server's JSON first."
  let json: unknown
  try {
    json = JSON.parse(stripJsonc(text))
  } catch (err) {
    try {
      // The brace goes on its own line, so a trailing `//` comment can't swallow it.
      json = JSON.parse(stripJsonc(`{${text}\n}`))
    } catch {
      throw `That isn't JSON EnvRouter can read: ${(err as Error).message}.`
    }
  }
  const isEntry = (v: unknown) => {
    const e = obj(v)
    return Boolean(e && (has(e, 'command') || has(e, 'url')))
  }
  if (isEntry(json)) {
    const server = parseEntry(json)
    if (!server) throw "EnvRouter can't use this server's transport, values or sign-in."
    return { servers: [{ name: null, server }], skipped: [] }
  }
  const root = obj(json)
  const table =
    obj(root?.mcpServers) ??
    obj(root?.servers) ??
    obj(obj(root?.mcp)?.servers) ??
    (root && Object.keys(root).length > 0 && Object.values(root).every(isEntry) ? root : null)
  if (!table) throw 'There are no MCP servers in it. Paste the part with mcpServers, or one server with its command or url.'
  const pasted: Pasted = { servers: [], skipped: [] }
  for (const [name, value] of sorted(table)) {
    const server = parseEntry(value)
    if (server) pasted.servers.push({ name, server })
    else pasted.skipped.push(name)
  }
  if (pasted.servers.length === 0 && pasted.skipped.length === 0) throw 'There are no MCP servers in it.'
  if (pasted.servers.length === 0)
    throw `EnvRouter can't use ${pasted.skipped.join(', ')}: their transports, values or sign-in aren't ones it supports.`
  return pasted
}

/** `mcp_import::read_servers`: a file's `mcpServers`, plus each project's in Claude's `.claude.json`. */
const readServers = (path: string, dialect: McpDialect): [string, McpServer][] => {
  const file = obj(agentFiles[path])
  if (!file) return []
  const tables = [file.mcpServers]
  const projects = obj(file.projects)
  if (dialect === 'claude' && projects) tables.push(...sorted(projects).map(([, project]) => obj(project)?.mcpServers))
  return tables.flatMap((table) => {
    const t = obj(table)
    return t
      ? sorted(t).flatMap(([name, entry]): [string, McpServer][] => {
          const server = parseEntry(entry)
          return server ? [[name, server]] : []
        })
      : []
  })
}

/** `mcp_import::candidates`: only the files the payload's agents and profiles point at. */
const importCandidates = (cfg: ConfigState): ImportCandidate[] => {
  const found: ImportCandidate[] = []
  for (const [command, agent] of sorted(cfg.agents)) {
    const files = agent.mcpFiles
    if (!files || !agent.mcp) continue
    const dirs = [toolDir(files.defaultDir), ...cfg.profiles.map((p) => setTool(p, command)).map((t) => (t ? toolDir(t.path) : null))]
    const sources = dirs.flatMap((dir) => (dir ? [join(dir, files.userFile)] : []))
    const { projectFile } = files
    if (projectFile)
      for (const raw of cfg.profiles.flatMap((p) => p.triggerPaths)) {
        const base = triggerBaseOrNull(raw)
        if (base) sources.push(join(base, projectFile))
      }
    sources.sort(comparePaths)
    for (const path of sources.filter((s, i) => i === 0 || comparePaths(s, sources[i - 1]) !== 0)) {
      for (const [name, server] of readServers(path, agent.mcp.dialect)) {
        const existing = found.find((c) => c.name === name && same(c.server, server))
        if (!existing) found.push({ name, server, sources: [path] })
        else if (!existing.sources.includes(path)) existing.sources.push(path)
      }
    }
  }
  const compareSources = (a: string[], b: string[]) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return cmp(a[i], b[i])
    return a.length - b.length
  }
  return found.sort((a, b) => cmp(a.name, b.name) || compareSources(a.sources, b.sources))
}

// What Check Folder finds.

/** A result `?check=` asks for, or null to work it out from the config. */
const forcedResult = (check: string | null, tool: string): FolderCheck | null => {
  switch (check) {
    case 'shadowedOnPath':
      return { status: 'shadowedOnPath', path: `${macos ? '/opt/homebrew' : '/usr/local'}/bin/${tool}`, byPromptHook: false }
    case 'byPromptHook':
      return { status: 'shadowedOnPath', path: `${HOME}/.local/share/mise/installs/node/24.11.0/bin/${tool}`, byPromptHook: true }
    case 'shadowedByShell':
      // Shells name the file only for a function; an alias has no origin.
      return { status: 'shadowedByShell', kind: 'alias', origin: null }
    case 'notFound':
      return { status: 'notFound' }
    case 'notInstalled':
      return { status: 'notInstalled' }
    case 'shimFailed':
      // A shim the kernel kills (its signature broke) writes nothing to stderr.
      return { status: 'shimFailed', message: '' }
    default:
      return null
  }
}

// The native context menu, as a DOM stand-in. `Menu.new` sends each item's action as a channel;
// choosing an item sends the item's id down it, as Tauri does.

interface MenuEntry {
  id?: string
  text?: string
  enabled?: boolean
  item?: unknown
  handler?: { id: number }
}
const menus = new Map<number, MenuEntry[]>()
let nextRid = 1
/** `popup()` without a position opens at the pointer; with one, at that point of the window. */
let pointer = { x: 0, y: 0 }
for (const type of ['pointermove', 'pointerdown', 'contextmenu'])
  document.addEventListener(
    type,
    (event) => {
      const { clientX, clientY } = event as MouseEvent
      pointer = { x: clientX, y: clientY }
    },
    true,
  )

const MENU_STYLE = `
#mock-menu { position: fixed; z-index: 2147483647; min-width: 200px; padding: 5px; border-radius: 8px; color-scheme: light dark;
  background: Canvas; color: CanvasText; font: menu; font-size: 13px; box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.25), 0 8px 24px rgb(0 0 0 / 0.2); }
#mock-menu button { display: block; width: 100%; padding: 3px 10px; border: 0; border-radius: 4px; background: none; color: inherit; font: inherit; text-align: left; }
#mock-menu button:hover, #mock-menu button:focus-visible { background: Highlight; color: HighlightText; outline: none; }
#mock-menu button:disabled { opacity: 0.4; }
#mock-menu [role='separator'] { height: 1px; margin: 5px 10px; background: GrayText; opacity: 0.4; }
`

/** Closes the menu that's open, if one is: a native menu is modal, so showing another dismisses it. */
let dismissOpenMenu: (() => void) | null = null

/** Pops the menu and answers when it's dismissed, as Tauri's `popup` does: the main thread is held until the menu closes. */
const popupMenu = (entries: MenuEntry[], at: { x: number; y: number } = pointer) =>
  new Promise<void>((resolve) => {
    dismissOpenMenu?.()
    // A native menu doesn't take DOM focus, so closing it by choosing or Escape leaves it where it was.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const giveBack = () => {
      if (opener?.isConnected) opener.focus()
    }
    if (!document.getElementById('mock-menu-style')) {
      const style = document.createElement('style')
      style.id = 'mock-menu-style'
      style.textContent = MENU_STYLE
      document.head.append(style)
    }
    const menu = document.createElement('div')
    menu.id = 'mock-menu'
    menu.setAttribute('role', 'menu')
    const items: HTMLButtonElement[] = []
    const close = () => {
      menu.remove()
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', keys, true)
      dismissOpenMenu = null
      resolve()
    }
    dismissOpenMenu = close
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) close()
    }
    const keys = (event: KeyboardEvent) => {
      const at = items.indexOf(document.activeElement as HTMLButtonElement)
      if (event.key === 'Escape') {
        close()
        giveBack()
      } else if (event.key === 'ArrowDown') items[(at + 1) % items.length]?.focus()
      else if (event.key === 'ArrowUp') items[(at - 1 + items.length) % items.length]?.focus()
      else return
      event.preventDefault()
    }
    for (const entry of entries) {
      if (entry.item === 'Separator') {
        const line = document.createElement('div')
        line.setAttribute('role', 'separator')
        menu.append(line)
        continue
      }
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'menuitem')
      button.textContent = entry.text ?? ''
      button.disabled = entry.enabled === false
      button.addEventListener('click', () => {
        close()
        giveBack()
        const internals = (window as unknown as { __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void } }).__TAURI_INTERNALS__
        if (entry.handler) internals.runCallback(entry.handler.id, { index: 0, message: entry.id })
      })
      items.push(button)
      menu.append(button)
    }
    document.body.append(menu)
    const { width, height } = menu.getBoundingClientRect()
    menu.style.left = `${Math.max(4, Math.min(at.x, innerWidth - width - 4))}px`
    menu.style.top = `${Math.max(4, Math.min(at.y, innerHeight - height - 4))}px`
    items[0]?.focus()
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', keys, true)
  })

const failed = (status: ServerCheck['status'], message: string, log: string | null = null): ServerCheck => ({ status, tools: [], message, log })

/** What `home()` in src-tauri answers once an uninstall has finished. */
const UNINSTALLED = 'EnvRouter is uninstalled. Quit it to finish.'

/** The commands that never ask for the home folder, so the guard in `home()` doesn't stop them. */
const UNGUARDED = ['set_unsaved_edits', 'quit_app', 'parse_mcp_json', 'open_help']

/** `uninstall::remove_next`, as an app installed the usual way would hear it. */
const removeNext = (): UninstallReport['removeNext'] =>
  macos
    ? [
        { what: 'app', command: 'brew uninstall --zap --cask envrouter' },
        { what: 'cli', command: 'brew uninstall envrouter-cli' },
      ]
    : [{ what: 'app', command: 'sudo apt remove env-router' }]

/**
 * `uninstall::run`: shells, then editors (every file tried, a problem stops the run before the next step), then the stored secrets (a store
 * that can't be reached doesn't stop it, one that won't delete does), then the folder. `dryRun` changes nothing.
 */
const uninstall = (dryRun: boolean): UninstallReport => {
  const shellFiles = [...new Set(setup.shells.filter((s) => s.installed).flatMap((s) => s.startupFiles))]
  const settings = [...new Set(Object.values(ideHooks()).map((hook) => hook.setting))]
  const editorFiles: UninstallReport['editorFiles'] = []
  const problems: string[] = []
  for (const spot of editorSpots) {
    for (const setting of settings) {
      const key = `${spot.settingsFile} ${setting}`
      if (failing === 'uninstall' && (spot.editor === 'code' || spot.editor === 'cursor')) {
        problems.push(
          `\`${spot.settingsFile}\` couldn't be read, and it names EnvRouter's shim in \`${setting}\`. Fix it in ${spot.label}, or delete that setting, then uninstall again.`,
        )
      } else if (wrappers.get(key) === SHIM) {
        editorFiles.push({ editor: spot.editor, settingsFile: spot.settingsFile, setting })
        if (!dryRun) wrappers.delete(key)
      }
    }
  }
  if (!dryRun) for (const s of setup.shells) s.installed = false
  const report = { dryRun, shellFiles, editorFiles, appData: [], appDataLeft: [], left: [], problems, removeNext: removeNext() }
  if (problems.length > 0) return { ...report, secrets: { status: 'notReached' }, folder: 'notReached' }

  // Off macOS `store::usable` says so before anything is deleted; the Keychain can't tell until it's asked, and refuses the delete.
  const unreachable = storeOff && !macos
  if (storeOff && macos && !dryRun) {
    const why = `Couldn't delete the stored MCP secrets: ${storeError.replace(/\.$/, '')}. \`~/.envrouter\` is still there: remove \`EnvRouter MCP secrets\` from the ${storeName} yourself if this keeps failing, then run uninstall again.`
    return { ...report, problems: [why], secrets: { status: 'notReached' }, folder: 'notReached' }
  }
  const secrets: UninstallReport['secrets'] = unreachable
    ? { status: 'unreachable', reason: storeError }
    : { status: dryRun ? 'wouldDelete' : 'deleted' }
  if (!dryRun) {
    stored = new Set()
    config = { version: CONFIG_VERSION, profiles: [], mcpServers: {}, agents: {} }
    uninstalled = true
  }
  return { ...report, secrets, folder: dryRun ? 'wouldDelete' : 'deleted' }
}

const respond = async (cmd: string, args: unknown): Promise<unknown> => {
  const a = (args ?? {}) as Record<string, unknown>
  if (uninstalled && !cmd.startsWith('plugin:') && !UNGUARDED.includes(cmd)) {
    // `get_config` is the one command that rejects with its kind too. `home()` refuses before any file is named, so there's no `path`.
    if (cmd === 'get_config') throw { kind: 'other', message: UNINSTALLED, path: null } satisfies ConfigFault
    throw UNINSTALLED
  }
  switch (cmd) {
    case 'plugin:path|resolve_directory':
      // tauri's `Error::UnknownPath`
      if (failing === 'home') throw 'unknown path'
      return HOME
    case 'plugin:dialog|open': {
      const opts = (a.options ?? {}) as { multiple?: boolean; title?: string }
      if (opts.title === 'Choose Config Folder') return `${HOME}/.claude-acme`
      return opts.multiple ? [`${HOME}/clients/acme`, `${HOME}/dev/acme-api`] : `${HOME}/dev/work/billing-api`
    }
    case 'plugin:dialog|message': {
      // `ask` is sent as a message with custom buttons and resolves to the label clicked. The
      // browser's own confirm stands in for the native sheet, so a delete asks here too.
      const [labels] = Object.values((a.buttons ?? {}) as Record<string, unknown>)
      const yes = window.confirm([a.title, a.message].filter(Boolean).join('\n\n'))
      return Array.isArray(labels) ? labels[yes ? 0 : 1] : yes ? 'Ok' : 'Cancel'
    }
    case 'plugin:menu|new': {
      const rid = nextRid++
      const opts = (a.options ?? {}) as { id?: string; items?: MenuEntry[] }
      menus.set(rid, opts.items ?? [])
      return [rid, opts.id ?? `menu-${rid}`]
    }
    case 'plugin:menu|popup': {
      // A `Position` goes over IPC as `{ Logical: { x, y } }` (or `Physical`), by its `toJSON`; no position is `null`.
      const at = a.at ? (JSON.parse(JSON.stringify(a.at)) as Record<'Logical' | 'Physical', { x: number; y: number }>) : null
      // As `resources_table.get`: a menu that was closed can't be shown.
      const entries = menus.get(a.rid as number)
      if (!entries) throw `resource id ${a.rid} is invalid`
      await popupMenu(entries, at?.Logical ?? at?.Physical)
      return null
    }
    case 'plugin:resources|close':
      menus.delete(a.rid as number)
      return null
    case 'plugin:opener|reveal_item_in_dir':
      // WSL with no file manager, say.
      if (failing === 'reveal') throw 'No file manager could show it.'
      // Finder or the file manager would open beside the window; nothing to show in a browser.
      return null
    case 'get_config':
      // `ConfigFault`: the one command that rejects with its kind too.
      if (configBroken && scenario === 'newer')
        throw {
          kind: 'other',
          message: `${HOME}/.envrouter/config.json is from a newer version of EnvRouter. Update EnvRouter to use it.`,
          path: CONFIG_FILE,
        } satisfies ConfigFault
      if (configBroken)
        throw {
          kind: 'parse',
          message: `${HOME}/.envrouter/config.json is not valid JSON: expected \`,\` or \`}\` at line 7 column 5`,
          path: CONFIG_FILE,
        } satisfies ConfigFault
      // `config::load_or_init`
      if (configMissing) {
        config = { version: CONFIG_VERSION, profiles: [], mcpServers: {}, agents: {} }
        configMissing = false
      }
      return config
    case 'save_config': {
      await delay(250)
      // `commands::save`: a save from a config the file no longer holds changes nothing.
      if (a.base !== undefined && a.base !== null && configMissing) return { status: 'missing' } satisfies SaveOutcome
      if (a.base !== undefined && a.base !== null && (configBroken || !same(a.base, config))) {
        if (configBroken) return respond('get_config', {})
        return { status: 'changed', config } satisfies SaveOutcome
      }
      const next = structuredClone(a.payload as ConfigState)
      const secrets = (a.secrets ?? {}) as Record<string, string>
      validate(next)
      const referenced = secretIds(next)
      if (Object.keys(secrets).some((id) => !referenced.has(id))) throw "A new secret isn't used by any server. Save the server again."
      // `shims::install_bundled` runs before the store is touched, so a failed save still reinstalls.
      shimInstalled = true
      // The store is read only when this save adds a secret or stops using one. New values go in
      // before config.json is written, and secrets nothing names any more come out after.
      const before = configMissing ? new Set<string>() : secretIds(config)
      // A secret a Start Over backup names stays, so putting the backup back brings its secrets too.
      const kept = new Set([...referenced, ...backedUp])
      if (Object.keys(secrets).length > 0) {
        if (storeOff) throw `Couldn't save the secret: ${storeError.replace(/\.$/, '')}. Nothing was saved.`
        stored = new Set([...[...stored].filter((id) => kept.has(id) || before.has(id)), ...Object.keys(secrets)])
      }
      config = { ...next, version: CONFIG_VERSION }
      configBroken = false
      configMissing = false
      let warning: string | null = null
      if ([...before].some((id) => !kept.has(id))) {
        // The config is written by now, so a store that won't let go is a warning, not a failed save.
        if (storeOff) warning = `Couldn't remove a secret no server uses any more: ${storeError.replace(/\.$/, '')}.`
        else stored = new Set([...stored].filter((id) => kept.has(id)))
      }
      return { status: 'saved', config, warning } satisfies SaveOutcome
    }
    case 'reset_unreadable_config': {
      await delay(250)
      // `commands::reset_unreadable_config`: only a file that isn't valid JSON is backed up and replaced.
      if (configMissing) throw 'config.json is gone, so nothing was changed.'
      if (!configBroken) throw 'config.json can be read now, so nothing was changed.'
      if (scenario === 'newer') throw `${HOME}/.envrouter/config.json is from a newer version of EnvRouter. Update EnvRouter to use it.`
      backups++
      for (const id of secretIds(config)) backedUp.add(id)
      config = { version: CONFIG_VERSION, profiles: [], mcpServers: {}, agents: {} }
      configBroken = false
      return `${HOME}/.envrouter/config.json.bak${backups === 1 ? '' : `-${backups}`}`
    }
    case 'set_unsaved_edits':
      // `quit::set_unsaved_edits`
      unsaved = a.unsaved === true
      quitAsked = false
      return null
    case 'quit_app':
      unsaved = false
      console.info('quit')
      return null
    case 'uninstall':
      await delay(700)
      return uninstall(a.dryRun === true)
    case 'npm_dist_tags': {
      await delay(700)
      const command = String(a.command)
      const name = String(a.package)
      if (!/(^|\/)npx$/.test(command)) throw `${command} isn't npx, so there's no npm package to look up.`
      if (name.endsWith('-nope')) throw `npm has no package named ${name}.`
      return { latest: '1.4.0', next: '2.0.0-beta.2' }
    }
    case 'import_candidates':
      await delay(500)
      return importCandidates(a.payload as ConfigState)
    case 'parse_mcp_json':
      return parsePasted(String(a.text ?? ''))
    case 'get_mcp_tools': {
      if (configBroken) return respond('get_config', {})
      const known = [...toolCache].filter(([name, cached]) => same(config.mcpServers[name], cached.server))
      return Object.fromEntries(known.sort(([x], [y]) => cmp(x, y)).map(([name, cached]) => [name, cached.tools]))
    }
    case 'check_mcp_server': {
      await delay(1400)
      const name = a.name as string
      const server = a.server as McpServer
      const typed = (a.secrets ?? {}) as Record<string, string>
      const ids = secretIdsOf(server)
      if (!ids.every((id) => has(typed, id))) {
        if (storeOff) return failed('failed', `Couldn't read the secrets: ${storeError}.`)
        if (ids.some((id) => !has(typed, id) && !stored.has(id)))
          return failed('failed', `A secret this server needs isn't in the ${storeName}. Enter it again.`)
      }
      if (server.transport === 'sse') return failed('unsupported', "SSE servers can't be checked here. The agent connects to them as usual.")
      if (name === 'slow') {
        await delay(3000)
        const what = server.transport === 'stdio' ? server.command : server.url
        return failed(
          'timedOut',
          `${what} didn't answer within 45 seconds.`,
          server.transport === 'stdio' ? "Unable to find image 'mcp/fetch:latest' locally\nlatest: Pulling from mcp/fetch" : null,
        )
      }
      if (name === 'linear') return failed('needsLogin', 'The server wants a sign-in. Run the agent in a profile folder and use /mcp to sign in.')
      if (name === 'postgres')
        return failed(
          'failed',
          'connection closed: initialize response',
          'Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)',
        )
      const tools = serverTools[name] ?? [tool('echo', 'Echo the input back')]
      if (isFileName(name)) toolCache.set(name, { server: structuredClone(server), tools })
      return { status: 'ok', tools, message: null, log: null } satisfies ServerCheck
    }
    case 'reveal_place': {
      // `commands::locate`, then `show_located`
      const place = a.place as Place
      let path: string
      if (place.kind === 'config') {
        if (configMissing) throw "There's no config.json yet. EnvRouter writes it the next time the window reads its settings."
        path = `${HOME}/.envrouter/config.json`
      } else if (place.kind === 'root') {
        path = `${HOME}/.envrouter`
      } else {
        if (!isFileName(place.profileId)) throw "That isn't a profile."
        // The mock renders no files; a saved profile with servers is the one that would have them.
        const servers = config.profiles.find((p) => p.id === place.profileId)?.mcpServers ?? {}
        if (Object.keys(servers).length === 0)
          throw 'This profile has no MCP files yet. EnvRouter writes them when the profile is saved with an MCP server.'
        path = `${HOME}/.envrouter/mcp/${place.profileId}`
      }
      // WSL with no file manager, say. Finder or the file manager would open beside the window; nothing to show in a browser.
      if (failing === 'reveal') throw `Couldn't show \`${path}\`: No file manager could show it.`
      return null
    }
    case 'open_help': {
      // `help::open`: a launcher that can't start, as in a WSL distro with none installed, says why and where the page is.
      // A name that isn't a link never reaches the command: Tauri's argument parsing refuses it first.
      if (typeof a.link !== 'string' || !Object.keys(helpLinks).includes(a.link))
        throw `invalid args \`link\` for command \`open_help\`: unknown variant \`${String(a.link)}\`, expected ${Object.keys(helpLinks)
          .map((name) => `\`${name}\``)
          .join(' or ')}`
      const page = helpLinks[a.link as HelpLink]
      if (failing === 'reveal') throw `No such file or directory (os error 2). It's at ${page.url}.`
      return null
    }
    case 'open_in_editor': {
      const path = String(a.path)
      if (!path.startsWith(`${HOME}/`)) throw `${path} isn't a file in your home folder.`
      if (failing === 'editor') throw `couldn't open ${path}`
      configBroken = false
      return null
    }
    case 'get_setup_status':
      // `shims::bundled`, when the app's own executable can't be found
      if (failing === 'status') throw 'current executable: No such file or directory (os error 2)'
      return { ...setup, shimInstalled } satisfies SetupStatus
    case 'set_shell_integration': {
      await delay(300)
      const s = setup.shells.find((x) => x.shell === a.shell)
      if (!s) throw `unknown variant \`${a.shell}\`, expected one of \`zsh\`, \`bash\`, \`fish\``
      // `Error::Io`: the path, then the OS's reason
      if (failing === 'shell') throw `${s.startupFiles[0]}: Permission denied (os error 13)`
      if (a.enabled) shimInstalled = true
      s.installed = Boolean(a.enabled)
      return s
    }
    case 'get_editor_status': {
      const hooks = sorted((a.hooks ?? {}) as Record<string, IdeHook>)
      return editorSpots.flatMap((spot) => hooks.map(([command, hook]) => editorStatus(spot, command, hook)))
    }
    case 'set_editor_integration': {
      await delay(300)
      const spot = editorSpots.find((x) => x.editor === a.editor)
      if (!spot) throw `unknown variant \`${a.editor}\``
      const command = String(a.command)
      const hook = a.hook as IdeHook
      if (a.enabled) shimInstalled = true
      const key = `${spot.settingsFile} ${hook.setting}`
      const current = wrappers.get(key)
      // As `editors::set_integration`: someone else's wrapper is never replaced or cleared.
      if (current && current !== SHIM) {
        if (a.enabled)
          throw `${spot.label} already runs the extension through ${current}. Clear ${hook.setting} in the ${spot.label} settings to use EnvRouter.`
      } else if (a.enabled) wrappers.set(key, SHIM)
      else wrappers.delete(key)
      return editorStatus(spot, command, hook)
    }
    case 'preview_folder': {
      const payload = a.payload as ConfigState
      const p = owner(payload, a.folder as string)
      const settings = setTool(p, a.tool as string)
      return {
        profileId: p?.id ?? null,
        profile: p?.name ?? null,
        envVar: settings ? settings.envVar : null,
        value: settings ? expandHome(settings.path.trim()) : null,
        mcp: mcpFor(payload, p, a.tool as string),
      }
    }
    case 'check_folder': {
      const command = String(a.tool)
      const folder = String(a.folder)
      if (!isCommandName(command)) throw `"${command}" isn't a valid command name.`
      if (!folder.startsWith('/')) throw `${folder} isn't a folder. Drop or choose a folder to check.`
      const s = setup.shells.find((x) => x.shell === a.shell)
      if (!s?.available) throw `${a.shell} isn't installed.`
      if (forcedCheck === 'timeout') {
        // The real deadline is 15 seconds; the mock gives up sooner.
        await delay(4000)
        throw `"${shellBinary(s.shell)}" didn't finish within 15 seconds. Something in your shell startup files may be waiting for input.`
      }
      await delay(1100)
      // A startup file that runs `exec tmux` replaces the shell before it can answer.
      if (forcedCheck === 'noPath') throw `${s.shell} exited without reporting its PATH. open terminal failed: not a terminal`
      const forced = forcedResult(forcedCheck, command)
      if (forced) return forced
      if (forcedCheck === 'owned' || forcedCheck === 'unowned') {
        // A profile that owns the folder but leaves the agent alone; the stand-in name when the config knows no owner.
        const p = owner(config, folder)
        return {
          status: 'routed',
          profile: forcedCheck === 'owned' ? (p?.name ?? 'Personal') : null,
          profileId: forcedCheck === 'owned' ? (p?.id ?? 'p1') : null,
          envVar: null,
          value: null,
          mcp: [],
          mcpManagedBy: null,
          viaAlias: null,
          real: `${HOME}/.local/bin/${command}`,
        } satisfies FolderCheck
      }
      if (scenario === 'shadowed') return { status: 'shadowedByShell', kind: 'function', origin: s.startupFiles[0] ?? null } satisfies FolderCheck
      // With the shell off, or no profile setting the tool (so no shim for it), the real backend
      // finds the tool itself on PATH, not nothing.
      const shimmed = config.profiles.some((p) => setTool(p, command) || mcpFor(config, p, command).length > 0)
      if (!s.installed || !shimmed)
        return { status: 'shadowedOnPath', path: `${HOME}/.local/bin/${command}`, byPromptHook: false } satisfies FolderCheck
      const p = owner(config, folder)
      const settings = setTool(p, command)
      return {
        status: 'routed',
        profile: p?.name ?? null,
        profileId: p?.id ?? null,
        envVar: settings ? settings.envVar : null,
        value: settings ? expandHome(settings.path.trim()) : null,
        mcp: forcedCheck === 'managed' ? [] : mcpFor(config, p, command),
        mcpManagedBy:
          forcedCheck === 'managed'
            ? macos
              ? '/Library/Application Support/ClaudeCode/managed-mcp.json'
              : '/etc/claude-code/managed-mcp.json'
            : null,
        viaAlias: forcedCheck === 'alias' ? `${command} --model opus` : null,
        real: `${HOME}/.local/bin/${command}`,
      } satisfies FolderCheck
    }
    default:
      throw `mock: unhandled ${cmd}`
  }
}

mockWindows('main')
// Real IPC deserializes a fresh value every time. Handing React the mock's own objects would
// let a later mutation here pass for "nothing changed" and skip the re-render.
mockIPC(async (cmd, args) => structuredClone(await respond(cmd, args)), { shouldMockEvents: true })

declare global {
  interface Window {
    __mockDrop: (path: string, x: number, y: number) => Promise<void>
    __mockEditConfig: (edit: (config: ConfigState) => ConfigState) => void
    __mockDeleteConfig: () => void
    __mockQuit: () => Promise<void>
    __mockFix: () => void
    __mockMenuReveal: (place: Place) => Promise<void>
    __mockMenuHelp: (link: HelpLink) => Promise<void>
  }
}

window.__mockEditConfig = (edit) => {
  config = edit(structuredClone(config))
}

window.__mockFix = () => {
  failing = null
}

// `tray::reveal_in_background`: a failure after the uninstall began (the gate refused it, or it ran on) isn't told, as the window has nothing to add.
window.__mockMenuReveal = async (place) => {
  try {
    await respond('reveal_place', { place })
  } catch (message) {
    if (uninstalled) return
    await emit('reveal-failed', { what: place, message: String(message) } satisfies RevealFailed)
  }
}

// `tray::help_in_background`: the Help menu's items, told the same way.
window.__mockMenuHelp = async (link) => {
  try {
    await respond('open_help', { link })
  } catch (message) {
    if (uninstalled) return
    await emit('reveal-failed', { what: { kind: 'help', link }, message: String(message) } satisfies RevealFailed)
  }
}

window.__mockDeleteConfig = () => {
  configMissing = true
}

// `quit::may_quit`
window.__mockQuit = async () => {
  if (!unsaved || quitAsked) {
    console.info('quit')
    return
  }
  quitAsked = true
  await emit('quit-requested')
}

window.__mockDrop = async (path, x, y) => {
  const position = { x: x * devicePixelRatio, y: y * devicePixelRatio }
  await emit('tauri://drag-enter', { paths: [path], position })
  await delay(400)
  await emit('tauri://drag-drop', { paths: [path], position })
}
