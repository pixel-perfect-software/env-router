// The top of the window: the titlebar (traffic lights, shell status, Shells…, Check Folder…),
// the health banner beneath it, and the shell setup popover.

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'
import { tildify } from '../lib/paths'
import type { SetupStatus, Shell, ShellStatus } from '../lib/types'
import { Button, CloseIcon, IconButton, StatusTile, Switch, type Tone } from './ui'

export function TitleBand({
  setup,
  blockedShell,
  primary,
  shellsOpen,
  onToggleShells,
  onCheckFolder,
}: {
  setup: SetupStatus | null
  /** A shell the last check found blocked: its dot turns into a red cross. */
  blockedShell: Shell | null
  /** Check Folder… is the window's accent button only when nothing more urgent is. */
  primary: boolean
  shellsOpen: boolean
  onToggleShells: () => void
  onCheckFolder: () => void
}) {
  const shells = setup?.shells.filter((s) => s.available) ?? []
  return (
    <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-3 pr-4 pl-[86px]">
      <h1 data-tauri-drag-region className="text-title font-semibold">
        EnvRouter
      </h1>
      <div data-tauri-drag-region className="ml-auto flex items-center gap-2">
        {shells.length > 0 && (
          <>
            <ul className="mr-1 flex items-center gap-3 text-small text-ink-2" aria-label="EnvRouter by shell">
              {shells.map((s) => (
                <li key={s.shell} className="flex items-center gap-1.5">
                  {s.shell === blockedShell ? (
                    <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className="text-problem">
                      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`size-[7px] rounded-full ${s.installed ? 'bg-ok' : 'shadow-[inset_0_0_0_1.2px_var(--er-ink-3)]'}`}
                    />
                  )}
                  <span className={s.installed ? 'text-ink' : ''}>{s.shell}</span>
                  <span className="sr-only">{s.shell === blockedShell ? 'blocked' : s.installed ? 'on' : 'off'}</span>
                </li>
              ))}
            </ul>
            <Button
              aria-expanded={shellsOpen}
              aria-haspopup="dialog"
              aria-controls="shells-panel"
              onClick={onToggleShells}
              className={shellsOpen ? 'brightness-90' : ''}
            >
              Shells…
            </Button>
          </>
        )}
        <Button kind={primary ? 'primary' : 'push'} onClick={onCheckFolder} title="Check Folder… (⌘O)">
          Check Folder…
        </Button>
      </div>
    </div>
  )
}

export type Health =
  | { kind: 'loading' }
  /** `dismissible`: a one-off action failed. A failing status refresh isn't: it clears itself once one works. */
  | { kind: 'error'; message: string; dismissible: boolean }
  /** config.json couldn't be read, so there are no profiles to show. Coming back to the window retries. */
  | { kind: 'unloaded'; message: string; canOpen: boolean }
  | { kind: 'setup'; step: 1 | 2 | 3; shell: ShellStatus | undefined }
  | { kind: 'ok'; on: Shell[] }
  | { kind: 'off'; shell: ShellStatus }
  | { kind: 'partial'; on: Shell[]; shell: ShellStatus }
  | { kind: 'shim' }
  /** The last check in this shell found something stopping the shim from running. */
  | { kind: 'blocked'; shell: Shell; tool: string; headline: string; folder: string }

function Banner({ tone, title, detail, action }: { tone: Tone; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div role="status" className="mx-4 flex shrink-0 items-center gap-3 rounded-card bg-card p-3 shadow-card">
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
  onNewProfile,
  onEnableShell,
  onCheckFolder,
  onReinstall,
  onRecheck,
  onOpenConfig,
  onDismissError,
}: {
  health: Health
  onNewProfile: () => void
  onEnableShell: (shell: Shell) => void
  onCheckFolder: () => void
  onReinstall: () => void
  onRecheck: (folder: string, shell: Shell, tool: string) => void
  onOpenConfig: () => void
  onDismissError: () => void
}) {
  if (health.kind === 'loading') {
    return <div className="mx-4 h-[58px] shrink-0 animate-pulse rounded-card bg-card-muted" />
  }

  if (health.kind === 'setup') {
    const shellName = health.shell?.shell ?? 'your shell'
    const steps = ['Create a profile', `Turn on ${shellName}`, 'Check a folder']
    const actions = [
      <Button key="1" kind="primary" onClick={onNewProfile}>
        New Profile
      </Button>,
      <Button key="2" kind="primary" onClick={() => health.shell && onEnableShell(health.shell.shell)}>
        Turn On {shellName}
      </Button>,
      <Button key="3" kind="primary" onClick={onCheckFolder}>
        Check Folder…
      </Button>,
    ]
    return (
      <div className="mx-4 flex shrink-0 items-center gap-4 rounded-card bg-card p-3 pl-4 shadow-card">
        <div className="min-w-0 flex-1">
          <p className="font-medium">Set up EnvRouter</p>
          <ol className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
            {steps.map((label, i) => {
              const n = i + 1
              const done = n < health.step
              const current = n === health.step
              return (
                <li
                  key={label}
                  className={`flex items-center gap-2 text-small ${current ? 'text-ink' : 'text-ink-2'}`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span
                    className={`grid size-[18px] place-items-center rounded-full text-caption font-semibold tabular-nums ${
                      done ? 'bg-ok text-white' : current ? 'bg-accent text-on-accent' : 'shadow-[inset_0_0_0_1px_var(--er-rule)]'
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
                  <span className={current ? 'font-medium' : ''}>{label}</span>
                </li>
              )
            })}
          </ol>
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
          detail={health.message}
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
          detail={health.message}
          action={
            health.canOpen ? (
              <Button kind="primary" onClick={onOpenConfig}>
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
          detail="No agent is routed until ~/.envrouter/bin/envrouter-shim is reinstalled."
          action={
            <Button kind="primary" onClick={onReinstall}>
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
            <Button kind="primary" onClick={() => onEnableShell(health.shell.shell)}>
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
      return <Banner tone="ok" title={`Routing is on in ${health.on.join(' and ')}`} />
  }
}

export function ShellsPopover({
  setup,
  home,
  onSet,
  onClose,
}: {
  setup: SetupStatus
  home: string
  onSet: (shell: Shell, enabled: boolean) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState<Shell | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!panel.current?.contains(target) && !target.closest('[aria-controls="shells-panel"]')) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [onClose])

  const toggle = async (shell: Shell, enabled: boolean) => {
    setBusy(shell)
    setError(null)
    try {
      await onSet(shell, enabled)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section
      ref={panel}
      id="shells-panel"
      role="dialog"
      aria-label="Shell setup"
      className="absolute top-[46px] right-4 z-30 w-[min(440px,calc(100vw-32px))] animate-[er-open_140ms_var(--ease-settle)] rounded-card bg-raised p-1.5 shadow-raised"
    >
      <ul>
        {setup.shells.map((s) => (
          <li key={s.shell} className={`flex items-center gap-3 rounded-[7px] px-2.5 py-2 ${s.available ? '' : 'opacity-60'}`}>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.shell}
                {s.isDefault && <span className="ml-2 rounded-full bg-tint px-1.5 py-px text-caption font-normal text-accent">login shell</span>}
              </p>
              <p className="truncate font-mono text-small text-ink-2 select-text">
                {s.available ? s.startupFiles.map((f) => tildify(f, home)).join(', ') : 'Not installed'}
              </p>
            </div>
            {s.available && (
              <Switch checked={s.installed} disabled={busy !== null} onChange={(next) => toggle(s.shell, next)} label={`EnvRouter in ${s.shell}`} />
            )}
          </li>
        ))}
      </ul>
      <p className={`mx-2.5 mt-1 mb-1.5 border-t border-rule pt-2 text-small ${error ? 'text-problem' : 'text-ink-2'}`}>
        {error ?? 'Adds a marked block to the end of each file; turning a shell off removes it.'}
      </p>
    </section>
  )
}
