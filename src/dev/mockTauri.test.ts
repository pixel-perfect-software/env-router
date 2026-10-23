// The browser mock must answer as the real backend does, or a UI review in the browser misleads.
// Each test boots the mock for one URL and calls it through Tauri's own `invoke`.

import { invoke } from '@tauri-apps/api/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConfigState, EditorStatus, ImportCandidate, McpServer, Pasted, ToolInfo } from '../lib/types'

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
    expect(saved.version).toBe(3)
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

  it('fails to store a secret when there is no store', async () => {
    const call = await boot('?scenario=mcp&store=off&platform=linux')
    const config = await call<ConfigState>('get_config')
    await expect(call('save_config', { payload: config, secrets: { '7F3A09C2': 'ghp_new' } })).rejects.toMatch(
      /^Couldn't save the secret: there's no Secret Service.*Nothing was saved\.$/,
    )
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

  it('lists one row per editor per hook, with remote servers in WSL', async () => {
    const call = await boot('?platform=wsl')
    expect(await call('get_editor_status', { hooks: {} })).toEqual([])
    const rows = await call<EditorStatus[]>('get_editor_status', {
      hooks: { claude: { setting: 'claudeCode.claudeProcessWrapper', extension: 'anthropic.claude-code' } },
    })
    expect(rows).toHaveLength(9)
    expect(rows.find((r) => r.editor === 'remoteCode')).toMatchObject({
      available: true,
      extensionInstalled: true,
      settingsFile: '/home/sam/.vscode-server/data/Machine/settings.json',
    })
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
