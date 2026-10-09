// Turns a folder check into the docket's wording: one headline, the values behind it, and
// the single action that fixes it. Terse on purpose; the user is a developer.

import type { Tone } from '../components/ui'
import { tildify } from './paths'
import type { FolderCheck, ShellStatus } from './types'

export type VerdictAction = { kind: 'enableShell' } | { kind: 'openFile'; path: string } | { kind: 'reinstall' }

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
  switch (check.status) {
    case 'routed': {
      const values = check.envVar && check.value ? [{ label: 'sets', value: `${check.envVar}=${tildify(check.value, home)}` }] : []
      if (check.profile && trigger) values.push({ label: 'via', value: tildify(trigger, home) })
      values.push({ label: 'runs', value: tildify(check.real, home) })
      if (!check.profile) return { tone: 'neutral', headline: 'No profile owns this folder', note: `${tool} uses its default config here.`, values }
      if (!check.envVar) {
        return {
          tone: 'warn',
          headline: `Owned by ${check.profile}`,
          note: `${check.profile} doesn't set ${tool}, so it uses its default config here.`,
          values,
        }
      }
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
        values: [],
      }
    case 'notInstalled':
      return {
        tone: 'problem',
        headline: `${tool} isn't installed`,
        note: `EnvRouter's shim is first on PATH, but there's no ${tool} after it to run. Install it, then check again.`,
        values: [{ label: 'shim', value: tildify(`${shimsDir}/${tool}`, home) }],
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
