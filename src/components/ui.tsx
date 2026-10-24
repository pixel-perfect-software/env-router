// The window's control vocabulary: push buttons, a switch, a text field, state marks, icons,
// and profile colours. Everything else composes these.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef, useLayoutEffect, useRef, useState } from 'react'

type ButtonKind = 'push' | 'primary' | 'plain'
type ButtonSize = 'regular' | 'large' | 'toolbar'

const BUTTON: Record<ButtonKind, string> = {
  // Held open (a popover it opened, aria-expanded) it stays pressed, hovered or not.
  push: 'bg-button text-ink shadow-push hover:brightness-[0.97] active:brightness-90 aria-expanded:brightness-90 aria-expanded:hover:brightness-90',
  primary: 'bg-accent text-on-accent font-medium shadow-primary hover:brightness-105 active:brightness-90',
  plain: 'px-2 -mx-2 text-accent-ink hover:bg-tint active:brightness-90',
}

/**
 * Regular is the form control: a rounded rectangle at 26px. Large (a hero's one action, 28px) and
 * toolbar (the titlebar's controls) are capsules, as macOS 26 and later draw their bigger controls.
 */
const SIZE: Record<ButtonSize, string> = {
  regular: 'h-[26px] px-3 rounded-control',
  large: 'h-[28px] px-4 rounded-full',
  // macOS 27's toolbar items: 34pt pills in the 52pt band (measured).
  toolbar: 'h-[34px] px-3.5 rounded-full',
}

/**
 * `busy`: working on its last press. It looks disabled but keeps focus (`aria-disabled`, not
 * `disabled`, which would drop focus to the page), and ignores presses, a form's Return included.
 */
export function Button({
  kind = 'push',
  size = 'regular',
  busy = false,
  className = '',
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind; size?: ButtonSize; busy?: boolean }) {
  return (
    <button
      type="button"
      aria-disabled={busy || undefined}
      onClick={(e) => (busy ? e.preventDefault() : onClick?.(e))}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-body disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45 ${kind === 'plain' ? 'h-[26px] rounded-control' : `${SIZE[size]} forced-colors:border forced-colors:border-[ButtonText]`} ${BUTTON[kind]} ${className}`}
      {...props}
    />
  )
}

/**
 * An editor's footer on muted card: the leading actions, the inline error, then the closing
 * actions. Empty, the error is the spacer that pushes the closing actions right; once it says
 * something it takes its own row above them, so a sentence never squeezes between the buttons.
 */
export function Footer({ leading, error, errorId, children }: { leading?: ReactNode; error: string | null; errorId?: string; children: ReactNode }) {
  return (
    <footer className="flex flex-wrap items-center gap-2 bg-card-muted px-5 py-3 hair-t">
      {leading}
      <p id={errorId} role="alert" className={`min-w-0 text-small text-problem ${error ? 'order-first basis-full' : 'flex-1'}`}>
        {error}
      </p>
      {error && <span aria-hidden="true" className="flex-1" />}
      {children}
    </footer>
  )
}

/** A borderless square button for an icon, labelled for assistive tech. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string }>(function IconButton(
  { label, className = '', children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={`inline-grid size-[26px] shrink-0 place-items-center rounded-control text-ink-2 hover:bg-[color-mix(in_srgb,var(--er-ink)_8%,transparent)] hover:text-ink active:brightness-90 disabled:opacity-40 aria-pressed:bg-tint aria-pressed:text-accent-ink ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})

/** `busy`: as `Button`'s, it looks disabled and ignores presses but keeps focus. */
export function Switch({
  checked,
  onChange,
  label,
  busy = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  busy?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={busy || undefined}
      onClick={() => busy || onChange(!checked)}
      className={`relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors duration-150 aria-disabled:opacity-45 ${
        // Off, the track carries a field edge so the control's bounds hold 3:1 (WCAG 1.4.11).
        checked ? 'bg-accent' : 'bg-[color-mix(in_srgb,var(--er-ink)_18%,transparent)] shadow-[inset_0_0_0_1px_var(--er-field-edge)]'
      } forced-colors:border forced-colors:border-[ButtonText] forced-colors:forced-color-adjust-none ${checked ? 'forced-colors:bg-[Highlight]' : 'forced-colors:bg-[Canvas]'}`}
    >
      <span
        className={`absolute top-[1.5px] left-[1.5px] size-[13px] rounded-full bg-white shadow-[0_0.5px_1.5px_rgb(0_0_0/0.3)] transition-transform duration-150 ease-settle ${
          checked ? 'translate-x-[12px] forced-colors:bg-[HighlightText]' : 'forced-colors:bg-[ButtonText]'
        }`}
      />
    </button>
  )
}

/** A checkbox's box, for a row that is itself the `role="checkbox"` control: accent-filled with a drawn check when on. */
export function CheckBox({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-[14px] shrink-0 place-items-center rounded-[4px] transition-colors duration-100 ${
        checked
          ? 'bg-accent text-on-accent shadow-[0_0.5px_1px_rgb(0_0_0/0.2)] forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none'
          : 'bg-field shadow-[inset_0_0_0_1px_var(--er-field-edge)] forced-colors:border forced-colors:border-[ButtonText]'
      }`}
    >
      {checked && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.2 5.2l1.9 1.9 3.8-4.2" />
        </svg>
      )}
    </span>
  )
}

/**
 * A segmented control: a 7% ink track, the chosen segment raised on it. The toolbar's view switch
 * is a capsule like the controls beside it, and its raised thumb slides to the chosen segment, as
 * macOS 27's tabs do; in a form it stays a rounded rectangle and the chosen segment simply lifts.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'small',
}: {
  label: string
  /** `toolbar`: the titlebar's view switch, at toolbar-item height. */
  size?: 'small' | 'toolbar'
  /** Value, label, and an optional leading icon. */
  options: [T, string, ReactNode?][]
  value: T
  onChange: (value: T) => void
}) {
  const toolbar = size === 'toolbar'
  const track = useRef<HTMLFieldSetElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: the chosen segment moves with the value and the labels
  useLayoutEffect(() => {
    const el = track.current
    if (!toolbar || !el) return
    // Measured again whenever the track resizes, since the system font can arrive after the first frame.
    const place = () => {
      const chosen = el.querySelector<HTMLElement>('[aria-pressed="true"]')
      if (!chosen) return
      const [left, width] = [chosen.offsetLeft, chosen.offsetWidth]
      setThumb((t) => (t && t.left === left && t.width === width ? t : { left, width }))
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [toolbar, value, options.length])
  const raised = 'bg-button shadow-[0_0.5px_1.5px_rgb(0_0_0/0.18)] forced-colors:bg-[Highlight] forced-colors:forced-color-adjust-none'
  return (
    <fieldset ref={track} className={`relative flex w-fit shrink-0 bg-track p-[2px] ${toolbar ? 'rounded-full' : 'rounded-[7px]'}`}>
      <legend className="sr-only">{label}</legend>
      {toolbar && thumb && (
        <span
          aria-hidden="true"
          className={`absolute top-[2px] bottom-[2px] left-0 rounded-full transition-[translate,width] duration-200 ease-settle ${raised}`}
          style={{ width: thumb.width, translate: `${thumb.left}px 0` }}
        />
      )}
      {options.map(([option, text, icon]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`relative flex items-center gap-1.5 whitespace-nowrap transition-colors duration-150 ${toolbar ? 'h-[30px] rounded-full px-3.5 text-body' : 'h-[22px] rounded-[5px] px-2.5 text-small'} ${
            option === value
              ? `text-ink forced-colors:text-[HighlightText] forced-colors:forced-color-adjust-none ${toolbar ? '' : raised}`
              : 'text-ink-2 hover:text-ink'
          }`}
        >
          {icon}
          {text}
        </button>
      ))}
    </fieldset>
  )
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(function TextField(
  { mono, className = '', ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      className={`h-[28px] min-w-0 text-ellipsis rounded-control bg-field px-2 text-ink select-text shadow-[inset_0_0_0_1px_var(--er-field-edge)] placeholder:text-ink-2 placeholder:italic focus:shadow-[inset_0_0_0_1.5px_var(--er-accent-ink)] focus:outline-none forced-colors:border forced-colors:border-[ButtonText] ${
        mono ? 'font-mono text-small' : 'text-body'
      } ${className}`}
      {...props}
    />
  )
})

/** The printed state marks: on, off, problem, pending. Never colour alone: each has its own shape. */
export type MarkKind = 'on' | 'off' | 'problem' | 'pending'

export function Mark({ kind, className = '' }: { kind: MarkKind; className?: string }) {
  const common = { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true, className: `shrink-0 ${className}` } as const
  switch (kind) {
    case 'on':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.5" fill="currentColor" />
        </svg>
      )
    case 'off':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )
    case 'problem':
      return (
        <svg {...common} className={`${common.className} text-problem`}>
          <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      )
    case 'pending':
      return (
        <svg {...common} className={`${common.className} animate-[er-pending_1.1s_ease-in-out_infinite]`}>
          <circle cx="5" cy="5" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.4 2" />
        </svg>
      )
  }
}

export {
  BackIcon,
  BranchIcon,
  ChevronIcon,
  CloseIcon,
  DropIcon,
  FolderIcon,
  LockIcon,
  PencilIcon,
  PlugIcon,
  PlusIcon,
} from './icons'

/**
 * Profile colours: blues, purples, cyans and greys only, because red, amber and green belong
 * to status and a profile tag must never read as a verdict.
 */
const PROFILE_COLORS = ['#4f7cf0', '#c45ab8', '#1f9fbf', '#7a5af0', '#6577a8', '#4aa3e8', '#a35bdb', '#8a8f99']

const hash = (id: string) => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0
  return Math.abs(h)
}

/**
 * A colour per profile, keyed by id so it survives renames, reordering and other profiles
 * being added or deleted. A profile moves off its preferred colour only when another one
 * already holds it, so profiles on screen together never share a hue (up to eight).
 */
export function profileColors(ids: string[]): Map<string, string> {
  const taken = new Set<number>()
  const colors = new Map<string, string>()
  for (const id of ids) {
    let slot = hash(id) % PROFILE_COLORS.length
    for (let tries = 0; taken.has(slot) && tries < PROFILE_COLORS.length; tries++) slot = (slot + 1) % PROFILE_COLORS.length
    taken.add(slot)
    colors.set(id, PROFILE_COLORS[slot])
  }
  return colors
}

const DOT_SIZE = { 2: 'size-2', 2.5: 'size-2.5', 3: 'size-3' }

export function ProfileDot({ color, size = 2.5, className = '' }: { color: string; size?: keyof typeof DOT_SIZE; className?: string }) {
  return <span aria-hidden="true" className={`inline-block ${DOT_SIZE[size]} shrink-0 rounded-full ${className}`} style={{ background: color }} />
}

export type Tone = 'ok' | 'warn' | 'problem' | 'neutral' | 'pending'

const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', problem: 'text-problem', neutral: 'text-ink-2', pending: 'text-ink-2' }

/**
 * The status icon shared by the health banner and the check result: a tinted tile with a
 * glyph whose shape, not only its colour, says the state.
 */
export function StatusTile({ tone, size = 32, badge = false }: { tone: Tone; size?: number; badge?: boolean }) {
  // `badge`: a small solid disc with a white glyph, for a one-line status where a pale tile would wash out.
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center ${badge ? 'rounded-full forced-colors:border forced-colors:border-[CanvasText]' : 'rounded-[8px]'} ${TONE_TEXT[tone]} ${tone === 'pending' ? 'animate-[er-pending_1.1s_ease-in-out_infinite]' : 'animate-[er-stamp_180ms_var(--ease-settle)]'}`}
      style={{ width: size, height: size, background: badge ? 'currentColor' : 'color-mix(in srgb, currentColor 14%, transparent)' }}
    >
      <svg
        width={badge ? size * 0.62 : size / 2}
        height={badge ? size * 0.62 : size / 2}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        className={badge ? 'text-white dark:text-window forced-colors:text-[CanvasText]' : undefined}
        strokeWidth={badge ? 2.4 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {tone === 'ok' && <path d="M3.5 8.4l2.8 2.8 6.2-6.4" />}
        {tone === 'warn' && <path d="M8 3.5v5.5M8 12.2v.3" />}
        {tone === 'problem' && <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />}
        {tone === 'neutral' && <path d="M4 8h8" />}
        {tone === 'pending' && <circle cx="8" cy="8" r="4.5" strokeDasharray="3 2.4" />}
      </svg>
    </span>
  )
}
