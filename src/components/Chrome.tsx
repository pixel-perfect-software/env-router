// The top of the window: the titlebar (traffic lights, app icon and name, shell status, Shells…, Editors…, Check Folder…),
// the health banner beneath it, and the Shells and Editors popovers.

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
// The small cut: it's drawn for 64 px and under, and the titlebar shows it at 22.
import appIcon from '../../src-tauri/icons/app-icon-small.svg'
import { errorMessage } from '../lib/api'
import { tildify } from '../lib/paths'
import { shortcutLabel, usePlatform } from '../lib/platform'
import { toolLabel } from '../lib/tools'
import type { Editor, EditorStatus, SetupStatus, Shell, ShellStatus } from '../lib/types'
import { AgentMark, DisclosureIcon, EditorIcon, FolderCheckIcon, PlugIcon } from './icons'
import { Button, CloseIcon, FolderIcon, IconButton, Segmented, StatusTile, Switch, type Tone } from './ui'

export function TitleBand({
  setup,
  blockedShell,
  primary,
  canCheck,
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
  /** Off while there's no config to check against (config.json unreadable, or still loading). */
  canCheck: boolean
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
  const platform = usePlatform()
  const shells = setup?.shells.filter((s) => s.available) ?? []
  return (
    <div
      data-tauri-drag-region
      data-titlebar
      className={`flex h-[52px] shrink-0 items-center gap-3 pr-4 max-[760px]:gap-2 ${platform.isMac ? 'pl-[86px]' : 'pl-4'}`}
    >
      {/* On macOS the band is the title bar, beside the traffic lights. Elsewhere the system's own title bar already names the app, so
          the band is just the toolbar; the name stays for screen readers. */}
      {platform.isMac ? (
        <div data-tauri-drag-region className="flex items-center gap-2">
          <img data-tauri-drag-region src={appIcon} alt="" width={22} height={22} draggable={false} className="shrink-0" />
          {/* A narrow window keeps the icon; the name stays for screen readers. */}
          <h1 data-tauri-drag-region className="text-body font-bold max-[900px]:sr-only">
            EnvRouter
          </h1>
        </div>
      ) : (
        <h1 className="sr-only">EnvRouter</h1>
      )}
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
      <div data-tauri-drag-region className="ml-auto flex min-w-0 items-center gap-2">
        {/* Each shell's state lives in the control that changes it: the dots open the Shells popover. */}
        {shells.length > 0 && (
          <Button
            size="toolbar"
            aria-expanded={shellsOpen}
            aria-haspopup="dialog"
            aria-controls="shells-panel"
            onClick={onToggleShells}
            title="Shells…"
            className="min-w-0 gap-2 pr-2.5 text-small !shrink"
          >
            {shells.map((s) => (
              <span key={s.shell} className="flex min-w-0 items-center gap-1.5">
                {s.shell === blockedShell ? (
                  <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className="shrink-0 text-problem">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`size-[7px] shrink-0 rounded-full ${
                      s.installed
                        ? 'bg-ok forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none'
                        : 'shadow-[inset_0_0_0_1.2px_var(--er-ink-2)] forced-colors:border forced-colors:border-[CanvasText]'
                    }`}
                  />
                )}
                {/* Three shells in a narrow window keep their dots; the names stay for screen readers and in the popover. */}
                <span className={`truncate ${shells.length > 2 ? 'max-[760px]:sr-only' : ''} ${s.installed ? 'text-ink' : 'text-ink-2'}`}>
                  {s.shell}
                </span>
              </span>
            ))}
            <span className="-ml-0.5 shrink-0 text-ink-2">
              <DisclosureIcon />
            </span>
            {/* After the visible names, so the accessible name starts with what's on screen (WCAG 2.5.3). */}
            <span className="sr-only">
              , Shells: {shells.map((s) => `${s.shell} ${s.shell === blockedShell ? 'blocked' : s.installed ? 'on' : 'off'}`).join(', ')}
            </span>
          </Button>
        )}
        {editorsShown && (
          <Button
            size="toolbar"
            aria-expanded={editorsOpen}
            aria-haspopup="dialog"
            aria-controls="editors-panel"
            aria-label="Editors…"
            onClick={onToggleEditors}
            title="Editors…"
            className="w-[34px] justify-center !px-0"
          >
            <EditorIcon />
          </Button>
        )}
        <Button
          id="check-folder"
          size="toolbar"
          kind={primary ? 'primary' : 'push'}
          disabled={!canCheck}
          onClick={onCheckFolder}
          title={`Check Folder… (${shortcutLabel('o', platform)})`}
          className="pl-2.5"
        >
          <FolderCheckIcon />
          {/* Accent or not, the label keeps the accent's width, so the toolbar doesn't shift when it stands down. */}
          <span className="grid">
            <span className="col-start-1 row-start-1">Check Folder…</span>
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-medium">
              Check Folder…
            </span>
          </span>
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
  | { kind: 'unloaded'; message: string; canOpen: boolean; openError?: string }
  | { kind: 'setup'; step: 1 | 2 | 3; shell: ShellStatus | undefined }
  | { kind: 'ok'; on: Shell[] }
  | { kind: 'off'; shell: ShellStatus }
  | { kind: 'partial'; on: Shell[]; shell: ShellStatus }
  | { kind: 'shim' }
  /** The last check in this shell found something stopping the shim from running. */
  | { kind: 'blocked'; shell: Shell; tool: string; headline: string; folder: string }

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

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const summaryLine = (s: Summary) =>
  [count(s.profiles, 'profile', 'profiles'), count(s.folders, 'folder', 'folders'), s.servers > 0 && count(s.servers, 'MCP server', 'MCP servers')]
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

const EDITOR_LABEL: Record<Editor, string> = {
  code: 'VS Code',
  codeInsiders: 'VS Code Insiders',
  cursor: 'Cursor',
  windsurf: 'Windsurf',
  codium: 'VSCodium',
  remoteCode: 'VS Code Server',
  remoteCodeInsiders: 'VS Code Insiders Server',
  remoteCursor: 'Cursor Server',
  remoteWindsurf: 'Windsurf Server',
}

/** The editors the Editors popover lists: ones run on this Mac with the extension, or still routed after it was removed. */
export const editorsToShow = (editors: EditorStatus[] | null) => editors?.filter((e) => e.available && (e.extensionInstalled || e.installed)) ?? []

/** A titlebar popover, anchored under its button at the right. Escape or a click outside closes it, except on its own button, which toggles it. */
function TitlePopover({ id, label, onClose, children }: { id: string; label: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  // Hangs from its own button, right edges aligned, as a native popover does; the window's edge still holds it in.
  const [right, setRight] = useState(16)
  const place = useCallback(() => {
    const button = document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)
    const width = panel.current?.offsetWidth ?? 0
    if (!button) return
    const fromRight = window.innerWidth - button.getBoundingClientRect().right
    setRight(Math.max(16, Math.min(fromRight, window.innerWidth - width - 16)))
  }, [id])
  // Every render, not just the first: the toolbar can rearrange while it's open (Editors… appears once the editors are read).
  useLayoutEffect(place)
  useEffect(() => {
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [place])

  // Opening moves focus into the panel, as a native popover takes it; Tab past either end leaves and closes it, so focus is
  // never on a control the panel covers.
  useEffect(() => {
    const el = panel.current
    if (!el) return
    el.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled), [href]')?.focus()
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null
      // No next element: the window lost focus, or a control inside turned itself off. Neither is leaving.
      if (!next || el.contains(next) || document.querySelector(`[aria-controls="${id}"]`)?.contains(next)) return
      onClose()
    }
    el.addEventListener('focusout', onFocusOut)
    return () => el.removeEventListener('focusout', onFocusOut)
  }, [id, onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Back to the button that opened it, or focus would fall to the page.
      document.querySelector<HTMLElement>(`[aria-controls="${id}"]`)?.focus()
      onClose()
    }
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
      style={{ right }}
      className="absolute top-[46px] z-30 w-[min(440px,calc(100vw-32px))] origin-top-right animate-[er-open_140ms_var(--ease-settle)] rounded-card bg-raised p-1.5 shadow-raised"
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
          <li key={s.shell} className="flex items-center gap-3 rounded-[7px] px-2.5 py-2">
            <div className="min-w-0 flex-1">
              {/* An unavailable shell steps down to secondary ink rather than fading, so it stays readable. */}
              <p className={`font-medium ${s.available ? '' : 'text-ink-2'}`}>
                {s.shell}
                {s.isDefault && <span className="ml-2 rounded-full bg-tint px-1.5 py-px text-caption font-normal text-accent-ink">login shell</span>}
              </p>
              {s.available ? (
                <p className="truncate font-mono text-small text-ink-2 select-text">{s.startupFiles.map((f) => tildify(f, home)).join(', ')}</p>
              ) : (
                <p className="text-small text-ink-2 italic">Not installed</p>
              )}
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
  return (
    <p className="truncate font-mono text-small text-ink-2 select-text" title={file}>
      {shortSettingsPath(file)}
    </p>
  )
}

/**
 * Every desktop editor keeps its settings under the same long folder, so that part is shortened and the editor's own folder stays visible:
 * `~/Library/…/Code/User/settings.json` on macOS. Linux paths (`~/.config/Code/User/settings.json`) and servers'
 * (`~/.vscode-server/data/Machine/settings.json`) are short enough already.
 */
const shortSettingsPath = (file: string) => file.replace('/Library/Application Support/', '/Library/…/')

/** A popover's closing note under a hairline; a failed switch's error takes its place. */
function Note({ error, children }: { error: string | null; children: ReactNode }) {
  return (
    <p role={error ? 'alert' : undefined} className={`mx-2.5 mt-1 mb-1.5 pt-2 text-small hair-t ${error ? 'text-problem' : 'text-ink-2'}`}>
      {error ?? children}
    </p>
  )
}
