// The server editor: one MCP server's form (name, transport, command or URL, arguments, environment or
// headers, which profiles use it) with its Save, Revert, Duplicate and Delete footer.

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { errorMessage, npmDistTags } from '../lib/api'
import { confirmDeleteServer } from '../lib/confirm'
import {
  type DraftValue,
  draftOf,
  initSlot,
  isPending,
  newSecretId,
  type Pair,
  type ProfileChip,
  plainCredentials,
  plainNote,
  SECRET_NAME,
  SERVER_NAME,
  type ServerDraft,
  serverOf,
  serverSummary,
  TRANSPORTS,
  type Transport,
  withInit,
} from '../lib/mcp'
import { newerRelease, npxPackage, pinnedArg, pinnedVersion, pinTarget } from '../lib/npm'
import { usePlatform } from '../lib/platform'
import type { McpServer, ToolInfo } from '../lib/types'
import { setUnsaved } from '../lib/unsaved'
import { TransportIcon } from './icons'
import { ServerMark } from './ServerMark'
import { CheckSection } from './ServerTools'
import { Button, CloseIcon, Footer, IconButton, LockIcon, PlusIcon, ProfileDot, Segmented, StatusTile, TextField } from './ui'

export function ServerEditor({
  name,
  server,
  template,
  taken,
  profiles,
  initialUsedBy,
  cachedTools,
  toolsOff,
  onDirty,
  onCancel,
  onSave,
  onDelete,
  onDuplicate,
  pinOnOpen = false,
  changedOutside = null,
}: {
  /** null for a new server. */
  name: string | null
  server: McpServer | undefined
  /** A new server's starting point: a catalog entry or a copy of another server. */
  template?: ServerDraft
  /** Other servers' names, which this one can't take. */
  taken: string[]
  profiles: ProfileChip[]
  /** Ids of the profiles that load this server now. */
  initialUsedBy: string[]
  cachedTools: ToolInfo[] | undefined
  toolsOff: Record<string, ProfileChip[]>
  onDirty: (dirty: boolean) => void
  /** Cancel on a new server. An existing one's Revert goes back to the saved server in place. */
  onCancel: () => void
  onSave: (name: string, server: McpServer, secrets: Record<string, string>, usedBy: string[]) => Promise<void>
  onDelete?: () => Promise<void>
  /** Opens a new server copied from the saved one (unsaved edits ask first). */
  onDuplicate?: () => void
  /** Pin an unpinned npm package as soon as the editor opens: a server just picked from the catalog. */
  pinOnOpen?: boolean
  /** config.json changed or dropped this server (the CLI, a hand edit) while this editor held unsaved edits. */
  changedOutside?: 'changed' | 'deleted' | null
}) {
  const initial = useRef(template ?? draftOf(name ?? '', server))
  const [draft, setDraft] = useState<ServerDraft>(initial.current)
  // Only the profiles switched here, on or off. The rest follow the saved assignment, which a
  // profile's own editor can change while this one waits behind the Profiles view.
  const [switched, setSwitched] = useState<Record<string, boolean>>({})
  const usedBy = profiles.map((p) => p.id).filter((id) => switched[id] ?? initialUsedBy.includes(id))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial.current) ||
    usedBy.length !== initialUsedBy.length ||
    usedBy.some((id) => !initialUsedBy.includes(id))

  /** Back to the saved server. A new one has nothing to go back to, so it closes instead. */
  const revert = () => {
    if (!name) return onCancel()
    setDraft(initial.current)
    setSwitched({})
    setError(null)
  }
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  useEffect(() => {
    setUnsaved('server', dirty)
    return () => setUnsaved('server', false)
  }, [dirty])

  useEffect(() => {
    // A new server starts at its name; an existing one keeps focus in the list it was picked from.
    if (!name) nameField.current?.focus()
  }, [name])

  const set = <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const preview = serverOf(draft)

  const save = async () => {
    const trimmed = draft.name.trim()
    const problem = !trimmed
      ? 'Give the server a name.'
      : !SERVER_NAME.test(trimmed)
        ? 'Use only letters, digits, - and _ in the name.'
        : taken.includes(trimmed)
          ? `There's already a server named ${trimmed}.`
          : null
    if (problem) {
      setError(problem)
      nameField.current?.focus()
      return
    }
    const built = serverOf(draft)
    if ('error' in built) {
      setError(built.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed, built.server, built.secrets, usedBy)
      // Saved: the assignment is the saved one now, so a later change from a profile shows here.
      setSwitched({})
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      // A save that changed only which profiles use the server keeps this editor open.
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!onDelete || !name) return
    if (
      !(await confirmDeleteServer(
        name,
        profiles.filter((p) => initialUsedBy.includes(p.id)).map((p) => p.name),
      ))
    )
      return
    setSaving(true)
    try {
      await onDelete()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const stdio = draft.transport === 'stdio'
  const initAt = stdio ? initSlot(draft.command, draft.args) : null
  const plain = plainCredentials(draft)
  return (
    <form
      aria-label={name ? `Edit ${name}` : 'New MCP server'}
      className="flex min-h-0 flex-1 animate-[er-fade_160ms_var(--ease-settle)] flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <header className="flex items-center gap-3 px-5 pt-4 pb-3 hair-b">
        {'server' in preview ? (
          <ServerMark name={draft.name || name || '?'} server={preview.server} size={36} />
        ) : (
          <ServerMark name={draft.name || name || '?'} server={server ?? { transport: 'stdio', command: '', args: [], env: {} }} size={36} />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-title font-semibold">{name ?? (draft.name.trim() || 'New Server')}</h2>
          <p className="truncate font-mono text-caption text-ink-2">{'server' in preview ? serverSummary(preview.server) : 'Not set up yet'}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pt-4 pb-5">
        {changedOutside && (
          <Caution tucked={false}>
            {changedOutside === 'deleted'
              ? 'config.json no longer has this server. Saving adds it back.'
              : 'config.json changed this server after you started editing. Saving replaces that change; Revert shows it.'}
          </Caution>
        )}
        {/* First: which profiles load the server is the part people change most. */}
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-small font-medium text-ink-2">Used by</legend>
          {profiles.length === 0 ? (
            <p className="text-small text-ink-2 italic">No profiles yet</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {profiles.map((p) => {
                const on = usedBy.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setSwitched((s) => ({ ...s, [p.id]: !on }))}
                    className={`flex h-[28px] items-center gap-1.5 rounded-full pr-3 pl-2.5 text-small transition-[background-color,box-shadow] duration-150 ease-settle ${
                      on
                        ? 'text-ink'
                        : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--er-rule)] hover:bg-[color-mix(in_srgb,var(--er-ink)_5%,transparent)] hover:text-ink'
                    }`}
                    style={
                      on ? { background: `color-mix(in srgb, ${p.color} 16%, var(--er-card))`, boxShadow: `inset 0 0 0 1.5px ${p.color}` } : undefined
                    }
                  >
                    <ProfileDot color={p.color} size={2} className={on ? '' : 'opacity-70'} />
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
          <p className="mt-1.5 text-caption text-ink-2">The agents load it in these profiles' folders.</p>
        </fieldset>

        <div>
          <label htmlFor="server-name" className="mb-1.5 block text-small font-medium text-ink-2">
            Name
          </label>
          <TextField
            ref={nameField}
            mono
            id="server-name"
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="github"
            aria-describedby="server-name-note"
            className="w-full"
          />
          <p id="server-name-note" className="mt-1 text-caption text-ink-2">
            Agents see this name. Letters, digits, - and _.
          </p>
        </div>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-small font-medium text-ink-2">Connects with</legend>
          <Segmented
            label="Transport"
            options={TRANSPORTS.map(([t, text]) => [t, text, <TransportIcon key={t} transport={t} size={12} />])}
            value={draft.transport}
            onChange={(t: Transport) => set('transport', t)}
          />
        </fieldset>

        {stdio ? (
          <>
            <div>
              <label htmlFor="server-command" className="mb-1.5 block text-small font-medium text-ink-2">
                Command
              </label>
              <TextField
                mono
                id="server-command"
                value={draft.command}
                onChange={(e) => set('command', e.target.value)}
                placeholder="npx"
                className="w-full"
              />
            </div>
            <ValueList
              label="Arguments"
              add="Add Argument"
              placeholder="-y"
              values={draft.args}
              onChange={(args) => set('args', args)}
              note={draft.args.length > 0 && <LockLegend />}
            />
            <VersionRow
              command={draft.command}
              args={draft.args}
              pinOnOpen={pinOnOpen}
              // The lookup takes a moment: the pin lands only if the argument is still what was pinned.
              onPin={(index, from, to) =>
                setDraft((d) => (d.args[index] === from ? { ...d, args: d.args.map((a, i) => (i === index ? to : a)) } : d))
              }
            />
            {initAt !== null && (
              <Caution
                action={
                  <Button onClick={() => set('args', withInit(draft.args, initAt))}>
                    Add <span className="font-mono">--init</span>
                  </Button>
                }
              >
                Without <span className="font-mono">--init</span>, the container keeps running after the agent stops it.
              </Caution>
            )}
            {plain.length > 0 && <Caution>{plainNote(plain)}</Caution>}
            <PairList
              label="Environment"
              add="Add Variable"
              keyPlaceholder="API_KEY"
              rows={draft.env}
              onChange={(env) => set('env', env)}
              note={draft.args.length === 0 && draft.env.length > 0 && <LockLegend />}
            />
          </>
        ) : (
          <>
            <div>
              <label htmlFor="server-url" className="mb-1.5 block text-small font-medium text-ink-2">
                URL
              </label>
              <TextField
                mono
                id="server-url"
                type="url"
                value={draft.url}
                onChange={(e) => set('url', e.target.value)}
                placeholder={draft.transport === 'sse' ? 'https://example.com/sse' : 'https://example.com/mcp'}
                className="w-full"
              />
            </div>
            {plain.length > 0 && <Caution>{plainNote(plain)}</Caution>}
            <PairList
              label="Headers"
              add="Add Header"
              keyPlaceholder="Authorization"
              rows={draft.headers}
              onChange={(headers) => set('headers', headers)}
              note={draft.headers.length > 0 && <LockLegend />}
            />
          </>
        )}
        <CheckSection name={draft.name.trim()} draft={draft} cached={cachedTools} toolsOff={toolsOff} />
      </div>

      <Footer
        leading={
          <>
            {onDelete && (
              <Button onClick={remove} disabled={saving}>
                Delete…
              </Button>
            )}
            {onDuplicate && (
              <Button onClick={onDuplicate} disabled={saving}>
                Duplicate
              </Button>
            )}
          </>
        }
        error={error}
      >
        <Button onClick={revert} disabled={saving || (!dirty && Boolean(name))}>
          {name ? 'Revert' : 'Cancel'}
        </Button>
        <Button kind="primary" type="submit" disabled={!dirty && Boolean(name)} busy={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </Footer>
    </form>
  )
}

/** A warning tucked under the field it's about (or, `tucked={false}`, about the whole server): a well with the amber tile, one line, and maybe a fix. */
function Caution({ children, action, tucked = true }: { children: ReactNode; action?: ReactNode; tucked?: boolean }) {
  return (
    <div role={tucked ? undefined : 'status'} className={`${tucked ? '-mt-3 ' : ''}flex items-center gap-2 rounded-[8px] bg-well py-1.5 pr-1.5 pl-2`}>
      <StatusTile tone="warn" size={20} />
      <p className="min-w-0 flex-1 py-0.5 text-small text-ink-2">{children}</p>
      {action}
    </div>
  )
}

/**
 * Under the arguments of an `npx` server: which release it runs. Unpinned, a caution with Pin
 * Version; pinned, the version and a way to look for a newer one. Both ask the user's own npm
 * (`npm view`), and only when clicked, or on opening a server picked from the catalog.
 */
function VersionRow({
  command,
  args,
  pinOnOpen,
  onPin,
}: {
  command: string
  args: DraftValue[]
  pinOnOpen: boolean
  onPin: (index: number, from: string, to: string) => void
}) {
  const pkg = npxPackage(command, args)
  // The last lookup, for the package it was about.
  const [lookup, setLookup] = useState<{ name: string; result: 'looking' | { tags: Record<string, string> } | { error: string } } | null>(null)
  const current = pkg && lookup?.name === pkg.name ? lookup.result : null
  const tags = current && current !== 'looking' && 'tags' in current ? current.tags : null
  const problem = current && current !== 'looking' && 'error' in current ? current.error : null

  const look = async (pin: boolean) => {
    if (!pkg) return
    const { name } = pkg
    setLookup({ name, result: 'looking' })
    try {
      const found = await npmDistTags(command.trim(), name)
      setLookup((l) => (l?.name === name ? { name, result: { tags: found } } : l))
      const target = pinTarget(pkg, found)
      if (pin && target) onPin(pkg.index, args[pkg.index] as string, pinnedArg(pkg, target))
    } catch (err) {
      setLookup((l) => (l?.name === name ? { name, result: { error: errorMessage(err) } } : l))
    }
  }

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (pinOnOpen && pkg && pinnedVersion(pkg) === null) look(true)
  })

  if (!pkg) return null
  const pinned = pinnedVersion(pkg)
  const looking = current === 'looking'
  if (pinned === null) {
    return (
      <Caution
        action={
          <Button onClick={() => look(true)} busy={looking}>
            {looking ? 'Looking Up…' : 'Pin Version'}
          </Button>
        }
      >
        {problem ?? (
          <>
            Not pinned: a new release of <span className="font-mono">{pkg.name}</span> runs in every session the day it's out.
          </>
        )}
      </Caution>
    )
  }
  const update = tags ? newerRelease(pinned, tags) : null
  return (
    <div className="-mt-3 flex min-h-[26px] items-center gap-2" aria-live="polite">
      <p className="min-w-0 flex-1 text-small text-ink-2">
        Pinned to <span className="font-mono text-ink">{pinned}</span>
        {problem ? (
          `. ${problem}`
        ) : update ? (
          <>
            . <span className="font-mono text-ink">{update}</span> is out.
          </>
        ) : tags ? (
          ', the newest release.'
        ) : (
          '.'
        )}
      </p>
      {update ? (
        <Button onClick={() => onPin(pkg.index, args[pkg.index] as string, pinnedArg(pkg, update))}>Update to {update}</Button>
      ) : (
        !tags && (
          <Button kind="plain" onClick={() => look(false)} busy={looking}>
            {looking ? 'Looking Up…' : 'Check for Update'}
          </Button>
        )
      )}
    </div>
  )
}

/** What the lock beside a value does, under the first list that has values: its tooltip takes too long to come up. */
function LockLegend() {
  const platform = usePlatform()
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
    const sealed = platform.isMac ? 'In Keychain' : `In the ${platform.secretStore}`
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
  const pending = isPending(value)
  return (
    <span className="relative flex min-w-0 flex-1">
      <TextField
        mono
        type={pending ? 'password' : 'text'}
        aria-label={label}
        value={pending ? value.value : value}
        onChange={(e) => onChange(pending ? { ...value, value: e.target.value } : e.target.value)}
        placeholder={hint ?? (pending ? `Saved to the ${platform.secretStore}` : placeholder)}
        className="w-full pr-8"
      />
      <IconButton
        // One name; aria-pressed says whether it's on. A name that flips with the state reads as its opposite.
        label={`Store ${label} in the ${platform.secretStore} on save`}
        aria-pressed={pending}
        onClick={() => onChange(pending ? value.value : { secret: newSecretId(), value })}
        className="absolute top-px right-px !size-[26px]"
      >
        <LockIcon />
      </IconButton>
    </span>
  )
}

function ValueList({
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

function PairList({
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
