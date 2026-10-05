// The docket: the stamped result of the last folder check, docked along the bottom. One
// complete state at a time: pending, then a verdict, never a scrolling log.

import { tildify } from '../lib/paths'
import { toolLabel } from '../lib/tools'
import type { FolderCheck, Preview, Shell, ShellStatus } from '../lib/types'
import { type VerdictAction, verdictOf } from '../lib/verdict'
import { Button, CloseIcon, DropIcon, IconButton, StatusTile } from './ui'

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
  const base = 'mx-4 mb-4 flex min-h-[60px] shrink-0 flex-wrap items-center gap-x-4 gap-y-2.5 rounded-card px-4 py-3'

  if (hovering) {
    return (
      <footer className={`${base} bg-tint text-accent shadow-[0_0_0_1.5px_var(--er-accent)]`}>
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
      <footer className={`${base} border-[1.5px] border-dashed border-ink-3/45 text-ink-2`}>
        <DropIcon />
        <p>
          Drop a folder on this window, or press <kbd className="font-sans">⌘O</kbd>, to see which profile a new {shell?.shell ?? 'terminal'} window
          uses there.
        </p>
      </footer>
    )
  }

  const shell = shells.find((s) => s.shell === check.shell)
  const verdict =
    check.result && shell ? verdictOf(check.result, shell, check.tool, routedTools.includes(check.tool), shimsDir, home, check.trigger) : null
  const available = shells.filter((s) => s.available)

  return (
    <footer className={`${base} animate-[er-rise_180ms_var(--ease-settle)] bg-raised shadow-raised`} aria-live="polite">
      <div className="flex min-w-[300px] flex-1 items-start gap-3">
        <StatusTile
          key={`${check.key}-${check.error ? 'err' : (verdict?.tone ?? 'pending')}`}
          tone={check.error ? 'problem' : (verdict?.tone ?? 'pending')}
          size={28}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="truncate font-semibold">
              {check.error
                ? "Couldn't check this folder"
                : verdict
                  ? verdict.headline
                  : `Checking ${toolLabel(check.tool)} in a new ${check.shell} window…`}
            </h2>
            <span className="min-w-0 truncate font-mono text-small text-ink-2 select-text" title={check.folder}>
              {tildify(check.folder, home)}
            </span>
          </div>
          <div className="mt-0.5 text-small text-ink-2">
            {check.error ? (
              <p className="select-text">{check.error}</p>
            ) : verdict ? (
              <>
                {verdict.note && <p>{verdict.note}</p>}
                {verdict.values.length > 0 && (
                  <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
                    {verdict.values.map((v) => (
                      <div key={v.label} className="flex min-w-0 gap-1.5">
                        <dt>{v.label}</dt>
                        <dd className="truncate font-mono text-ink select-text">{v.value}</dd>
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
            options={routedTools.map((t) => [t, toolLabel(t)])}
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

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: [T, string][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="flex shrink-0 rounded-[7px] bg-[color-mix(in_srgb,var(--er-ink)_7%,transparent)] p-[2px]">
      <legend className="sr-only">{label}</legend>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`h-[22px] rounded-[5px] px-2.5 text-small whitespace-nowrap ${
            option === value ? 'bg-button text-ink shadow-[0_0.5px_1.5px_rgb(0_0_0/0.18)]' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {text}
        </button>
      ))}
    </fieldset>
  )
}
