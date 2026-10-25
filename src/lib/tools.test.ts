import { describe, expect, it } from 'vitest'
import { ideHooks, toolByCommand, withAgents } from './tools'
import type { AgentDef, ConfigState } from './types'

const configWith = (agents: Record<string, AgentDef>): ConfigState => ({ version: 5, agents, profiles: [], mcpServers: {} })

describe('withAgents', () => {
  const stale: AgentDef = { mcp: null, mcpFiles: null, ide: null }
  const byHand: AgentDef = { mcp: null, mcpFiles: null, ide: { setting: 'my.wrapper', extension: 'me.my-agent' } }

  it('rewrites the registry agents in a copy, and keeps one that was added by hand', () => {
    const config = configWith({ claude: stale, 'my-agent': byHand })
    const saved = withAgents(config)
    expect(saved.agents.claude.mcp).toEqual(toolByCommand('claude')?.mcp)
    expect(saved.agents['my-agent']).toBe(byHand)
    expect(config.agents.claude).toBe(stale)
  })

  it("keeps the registry's editor note, which is the window's alone, out of what Rust is sent and what is saved", () => {
    expect(toolByCommand('claude')?.ide?.note).toBeTruthy()
    expect(withAgents(configWith({})).agents.claude.ide).toEqual({ setting: 'claudeCode.claudeProcessWrapper', extension: 'anthropic.claude-code' })
    expect(ideHooks().claude).toEqual(withAgents(configWith({})).agents.claude.ide)
  })

  it('writes what an agent lacks as null, so the JSON Rust reads has every field', () => {
    const { agents } = withAgents(configWith({}))
    expect(JSON.parse(JSON.stringify(agents))).toStrictEqual(agents)
  })
})
