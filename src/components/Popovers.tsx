// The titlebar's Shells and Editors popovers.

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'
import { tildify } from '../lib/paths'
import { toolLabel } from '../lib/tools'
import type { Editor, EditorStatus, SetupStatus, Shell } from '../lib/types'
import { AgentMark } from './icons'
import { Switch } from './ui'

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
                <p className="truncate font-mono text-small text-ink-2 select-text" title={s.startupFiles.map((f) => tildify(f, home)).join(', ')}>
                  {s.startupFiles.map((f) => tildify(f, home)).join(', ')}
                </p>
              ) : (
                <p className="text-small text-ink-2 italic">Not installed</p>
              )}
            </div>
            {s.available && (
              <Switch
                checked={s.installed}
                busy={busy !== null}
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
                busy={busy !== null}
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
