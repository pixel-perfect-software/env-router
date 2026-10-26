// Turns a folder check into the docket's wording: one headline, the values behind it, and
// the single action that fixes it. Terse on purpose; the user is a developer.

import type { Tone } from '../components/ui'
import { tildify } from './paths'
import { listOf, plural } from './text'
import { toolByCommand } from './tools'
import type { FolderCheck, Preview, ShellStatus } from './types'

export type VerdictAction =
  | { kind: 'enableShell' }
  | { kind: 'openFile'; path: string }
  | { kind: 'reinstall' }
  | { kind: 'editProfile'; profileId: string; name: string }
  /** A profile for the checked folder, which starts as that folder's. */
  | { kind: 'newProfile' }
  /** Nothing in the window fixes it; the user does, then asks again. */
  | { kind: 'recheck' }

/** The profile that owns the checked folder, as the config (not a shell) says. */
export type Owner = { profileId: string; name: string }

export const ownerOf = (preview: Preview | null): Owner | null =>
  preview?.profileId && preview.profile ? { profileId: preview.profileId, name: preview.profile } : null

export type Verdict = {
  /** The status tile: routed (ok), owned but this agent unset (warn), nobody's folder (neutral). */
  tone: Tone
  headline: string
  /** Plain sentence, if the values alone don't explain it. */
  note?: string
  /** Paths and `NAME=value` pairs, rendered in mono. */
  values: { label: string; value: string }[]
  action?: VerdictAction
  /** The problem stops routing in this shell (as opposed to describing this one folder). */
  blocksShell?: boolean
}

/**
 * Whether the verdict's action fixes a problem, so it may be the window's one accent button. A verdict that only
 * describes the folder (Owned by, No profile owns it) and Check Again, which fixes nothing itself, stay push buttons.
 */
/** A routed check whose agent will start: the shim set it up and nothing in the agent's own files stops it. */
export const routedAndStarts = (check: FolderCheck) => check.status === 'routed' && check.mcpClashes.length === 0

export const offersFix = (v: Verdict) => v.tone === 'problem' && v.action !== undefined && v.action.kind !== 'recheck'

export function verdictOf(
  check: FolderCheck,
  shell: ShellStatus,
  tool: string,
  /** Some profile sets this tool, so a shim for it exists. */
  toolRouted: boolean,
  shimsDir: string,
  home: string,
  /** The trigger folder that matched, so the verdict can say which path won. */
  trigger: string | null = null,
  owner: Owner | null = null,
): Verdict {
  const name = shell.shell
  const startupFile = shell.startupFiles[0] ?? ''
  /** The shell has no EnvRouter block, so the shims directory isn't on its PATH at all. */
  const off = (runs?: string): Verdict => ({
    tone: 'problem',
    headline: `EnvRouter is off in ${name}`,
    values: [...(runs ? [{ label: 'runs', value: tildify(runs, home) }] : []), { label: 'adds a block to', value: tildify(startupFile, home) }],
    action: { kind: 'enableShell' },
  })
  /** Edit the profile that owns the folder, else make one for it. */
  const profileAction = (): VerdictAction => (owner ? { kind: 'editProfile', ...owner } : { kind: 'newProfile' })
  /** The agent isn't installed: the vendor's own installer, to copy, and a check once it has run. */
  const install = (values: Verdict['values'] = []): Pick<Verdict, 'values' | 'action'> => {
    const command = toolByCommand(tool)?.install
    return { values: command ? [...values, { label: 'install', value: command }] : values, action: { kind: 'recheck' } }
  }
  switch (check.status) {
    case 'routed': {
      const values = check.envVar && check.value ? [{ label: 'sets', value: `${check.envVar}=${tildify(check.value, home)}` }] : []
      if (check.profile && trigger) values.push({ label: 'via', value: tildify(trigger, home) })
      // Alphabetical, as the card footer lists them.
      if (check.mcp.length > 0) values.push({ label: 'mcp', value: [...check.mcp].sort((a, b) => a.localeCompare(b)).join(', ') })
      if (check.viaAlias) values.push({ label: 'alias', value: check.viaAlias })
      values.push({ label: 'runs', value: tildify(check.real, home) })
      if (!check.profile) {
        return {
          tone: 'neutral',
          headline: 'No profile owns this folder',
          note: `${tool} uses its default config here.`,
          values,
          action: { kind: 'newProfile' },
        }
      }
      // The agent merges a server it is handed with its own same-name one, and quits at startup when the two disagree on the transport.
      if (check.mcpClashes.length > 0) {
        const servers = [...new Set(check.mcpClashes.map((c) => c.server))]
        const [file, ...more] = [...new Set(check.mcpClashes.map((c) => c.file))]
        const openable = check.mcpClashes.find((c) => c.openable)
        return {
          tone: 'problem',
          headline: `${tool} won't start here`,
          note: `${check.profile} and ${tildify(file, home)}${more.length > 0 ? ` (and ${plural(more.length, 'more file', 'more files')})` : ''} both define ${listOf(servers)}, one as a command and the other as a URL, and ${tool} merges servers that share a name. Rename one of them.`,
          values,
          // Open refuses a file outside the home folder.
          action: openable ? { kind: 'openFile', path: openable.file } : undefined,
        }
      }
      const managed = check.mcpManagedBy && `its MCP servers are off because ${tildify(check.mcpManagedBy, home)} manages them on this machine`
      // Loading the profile's MCP servers is routing too, even with the agent's own config.
      if (!check.envVar && check.mcp.length > 0) {
        return {
          tone: 'ok',
          headline: `Routed to ${check.profile}`,
          note: `${tool} keeps its default config and loads ${check.profile}'s MCP servers.`,
          values,
        }
      }
      if (!check.envVar) {
        // The config named another owner by now (or none): editing that one wouldn't be this verdict's profile. By id: names repeat.
        const action: VerdictAction = owner && owner.profileId === check.profileId ? { kind: 'editProfile', ...owner } : { kind: 'recheck' }
        return {
          tone: 'warn',
          headline: `Owned by ${check.profile}`,
          note: managed
            ? `${check.profile} doesn't set ${tool}, and ${managed}.`
            : `${check.profile} doesn't set ${tool}, so it uses its default config here.`,
          values,
          action,
        }
      }
      if (managed)
        return { tone: 'ok', headline: `Routed to ${check.profile}`, note: `${check.profile} sets ${tool}'s config, but ${managed}.`, values }
      return { tone: 'ok', headline: `Routed to ${check.profile}`, values }
    }
    case 'shadowedByShell': {
      const file = check.origin ?? startupFile
      return {
        tone: 'problem',
        headline: `A ${name} ${check.kind} named ${tool} runs first`,
        note: `It runs instead of anything on PATH. Remove it, then open a new terminal.`,
        values: [{ label: check.origin ? 'defined in' : 'look in', value: tildify(file, home) }],
        action: file ? { kind: 'openFile', path: file } : undefined,
        blocksShell: true,
      }
    }
    case 'shadowedOnPath':
      if (!toolRouted) {
        return {
          tone: 'problem',
          headline: `No profile sets ${tool} yet`,
          note: `With no shim for it, new windows run ${tool} directly.`,
          values: [{ label: 'runs', value: tildify(check.path, home) }],
          action: profileAction(),
        }
      }
      // Nothing is "ahead of" the shim when its directory isn't on PATH in the first place.
      if (!shell.installed) return off(check.path)
      return {
        tone: 'problem',
        headline: `Another ${tool} comes first on PATH`,
        // Moving the block can't help when a hook reorders PATH before every prompt.
        note: check.byPromptHook
          ? `A prompt hook, such as mise or direnv, moves it ahead of EnvRouter's shims before every prompt.`
          : `Keep EnvRouter's block at the end of ${tildify(startupFile, home)}.`,
        values: [
          { label: 'runs', value: tildify(check.path, home) },
          { label: 'instead of', value: tildify(`${shimsDir}/${tool}`, home) },
        ],
        action: startupFile ? { kind: 'openFile', path: startupFile } : undefined,
        blocksShell: true,
      }
    case 'notFound':
      if (!shell.installed) return off()
      // A profile sets the tool, so its shim should be there: the shims folder is out of date.
      if (toolRouted) {
        return {
          tone: 'problem',
          headline: `${tool} isn't on PATH in new ${name} windows`,
          note: `EnvRouter's link for ${tool} is missing, and ${tool} itself isn't installed.`,
          values: [{ label: 'expected', value: tildify(`${shimsDir}/${tool}`, home) }],
          action: { kind: 'reinstall' },
        }
      }
      return {
        tone: 'problem',
        headline: `${tool} isn't on PATH in new ${name} windows`,
        note: `No profile sets ${tool}, and ${tool} itself isn't installed.`,
        ...install(),
      }
    case 'notInstalled':
      return {
        tone: 'problem',
        headline: `${tool} isn't installed`,
        note: `EnvRouter's shim is first on PATH, but there's no ${tool} after it to run. Install it, then check again.`,
        ...install([{ label: 'shim', value: tildify(`${shimsDir}/${tool}`, home) }]),
      }
    case 'shimFailed':
      return {
        tone: 'problem',
        headline: `EnvRouter couldn't route ${tool}`,
        note: check.message,
        values: [],
        action: { kind: 'reinstall' },
        blocksShell: true,
      }
  }
}
