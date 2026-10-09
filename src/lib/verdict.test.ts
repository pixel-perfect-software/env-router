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
})
