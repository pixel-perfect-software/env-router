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
    expect(health({ config: null, setup: null })).toEqual({ kind: 'loading' })
  })

  it('is ok when the login shell is on and the shim is current', () => {
    expect(health()).toEqual({ kind: 'ok', on: ['zsh'] })
  })

  it('lists the shells that are on, in the order the backend gave them', () => {
    expect(health({ setup: setupOf([bashOn, zshOn]) })).toEqual({ kind: 'ok', on: ['bash', 'zsh'] })
  })

  it('reports an unreadable config.json, which outranks everything else', () => {
    const everything = { setupError: 's', actionError: 'a', blocked, checkedOnce: false }
    expect(health({ loadError: 'bad json', ...everything })).toEqual({ kind: 'unloaded', message: 'bad json', canOpen: true, openError: undefined })
    expect(health({ loadError: 'bad json', config: null, setup: null })).toMatchObject({ kind: 'unloaded' })
  })

  it('offers to open an unreadable config.json only when the home folder is known', () => {
    expect(health({ loadError: 'bad json', home: '' })).toMatchObject({ kind: 'unloaded', canOpen: false })
  })

  it('carries the failure to open the file along with the parse error', () => {
    expect(health({ loadError: 'bad json', openError: 'no editor' })).toMatchObject({ kind: 'unloaded', openError: 'no editor' })
  })

  it('reports a failed status refresh as an error that can not be dismissed', () => {
    expect(health({ setupError: 'no status', actionError: 'a' })).toEqual({ kind: 'error', message: 'no status', dismissible: false })
  })

  it('reports a failed action as an error that can be dismissed', () => {
    expect(health({ actionError: 'could not turn on zsh' })).toEqual({ kind: 'error', message: 'could not turn on zsh', dismissible: true })
  })

  it('shows an error before it has the data to say anything else', () => {
    expect(health({ actionError: 'a', config: null, setup: null })).toMatchObject({ kind: 'error' })
  })

  describe('first run', () => {
    it('step 1: create a profile, naming the login shell', () => {
      const setup = setupOf([bashOff, zshOff])
      expect(health({ config: noProfiles, setup, checkedOnce: false })).toEqual({ kind: 'setup', step: 1, shell: zshOff })
    })

    it('takes the first shell that is installed when none is the login shell', () => {
      const setup = setupOf([shell('zsh', false, { available: false }), bashOff, shell('fish', false)])
      expect(health({ config: noProfiles, setup })).toEqual({ kind: 'setup', step: 1, shell: bashOff })
    })

    it('has no shell to name when none is installed', () => {
      expect(health({ config: noProfiles, setup: setupOf([shell('zsh', false, { available: false })]) })).toEqual({
        kind: 'setup',
        step: 1,
        shell: undefined,
      })
    })

    it('step 2: turn the shell on, once there is a profile and no shell is on', () => {
      expect(health({ setup: setupOf([zshOff, bashOff]), checkedOnce: false })).toEqual({ kind: 'setup', step: 2, shell: zshOff })
    })

    it('step 3: check a folder, once routing is on and nothing has been checked', () => {
      expect(health({ checkedOnce: false })).toEqual({ kind: 'setup', step: 3, shell: zshOn })
    })

    it('skips step 3 for a window that has checked a folder before', () => {
      expect(health({ checkedOnce: true })).toEqual({ kind: 'ok', on: ['zsh'] })
    })

    it('does not ask for step 1 while a profile exists, and step 2 never applies once a shell is on', () => {
      expect(health({ checkedOnce: false, setup: setupOf([zshOff, bashOn]) })).toEqual({ kind: 'setup', step: 3, shell: zshOff })
    })
  })

  it('says routing is off when a window that has checked before finds every shell off', () => {
    expect(health({ setup: setupOf([zshOff, bashOff]) })).toEqual({ kind: 'off', shell: zshOff })
  })

  it('does not count a shell that is not installed on the machine as on', () => {
    const setup = setupOf([zshOff, shell('fish', true, { available: false })])
    expect(health({ setup })).toEqual({ kind: 'off', shell: zshOff })
  })

  it('says the shim is missing once a shell is on', () => {
    expect(health({ setup: setupOf([zshOn], false) })).toEqual({ kind: 'shim' })
    expect(health({ setup: setupOf([zshOn], false), checkedOnce: false, blocked })).toEqual({ kind: 'shim' })
  })

  it('asks for step 2 before the shim, while no shell is on', () => {
    expect(health({ setup: setupOf([zshOff], false), checkedOnce: false })).toEqual({ kind: 'setup', step: 2, shell: zshOff })
  })

  it('says routing is partly off when the login shell is off and another is on', () => {
    expect(health({ setup: setupOf([zshOff, bashOn]) })).toEqual({ kind: 'partial', on: ['bash'], shell: zshOff })
  })

  describe('a check that found something stopping the shim', () => {
    it('blocks the shell the check ran in, over step 3 and over ok', () => {
      expect(health({ blocked })).toEqual({ kind: 'blocked', ...blocked })
      expect(health({ blocked, checkedOnce: false })).toEqual({ kind: 'blocked', ...blocked })
    })

    it('blocks over partial, too', () => {
      const bash: Blocked = { ...blocked, shell: 'bash' }
      expect(health({ setup: setupOf([zshOff, bashOn]), blocked: bash })).toEqual({ kind: 'blocked', ...bash })
    })

    it('is dropped from the line once that shell is off', () => {
      expect(health({ setup: setupOf([zshOff, bashOn]), blocked })).toEqual({ kind: 'partial', on: ['bash'], shell: zshOff })
      expect(health({ setup: setupOf([zshOff]), blocked })).toEqual({ kind: 'off', shell: zshOff })
    })
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

describe('docketHasAction', () => {
  const setup = setupOf([zshOn])

  it('is false with no result to act on', () => {
    expect(docketHasAction(null, setup, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check(null), setup, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check(null, { error: 'boom' }), setup, ['claude'], HOME)).toBe(false)
  })

  it('is false until the setup status has arrived, or when the checked shell is not in it', () => {
    expect(docketHasAction(check({ status: 'shimFailed', message: 'x' }), null, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check({ status: 'shimFailed', message: 'x' }, { shell: 'fish' }), setup, ['claude'], HOME)).toBe(false)
  })

  it('is false for a result that needs no action', () => {
    expect(docketHasAction(check(routed), setup, ['claude'], HOME)).toBe(false)
    expect(docketHasAction(check({ status: 'notInstalled' }), setup, ['claude'], HOME)).toBe(false)
  })

  it('is true when the result offers to reinstall the shim', () => {
    expect(docketHasAction(check({ status: 'shimFailed', message: 'x' }), setup, ['claude'], HOME)).toBe(true)
    expect(docketHasAction(check({ status: 'notFound' }), setup, ['claude'], HOME)).toBe(true)
  })

  it('is true when the result offers to turn the shell on', () => {
    expect(docketHasAction(check({ status: 'notFound' }), setupOf([zshOff]), ['claude'], HOME)).toBe(true)
    expect(
      docketHasAction(check({ status: 'shadowedOnPath', path: '/usr/bin/claude', byPromptHook: false }), setupOf([zshOff]), ['claude'], HOME),
    ).toBe(true)
  })

  it('is true when the result offers to open the file that shadows the shim', () => {
    expect(docketHasAction(check({ status: 'shadowedByShell', kind: 'alias', origin: `${HOME}/.zshrc` }), setup, ['claude'], HOME)).toBe(true)
  })

  it('reads whether a profile sets the tool from the routed tools', () => {
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
  const views = ['profiles', 'servers'] as const

  describe('bannerHasPrimary', () => {
    it('is true for the states whose banner action is the fix', () => {
      expect(all.filter(bannerHasPrimary).map((h) => h.kind)).toEqual(['unloaded', 'setup', 'setup', 'setup', 'setup', 'off', 'shim'])
    })

    it('is false for an unreadable config.json with no home folder to open it from', () => {
      expect(bannerHasPrimary({ kind: 'unloaded', message: 'm', canOpen: false })).toBe(false)
    })

    it('is false where the banner action is secondary: Turn On beside a working shell, and Check Again', () => {
      expect(bannerHasPrimary({ kind: 'partial', on: ['bash'], shell: zsh })).toBe(false)
      expect(bannerHasPrimary({ kind: 'blocked', ...blocked })).toBe(false)
    })
  })

  describe('accentsOf', () => {
    const noAction = (h: Health, view: (typeof views)[number], inspecting = false) => accentsOf(h, view, inspecting, false)

    it('puts the banner action first: the docket and Check Folder… stand down', () => {
      for (const h of all.filter(bannerHasPrimary)) {
        expect(accentsOf(h, 'profiles', false, false)).toEqual({ quiet: false, docket: false, titlebar: false })
        expect(accentsOf(h, 'profiles', false, true)).toEqual({ quiet: false, docket: false, titlebar: false })
      }
    })

    it("puts the check result's action second: Check Folder… stands down", () => {
      for (const h of all.filter((s) => !bannerHasPrimary(s))) {
        expect(accentsOf(h, 'profiles', false, true)).toEqual({ quiet: false, docket: true, titlebar: false })
      }
    })

    it('gives Check Folder… the accent when the banner and the result have nothing to do', () => {
      for (const h of all.filter((s) => !bannerHasPrimary(s))) {
        expect(accentsOf(h, 'profiles', false, false)).toEqual({ quiet: false, docket: true, titlebar: true })
      }
    })

    it('lets the profile inspector take the accent: the docket and Check Folder… stand down', () => {
      for (const h of all) {
        for (const action of [false, true]) {
          expect(accentsOf(h, 'profiles', true, action)).toMatchObject({ docket: false, titlebar: false })
        }
      }
    })

    it('keeps Check Folder… a push button on Servers, and quiets the banner there', () => {
      for (const h of all) {
        for (const action of [false, true]) {
          expect(accentsOf(h, 'servers', false, action)).toMatchObject({ quiet: true, titlebar: false })
          expect(accentsOf(h, 'servers', true, action)).toMatchObject({ quiet: true, titlebar: false })
        }
      }
    })

    it('quiets the banner by the view alone', () => {
      for (const h of all) {
        for (const inspecting of [false, true]) {
          expect(noAction(h, 'profiles', inspecting).quiet).toBe(false)
          expect(noAction(h, 'servers', inspecting).quiet).toBe(true)
        }
      }
    })

    // The accent-filled buttons the three show, as App passes the arbitration to them. Welcome's own button (shown in place of
    // the banner on step 1) and the editors' Save are outside this module.
    const filled = (h: Health, view: (typeof views)[number], inspecting: boolean, docketAction: boolean) => {
      const a = accentsOf(h, view, inspecting, docketAction)
      return {
        banner: bannerHasPrimary(h) && !a.quiet,
        // The docket renders on Profiles only, and only a result with an action has a button to fill.
        docket: view === 'profiles' && a.docket && docketAction,
        titlebar: a.titlebar,
      }
    }
    const shown = (h: Health, view: (typeof views)[number], inspecting: boolean, docketAction: boolean) =>
      Object.values(filled(h, view, inspecting, docketAction)).filter(Boolean).length

    it('fills at most one of the banner, the docket and Check Folder… in any state', () => {
      for (const h of all) {
        for (const view of views) {
          for (const inspecting of [false, true]) {
            for (const docketAction of [false, true]) {
              expect(shown(h, view, inspecting, docketAction), JSON.stringify({ h, view, inspecting, docketAction })).toBeLessThanOrEqual(1)
            }
          }
        }
      }
    })

    it('fills exactly one of them on Profiles when nothing else is open', () => {
      for (const h of all) {
        for (const docketAction of [false, true]) {
          expect(shown(h, 'profiles', false, docketAction), JSON.stringify({ h, docketAction })).toBe(1)
        }
      }
    })

    it('fills none of them on Servers, where the editor Save holds the accent', () => {
      for (const h of all) {
        for (const docketAction of [false, true]) {
          expect(shown(h, 'servers', false, docketAction), JSON.stringify({ h, docketAction })).toBe(0)
        }
      }
    })

    it('says who holds the accent in the states a window can be in', () => {
      const who = (h: Health, docketAction = false) => {
        const f = filled(h, 'profiles', false, docketAction)
        return Object.entries(f).find(([, on]) => on)?.[0]
      }
      expect(who({ kind: 'shim' })).toBe('banner')
      expect(who({ kind: 'shim' }, true)).toBe('banner')
      expect(who({ kind: 'ok', on: ['zsh'] })).toBe('titlebar')
      expect(who({ kind: 'ok', on: ['zsh'] }, true)).toBe('docket')
      // Check Again is a push button because the fix lives in the check result.
      expect(who({ kind: 'blocked', ...blocked })).toBe('titlebar')
      expect(who({ kind: 'blocked', ...blocked }, true)).toBe('docket')
    })
  })
})
