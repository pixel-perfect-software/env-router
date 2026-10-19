// Development only: lets the frontend run in a plain browser for design review, with the
// Tauri commands answered from memory. main.tsx loads it only when `import.meta.env.DEV` and no
// Tauri runtime is present, so it never ships. Pick a state with `?scenario=`:
// first-run (default), populated, mcp (populated, with an MCP server library), shadowed, or broken (config.json can't be read until
// "Open config.json" is clicked, which stands in for fixing it). `?platform=linux` answers as a
// Linux desktop would (home in /home, bash as the login shell, ~/.config editor settings, a
// keyring). `window.__mockDrop(path, x, y)` simulates a Finder drop.

import { emit } from '@tauri-apps/api/event'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import { withAgents } from '../lib/tools'
import type {
  ConfigState,
  EditorStatus,
  FolderCheck,
  ImportCandidate,
  McpServer,
  Profile,
  ServerCheck,
  SetupStatus,
  ShellStatus,
  ToolInfo,
} from '../lib/types'

const linux = new URLSearchParams(location.search).get('platform') === 'linux'
const HOME = linux ? '/home/sam' : '/Users/sam'

const scenario = new URLSearchParams(location.search).get('scenario') ?? 'first-run'

const shell = (name: ShellStatus['shell'], files: string[], available: boolean, installed: boolean, isDefault = false): ShellStatus => ({
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
let configBroken = scenario === 'broken'
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
const checked = new Set(withLibrary ? ['github', 'playwright'] : [])
const using = (...names: string[]) => (withLibrary ? Object.fromEntries(names.map((n) => [n, { disabledTools: [] }])) : {})
let config: ConfigState = withAgents({
  version: 3,
  mcpServers: library,
  agents: {},
  profiles: populated
    ? [
        { ...profile('p1', 'Personal', ['~/dev', '~/notes'], '~/.claude-personal'), mcpServers: using('playwright') },
        {
          ...profile('p2', 'Work', ['~/dev/work/*', '~/Documents/Acme'], '~/.claude-work', {
            copilot: { envVar: 'COPILOT_HOME', path: '~/.copilot-work' },
          }),
          mcpServers: withLibrary
            ? { ...using('linear', 'sentry', 'postgres'), github: { disabledTools: ['delete_repository', 'fork_repository'] } }
            : {},
        },
        profile('p3', 'Northwind', ['~/clients/northwind'], '~/.claude-northwind', {
          copilot: { envVar: 'COPILOT_HOME', path: '~/.copilot-northwind' },
        }),
        { ...profile('p4', 'Scratch', ['~/dev/scratch']), mcpServers: using('playwright') },
      ]
    : [],
})
const setup: SetupStatus = {
  platform: linux ? 'linux' : 'macos',
  secretStore: linux ? 'keyring' : 'Keychain',
  shimInstalled: true,
  shimsDir: `${HOME}/.envrouter/shims`,
  shells: [
    shell('zsh', ['.zshrc'], true, linux ? false : populated, !linux),
    linux ? shell('bash', ['.bashrc'], true, populated, true) : shell('bash', ['.bash_profile', '.bashrc'], true, false),
    shell('fish', ['.config/fish/config.fish'], false, false),
  ],
}

/** VS Code with Claude Code installed, Insiders already running it through the user's own wrapper, and Cursor without the extension. */
const editors: EditorStatus[] = (
  [
    ['code', 'Code', true, true],
    ['codeInsiders', 'Code - Insiders', true, true],
    ['cursor', 'Cursor', true, false],
    ['windsurf', 'Windsurf', false, false],
    ['codium', 'VSCodium', false, false],
  ] as const
).map(([editor, dir, available, extensionInstalled]) => ({
  editor,
  command: 'claude',
  available,
  extensionInstalled,
  settingsFile: `${HOME}/${linux ? '.config' : 'Library/Application Support'}/${dir}/User/settings.json`,
  wrapper: editor === 'codeInsiders' ? `${HOME}/bin/claude-wrap` : null,
  installed: false,
}))

try {
  if (populated) localStorage.setItem('envrouter.checkedOnce', '1')
  else localStorage.removeItem('envrouter.checkedOnce')
} catch {
  // Storage unavailable; first-run state still renders.
}

const expand = (p: string) => (p.startsWith('~') ? HOME + p.slice(1) : p).replace(/\/\*\*?$/, '').replace(/\/$/, '')

/** Longest-prefix owner, as the Rust resolver decides it. */
const owner = (cfg: ConfigState, folder: string) => {
  let best: { depth: number; profile: Profile } | null = null
  for (const p of cfg.profiles) {
    for (const t of p.triggerPaths) {
      const base = expand(t)
      if (folder === base || folder.startsWith(`${base}/`)) {
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
  p && cfg.agents[tool]?.mcp
    ? Object.keys(p.mcpServers)
        .filter((name) => cfg.mcpServers[name])
        .sort()
    : []

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const respond = async (cmd: string, args: unknown): Promise<unknown> => {
  const a = (args ?? {}) as Record<string, unknown>
  switch (cmd) {
    case 'plugin:path|resolve_directory':
      return HOME
    case 'plugin:dialog|open': {
      const opts = (a.options ?? {}) as { multiple?: boolean; title?: string }
      if (opts.title === 'Choose Config Folder') return `${HOME}/.claude-acme`
      return opts.multiple ? [`${HOME}/clients/acme`, `${HOME}/dev/acme-api`] : `${HOME}/dev/work/billing-api`
    }
    case 'plugin:dialog|message': {
      // `ask` is sent as a message with custom buttons and resolves to the label clicked. Always confirm.
      const [labels] = Object.values((a.buttons ?? {}) as Record<string, unknown>)
      return Array.isArray(labels) ? labels[0] : 'Ok'
    }
    case 'get_config':
      if (configBroken) throw `${HOME}/.envrouter/config.json is not valid JSON: expected \`,\` or \`}\` at line 7 column 5`
      return config
    case 'save_config': {
      const next = a.payload as ConfigState
      const seen = new Map<string, Profile>()
      for (const p of next.profiles) {
        for (const server of Object.keys(p.mcpServers))
          if (!next.mcpServers[server]) throw `Profile "${p.name}" uses the MCP server "${server}", which isn't in the server list.`
        for (const [name, tool] of Object.entries(p.tools)) {
          const path = tool.path.trim()
          if (path && !/^(~$|~\/|\/)/.test(path))
            throw `The ${name} folder "${path}" in profile "${p.name}" must be an absolute path or start with ~, without "..".`
        }
        for (const t of p.triggerPaths) {
          const other = seen.get(expand(t))
          if (other && other.id !== p.id)
            throw `${expand(t)} is a trigger path in both "${other.name}" and "${p.name}". A folder can belong to only one profile.`
          seen.set(expand(t), p)
        }
      }
      await delay(250)
      config = next
      return null
    }
    case 'import_candidates':
      await delay(500)
      return [
        {
          name: 'github',
          server: library.github ?? { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: {} },
          sources: [`${HOME}/.claude-work/.claude.json`],
        },
        {
          name: 'github',
          server: {
            transport: 'stdio',
            command: 'docker',
            args: ['run', '-i', '--rm', 'ghcr.io/github/github-mcp-server'],
            env: { GITHUB_TOKEN: 'ghp_example' },
          },
          sources: [`${HOME}/.claude.json`],
        },
        {
          name: 'mcpmux',
          server: { transport: 'http', url: 'http://localhost:45818/mcp', headers: {} },
          sources: [`${HOME}/.claude.json`, `${HOME}/.claude-work/.claude.json`],
        },
        {
          name: 'supabase',
          server: {
            transport: 'stdio',
            command: 'npx',
            args: ['-y', '@supabase/mcp-server-supabase'],
            env: { SUPABASE_ACCESS_TOKEN: 'sbp_example' },
          },
          sources: [`${HOME}/dev/work/billing-api/.mcp.json`],
        },
      ] satisfies ImportCandidate[]
    case 'get_mcp_tools':
      return Object.fromEntries([...checked].filter((name) => config.mcpServers[name]).map((name) => [name, serverTools[name] ?? []]))
    case 'check_mcp_server': {
      await delay(1400)
      const name = a.name as string
      const server = a.server as McpServer
      if (server.transport === 'sse')
        return {
          status: 'unsupported',
          tools: [],
          message: "SSE servers can't be checked here. The agent connects to them as usual.",
          log: null,
        } satisfies ServerCheck
      if (name === 'linear')
        return {
          status: 'needsLogin',
          tools: [],
          message: 'The server wants a sign-in. Run the agent in a profile folder and use /mcp to sign in.',
          log: null,
        } satisfies ServerCheck
      if (name === 'postgres')
        return {
          status: 'failed',
          tools: [],
          message: 'connection closed: initialize response',
          log: 'Error: connect ECONNREFUSED 127.0.0.1:5432\n    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1611:16)',
        } satisfies ServerCheck
      checked.add(name)
      return { status: 'ok', tools: serverTools[name] ?? [tool('echo', 'Echo the input back')], message: null, log: null } satisfies ServerCheck
    }
    case 'open_in_editor':
      configBroken = false
      return null
    case 'get_setup_status':
      return setup
    case 'set_shell_integration': {
      await delay(300)
      const s = setup.shells.find((x) => x.shell === a.shell)
      if (!s) throw 'unknown shell'
      s.installed = Boolean(a.enabled)
      return s
    }
    case 'get_editor_status':
      return editors.map((e) => ({ ...e }))
    case 'set_editor_integration': {
      await delay(300)
      const e = editors.find((x) => x.editor === a.editor && x.command === a.command)
      if (!e) throw 'unknown editor'
      // As `editors::set_integration`: someone else's wrapper is never replaced or cleared.
      if (e.wrapper && !e.installed) {
        if (a.enabled)
          throw `VS Code Insiders already runs the extension through ${e.wrapper}. Clear claudeCode.claudeProcessWrapper in the VS Code Insiders settings to use EnvRouter.`
        return { ...e }
      }
      e.installed = Boolean(a.enabled)
      e.wrapper = e.installed ? `${HOME}/.envrouter/bin/envrouter-shim` : null
      return { ...e }
    }
    case 'preview_folder': {
      const payload = a.payload as ConfigState
      const p = owner(payload, a.folder as string)
      const tool = setTool(p, a.tool as string)
      return {
        profileId: p?.id ?? null,
        profile: p?.name ?? null,
        envVar: tool ? tool.envVar : null,
        value: tool ? expand(tool.path) : null,
        mcp: mcpFor(payload, p, a.tool as string),
      }
    }
    case 'check_folder': {
      await delay(1100)
      if (!(a.folder as string).startsWith('/')) throw `${a.folder} isn't a folder. Drop or choose a folder to check.`
      const s = setup.shells.find((x) => x.shell === a.shell)
      if (scenario === 'shadowed') return { status: 'shadowedByShell', kind: 'function', origin: `${HOME}/.zshrc` } satisfies FolderCheck
      // With the shell off, or no profile setting the tool (so no shim for it), the real backend
      // finds the tool itself on PATH, not nothing.
      const shimmed = config.profiles.some((p) => setTool(p, a.tool as string) || mcpFor(config, p, a.tool as string).length > 0)
      if (!s?.installed || !shimmed)
        return { status: 'shadowedOnPath', path: `${HOME}/.local/bin/${a.tool as string}`, byPromptHook: false } satisfies FolderCheck
      const p = owner(config, a.folder as string)
      const tool = setTool(p, a.tool as string)
      return {
        status: 'routed',
        profile: p?.name ?? null,
        envVar: tool ? tool.envVar : null,
        value: tool ? expand(tool.path) : null,
        mcp: mcpFor(config, p, a.tool as string),
        real: `${HOME}/.local/bin/${a.tool as string}`,
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
  }
}

window.__mockDrop = async (path, x, y) => {
  const position = { x: x * devicePixelRatio, y: y * devicePixelRatio }
  await emit('tauri://drag-enter', { paths: [path], position })
  await delay(400)
  await emit('tauri://drag-drop', { paths: [path], position })
}
