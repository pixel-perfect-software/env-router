import { describe, expect, it } from 'vitest'
import {
  draftFromCatalog,
  draftOf,
  freeName,
  isPending,
  newSecretId,
  sameEndpoint,
  serverOf,
  withoutServer,
  withSecretsLocked,
  withServer,
  withUsedBy,
} from './mcp'
import type { ConfigState, McpServer } from './types'

const github: McpServer = { transport: 'stdio', command: 'npx', args: ['-y', 'gh'], env: { GITHUB_TOKEN: { secret: 'AA11' } } }

const config = (): ConfigState => ({
  version: 3,
  agents: {},
  mcpServers: { github },
  profiles: [
    { id: 'w', name: 'Work', triggerPaths: [], tools: {}, mcpServers: { github: { disabledTools: ['fork'] } } },
    { id: 'h', name: 'Home', triggerPaths: [], tools: {}, mcpServers: {} },
  ],
})

describe('serverOf', () => {
  it('round-trips a stored server without touching its secrets', () => {
    expect(serverOf(draftOf('github', github))).toEqual({ server: github, secrets: {} })
  })

  it('sets typed secrets aside for the Keychain and keeps only their ids', () => {
    const draft = { ...draftOf('github', github), env: [{ key: 'GITHUB_TOKEN', value: { secret: 'BB22', value: 'ghp_x' } }] }
    expect(serverOf(draft)).toEqual({
      server: { ...github, env: { GITHUB_TOKEN: { secret: 'BB22' } } },
      secrets: { BB22: 'ghp_x' },
    })
  })

  it('asks for a value before saving an empty secret, and skips blank rows', () => {
    const empty = { ...draftOf('github', github), env: [{ key: 'GITHUB_TOKEN', value: { secret: 'BB22', value: '' } }] }
    expect(serverOf(empty)).toEqual({ error: 'Enter a value for GITHUB_TOKEN, or remove it.' })
    const blank = { ...draftOf('github', github), args: ['-y', ''], env: [{ key: '', value: '' }] }
    expect(serverOf(blank)).toEqual({ server: { ...github, args: ['-y'], env: {} }, secrets: {} })
  })

  it('refuses an empty value under a credential-looking name, even unlocked', () => {
    const unlocked = { ...draftOf('github', github), env: [{ key: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: '' }] }
    expect(serverOf(unlocked)).toEqual({ error: 'Enter a value for GITHUB_PERSONAL_ACCESS_TOKEN, or remove it.' })
    const header = {
      ...draftOf('relic', { transport: 'http', url: 'https://mcp.example.com/mcp', headers: {} }),
      headers: [{ key: 'Api-Key', value: ' ' }],
    }
    expect(serverOf(header)).toEqual({ error: 'Enter a value for Api-Key, or remove it.' })
    // Other names may be empty on purpose.
    const plain = { ...draftOf('github', github), env: [{ key: 'GITHUB_HOST', value: '' }] }
    expect(serverOf(plain)).toEqual({ server: { ...github, env: { GITHUB_HOST: '' } }, secrets: {} })
  })

  it('names what to fix', () => {
    expect(serverOf({ ...draftOf('x', undefined), command: ' ' })).toEqual({ error: 'Enter the command that starts the server.' })
    expect(serverOf({ ...draftOf('x', undefined), transport: 'http', url: 'mcp.example.com' })).toEqual({
      error: 'Enter a URL starting with https:// or http://.',
    })
    const twice = {
      ...draftOf('x', undefined),
      command: 'npx',
      env: [
        { key: 'A', value: '1' },
        { key: 'A', value: '2' },
      ],
    }
    expect(serverOf(twice)).toEqual({ error: 'A is set twice.' })
  })
})

describe('library edits', () => {
  it('renames a server in every profile that uses it, keeping its turned-off tools', () => {
    const before = config()
    const next = withServer(before, 'github', 'gh', github)
    expect(Object.keys(next.mcpServers)).toEqual(['gh'])
    expect(next.profiles[0].mcpServers).toEqual({ gh: { disabledTools: ['fork'] } })
    // A profile that doesn't use it is passed through as is.
    expect(next.profiles[1]).toBe(before.profiles[1])
  })

  it('removes a server from the library and every profile', () => {
    const next = withoutServer(config(), 'github')
    expect(next.mcpServers).toEqual({})
    expect(next.profiles.map((p) => p.mcpServers)).toEqual([{}, {}])
  })

  it('makes ids the backend accepts', () => {
    expect(newSecretId()).toMatch(/^[0-9A-F]{16}$/)
  })
})

describe('imports and the catalog', () => {
  it('moves credential-looking values to the Keychain, but not references or ordinary values', () => {
    const server: McpServer = {
      transport: 'stdio',
      command: 'npx',
      args: [],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: an agent-side ${VAR} reference, kept as typed
      env: { GITHUB_TOKEN: 'ghp_x', API_KEY: '${API_KEY}', LOG_LEVEL: 'debug' },
    }
    const locked = withSecretsLocked(draftOf('gh', server))
    expect(locked.env.map((row) => [row.key, isPending(row.value)])).toEqual([
      ['GITHUB_TOKEN', true],
      ['API_KEY', false],
      ['LOG_LEVEL', false],
    ])
    const built = serverOf(locked)
    expect('secrets' in built && Object.values(built.secrets)).toEqual(['ghp_x'])
  })

  it('leaves catalog secrets empty with a hint, so saving asks for them', () => {
    const draft = draftFromCatalog(
      'github',
      { transport: 'http', url: 'https://x/mcp', headers: { Authorization: '' } },
      { Authorization: 'Bearer …' },
    )
    expect(draft.headers[0]).toMatchObject({ key: 'Authorization', hint: 'Bearer …' })
    expect(serverOf(draft)).toEqual({ error: 'Enter a value for Authorization, or remove it.' })
  })

  it('finds a free name', () => {
    expect(freeName('gh', new Set(['x']))).toBe('gh')
    expect(freeName('gh', new Set(['gh', 'gh-2']))).toBe('gh-3')
  })
})

describe('sameEndpoint and withUsedBy', () => {
  it('matches servers by what they reach, not their names', () => {
    const remote: McpServer = { transport: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: {} }
    expect(sameEndpoint(github, remote)).toBe(false)
    expect(sameEndpoint(remote, { ...remote, url: 'https://api.githubcopilot.com/mcp', headers: { A: 'b' } })).toBe(true)
    expect(sameEndpoint(github, { ...github, env: {} })).toBe(true)
  })

  it('sets exactly the profiles that load a server, keeping their turned-off tools', () => {
    const next = withUsedBy(config(), 'github', ['w', 'h'])
    expect(next.profiles.map((p) => p.mcpServers.github)).toEqual([{ disabledTools: ['fork'] }, { disabledTools: [] }])
    expect(withUsedBy(next, 'github', []).profiles.every((p) => !p.mcpServers.github)).toBe(true)
  })
})
