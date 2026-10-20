import { describe, expect, it } from 'vitest'
import {
  draftFromCatalog,
  draftOf,
  duplicateDraft,
  freeName,
  initSlot,
  isPending,
  newSecretId,
  plainCredentials,
  sameDefinition,
  sameEndpoint,
  serverOf,
  serverWithInit,
  suggestName,
  withInit,
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

  it('locks a token by its shape under a harmless name, and flags plain credentials it leaves alone', () => {
    const draft = withSecretsLocked(
      draftOf('n', { transport: 'stdio', command: 'npx', args: [], env: { OPENAPI_MCP_HEADERS: '{"Authorization":"Bearer ntn_abc"}', MODE: 'ro' } }),
    )
    expect(draft.env.filter((row) => isPending(row.value)).map((row) => row.key)).toEqual(['OPENAPI_MCP_HEADERS'])
    const stdio = (args: string[]) => draftOf('s', { transport: 'stdio', command: 'npx', args, env: {} })
    expect(plainCredentials(stdio(['-y', '@stripe/mcp', '--api-key=sk_live_123']))).toEqual(['argument 3'])
    expect(plainCredentials(stdio(['srv', '--token', 'abc123']))).toEqual(['argument 3'])
    expect(plainCredentials(stdio(['srv', 'postgresql://u:pw@host/db']))).toEqual(['argument 2'])
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a literal reference, as users type it
    expect(plainCredentials(stdio(['srv', '--api-key=${API_KEY}', '-e', 'GITHUB_TOKEN', '--transport', 'stdio']))).toEqual([])
    const http = (url: string) => draftOf('h', { transport: 'http', url, headers: {} })
    expect(plainCredentials(http('https://mcp.x.com/mcp?api_key=abc'))).toEqual(['the URL'])
    expect(plainCredentials(http('https://huggingface.co/mcp?login'))).toEqual([])
  })

  it('locks a connection string with a password, whatever its name', () => {
    const draft = withSecretsLocked(
      draftOf('pg', {
        transport: 'stdio',
        command: 'docker',
        args: [],
        env: {
          DATABASE_URI: 'postgresql://app:hunter2@host.docker.internal:5432/db',
          HOST_URL: 'https://example.com',
          NO_PASS: 'redis://localhost:6379',
        },
      }),
    )
    expect(draft.env.filter((row) => isPending(row.value)).map((row) => row.key)).toEqual(['DATABASE_URI'])
  })

  it('duplicates a server under a free name, its secrets kept by name but empty', () => {
    const server: McpServer = {
      transport: 'stdio',
      command: 'docker',
      args: ['run', { secret: 'A1' }],
      env: { DATABASE_URI: { secret: 'B2' }, MODE: 'ro' },
    }
    const copy = duplicateDraft('pg', server, new Set(['pg', 'pg-2']))
    expect(copy.name).toBe('pg-3')
    expect(copy.args[0]).toBe('run')
    expect(copy.env[1]).toEqual({ key: 'MODE', value: 'ro' })
    for (const value of [copy.args[1], copy.env[0].value]) {
      expect(isPending(value) && value.value).toBe('')
      expect(isPending(value) && ['A1', 'B2'].includes(value.secret)).toBe(false)
    }
    expect(copy.env[0].key).toBe('DATABASE_URI')
    expect(serverOf(copy)).toEqual({ error: 'Enter a value for DATABASE_URI, or remove it.' })
  })

  it('suggests a name for a pasted server from its host, package or image', () => {
    const stdio = (command: string, args: string[]): McpServer => ({ transport: 'stdio', command, args, env: {} })
    const http = (url: string): McpServer => ({ transport: 'http', url, headers: {} })
    expect(suggestName(http('https://mcp.linear.app/mcp'))).toBe('linear')
    expect(suggestName(http('https://api.githubcopilot.com/mcp/'))).toBe('githubcopilot')
    expect(suggestName(http('http://127.0.0.1:3845/mcp'))).toBe('server')
    expect(suggestName(stdio('npx', ['-y', '@upstash/context7-mcp@latest']))).toBe('context7')
    expect(suggestName(stdio('uvx', ['mcp-server-fetch']))).toBe('fetch')
    expect(suggestName(stdio('docker', ['run', '--init', '-i', '--rm', '-e', 'DATABASE_URI', 'crystaldba/postgres-mcp']))).toBe('postgres')
    expect(suggestName(stdio('docker', ['run', '-i', 'ghcr.io/github/github-mcp-server:1.2']))).toBe('github')
    expect(suggestName(stdio('/usr/local/bin/semgrep', ['mcp']))).toBe('semgrep')
    expect(suggestName(stdio('docker', ['run', '-i', '-v', '/data:/data', 'mcp/sqlite:latest']))).toBe('sqlite')
  })

  it('finds a free name', () => {
    expect(freeName('gh', new Set(['x']))).toBe('gh')
    expect(freeName('gh', new Set(['gh', 'gh-2']))).toBe('gh-3')
  })
})

describe('--init for containers', () => {
  it('finds where --init goes in docker and podman run commands that lack it', () => {
    expect(initSlot('docker', ['run', '-i', '--rm', 'image'])).toBe(1)
    expect(initSlot('/opt/homebrew/bin/podman', ['container', 'run', '-i', 'image'])).toBe(2)
    expect(initSlot('docker', ['run', '-i', '--init', 'image'])).toBeNull()
    expect(initSlot('docker', ['run', '--init=false', 'image'])).toBeNull()
    expect(initSlot('docker', ['exec', '-i', 'box', 'server'])).toBeNull()
    expect(initSlot('npx', ['run', 'server'])).toBeNull()
  })

  it('adds it on import, and leaves every other server as it is', () => {
    const docker: McpServer = { transport: 'stdio', command: 'docker', args: ['run', '-i', { secret: 'AB' }, 'image'], env: {} }
    expect(serverWithInit(docker)).toEqual({ ...docker, args: ['run', '--init', '-i', { secret: 'AB' }, 'image'] })
    const npx: McpServer = { transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: {} }
    expect(serverWithInit(npx)).toBe(npx)
    expect(withInit(['run', 'image'], 1)).toEqual(['run', '--init', 'image'])
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

describe('sameDefinition', () => {
  it('counts a server whose credential went to the store as the one an agent still defines in plain text', () => {
    const saved: McpServer = { transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: { TOKEN: { secret: 'AB' } } }
    const found: McpServer = { transport: 'stdio', command: 'npx', args: ['-y', 'server'], env: { TOKEN: 'ghp_x' } }
    expect(sameDefinition(saved, found)).toBe(true)
    expect(sameDefinition(saved, { ...found, args: ['-y', 'other'] })).toBe(false)
    expect(sameDefinition(saved, { ...found, env: {} })).toBe(false)
    expect(sameDefinition(undefined, found)).toBe(false)
  })

  it('compares plain values exactly, and remote servers by URL and headers', () => {
    const remote: McpServer = { transport: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: { secret: 'CD' } } }
    expect(sameDefinition(remote, { ...remote, headers: { Authorization: 'Bearer x' } })).toBe(true)
    expect(sameDefinition(remote, { ...remote, url: 'https://mcp.example.com/other', headers: { Authorization: 'Bearer x' } })).toBe(false)
    expect(sameDefinition({ ...remote, headers: { A: 'b' } }, { ...remote, headers: { A: 'c' } })).toBe(false)
  })
})
