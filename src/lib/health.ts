// What the window says about routing, and which button carries the accent. Pure, so the states and
// the One Accent Rule (DESIGN.md) are pinned in health.test.ts instead of checked by eye.

import type { CheckState } from '../components/Docket'
import type { ConfigFault, ConfigState, SetupStatus, Shell, ShellStatus } from './types'
import { offersFix, verdictOf } from './verdict'

/** What went wrong with the file actions of the unreadable banner, and which one it was: the accent moves off Open only when Open failed. */
export type FileError = { action: 'open' | 'reveal' | 'startOver'; message: string }

export type Health =
  | { kind: 'loading' }
  /** `dismissible`: a one-off action failed. A failing status refresh isn't: it clears itself once one works. */
  | { kind: 'error'; message: string; dismissible: boolean }
  /** A save went through but couldn't finish something after it (see `SaveOutcome`). Dismissed by the user, or replaced by the next save's. */
  | { kind: 'warning'; message: string }
  /**
   * config.json couldn't be read, so there are no profiles to show. Coming back to the window retries. `canStartOver`: it won't
   * parse, which is the only trouble that replacing the file helps.
   */
  | { kind: 'unloaded'; message: string; canOpen: boolean; canStartOver: boolean; openError?: FileError }
  | { kind: 'setup'; step: 1 | 2 | 3; shell: ShellStatus | undefined }
  | { kind: 'ok'; on: Shell[] }
  | { kind: 'off'; shell: ShellStatus }
  | { kind: 'partial'; on: Shell[]; shell: ShellStatus }
  | { kind: 'shim' }
  /** The last check in this shell found something stopping the shim from running. */
  | { kind: 'blocked'; shell: Shell; tool: string; headline: string; folder: string }

/** A check that found something stopping the shim in a shell, until a later check clears it. */
export type Blocked = { shell: Shell; tool: string; headline: string; folder: string }

export function healthOf(
  config: ConfigState | null,
  setup: SetupStatus | null,
  loadError: ConfigFault | null,
  setupError: string | null,
  actionError: string | null,
  home: string,
  checkedOnce: boolean,
  blocked: Blocked | null,
  openError: FileError | null,
  saveWarning: string | null,
): Health {
  if (loadError)
    return {
      kind: 'unloaded',
      message: loadError.message,
      canOpen: home !== '',
      canStartOver: loadError.kind === 'parse',
      openError: openError ?? undefined,
    }
  if (setupError) return { kind: 'error', message: setupError, dismissible: false }
  if (actionError) return { kind: 'error', message: actionError, dismissible: true }
  if (saveWarning) return { kind: 'warning', message: saveWarning }
  if (!config || !setup) return { kind: 'loading' }
  const available = setup.shells.filter((s) => s.available)
  const login = available.find((s) => s.isDefault) ?? available[0]
  const on = available.filter((s) => s.installed).map((s) => s.shell)

  if (config.profiles.length === 0) return { kind: 'setup', step: 1, shell: login }
  if (on.length === 0 && login) return checkedOnce ? { kind: 'off', shell: login } : { kind: 'setup', step: 2, shell: login }
  if (!setup.shimInstalled) return { kind: 'shim' }
  // What a real shell reported outranks what the config and startup files suggest.
  if (blocked && on.includes(blocked.shell)) return { kind: 'blocked', ...blocked }
  if (!checkedOnce) return { kind: 'setup', step: 3, shell: login }
  if (login && !login.installed) return { kind: 'partial', on, shell: login }
  return { kind: 'ok', on }
}

// A Mac window has one default button. The banner's action outranks the check result's,
// which outranks Check Folder… in the titlebar.
export const bannerHasPrimary = (h: Health) => h.kind === 'setup' || h.kind === 'shim' || h.kind === 'off' || h.kind === 'unloaded'

/**
 * Whether the docket's check result offers a fix (Turn On, Open a file, Reinstall Shim, Edit or New Profile for a tool no
 * profile sets). The owner only picks which profile that fix opens, so it isn't passed. A verdict that only describes the
 * folder (Owned by, No profile owns it) and Check Again don't count: they stay push buttons.
 */
export function docketHasFix(check: CheckState | null, setup: SetupStatus | null, routedTools: string[], home: string): boolean {
  const status = check?.result && setup?.shells.find((s) => s.shell === check.shell)
  return status && check?.result && setup
    ? offersFix(verdictOf(check.result, status, check.tool, routedTools.includes(check.tool), setup.shimsDir, home, check.trigger))
    : false
}

/** Which of the banner, the docket and the titlebar's Check Folder… may be the accent, as the props their components take. */
export interface Accents {
  /** HealthLine's `quiet`: on Servers the editor's Save is the accent, so the banner's action stands down to a push button. */
  quiet: boolean
  /** Docket's `primary`: the result's action may be the accent. */
  docket: boolean
  /** TitleBand's `primary`: Check Folder… is the accent. */
  titlebar: boolean
}

/**
 * With the inspector open, Save is the accent and the docket and Check Folder… stand down. The banner's `quiet` follows
 * the view alone, so it keeps its own accent behind the inspector.
 */
export const accentsOf = (health: Health, view: 'profiles' | 'servers', inspecting: boolean, docketFix: boolean): Accents => ({
  quiet: view === 'servers',
  docket: !inspecting && !bannerHasPrimary(health),
  titlebar: view === 'profiles' && !inspecting && !bannerHasPrimary(health) && !docketFix,
})
