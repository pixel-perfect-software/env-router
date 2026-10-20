// The docket: the stamped result of the last folder check, docked along the bottom. One
// complete state at a time: pending, then a verdict, never a scrolling log.

import { tildify } from '../lib/paths'
import { shortcutLabel, usePlatform } from '../lib/platform'
import { toolLabel } from '../lib/tools'
import type { FolderCheck, Preview, Shell, ShellStatus } from '../lib/types'
import { type VerdictAction, verdictOf } from '../lib/verdict'
import { AgentMark } from './icons'
import { Button, CloseIcon, DropIcon, IconButton, Segmented, StatusTile } from './ui'

export interface CheckState {
  key: number
  folder: string
  shell: Shell
  /** The agent checked, e.g. `claude`. */
  tool: string
  /** The trigger folder that owns it, if any (from the config). */
  trigger: string | null
  preview: Preview | null
  result: FolderCheck | null
  error: string | null
}

export function Docket({
  check,
  shells,
  home,
  routedTools,
  shimsDir,
  primary,
  hovering,
  onRecheck,
  onAction,
  onDismiss,
}: {
  check: CheckState | null
  shells: ShellStatus[]
  home: string
  /** Agents some profile sets; the check can switch between them. */
  routedTools: string[]
  shimsDir: string
  hovering: string | null
  onRecheck: (shell: Shell, tool: string) => void
  onAction: (action: VerdictAction, shell: Shell) => void
  /** Whether the verdict's action may be the window's one accent button. */
  primary: boolean
  onDismiss: () => void
}) {
  const platform = usePlatform()
  // Each state renders the same footer, a polite live region throughout, so a result is announced as it replaces the drop zone.
  const base = 'mx-4 mb-4 flex min-h-[60px] shrink-0 items-center gap-x-4 gap-y-2.5 rounded-card px-4 py-3'

  if (hovering) {
    return (
      <footer aria-live="polite" className={`${base} bg-tint text-accent-ink shadow-[0_0_0_1.5px_var(--er-accent-ink)]`}>
        <DropIcon />
        <p className="min-w-0 truncate">
          Release to check <span className="font-mono text-small">{tildify(hovering, home)}</span>
        </p>
      </footer>
    )
  }

  if (!check) {
    const shell = shells.find((s) => s.isDefault && s.available) ?? shells.find((s) => s.available)
    return (
      <footer aria-live="polite" className={`${base} border-[1.5px] border-dashed border-ink-3/45 text-ink-2`}>
        <span className="shrink-0">
          <DropIcon />
        </span>
        <p className="min-w-0">
          Drop a folder on this window, or press <kbd className="font-sans">{shortcutLabel('o', platform)}</kbd>, to see which profile a new{' '}
          {shell?.shell ?? 'terminal'} window uses there.
        </p>
      </footer>
    )
  }

  const shell = shells.find((s) => s.shell === check.shell)
  const verdict =
    check.result && shell ? verdictOf(check.result, shell, check.tool, routedTools.includes(check.tool), shimsDir, home, check.trigger) : null
  const available = shells.filter((s) => s.available)

  return (
    <footer className={`${base} flex-wrap animate-[er-rise_180ms_var(--ease-settle)] bg-raised shadow-raised`} aria-live="polite">
      <div className="flex min-w-[300px] flex-1 items-start gap-3">
        <StatusTile
          key={`${check.key}-${check.error ? 'err' : (verdict?.tone ?? 'pending')}`}
          tone={check.error ? 'problem' : (verdict?.tone ?? 'pending')}
          size={28}
        />
        <div className="min-w-0 flex-1">
          {/* The headline wraps rather than truncating: it's the verdict. The folder gives way first. */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="font-semibold">
              {check.error
                ? "Couldn't check this folder"
                : verdict
                  ? verdict.headline
                  : `Checking ${toolLabel(check.tool)} in a new ${check.shell} window…`}
            </h2>
            <span className="min-w-0 max-w-full truncate font-mono text-small text-ink-2 select-text" title={check.folder}>
              {tildify(check.folder, home)}
            </span>
          </div>
          <div className="mt-0.5 text-small text-ink-2">
            {check.error ? (
              <p className="select-text">{check.error}</p>
            ) : verdict ? (
              <>
                {/* In a short window the note keeps to one line, so the cards above stay in view. */}
                {verdict.note && (
                  <p className="[@media(max-height:520px)]:line-clamp-1" title={verdict.note}>
                    {verdict.note}
                  </p>
                )}
                {verdict.values.length > 0 && (
                  <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {verdict.values.map((v) => (
                      <div key={v.label} className="flex min-w-0 gap-1.5">
                        <dt>{v.label}</dt>
                        <dd className="truncate font-mono text-ink select-text" title={v.value}>
                          {v.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            ) : (
              <p>
                The config says {check.preview?.profile ? <span className="text-ink">{check.preview.profile}</span> : 'no profile'}. Asking a real
                shell to be sure.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Wraps under the verdict in a narrow window rather than squeezing it. */}
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {verdict?.action && (
          <Button kind={primary ? 'primary' : 'push'} onClick={() => verdict.action && onAction(verdict.action, check.shell)}>
            {actionLabel(verdict.action, check.shell, home)}
          </Button>
        )}
        {routedTools.length > 1 && (
          <Segmented
            label="Agent"
            options={routedTools.map((t) => [t, toolLabel(t), <AgentMark key={t} command={t} size={12} />])}
            value={check.tool}
            onChange={(tool) => onRecheck(check.shell, tool)}
          />
        )}
        {available.length > 1 && (
          <Segmented
            label="Shell"
            options={available.map((s) => [s.shell, s.shell])}
            value={check.shell}
            onChange={(shell) => onRecheck(shell, check.tool)}
          />
        )}
        <IconButton label="Dismiss" onClick={onDismiss}>
          <CloseIcon />
        </IconButton>
      </div>
    </footer>
  )
}

function actionLabel(action: VerdictAction, shell: Shell, home: string) {
  switch (action.kind) {
    case 'enableShell':
      return `Turn On ${shell}`
    case 'openFile':
      return `Open ${tildify(action.path, home)}`
    case 'reinstall':
      return 'Reinstall Shim'
  }
}
