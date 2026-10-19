// The window's control vocabulary: push buttons, a switch, a text field, state marks, icons,
// and profile colours. Everything else composes these.

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { forwardRef } from 'react'

type ButtonKind = 'push' | 'primary' | 'plain'

const BUTTON: Record<ButtonKind, string> = {
  push: 'h-[26px] px-3 rounded-control bg-button text-ink shadow-[0_0_0_0.5px_rgb(0_0_0/0.14),0_1px_2px_rgb(0_0_0/0.08)] hover:brightness-[0.97] active:brightness-90',
  primary:
    'h-[26px] px-3 rounded-control bg-accent text-on-accent font-medium shadow-[0_1px_2px_rgb(0_0_0/0.18)] hover:brightness-105 active:brightness-90',
  plain: 'h-[26px] px-2 -mx-2 rounded-control text-accent hover:bg-tint active:brightness-90',
}

export function Button({ kind = 'push', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: ButtonKind }) {
  return (
    <button
      type="button"
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-body disabled:pointer-events-none disabled:opacity-45 aria-disabled:opacity-45 ${BUTTON[kind]} ${className}`}
      {...props}
    />
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
      className={`inline-grid size-[26px] shrink-0 place-items-center rounded-control text-ink-2 hover:bg-[color-mix(in_srgb,var(--er-ink)_8%,transparent)] hover:text-ink active:brightness-90 disabled:opacity-40 ${className}`}
      {...props}
    >
      {children}
    </button>
  )
})

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[16px] w-[28px] shrink-0 rounded-full transition-colors duration-150 disabled:opacity-45 ${
        checked ? 'bg-accent' : 'bg-[color-mix(in_srgb,var(--er-ink)_18%,transparent)]'
      }`}
    >
      <span
        className={`absolute top-[1.5px] left-[1.5px] size-[13px] rounded-full bg-white shadow-[0_0.5px_1.5px_rgb(0_0_0/0.3)] transition-transform duration-150 ease-settle ${
          checked ? 'translate-x-[12px]' : ''
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
          ? 'bg-accent text-on-accent shadow-[0_0.5px_1px_rgb(0_0_0/0.2)]'
          : 'bg-field shadow-[inset_0_0_0_1px_var(--er-rule),0_0.5px_1px_rgb(0_0_0/0.06)]'
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

/** A segmented control: a 7% ink track, the chosen segment raised on it. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'small',
}: {
  label: string
  /** `toolbar`: the titlebar's view switch, at push-button height. */
  size?: 'small' | 'toolbar'
  /** Value, label, and an optional leading icon. */
  options: [T, string, ReactNode?][]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <fieldset className="flex w-fit shrink-0 rounded-[7px] bg-track p-[2px]">
      <legend className="sr-only">{label}</legend>
      {options.map(([option, text, icon]) => (
        <button
          key={option}
          type="button"
          aria-pressed={option === value}
          onClick={() => onChange(option)}
          className={`flex items-center gap-1.5 rounded-[5px] whitespace-nowrap ${size === 'toolbar' ? 'h-[24px] px-3 text-body' : 'h-[22px] px-2.5 text-small'} ${
            option === value ? 'bg-button text-ink shadow-[0_0.5px_1.5px_rgb(0_0_0/0.18)]' : 'text-ink-2 hover:text-ink'
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
      className={`h-[28px] min-w-0 rounded-control bg-field px-2 text-ink select-text shadow-[inset_0_0_0_1px_var(--er-field-edge)] placeholder:text-ink-2 placeholder:italic focus:shadow-[inset_0_0_0_1.5px_var(--er-accent)] focus:outline-none ${
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

export function ProfileDot({ color, className = '' }: { color: string; className?: string }) {
  return <span aria-hidden="true" className={`inline-block size-2.5 shrink-0 rounded-full ${className}`} style={{ background: color }} />
}

export type Tone = 'ok' | 'warn' | 'problem' | 'neutral' | 'pending'

const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', problem: 'text-problem', neutral: 'text-ink-2', pending: 'text-ink-2' }

/**
 * The status icon shared by the health banner and the check result: a tinted tile with a
 * glyph whose shape, not only its colour, says the state.
 */
export function StatusTile({ tone, size = 32 }: { tone: Tone; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[8px] ${TONE_TEXT[tone]} ${tone === 'pending' ? 'animate-[er-pending_1.1s_ease-in-out_infinite]' : 'animate-[er-stamp_180ms_var(--ease-settle)]'}`}
      style={{ width: size, height: size, background: 'color-mix(in srgb, currentColor 14%, transparent)' }}
    >
      <svg
        width={size / 2}
        height={size / 2}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
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
