// The health banner beneath the titlebar, and first run's setup steps.

import type { ReactNode } from 'react'
import type { Health } from '../lib/health'
import { tildify } from '../lib/paths'
import { plural } from '../lib/text'
import type { Shell } from '../lib/types'
import { Button, CloseIcon, IconButton, StatusTile, type Tone } from './ui'

/**
 * A backend message with its values set in mono: paths under home, tildified, and `quoted` tokens (serde_json quotes
 * them so), which keep quotes because a lone `,` in mono is easy to misread.
 */
function ValueText({ text, home }: { text: string; home: string }) {
  const homePath = home ? `|${home.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:/[^\\s:]*)?` : ''
  return text.split(new RegExp(`(\`[^\`]+\`${homePath})`)).map((part, i) => {
    if (i % 2 === 0) return part
    return part.startsWith('`') ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string
      <span key={i}>
        “<code className="font-mono">{part.slice(1, -1)}</code>”
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one fixed string
      <code key={i} className="font-mono">
        {tildify(part, home)}
      </code>
    )
  })
}

function Banner({ tone, title, detail, action }: { tone: Tone; title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-4 flex shrink-0 items-center gap-3 rounded-card bg-card p-3 shadow-card">
      <StatusTile tone={tone} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {detail && <p className="text-small text-ink-2">{detail}</p>}
      </div>
      {action}
    </div>
  )
}

export function HealthLine({
  health,
  summary,
  home,
  quiet = false,
  onNewProfile,
  onEnableShell,
  onCheckFolder,
  onReinstall,
  onRecheck,
  onOpenConfig,
  onDismissError,
}: {
  health: Health
  /** Tildifies paths in the backend's messages. */
  home: string
  /** Shown beside working routing's line. */
  summary?: Summary
  /** On Servers the editor's Save is the accent, so the banner's action stands down to a push button. */
  quiet?: boolean
  onNewProfile: () => void
  onEnableShell: (shell: Shell) => void
  onCheckFolder: () => void
  onReinstall: () => void
  onRecheck: (folder: string, shell: Shell, tool: string) => void
  onOpenConfig: () => void
  onDismissError: () => void
}) {
  const accent = quiet ? 'push' : 'primary'
  if (health.kind === 'loading') {
    // Holds the place of the line working routing gets, the likeliest answer.
    return (
      <div className="mx-4 flex h-5 shrink-0 items-center">
        <div className="h-3 w-48 rounded-full bg-track motion-safe:animate-pulse" />
      </div>
    )
  }

  if (health.kind === 'setup') {
    const shellName = health.shell?.shell ?? 'your shell'
    const actions = [
      <Button key="1" kind={accent} onClick={onNewProfile}>
        New Profile
      </Button>,
      <Button key="2" kind={accent} onClick={() => health.shell && onEnableShell(health.shell.shell)}>
        Turn On {shellName}
      </Button>,
      <Button key="3" kind={accent} onClick={onCheckFolder}>
        Check Folder…
      </Button>,
    ]
    return (
      <div className="mx-4 flex shrink-0 items-center gap-4 rounded-card bg-card p-3 pl-4 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Set up EnvRouter</p>
          <SetupSteps step={health.step} shell={shellName} className="mt-1.5" />
        </div>
        {actions[health.step - 1]}
      </div>
    )
  }

  switch (health.kind) {
    case 'error':
      return (
        <Banner
          tone="problem"
          title="Something went wrong"
          detail={<ValueText text={health.message} home={home} />}
          action={
            health.dismissible ? (
              <IconButton label="Dismiss" onClick={onDismissError}>
                <CloseIcon />
              </IconButton>
            ) : undefined
          }
        />
      )
    case 'unloaded':
      return (
        <Banner
          tone="problem"
          title="EnvRouter can't read config.json"
          detail={
            health.openError ? (
              <>
                <ValueText text={health.message} home={home} />
                <span className="block text-problem">{health.openError}</span>
              </>
            ) : (
              <ValueText text={health.message} home={home} />
            )
          }
          action={
            health.canOpen ? (
              <Button kind={accent} onClick={onOpenConfig}>
                Open config.json
              </Button>
            ) : undefined
          }
        />
      )
    case 'shim':
      return (
        <Banner
          tone="problem"
          title="The shim is missing or out of date"
          detail={
            <>
              No agent is routed until <span className="font-mono">~/.envrouter/bin/envrouter-shim</span> is reinstalled.
            </>
          }
          action={
            <Button kind={accent} onClick={onReinstall}>
              Reinstall
            </Button>
          }
        />
      )
    case 'off':
      return (
        <Banner
          tone="warn"
          title="Routing is off"
          detail={`New ${health.shell.shell} windows run every agent without a profile.`}
          action={
            <Button kind={accent} onClick={() => onEnableShell(health.shell.shell)}>
              Turn On {health.shell.shell}
            </Button>
          }
        />
      )
    case 'partial':
      return (
        <Banner
          tone="warn"
          title={`Routing is off in ${health.shell.shell}, your login shell`}
          detail={`It's on in ${health.on.join(' and ')}.`}
          action={<Button onClick={() => onEnableShell(health.shell.shell)}>Turn On {health.shell.shell}</Button>}
        />
      )
    case 'blocked':
      return (
        <Banner
          tone="problem"
          title={`Routing is blocked in ${health.shell}`}
          detail={`${health.headline}.`}
          action={<Button onClick={() => onRecheck(health.folder, health.shell, health.tool)}>Check Again</Button>}
        />
      )
    case 'ok':
      // Working routing doesn't ask for attention: a quiet line on the ground, not a card.
      return (
        <div className="mx-4 flex h-5 shrink-0 items-center gap-2 px-0.5 text-small">
          <StatusTile tone="ok" size={16} badge />
          <p className="min-w-0 truncate font-medium">Routing is on in {health.on.join(' and ')}</p>
          {summary && <p className="ml-auto shrink-0 text-ink-2 tabular-nums">{summaryLine(summary)}</p>}
        </div>
      )
  }
}

/** What the map holds, at a glance: "4 profiles · 6 folders · 6 MCP servers". */
export interface Summary {
  profiles: number
  folders: number
  servers: number
}

const summaryLine = (s: Summary) =>
  [plural(s.profiles, 'profile', 'profiles'), plural(s.folders, 'folder', 'folders'), s.servers > 0 && plural(s.servers, 'MCP server', 'MCP servers')]
    .filter(Boolean)
    .join(' · ')

/** First run's three steps: done ones green with a check, the current one accent, the rest a ring. */
export function SetupSteps({ step, shell, className = '' }: { step: 1 | 2 | 3; shell: string; className?: string }) {
  const steps = ['Create a profile', `Turn on ${shell}`, 'Check a folder']
  return (
    <ol className={`flex flex-wrap items-center gap-x-5 gap-y-1 ${className}`}>
      {steps.map((label, i) => {
        const n = i + 1
        const done = n < step
        const current = n === step
        return (
          <li
            key={label}
            className={`flex items-center gap-2 text-small ${current ? 'text-ink' : 'text-ink-2'}`}
            aria-current={current ? 'step' : undefined}
          >
            <span
              className={`grid size-[18px] place-items-center rounded-full text-caption font-semibold tabular-nums ${
                done
                  ? 'bg-ok text-white dark:text-window forced-colors:border forced-colors:border-[CanvasText]'
                  : current
                    ? 'bg-accent text-on-accent forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none'
                    : 'shadow-[inset_0_0_0_1px_var(--er-field-edge)] forced-colors:border forced-colors:border-[CanvasText]'
              }`}
            >
              {done ? (
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <path d="M2 5.2l2 2L8 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                n
              )}
            </span>
            <span className={current ? 'font-medium' : ''}>
              {label}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
