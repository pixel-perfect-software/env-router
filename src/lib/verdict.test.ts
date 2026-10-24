import { describe, expect, it } from 'vitest'
import type { FolderCheck, ShellStatus } from './types'
import { verdictOf } from './verdict'

const HOME = '/Users/sam'
const SHIMS = `${HOME}/.envrouter/shims`
const zsh = (installed: boolean): ShellStatus => ({ shell: 'zsh', available: true, isDefault: true, installed, startupFiles: [`${HOME}/.zshrc`] })
const verdict = (check: FolderCheck, installed = true, toolRouted = true) => verdictOf(check, zsh(installed), 'claude', toolRouted, SHIMS, HOME)

describe('verdictOf', () => {
  it('says EnvRouter is off, not that PATH is wrong, when the shell has no block', () => {
    // What the backend reports for an off shell with the tool installed: the tool itself is first on PATH.
    const v = verdict({ status: 'shadowedOnPath', path: `${HOME}/.local/bin/claude`, byPromptHook: false }, false)
    expect(v.headline).toBe('EnvRouter is off in zsh')
    expect(v.action).toEqual({ kind: 'enableShell' })
    expect(v.blocksShell).toBeUndefined()
    expect(v.values).toEqual([
      { label: 'runs', value: '~/.local/bin/claude' },
      { label: 'adds a block to', value: '~/.zshrc' },
    ])
  })

  it('blames PATH order only when the block is installed', () => {
    const v = verdict({ status: 'shadowedOnPath', path: `${HOME}/.local/bin/claude`, byPromptHook: false })
    expect(v.headline).toBe('Another claude comes first on PATH')
    expect(v.note).toBe("Keep EnvRouter's block at the end of ~/.zshrc.")
    expect(v.action).toEqual({ kind: 'openFile', path: `${HOME}/.zshrc` })
    expect(v.blocksShell).toBe(true)
  })

  it('blames a prompt hook, not the block, when one reordered PATH', () => {
    const v = verdict({ status: 'shadowedOnPath', path: `${HOME}/.local/share/mise/installs/node/22/bin/claude`, byPromptHook: true })
    expect(v.headline).toBe('Another claude comes first on PATH')
    expect(v.note).toBe("A prompt hook, such as mise or direnv, moves it ahead of EnvRouter's shims before every prompt.")
    expect(v.blocksShell).toBe(true)
  })

  it('names the missing profile setting before anything about the shell', () => {
    const v = verdict({ status: 'shadowedOnPath', path: `${HOME}/.local/bin/claude`, byPromptHook: false }, false, false)
    expect(v.headline).toBe('No profile sets claude yet')
    expect(v.action).toBeUndefined()
  })

  it('offers to turn the shell on when nothing is on PATH and it is off', () => {
    expect(verdict({ status: 'notFound' }, false).action).toEqual({ kind: 'enableShell' })
    expect(verdict({ status: 'notFound' }, true, false).action).toBeUndefined()
  })

  it('offers to reinstall when a profile sets the tool but its shim link is missing', () => {
    const v = verdict({ status: 'notFound' })
    expect(v.note).toBe("EnvRouter's link for claude is missing, and claude itself isn't installed.")
    expect(v.values).toEqual([{ label: 'expected', value: '~/.envrouter/shims/claude' }])
    expect(v.action).toEqual({ kind: 'reinstall' })
  })

  it('does not offer to reinstall the shim when the tool itself is missing', () => {
    const v = verdict({ status: 'notInstalled' })
    expect(v.headline).toBe("claude isn't installed")
    expect(v.action).toBeUndefined()
    expect(v.blocksShell).toBeUndefined()
    expect(verdict({ status: 'shimFailed', message: 'boom' }).action).toEqual({ kind: 'reinstall' })
  })

  it('reports a route with what it sets, the trigger that won and the real binary', () => {
    const routed: FolderCheck = {
      status: 'routed',
      profile: 'Work',
      envVar: 'CLAUDE_CONFIG_DIR',
      value: `${HOME}/.claude-work`,
      mcp: [],
      mcpManagedBy: null,
      viaAlias: null,
      real: '/opt/bin/claude',
    }
    const v = verdictOf(routed, zsh(true), 'claude', true, SHIMS, HOME, `${HOME}/dev/work`)
    expect(v.tone).toBe('ok')
    expect(v.headline).toBe('Routed to Work')
    expect(v.values).toEqual([
      { label: 'sets', value: 'CLAUDE_CONFIG_DIR=~/.claude-work' },
      { label: 'via', value: '~/dev/work' },
      { label: 'runs', value: '/opt/bin/claude' },
    ])
  })

  it('counts MCP servers as routing, even when the profile leaves the config alone', () => {
    const base: FolderCheck = {
      status: 'routed',
      profile: 'Work',
      envVar: null,
      value: null,
      mcp: [],
      mcpManagedBy: null,
      viaAlias: null,
      real: '/opt/bin/claude',
    }
    expect(verdict(base).tone).toBe('warn')
    const v = verdict({ ...base, mcp: ['github', 'linear'] })
    expect(v.tone).toBe('ok')
    expect(v.headline).toBe('Routed to Work')
    expect(v.values).toEqual([
      { label: 'mcp', value: 'github, linear' },
      { label: 'runs', value: '/opt/bin/claude' },
    ])
  })

  it('names an alias the run goes through on its way to the shim', () => {
    const v = verdict({
      status: 'routed',
      profile: 'Work',
      envVar: 'CLAUDE_CONFIG_DIR',
      value: `${HOME}/.claude-work`,
      mcp: [],
      mcpManagedBy: null,
      viaAlias: 'claude --model opus',
      real: '/opt/bin/claude',
    })
    expect(v.tone).toBe('ok')
    expect(v.headline).toBe('Routed to Work')
    expect(v.values).toContainEqual({ label: 'alias', value: 'claude --model opus' })
  })

  it("says the profile's MCP servers are off on a machine whose admin manages them", () => {
    const managed = '/Library/Application Support/ClaudeCode/managed-mcp.json'
    const base: FolderCheck = {
      status: 'routed',
      profile: 'Work',
      envVar: null,
      value: null,
      mcp: [],
      mcpManagedBy: managed,
      viaAlias: null,
      real: '/opt/bin/claude',
    }
    const loose = verdict(base)
    expect(loose.tone).toBe('warn')
    expect(loose.note).toBe(`Work doesn't set claude, and its MCP servers are off because ${managed} manages them on this machine.`)
    const routed = verdict({ ...base, envVar: 'CLAUDE_CONFIG_DIR', value: `${HOME}/.claude-work` })
    expect(routed.tone).toBe('ok')
    expect(routed.headline).toBe('Routed to Work')
    expect(routed.note).toBe(`Work sets claude's config, but its MCP servers are off because ${managed} manages them on this machine.`)
  })

  it('says a profile owns the folder but leaves the agent alone, when it sets neither config nor servers', () => {
    const v = verdict({
      status: 'routed',
      profile: 'Work',
      envVar: null,
      value: null,
      mcp: [],
      mcpManagedBy: null,
      viaAlias: null,
      real: '/opt/bin/claude',
    })
    expect(v.tone).toBe('warn')
    expect(v.headline).toBe('Owned by Work')
    expect(v.note).toBe("Work doesn't set claude, so it uses its default config here.")
  })

  it('says no profile owns a folder, and names no trigger for it', () => {
    const unowned: FolderCheck = {
      status: 'routed',
      profile: null,
      envVar: null,
      value: null,
      mcp: [],
      mcpManagedBy: null,
      viaAlias: null,
      real: '/opt/bin/claude',
    }
    const v = verdictOf(unowned, zsh(true), 'claude', true, SHIMS, HOME, `${HOME}/dev`)
    expect(v.tone).toBe('neutral')
    expect(v.headline).toBe('No profile owns this folder')
    expect(v.note).toBe('claude uses its default config here.')
    expect(v.values).toEqual([{ label: 'runs', value: '/opt/bin/claude' }])
  })

  it('names a shell function that runs before the shim, and opens the file that defines it', () => {
    const origin = `${HOME}/.config/zsh/functions.zsh`
    const v = verdict({ status: 'shadowedByShell', kind: 'function', origin })
    expect(v.headline).toBe('A zsh function named claude runs first')
    expect(v.values).toEqual([{ label: 'defined in', value: '~/.config/zsh/functions.zsh' }])
    expect(v.action).toEqual({ kind: 'openFile', path: origin })
    expect(v.blocksShell).toBe(true)
  })

  it("sends an alias, which has no file to name, to the shell's startup file to look in", () => {
    const v = verdict({ status: 'shadowedByShell', kind: 'alias', origin: null })
    expect(v.headline).toBe('A zsh alias named claude runs first')
    expect(v.values).toEqual([{ label: 'look in', value: '~/.zshrc' }])
    expect(v.action).toEqual({ kind: 'openFile', path: `${HOME}/.zshrc` })
  })
})
