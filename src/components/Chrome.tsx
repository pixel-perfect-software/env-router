// The top of the window: the titlebar (traffic lights, app icon and name, shell status, Shells…, Editors…, Check Folder…),
// the health banner beneath it, and the Shells and Editors popovers.

import { type ReactNode, useEffect, useRef, useState } from 'react'
// The small cut: it's drawn for 64 px and under, and the titlebar shows it at 18.
import appIcon from '../../src-tauri/icons/app-icon-small.svg'
import { errorMessage } from '../lib/api'
import { tildify } from '../lib/paths'
import { toolLabel } from '../lib/tools'
import type { Editor, EditorStatus, SetupStatus, Shell, ShellStatus } from '../lib/types'
import { AgentMark, EditorIcon, FolderCheckIcon, PlugIcon, ShellIcon } from './icons'
import { Button, CloseIcon, FolderIcon, IconButton, Segmented, StatusTile, Switch, type Tone } from './ui'

export function TitleBand({
  setup,
  blockedShell,
  primary,
  shellsOpen,
  onToggleShells,
  editorsShown,
  editorsOpen,
  onToggleEditors,
  view,
  onView,
  onCheckFolder,
}: {
  setup: SetupStatus | null
  /** A shell the last check found blocked: its dot turns into a red cross. */
  blockedShell: Shell | null
  /** Check Folder… is the window's accent button only when nothing more urgent is. */
  primary: boolean
  shellsOpen: boolean
  onToggleShells: () => void
  /** An editor on this Mac runs an agent extension EnvRouter can route. */
  editorsShown: boolean
  editorsOpen: boolean
  onToggleEditors: () => void
  /** The window's two places: the profile map and the MCP server workbench. */
  view: 'profiles' | 'servers'
  onView: (view: 'profiles' | 'servers') => void
  onCheckFolder: () => void
}) {
  const shells = setup?.shells.filter((s) => s.available) ?? []
  return (
    <div data-tauri-drag-region data-titlebar className="flex h-[52px] shrink-0 items-center gap-3 pr-4 pl-[86px]">
      <div data-tauri-drag-region className="flex items-center gap-2">
        <img data-tauri-drag-region src={appIcon} alt="" width={18} height={18} draggable={false} />
        {/* A narrow window keeps the icon; the name stays for screen readers. */}
        <h1 data-tauri-drag-region className="text-title font-semibold max-[900px]:sr-only">
          EnvRouter
        </h1>
      </div>
      <Segmented
        label="View"
        size="toolbar"
        options={[
          ['profiles', 'Profiles', <FolderIcon key="p" />],
          ['servers', 'MCP Servers', <PlugIcon key="s" />],
        ]}
        value={view}
        onChange={onView}
      />
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
              title="Shells…"
            >
              <ShellIcon />
              {/* A narrow window keeps the icon; the name stays as the tooltip and accessible label. */}
              <span className="max-[820px]:sr-only">Shells…</span>
            </Button>
          </>
        )}
        {editorsShown && (
          <Button
            aria-expanded={editorsOpen}
            aria-haspopup="dialog"
            aria-controls="editors-panel"
            onClick={onToggleEditors}
            className={editorsOpen ? 'brightness-90' : ''}
            title="Editors…"
          >
            <EditorIcon />
            <span className="max-[820px]:sr-only">Editors…</span>
          </Button>
        )}
        <Button kind={primary ? 'primary' : 'push'} onClick={onCheckFolder} title="Check Folder… (⌘O)">
          <FolderCheckIcon />
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
    return <div className="mx-4 h-[58px] shrink-0 animate-pulse rounded-card bg-card-muted" />
  }

  if (health.kind === 'setup') {
    const shellName = health.shell?.shell ?? 'your shell'
    const steps = ['Create a profile', `Turn on ${shellName}`, 'Check a folder']
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
          detail="No agent is routed until ~/.envrouter/bin/envrouter-shim is reinstalled."
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
      return <Banner tone="ok" title={`Routing is on in ${health.on.join(' and ')}`} />
  }
}

const EDITOR_LABEL: Record<Editor, string> = {
  code: 'VS Code',
  codeInsiders: 'VS Code Insiders',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  codium: 'VSCodium',
}

/** The editors the Editors popover lists: ones run on this Mac with the extension, or still routed after it was removed. */
export const editorsToShow = (editors: EditorStatus[] | null) => editors?.filter((e) => e.available && (e.extensionInstalled || e.installed)) ?? []

/** A titlebar popover, anchored under its button at the right. Escape or a click outside closes it, except on its own button, which toggles it. */
function TitlePopover({ id, label, onClose, children }: { id: string; label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onPointer = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (!panel.current?.contains(target) && !target.closest(`[aria-controls="${id}"]`)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [id, onClose])

  return (
    <section
      ref={panel}
      id={id}
      role="dialog"
      aria-label={label}
      className="absolute top-[46px] right-4 z-30 w-[min(440px,calc(100vw-32px))] animate-[er-open_140ms_var(--ease-settle)] rounded-card bg-raised p-1.5 shadow-raised"
    >
      {children}
    </section>
  )
}

/** Runs one switch's command at a time; a failure's message replaces the popover's note. */
function useSwitches<K>() {
  const [busy, setBusy] = useState<K | null>(null)
  const [error, setError] = useState<string | null>(null)
  const run = async (key: K, work: () => Promise<void>) => {
    setBusy(key)
    setError(null)
    try {
      await work()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, run }
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
  const { busy, error, run } = useSwitches<Shell>()
  return (
    <TitlePopover id="shells-panel" label="Shell setup" onClose={onClose}>
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
              <Switch
                checked={s.installed}
                disabled={busy !== null}
                onChange={(next) => run(s.shell, () => onSet(s.shell, next))}
                label={`EnvRouter in ${s.shell}`}
              />
            )}
          </li>
        ))}
      </ul>
      <Note error={error}>Adds a marked block to the end of each file; turning a shell off removes it.</Note>
    </TitlePopover>
  )
}

export function EditorsPopover({
  editors,
  home,
  onSet,
  onClose,
}: {
  editors: EditorStatus[]
  home: string
  onSet: (editor: Editor, command: string, enabled: boolean) => Promise<void>
  onClose: () => void
}) {
  const { busy, error, run } = useSwitches<string>()
  return (
    <TitlePopover id="editors-panel" label="Editor setup" onClose={onClose}>
      <ul>
        {editorsToShow(editors).map((e) => {
          const key = `${e.editor}:${e.command}`
          const agent = toolLabel(e.command)
          return (
            <li key={key} className="flex items-center gap-3 rounded-[7px] px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="flex items-center font-medium">
                  {EDITOR_LABEL[e.editor]}
                  <span className="ml-2 inline-flex items-center gap-1 text-small font-normal text-ink-2">
                    <AgentMark command={e.command} size={12} />
                    {agent}
                  </span>
                </p>
                <EditorDetail status={e} agent={agent} home={home} />
              </div>
              <Switch
                checked={e.installed}
                disabled={busy !== null}
                onChange={(next) => run(key, () => onSet(e.editor, e.command, next))}
                label={`EnvRouter for ${agent} in ${EDITOR_LABEL[e.editor]}`}
              />
            </li>
          )
        })}
      </ul>
      <Note error={error}>Extensions run their own copy of the agent; this sets their process wrapper to EnvRouter. New sessions pick it up.</Note>
    </TitlePopover>
  )
}

/** The line under an editor's name: the file the switch edits, or why the switch may not do anything yet. */
function EditorDetail({ status, agent, home }: { status: EditorStatus; agent: string; home: string }) {
  if (status.wrapper && !status.installed)
    return (
      <p className="truncate text-small text-ink-2">
        Runs through <span className="font-mono select-text">{tildify(status.wrapper, home)}</span>
      </p>
    )
  if (!status.extensionInstalled) return <p className="truncate text-small text-ink-2 italic">The {agent} extension isn't installed</p>
  const file = tildify(status.settingsFile, home)
  // Every editor keeps it under the same long folder, so the part that tells them apart stays visible.
  return (
    <p className="truncate font-mono text-small text-ink-2 select-text" title={file}>
      {file.replace('/Library/Application Support/', '/Library/…/')}
    </p>
  )
}

/** A popover's closing note under a hairline; a failed switch's error takes its place. */
function Note({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <p
      role={error ? 'alert' : undefined}
      className={`mx-2.5 mt-1 mb-1.5 border-t border-rule pt-2 text-small ${error ? 'text-problem' : 'text-ink-2'}`}
    >
      {error ?? children}
    </p>
  )
}
