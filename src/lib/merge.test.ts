import { describe, expect, it } from 'vitest'
import { mergeConfig } from './merge'
import type { ConfigState, McpServer, Profile } from './types'

const profile = (id: string, name: string, triggerPaths: string[] = []): Profile => ({ id, name, triggerPaths, tools: {}, mcpServers: {} })
const npx = (pkg: string): McpServer => ({ transport: 'stdio', command: 'npx', args: ['-y', pkg], env: {} })

const base: ConfigState = {
  version: 4,
  agents: {},
  profiles: [profile('p1', 'Work', ['~/work']), profile('p2', 'Personal', ['~/dev'])],
  mcpServers: { context7: npx('@upstash/context7-mcp'), github: npx('gh') },
}

describe('mergeConfig', () => {
  it("keeps the other side's changes to other profiles and servers", () => {
    const mine = { ...base, profiles: [profile('p1', 'Work', ['~/work', '~/clients']), base.profiles[1]] }
    const theirs = {
      ...base,
      profiles: [...base.profiles, profile('p3', 'Scratch')],
      mcpServers: { ...base.mcpServers, context7: npx('@upstash/context7-mcp@1.4.0') },
    }
    const { config, conflicts } = mergeConfig(base, mine, theirs)
    expect(conflicts).toEqual([])
    expect(config.profiles.map((p) => p.id)).toEqual(['p1', 'p2', 'p3'])
    expect(config.profiles[0].triggerPaths).toEqual(['~/work', '~/clients'])
    expect(config.mcpServers.context7).toEqual(npx('@upstash/context7-mcp@1.4.0'))
  })

  it('applies deletions and additions from both sides', () => {
    const { github: _, ...withoutGithub } = base.mcpServers
    const mine = { ...base, profiles: [base.profiles[0]], mcpServers: { ...base.mcpServers, linear: npx('linear') } }
    const theirs = { ...base, mcpServers: withoutGithub }
    const { config, conflicts } = mergeConfig(base, mine, theirs)
    expect(conflicts).toEqual([])
    expect(config.profiles.map((p) => p.id)).toEqual(['p1'])
    expect(Object.keys(config.mcpServers).sort()).toEqual(['context7', 'linear'])
  })

  it('names what both sides changed differently, keeping the window’s version', () => {
    const mine = {
      ...base,
      profiles: [profile('p1', 'Work', ['~/w']), base.profiles[1]],
      mcpServers: { ...base.mcpServers, github: npx('gh@2.0.0') },
    }
    const { github: _, ...withoutGithub } = base.mcpServers
    const theirs = { ...base, profiles: [profile('p1', 'Job', ['~/work']), base.profiles[1]], mcpServers: withoutGithub }
    const { config, conflicts } = mergeConfig(base, mine, theirs)
    expect(conflicts).toEqual(['“Work”', 'the server “github”'])
    expect(config.profiles[0]).toEqual(mine.profiles[0])
    expect(config.mcpServers.github).toEqual(npx('gh@2.0.0'))
  })

  it('is no conflict when both sides made the same change', () => {
    const changed = { ...base, profiles: [profile('p1', 'Job', ['~/work']), base.profiles[1]] }
    expect(mergeConfig(base, changed, structuredClone(changed)).conflicts).toEqual([])
  })
})
