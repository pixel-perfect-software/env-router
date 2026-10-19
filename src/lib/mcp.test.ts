import { describe, expect, it } from 'vitest'
import { draftOf, newSecretId, serverOf, withoutServer, withServer } from './mcp'
import type { ConfigState, McpServer } from './types'

const github: McpServer = { transport: 'stdio', command: 'npx', args: ['-y', 'gh'], env: { GITHUB_TOKEN: { secret: 'AA11' } } }

const config = (): ConfigState => ({
  version: 2,
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
