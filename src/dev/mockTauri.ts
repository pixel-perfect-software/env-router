// Development only: lets the frontend run in a plain browser for design review, with the
// Tauri commands answered from memory. main.tsx loads it only when `import.meta.env.DEV` and no
// Tauri runtime is present, so it never ships. Pick a state with `?scenario=`:
// first-run (default), populated, shadowed, or broken (config.json can't be read until
// "Open config.json" is clicked, which stands in for fixing it). `window.__mockDrop(path, x, y)`
// simulates a Finder drop.

import { emit } from '@tauri-apps/api/event'
import { mockIPC, mockWindows } from '@tauri-apps/api/mocks'
import type { ConfigState, FolderCheck, Profile, SetupStatus, ShellStatus } from '../lib/types'

const HOME = '/Users/sam'
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
})

const populated = scenario !== 'first-run'
let configBroken = scenario === 'broken'
let config: ConfigState = {
  version: 1,
  profiles: populated
    ? [
        profile('p1', 'Personal', ['~/dev', '~/notes'], '~/.claude-personal'),
        profile('p2', 'Work', ['~/dev/work/*', '~/Documents/Acme'], '~/.claude-work', { codex: { envVar: 'CODEX_HOME', path: '~/.codex-work' } }),
        profile('p3', 'Northwind', ['~/clients/northwind'], '~/.claude-northwind', {
          copilot: { envVar: 'COPILOT_HOME', path: '~/.copilot-northwind' },
        }),
        profile('p4', 'Scratch', ['~/dev/scratch']),
      ]
    : [],
}
const setup: SetupStatus = {
  shimInstalled: true,
  shimsDir: `${HOME}/.envrouter/shims`,
  shells: [
    shell('zsh', ['.zshrc'], true, populated, true),
    shell('bash', ['.bash_profile', '.bashrc'], true, false),
    shell('fish', ['.config/fish/config.fish'], false, false),
  ],
}

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
    case 'preview_folder': {
      const p = owner(a.payload as ConfigState, a.folder as string)
      const tool = setTool(p, a.tool as string)
      return { profileId: p?.id ?? null, profile: p?.name ?? null, envVar: tool ? tool.envVar : null, value: tool ? expand(tool.path) : null }
    }
    case 'check_folder': {
      await delay(1100)
      if (!(a.folder as string).startsWith('/')) throw `${a.folder} isn't a folder. Drop or choose a folder to check.`
      const s = setup.shells.find((x) => x.shell === a.shell)
      if (scenario === 'shadowed') return { status: 'shadowedByShell', kind: 'function', origin: `${HOME}/.zshrc` } satisfies FolderCheck
      // With the shell off, or no profile setting the tool (so no shim for it), the real backend
      // finds the tool itself on PATH, not nothing.
      const shimmed = config.profiles.some((p) => setTool(p, a.tool as string))
      if (!s?.installed || !shimmed)
        return { status: 'shadowedOnPath', path: `${HOME}/.local/bin/${a.tool as string}`, byPromptHook: false } satisfies FolderCheck
      const p = owner(config, a.folder as string)
      const tool = setTool(p, a.tool as string)
      return {
        status: 'routed',
        profile: p?.name ?? null,
        envVar: tool ? tool.envVar : null,
        value: tool ? expand(tool.path) : null,
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
