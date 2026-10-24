import { describe, expect, it } from 'vitest'
import type { CheckState } from '../components/Docket'
import { accentsOf, type Blocked, bannerHasPrimary, docketHasAction, type Health, healthOf } from './health'
import type { ConfigState, FolderCheck, Profile, SetupStatus, Shell, ShellStatus } from './types'

const HOME = '/Users/sam'
const profile: Profile = { id: 'p1', name: 'Work', triggerPaths: ['~/work'], tools: {}, mcpServers: {} }
const withProfiles: ConfigState = { version: 4, agents: {}, profiles: [profile], mcpServers: {} }
const noProfiles: ConfigState = { ...withProfiles, profiles: [] }

const shell = (name: Shell, installed: boolean, extra: Partial<ShellStatus> = {}): ShellStatus => ({
  shell: name,
  available: true,
  isDefault: false,
  installed,
  startupFiles: [`${HOME}/.${name}rc`],
  ...extra,
})
const setupOf = (shells: ShellStatus[], shimInstalled = true): SetupStatus => ({
  platform: 'macos',
  secretStore: 'Keychain',
  shimInstalled,
  shimsDir: `${HOME}/.envrouter/shims`,
  shells,
})

const zshOn = shell('zsh', true, { isDefault: true })
const zshOff = shell('zsh', false, { isDefault: true })
const bashOn = shell('bash', true)
const bashOff = shell('bash', false)

interface Inputs {
  config: ConfigState | null
  setup: SetupStatus | null
  loadError: string | null
  setupError: string | null
  actionError: string | null
  home: string
  checkedOnce: boolean
  blocked: Blocked | null
  openError: string | null
}
// A window that has loaded everything and has nothing to report, then one change per test.
const health = (changes: Partial<Inputs> = {}): Health => {
  const i: Inputs = {
    config: withProfiles,
    setup: setupOf([zshOn]),
    loadError: null,
    setupError: null,
    actionError: null,
    home: HOME,
    checkedOnce: true,
    blocked: null,
    openError: null,
    ...changes,
  }
  return healthOf(i.config, i.setup, i.loadError, i.setupError, i.actionError, i.home, i.checkedOnce, i.blocked, i.openError)
}

const blocked: Blocked = { shell: 'zsh', tool: 'claude', headline: 'A zsh alias named claude runs first', folder: `${HOME}/work` }

describe('healthOf', () => {
  it('is loading until both the config and the setup status have arrived', () => {
    expect(health({ config: null })).toEqual({ kind: 'loading' })
    expect(health({ setup: null })).toEqual({ kind: 'loading' })
  })

  it('is ok when the login shell is on and the shim is current', () => {
    expect(health()).toEqual({ kind: 'ok', on: ['zsh'] })
  })

  it('reports an unreadable config.json, which outranks everything else', () => {
    const everything = { setupError: 's', actionError: 'a', blocked, checkedOnce: false, config: null, setup: null }
    expect(health({ loadError: 'bad json', ...everything })).toEqual({ kind: 'unloaded', message: 'bad json', canOpen: true, openError: undefined })
  })

  it('offers to open an unreadable config.json only when the home folder is known, and carries a failure to open it', () => {
    expect(health({ loadError: 'bad json', home: '' })).toMatchObject({ canOpen: false })
    expect(health({ loadError: 'bad json', openError: 'no editor' })).toMatchObject({ canOpen: true, openError: 'no editor' })
  })

  it('reports a failed status refresh as an error that can not be dismissed, over a failed action', () => {
    expect(health({ setupError: 'no status', actionError: 'a' })).toEqual({ kind: 'error', message: 'no status', dismissible: false })
  })

  it('reports a failed action as an error that can be dismissed, even before the data has arrived', () => {
    expect(health({ actionError: 'could not turn on zsh', config: null })).toEqual({
      kind: 'error',
      message: 'could not turn on zsh',
      dismissible: true,
    })
  })

  describe('first run', () => {
    it('step 1: create a profile, naming the login shell', () => {
      const setup = setupOf([bashOff, zshOff])
      expect(health({ config: noProfiles, setup, checkedOnce: false })).toEqual({ kind: 'setup', step: 1, shell: zshOff })
    })

    it('names the first available shell when none is the login shell', () => {
      const setup = setupOf([shell('zsh', false, { available: false }), bashOff, shell('fish', false)])
      expect(health({ config: noProfiles, setup })).toEqual({ kind: 'setup', step: 1, shell: bashOff })
    })

    it('step 2: turn the shell on, once there is a profile and no shell is on', () => {
      expect(health({ setup: setupOf([zshOff, bashOff]), checkedOnce: false })).toEqual({ kind: 'setup', step: 2, shell: zshOff })
    })

    it('step 3: check a folder, once any shell is on and nothing has been checked', () => {
      expect(health({ checkedOnce: false })).toEqual({ kind: 'setup', step: 3, shell: zshOn })
      expect(health({ checkedOnce: false, setup: setupOf([zshOff, bashOn]) })).toEqual({ kind: 'setup', step: 3, shell: zshOff })
    })
  })

  it('says routing is off when a window that has checked before finds every shell off', () => {
    expect(health({ setup: setupOf([zshOff, bashOff]) })).toEqual({ kind: 'off', shell: zshOff })
  })

  it('does not count a shell that is not installed on the machine as on', () => {
    expect(health({ setup: setupOf([zshOff, shell('fish', true, { available: false })]) })).toEqual({ kind: 'off', shell: zshOff })
  })

  it('says the shim is missing once a shell is on, over step 3 and a blocked shell', () => {
    expect(health({ setup: setupOf([zshOn], false), checkedOnce: false, blocked })).toEqual({ kind: 'shim' })
  })

  it('asks for step 2 before the shim, while no shell is on', () => {
    expect(health({ setup: setupOf([zshOff], false), checkedOnce: false })).toEqual({ kind: 'setup', step: 2, shell: zshOff })
  })

  it('says routing is partly off when the login shell is off and another is on', () => {
    expect(health({ setup: setupOf([zshOff, bashOn]) })).toEqual({ kind: 'partial', on: ['bash'], shell: zshOff })
  })

  it('reports a shell a check found blocked over step 3, ok and partial', () => {
    expect(health({ blocked, checkedOnce: false })).toEqual({ kind: 'blocked', ...blocked })
    const bash: Blocked = { ...blocked, shell: 'bash' }
    expect(health({ setup: setupOf([zshOff, bashOn]), blocked: bash })).toEqual({ kind: 'blocked', ...bash })
  })

  it('drops a blocked shell once that shell is off', () => {
    expect(health({ setup: setupOf([zshOff, bashOn]), blocked })).toEqual({ kind: 'partial', on: ['bash'], shell: zshOff })
  })
})

const check = (result: FolderCheck | null, extra: Partial<CheckState> = {}): CheckState => ({
  key: 1,
  folder: `${HOME}/work`,
  shell: 'zsh',
  tool: 'claude',
  trigger: null,
  preview: null,
  result,
  error: null,
  ...extra,
})
const shimFailed: FolderCheck = { status: 'shimFailed', message: 'x' }

// Which result offers which action is verdict.ts's, tested there; this only reads it.
describe('docketHasAction', () => {
  const setup = setupOf([zshOn])

  it('is false without a result, a setup status, or the checked shell in it', () => {
    expect(docketHasAction(null, setup, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check(null, { error: 'boom' }), setup, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check(shimFailed), null, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check(shimFailed, { shell: 'fish' }), setup, ['claude'], HOME)).toBe(false)
  })

  it("follows whether the result's verdict offers an action", () => {
    expect(docketHasAction(check(shimFailed), setup, ['claude'], HOME)).toBe(true)
    expect(docketHasAction(check({ status: 'notInstalled' }), setup, ['claude'], HOME)).toBe(false)
  })

  it('tells the verdict whether a profile sets the checked tool', () => {
    const shadowed = check({ status: 'shadowedOnPath', path: '/usr/bin/claude', byPromptHook: false })
    expect(docketHasAction(shadowed, setup, ['claude'], HOME)).toBe(true)
    expect(docketHasAction(shadowed, setup, ['copilot'], HOME)).toBe(false)
  })
})

describe('the accent', () => {
  const zsh = zshOff
  // One of every state the banner can be in; the Record keeps this list whole when a kind is added.
  const states: Record<Health['kind'], Health[]> = {
    loading: [{ kind: 'loading' }],
    error: [
      { kind: 'error', message: 'm', dismissible: true },
      { kind: 'error', message: 'm', dismissible: false },
    ],
    unloaded: [
      { kind: 'unloaded', message: 'm', canOpen: true },
      { kind: 'unloaded', message: 'm', canOpen: false },
    ],
    setup: [
      { kind: 'setup', step: 1, shell: zsh },
      { kind: 'setup', step: 2, shell: zsh },
      { kind: 'setup', step: 3, shell: zsh },
      { kind: 'setup', step: 1, shell: undefined },
    ],
    ok: [{ kind: 'ok', on: ['zsh'] }],
    off: [{ kind: 'off', shell: zsh }],
    partial: [{ kind: 'partial', on: ['bash'], shell: zsh }],
    shim: [{ kind: 'shim' }],
    blocked: [{ kind: 'blocked', ...blocked }],
  }
  const all = Object.values(states).flat()
  type View = 'profiles' | 'servers'

  it('gives the banner the accent only where its action is the fix', () => {
    // Not an unreadable config.json with no home to open it from, Turn On beside a working shell, or Check Again.
    expect(all.filter(bannerHasPrimary).map((h) => h.kind)).toEqual(['unloaded', 'setup', 'setup', 'setup', 'setup', 'off', 'shim'])
  })

  // The accent-filled buttons the three show, as App passes the arbitration to them. Welcome's own button (shown in place of
  // the banner on step 1) and the editors' Save are outside this module.
  const filled = (h: Health, view: View, inspecting: boolean, docketAction: boolean) => {
    const a = accentsOf(h, view, inspecting, docketAction)
    return {
      banner: bannerHasPrimary(h) && !a.quiet,
      // The docket renders on Profiles only, and only a result with an action has a button to fill.
      docket: view === 'profiles' && a.docket && docketAction,
      titlebar: a.titlebar,
    }
  }
  const everyCase = (run: (h: Health, view: View, inspecting: boolean, docketAction: boolean) => void) => {
    for (const h of all)
      for (const view of ['profiles', 'servers'] as const) for (const i of [false, true]) for (const d of [false, true]) run(h, view, i, d)
  }

  it('fills at most one of the banner, the docket and Check Folder… in any state', () => {
    everyCase((h, view, inspecting, docketAction) => {
      const shown = Object.values(filled(h, view, inspecting, docketAction)).filter(Boolean).length
      expect(shown, JSON.stringify({ h, view, inspecting, docketAction })).toBeLessThanOrEqual(1)
    })
  })

  it('fills exactly one of them on Profiles when nothing else is open', () => {
    everyCase((h, view, inspecting, docketAction) => {
      if (view !== 'profiles' || inspecting) return
      expect(Object.values(filled(h, view, inspecting, docketAction)).filter(Boolean), JSON.stringify({ h, docketAction })).toHaveLength(1)
    })
  })

  it('leaves the docket and Check Folder… to Save while the inspector is open, and all three to Save on Servers', () => {
    everyCase((h, view, inspecting, docketAction) => {
      const f = filled(h, view, inspecting, docketAction)
      if (inspecting) expect(f.docket || f.titlebar).toBe(false)
      if (view === 'servers') expect(f).toEqual({ banner: false, docket: false, titlebar: false })
    })
  })

  it('ranks the banner over the check result, and the check result over Check Folder…', () => {
    const who = (h: Health, docketAction: boolean) => Object.entries(filled(h, 'profiles', false, docketAction)).find(([, on]) => on)?.[0]
    expect(who({ kind: 'shim' }, true)).toBe('banner')
    expect(who({ kind: 'ok', on: ['zsh'] }, true)).toBe('docket')
    expect(who({ kind: 'ok', on: ['zsh'] }, false)).toBe('titlebar')
    // Check Again is a push button because the fix lives in the check result.
    expect(who({ kind: 'blocked', ...blocked }, false)).toBe('titlebar')
  })
})
