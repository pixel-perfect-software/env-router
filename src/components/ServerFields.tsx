// The server editor's form pieces: the lists of arguments, variables and headers (with the lock that sends a value to the secret
// store) and the cautions tucked under a field.

import type { ReactNode } from 'react'
import { type DraftValue, isPending, newSecretId, type Pair, SECRET_NAME } from '../lib/mcp'
import { usePlatform } from '../lib/platform'
import { Button, CloseIcon, IconButton, LockIcon, PlusIcon, StatusTile, TextField } from './ui'

/** A warning tucked under the field it's about (or, `tucked={false}`, about the whole server): a well with the amber tile, one line, and maybe a fix. */
export function Caution({ children, action, tucked = true }: { children: ReactNode; action?: ReactNode; tucked?: boolean }) {
  return (
    <div role={tucked ? undefined : 'status'} className={`${tucked ? '-mt-3 ' : ''}flex items-center gap-2 rounded-[8px] bg-well py-1.5 pr-1.5 pl-2`}>
      <StatusTile tone="warn" size={20} />
      <p className="min-w-0 flex-1 py-0.5 text-small text-ink-2">{children}</p>
      {action}
    </div>
  )
}

/** What the lock beside a value does, under the first list that has values: its tooltip takes too long to come up. */
export function LockLegend() {
  const platform = usePlatform()
  if (!platform.canLock)
    return (
      <p className="mb-2 flex items-start gap-1 text-caption text-ink-2">
        <span className="mt-px">
          <LockIcon />
        </span>
        <span>
          The lock is off. The {platform.secretStore} can't keep a value: {platform.storeProblem?.replace(/\.$/, '')}. Values are saved in
          config.json.
        </span>
      </p>
    )
  return (
    <p className="mb-2 flex items-center gap-1 text-caption text-ink-2">
      Click <LockIcon /> to keep a value in the {platform.secretStore} instead of config.json.
    </p>
  )
}

/**
 * One value: a text field with a lock that sends it to the Keychain on save (the field then
 * masks it), or, for a value already there, a sealed well that can only be replaced. A stored
 * secret never comes back to the window.
 */
function ValueField({
  value,
  onChange,
  label,
  placeholder,
  hint,
}: {
  value: DraftValue
  onChange: (value: DraftValue) => void
  label: string
  placeholder: string
  /** What to type, where it's known; shown in place of the placeholder. */
  hint?: string
}) {
  const platform = usePlatform()
  if (!isPending(value) && typeof value !== 'string') {
    const sealed = platform.sealedLabel
    return (
      <span className="flex h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-control bg-well pr-1 pl-2 text-small text-ink-2">
        <LockIcon />
        <span className="min-w-0 flex-1 truncate italic" title={sealed}>
          {sealed}
        </span>
        <Button
          kind="plain"
          className="!mx-0 !h-[22px]"
          aria-label={`Replace ${label}`}
          onClick={() => onChange({ secret: newSecretId(), value: '' })}
        >
          Replace
        </Button>
      </span>
    )
  }
  // A value marked for the store stays plain while there is no store: `serverOf` saves it that way.
  const marked = isPending(value)
  const pending = marked && platform.canLock
  return (
    <span className="relative flex min-w-0 flex-1">
      <TextField
        mono
        type={pending ? 'password' : 'text'}
        aria-label={label}
        value={marked ? value.value : value}
        onChange={(e) => onChange(marked ? { ...value, value: e.target.value } : e.target.value)}
        placeholder={hint ?? (pending ? `Saved to the ${platform.secretStore}` : placeholder)}
        className="w-full pr-8"
      />
      <IconButton
        // One name; aria-pressed says whether it's on. A name that flips with the state reads as its opposite.
        label={`Store ${label} in the ${platform.secretStore} on save`}
        aria-pressed={pending}
        disabled={!platform.canLock}
        onClick={() => onChange(marked ? value.value : { secret: newSecretId(), value })}
        className="absolute top-px right-px !size-[26px]"
      >
        <LockIcon />
      </IconButton>
    </span>
  )
}

export function ValueList({
  label,
  add,
  placeholder,
  values,
  onChange,
  note,
}: {
  label: string
  add: string
  placeholder: string
  values: DraftValue[]
  onChange: (values: DraftValue[]) => void
  /** A line under the label, before the rows. */
  note?: ReactNode
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-small font-medium text-ink-2">{label}</legend>
      {note}
      {values.length > 0 && (
        <ol className="mb-2 space-y-1.5">
          {values.map((value, i) => (
            // Arguments have no identity but their place, and their order is the meaning.
            // biome-ignore lint/suspicious/noArrayIndexKey: see above
            <li key={i} className="flex items-center gap-1.5">
              <ValueField
                label={`${label.toLowerCase()} ${i + 1}`}
                value={value}
                onChange={(next) => onChange(values.map((v, j) => (j === i ? next : v)))}
                placeholder={placeholder}
              />
              <IconButton label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(values.filter((_, j) => j !== i))}>
                <CloseIcon />
              </IconButton>
            </li>
          ))}
        </ol>
      )}
      <Button onClick={() => onChange([...values, ''])}>
        <PlusIcon />
        {add}
      </Button>
    </fieldset>
  )
}

/** A new, still empty value follows its name: under API_KEY or Authorization it heads for the Keychain. */
const followName = (key: string, value: DraftValue): DraftValue => {
  const empty = value === '' || (isPending(value) && value.value === '')
  if (!empty) return value
  if (SECRET_NAME.test(key)) return isPending(value) ? value : { secret: newSecretId(), value: '' }
  return ''
}

export function PairList({
  label,
  add,
  keyPlaceholder,
  rows,
  onChange,
  note,
}: {
  label: string
  add: string
  keyPlaceholder: string
  rows: Pair[]
  onChange: (rows: Pair[]) => void
  /** A line under the label, before the rows. */
  note?: ReactNode
}) {
  const update = (i: number, row: Pair) => onChange(rows.map((r, j) => (j === i ? row : r)))
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-small font-medium text-ink-2">{label}</legend>
      {note}
      {rows.length > 0 && (
        <ul className="mb-2 space-y-1.5">
          {rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row's key is the text being edited, so it can't be the React key
            <li key={i} className="flex items-center gap-1.5">
              <TextField
                mono
                aria-label={`${label} name ${i + 1}`}
                value={row.key}
                onChange={(e) => update(i, { key: e.target.value, value: followName(e.target.value, row.value) })}
                placeholder={keyPlaceholder}
                className="w-[46%]"
              />
              <ValueField
                label={`${row.key || `${label.toLowerCase()} ${i + 1}`} value`}
                value={row.value}
                onChange={(value) => update(i, { ...row, value })}
                placeholder="value"
                hint={row.hint}
              />
              <IconButton label={`Remove ${row.key || `${label.toLowerCase()} ${i + 1}`}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <CloseIcon />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={() => onChange([...rows, { key: '', value: '' }])}>
        <PlusIcon />
        {add}
      </Button>
    </fieldset>
  )
}
