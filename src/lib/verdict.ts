// Turns a folder check into the docket's wording: one headline, the values behind it, and
// the single action that fixes it. Terse on purpose; the user is a developer.

import type { Tone } from '../components/ui'
import { tildify } from './paths'
import type { FolderCheck, ShellStatus } from './types'

export type VerdictAction = { kind: 'enableShell' } | { kind: 'openFile'; path: string } | { kind: 'reinstall' }

export type Verdict = {
  mark: 'on' | 'problem'
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
  switch (check.status) {
    case 'routed': {
      const values = check.envVar && check.value ? [{ label: 'sets', value: `${check.envVar}=${tildify(check.value, home)}` }] : []
      if (check.profile && trigger) values.push({ label: 'via', value: tildify(trigger, home) })
      values.push({ label: 'runs', value: tildify(check.real, home) })
      if (!check.profile)
        return { mark: 'on', tone: 'neutral', headline: 'No profile owns this folder', note: `${tool} uses its default config here.`, values }
      if (!check.envVar) {
        return {
          mark: 'on',
          tone: 'warn',
          headline: `Owned by ${check.profile}`,
          note: `${check.profile} doesn't set ${tool}, so it uses its default config here.`,
          values,
        }
      }
      return { mark: 'on', tone: 'ok', headline: `Routed to ${check.profile}`, values }
    }
    case 'shadowedByShell': {
      const file = check.origin ?? startupFile
      return {
        mark: 'problem',
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
          mark: 'problem',
          tone: 'problem',
          headline: `No profile sets ${tool} yet`,
          note: `With no shim for it, new windows run ${tool} directly.`,
          values: [{ label: 'runs', value: tildify(check.path, home) }],
        }
      }
      return {
        mark: 'problem',
        tone: 'problem',
        headline: `Another ${tool} comes first on PATH`,
        note: `Keep EnvRouter's block at the end of ${tildify(startupFile, home)}.`,
        values: [
          { label: 'runs', value: tildify(check.path, home) },
          { label: 'instead of', value: tildify(`${shimsDir}/${tool}`, home) },
        ],
        action: startupFile ? { kind: 'openFile', path: startupFile } : undefined,
        blocksShell: true,
      }
    case 'notFound':
      return shell.installed
        ? {
            mark: 'problem',
            tone: 'problem',
            headline: `${tool} isn't on PATH in new ${name} windows`,
            note: `No profile sets ${tool}, and ${tool} itself isn't installed.`,
            values: [],
          }
        : {
            mark: 'problem',
            tone: 'problem',
            headline: `EnvRouter is off in ${name}`,
            values: [{ label: 'adds a block to', value: tildify(startupFile, home) }],
            action: { kind: 'enableShell' },
          }
    case 'shimFailed':
      return {
        mark: 'problem',
        tone: 'problem',
        headline: `EnvRouter couldn't route ${tool}`,
        note: check.message,
        values: [],
        action: { kind: 'reinstall' },
        blocksShell: true,
      }
  }
}
