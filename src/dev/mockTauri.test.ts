// The browser mock must answer as the real backend does, or a UI review in the browser misleads.
// Each test boots the mock for one URL and calls it through Tauri's own `invoke`.

import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConfigState,
  Editor,
  EditorStatus,
  ImportCandidate,
  McpServer,
  Pasted,
  SaveOutcome,
  SetupStatus,
  ToolInfo,
  UninstallReport,
} from '../lib/types'

const boot = async (search: string) => {
  vi.resetModules()
  vi.stubGlobal('location', { search })
  vi.stubGlobal('localStorage', { setItem: () => {}, removeItem: () => {} })
  vi.stubGlobal('document', { addEventListener: () => {} })
  vi.stubGlobal('window', globalThis)
  await import('./mockTauri')
  // The mock waits as the real commands take time; fake timers skip that.
  return async <T>(cmd: string, args?: Record<string, unknown>) => {
    const answer = invoke<T>(cmd, args)
    answer.catch(() => {})
    await vi.runAllTimersAsync()
    return answer
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('server tool lists', () => {
  it('offers a list only while the saved definition matches the checked one', async () => {
    const call = await boot('?scenario=mcp')
    expect(Object.keys(await call<Record<string, ToolInfo[]>>('get_mcp_tools'))).toEqual(['github', 'playwright'])

    const config = await call<ConfigState>('get_config')
    const echo: McpServer = { transport: 'stdio', command: 'uvx', args: ['mcp-echo'], env: {} }
    await call('check_mcp_server', { name: 'echo', server: echo, secrets: {} })
    const playwright = config.mcpServers.playwright as Extract<McpServer, { transport: 'stdio' }>
    playwright.args = ['@playwright/mcp@0.0.40']
    config.mcpServers.echo = echo
    await call('save_config', { payload: config, secrets: {} })

    expect(Object.keys(await call<Record<string, ToolInfo[]>>('get_mcp_tools'))).toEqual(['echo', 'github'])
  })
})

describe('import', () => {
  it('finds nothing on a first run', async () => {
    const call = await boot('')
    expect(await call('import_candidates', { payload: await call('get_config') })).toEqual([])
  })

  it("reads only the files the payload points at, with values as the agents' files hold them", async () => {
    const call = await boot('?scenario=mcp')
    const config = await call<ConfigState>('get_config')
    const found = await call<ImportCandidate[]>('import_candidates', { payload: config })
    const github = found.find((c) => c.sources.includes('/Users/sam/.claude-work/.claude.json'))
    expect(github?.server).toEqual({
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_example' },
    })
    // Without the Work profile, its config folder and trigger folders aren't read.
    const withoutWork = { ...config, profiles: config.profiles.filter((p) => p.name !== 'Work') }
    const fewer = await call<ImportCandidate[]>('import_candidates', { payload: withoutWork })
    expect(fewer.flatMap((c) => c.sources)).not.toContain('/Users/sam/.claude-work/.claude.json')
  })
})

describe('pasted JSON', () => {
  it('reads JSONC, takes numbers and flags as text, and skips what it cannot use', async () => {
    const call = await boot('')
    const text = `{
      // from the README
      "mcpServers": {
        "srv": { "command": "srv", "args": ["--port", 3000, "https://x.dev/a//b"], "env": { "DEBUG": true }, },
        /* not stdio */ "odd": { "type": "http", "command": "srv" },
      },
    }`
    const pasted = await call<Pasted>('parse_mcp_json', { text })
    expect(pasted.servers).toEqual([
      { name: 'srv', server: { transport: 'stdio', command: 'srv', args: ['--port', '3000', 'https://x.dev/a//b'], env: { DEBUG: 'true' } } },
    ])
    expect(pasted.skipped).toEqual(['odd'])
    await expect(call('parse_mcp_json', { text: '{ "mcpServers": {} }' })).rejects.toBe('There are no MCP servers in it.')
    await expect(call('parse_mcp_json', { text: '{ "command": "srv", "args": [["nested"]] }' })).rejects.toBe(
      "EnvRouter can't use this server's transport, values or sign-in.",
    )
  })
})

describe('saving', () => {
  it('keeps its own copy at the current version', async () => {
    const call = await boot('?scenario=populated')
    const config = await call<ConfigState>('get_config')
    const payload = { ...config, version: 1 }
    const count = payload.profiles.length
    await call('save_config', { payload, secrets: {} })
    payload.profiles.pop()
    const saved = await call<ConfigState>('get_config')
    expect(saved.version).toBe(5)
    expect(saved.profiles).toHaveLength(count)
  })

  it('rejects what config::validate and save_config reject, with their messages', async () => {
    const call = await boot('?scenario=mcp')
    const config = await call<ConfigState>('get_config')
    const withTrigger = (path: string) => ({ ...config, profiles: [{ ...config.profiles[0], triggerPaths: [path] }] })
    await expect(call('save_config', { payload: withTrigger('~/dev/*/api'), secrets: {} })).rejects.toBe(
      'Trigger path "~/dev/*/api" has a wildcard EnvRouter can\'t match. Only a trailing /* is supported.',
    )
    await expect(call('save_config', { payload: withTrigger('dev'), secrets: {} })).rejects.toBe(
      'Trigger path "dev" must be absolute or start with ~.',
    )
    const twin = { ...config.profiles[1], id: config.profiles[0].id, triggerPaths: [] }
    await expect(call('save_config', { payload: { ...config, profiles: [config.profiles[0], twin] }, secrets: {} })).rejects.toBe(
      `Profiles "${config.profiles[0].name}" and "${twin.name}" both have the id "${twin.id}". Give each its own id in config.json.`,
    )
    await expect(call('save_config', { payload: { ...config, profiles: [{ ...twin, id: '' }] }, secrets: {} })).rejects.toBe(
      `Profile "${twin.name}" has no id. Give it one in config.json.`,
    )
    await expect(call('save_config', { payload: config, secrets: { ABCD: 'x' } })).rejects.toBe(
      "A new secret isn't used by any server. Save the server again.",
    )
  })

  it('refuses a save with a base after config.json is deleted, and writes one without', async () => {
    const call = await boot('?scenario=mcp')
    const base = await call<ConfigState>('get_config')
    window.__mockDeleteConfig()
    const payload = { ...base, profiles: base.profiles.slice(1) }
    expect(await call('save_config', { payload, secrets: {}, base })).toEqual({ status: 'missing' })
    expect(await call('save_config', { payload, secrets: {}, base: null })).toMatchObject({ status: 'saved' })
    expect((await call<ConfigState>('get_config')).profiles).toHaveLength(base.profiles.length - 1)
  })

  it('reads an empty config after config.json is deleted', async () => {
    const call = await boot('?scenario=mcp')
    window.__mockDeleteConfig()
    expect(await call<ConfigState>('get_config')).toMatchObject({ profiles: [], mcpServers: {} })
  })

  it("says up front that there's no store, except on macOS, where nothing can tell without asking the Keychain", async () => {
    const problem = async (search: string) => (await (await boot(search))<SetupStatus>('get_setup_status')).secretStoreProblem
    expect(await problem('?scenario=mcp&store=off&platform=linux')).toMatch(/^there's no Secret Service/)
    expect(await problem('?scenario=mcp&store=off')).toBeNull()
    expect(await problem('?scenario=mcp&platform=linux')).toBeNull()
  })

  it('fails to store a secret when there is no store', async () => {
    const call = await boot('?scenario=mcp&store=off&platform=linux')
    const config = await call<ConfigState>('get_config')
    await expect(call('save_config', { payload: config, secrets: { '7F3A09C2': 'ghp_new' } })).rejects.toMatch(
      /^Couldn't save the secret: there's no Secret Service.*Nothing was saved\.$/,
    )
  })

  it("saves a config that drops a secret even when the store can't remove it, and warns instead of failing", async () => {
    const call = await boot('?scenario=mcp&store=off&platform=linux')
    const config = await call<ConfigState>('get_config')
    const { github: _, ...rest } = config.mcpServers
    const profiles = config.profiles.map((p) => {
      const { github: __, ...uses } = p.mcpServers
      return { ...p, mcpServers: uses }
    })
    const outcome = await call<SaveOutcome>('save_config', { payload: { ...config, mcpServers: rest, profiles }, secrets: {} })
    expect(outcome).toMatchObject({
      status: 'saved',
      warning: expect.stringMatching(/^Couldn't remove a secret no server uses any more: there's no Secret Service.*\.$/),
    })
    expect(Object.keys((await call<ConfigState>('get_config')).mcpServers)).not.toContain('github')
  })
})

describe('quitting', () => {
  it('quits at once with nothing unsaved, and asks once with unsaved edits, as quit::may_quit does', async () => {
    const call = await boot('?scenario=populated')
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    await window.__mockQuit()
    expect(log).toHaveBeenCalledWith('quit')
    log.mockClear()

    await call('set_unsaved_edits', { unsaved: true })
    await window.__mockQuit()
    expect(log).not.toHaveBeenCalled()
    // Kept editing: the window says so, and the next quit asks again.
    await call('set_unsaved_edits', { unsaved: true })
    await window.__mockQuit()
    expect(log).not.toHaveBeenCalled()
    // Unanswered, the second request quits.
    await window.__mockQuit()
    expect(log).toHaveBeenCalledWith('quit')
  })
})

describe('checks and files', () => {
  it('times out as the shell does', async () => {
    const call = await boot('?scenario=populated&check=timeout')
    await expect(call('check_folder', { shell: 'zsh', folder: '/Users/sam/dev', tool: 'claude' })).rejects.toBe(
      '"/bin/zsh" didn\'t finish within 15 seconds. Something in your shell startup files may be waiting for input.',
    )
  })

  it('opens only files in the home folder', async () => {
    const call = await boot('')
    await expect(call('open_in_editor', { path: '/etc/zshrc' })).rejects.toBe("/etc/zshrc isn't a file in your home folder.")
  })

  it("shows a profile's MCP folder only once it has servers, as locate does", async () => {
    const call = await boot('?scenario=mcp')
    const { profiles } = await call<ConfigState>('get_config')
    const [withServers, without] = [
      profiles.find((p) => Object.keys(p.mcpServers).length > 0),
      profiles.find((p) => Object.keys(p.mcpServers).length === 0),
    ]
    expect(await call('reveal_place', { place: { kind: 'mcpFiles', profileId: withServers?.id } })).toBeNull()
    await expect(call('reveal_place', { place: { kind: 'mcpFiles', profileId: without?.id } })).rejects.toBe(
      'This profile has no MCP files yet. EnvRouter writes them when the profile is saved with an MCP server.',
    )
  })

  it('starts over only from a config.json that cannot be parsed, as reset_unreadable_config does', async () => {
    const readable = await boot('?scenario=populated')
    await expect(readable('reset_unreadable_config')).rejects.toBe('config.json can be read now, so nothing was changed.')

    const broken = await boot('?scenario=broken')
    await expect(broken('get_config')).rejects.toMatchObject({ kind: 'parse', message: expect.stringMatching(/is not valid JSON/) })
    expect(await broken('reset_unreadable_config')).toBe('/Users/sam/.envrouter/config.json.bak')
    expect((await broken<ConfigState>('get_config')).profiles).toEqual([])
  })

  it('lists one row per editor per hook, with remote servers in WSL', async () => {
    const call = await boot('?platform=wsl')
    expect(await call('get_editor_status', { hooks: {} })).toEqual([])
    const rows = await call<EditorStatus[]>('get_editor_status', {
      hooks: { claude: { setting: 'claudeCode.claudeProcessWrapper', extension: 'anthropic.claude-code' } },
    })
    expect(rows).toHaveLength(9)
    expect(rows.find((r) => r.editor === 'remoteCode')).toMatchObject({
      label: 'VS Code Server',
      available: true,
      extensionInstalled: true,
      settingsFile: '/home/sam/.vscode-server/data/Machine/settings.json',
    })
  })

  it("only takes the backend's editor names, so a typo in an id does not compile", () => {
    // @ts-expect-error `remoteCod` is not one of `editors::Editor`'s names
    const typo: Editor = 'remoteCod'
    expect(typo).toBe('remoteCod')
  })
})

describe('saving', () => {
  it('refuses a save from a config changed since, and answers with the file', async () => {
    const call = await boot('?scenario=populated')
    const base = await call<ConfigState>('get_config')
    const elsewhere = { ...base, profiles: base.profiles.slice(1) }
    window.__mockEditConfig(() => elsewhere)
    const edit = { ...base, profiles: base.profiles.map((p, i) => (i === 0 ? { ...p, name: 'Renamed' } : p)) }
    expect(await call('save_config', { payload: edit, secrets: {}, base })).toEqual({ status: 'changed', config: elsewhere })
    expect(await call('get_config')).toEqual(elsewhere)

    const saved = await call<{ status: string; config: ConfigState }>('save_config', { payload: elsewhere, secrets: {}, base: elsewhere })
    expect(saved.status).toBe('saved')
    expect(saved.config).toEqual(await call('get_config'))
  })
})

describe('npm', () => {
  it('looks up only npx packages, as `npm::dist_tags` does', async () => {
    const call = await boot('?scenario=mcp')
    expect(await call('npm_dist_tags', { command: 'npx', package: '@acme/mcp' })).toMatchObject({ latest: '1.4.0' })
    await expect(call('npm_dist_tags', { command: 'npx', package: 'acme-nope' })).rejects.toBe('npm has no package named acme-nope.')
    await expect(call('npm_dist_tags', { command: 'uvx', package: 'git' })).rejects.toBe("uvx isn't npx, so there's no npm package to look up.")
  })
})

describe('uninstall', () => {
  const GUARD = 'EnvRouter is uninstalled. Quit it to finish.'
  const zsh = async (call: Awaited<ReturnType<typeof boot>>) => (await call<SetupStatus>('get_setup_status')).shells.find((s) => s.shell === 'zsh')

  it('changes nothing when it only plans', async () => {
    const call = await boot('?scenario=populated')
    const plan = await call<UninstallReport>('uninstall', { dryRun: true })
    expect(plan).toMatchObject({
      dryRun: true,
      shellFiles: ['/Users/sam/.zshrc'],
      secrets: { status: 'wouldDelete' },
      folder: 'wouldDelete',
      problems: [],
    })
    expect((await zsh(call))?.installed).toBe(true)
    expect((await call<ConfigState>('get_config')).profiles).not.toHaveLength(0)
  })

  it('stops at an editor it cannot read before the store and the folder, as uninstall::run does, and finishes once that is fixed', async () => {
    const call = await boot('?scenario=populated&fail=uninstall')
    const stopped = await call<UninstallReport>('uninstall', { dryRun: false })
    expect(stopped.problems).toEqual([
      "`/Users/sam/Library/Application Support/Code/User/settings.json` couldn't be read, and it names EnvRouter's shim in `claudeCode.claudeProcessWrapper`. Fix it in VS Code, or delete that setting, then uninstall again.",
      "`/Users/sam/Library/Application Support/Cursor/User/settings.json` couldn't be read, and it names EnvRouter's shim in `claudeCode.claudeProcessWrapper`. Fix it in Cursor, or delete that setting, then uninstall again.",
    ])
    expect(stopped).toMatchObject({ secrets: { status: 'notReached' }, folder: 'notReached' })
    // Every shell was still attempted, and nothing after the stop was touched.
    expect((await zsh(call))?.installed).toBe(false)
    expect((await call<ConfigState>('get_config')).profiles).not.toHaveLength(0)

    window.__mockFix()
    expect(await call<UninstallReport>('uninstall', { dryRun: false })).toMatchObject({ problems: [], folder: 'deleted' })
  })

  it('refuses every command that reaches the home folder once finished, with the unreachable store noted, as home() does', async () => {
    const call = await boot('?scenario=mcp&store=off&platform=linux')
    const done = await call<UninstallReport>('uninstall', { dryRun: false })
    expect(done).toMatchObject({ problems: [], secrets: { status: 'unreachable' }, folder: 'deleted' })
    expect(done.removeNext).toEqual([{ what: 'app', command: 'sudo apt remove env-router' }])

    await expect(call('get_config')).rejects.toEqual({ kind: 'other', message: GUARD, path: null })
    await expect(call('get_setup_status')).rejects.toBe(GUARD)
    await expect(call('save_config', { payload: {}, secrets: {} })).rejects.toBe(GUARD)
    // The window can still ask to quit, and read pasted text.
    await call('set_unsaved_edits', { unsaved: false })
    await call('quit_app')
  })
})
