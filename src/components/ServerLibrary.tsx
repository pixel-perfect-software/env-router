// The MCP server library: a right-side inspector like the profile editor. It opens on the list
// of servers; picking one (or Add Server…) drills into its form, where Save takes the accent.
// Which profile loads a server is chosen in that profile's editor, not here.

import { useEffect, useRef, useState } from 'react'
import { checkMcpServer, errorMessage } from '../lib/api'
import { confirmDeleteServer, confirmDiscardServer } from '../lib/confirm'
import {
  type DraftValue,
  draftOf,
  isPending,
  newSecretId,
  type Pair,
  profilesUsing,
  SECRET_NAME,
  SERVER_NAME,
  type ServerDraft,
  serverOf,
  serverSummary,
  TRANSPORTS,
  type Transport,
} from '../lib/mcp'
import type { ConfigState, McpServer, ServerCheck } from '../lib/types'
import {
  BackIcon,
  Button,
  ChevronIcon,
  CloseIcon,
  IconButton,
  LockIcon,
  PlugIcon,
  PlusIcon,
  ProfileDot,
  Segmented,
  StatusTile,
  TextField,
  type Tone,
} from './ui'

export function ServerLibrary({
  config,
  colors,
  onSave,
  onDelete,
  onClose,
}: {
  config: ConfigState
  /** Profile colours, so the list shows who uses each server. */
  colors: Map<string, string>
  onSave: (previous: string | null, name: string, server: McpServer, secrets: Record<string, string>) => Promise<void>
  onDelete: (name: string) => Promise<void>
  onClose: () => void
}) {
  // null: the list. '' : a new server. Otherwise the name of the server being edited.
  const [selected, setSelected] = useState<string | null>(null)
  const names = Object.keys(config.mcpServers).sort((a, b) => a.localeCompare(b))

  return (
    <>
      <div aria-hidden="true" className="absolute inset-0 z-30 animate-[er-fade_160ms_ease-out] bg-black/15 dark:bg-black/35" />
      <div className="absolute inset-y-0 right-0 z-40 flex w-[min(440px,calc(100%-40px))] animate-[er-slide_220ms_var(--ease-settle)] flex-col bg-raised shadow-raised">
        {selected === null ? (
          <ServerList config={config} names={names} colors={colors} onOpen={setSelected} onClose={onClose} />
        ) : (
          <ServerEditor
            key={selected}
            name={selected || null}
            server={selected ? config.mcpServers[selected] : undefined}
            taken={names.filter((n) => n !== selected)}
            usedBy={selected ? profilesUsing(config, selected).map((p) => ({ name: p.name, color: colors.get(p.id) ?? '' })) : []}
            onBack={() => setSelected(null)}
            onClose={onClose}
            onSave={async (name, server, secrets) => {
              await onSave(selected || null, name, server, secrets)
              setSelected(null)
            }}
            onDelete={
              selected
                ? async () => {
                    await onDelete(selected)
                    setSelected(null)
                  }
                : undefined
            }
          />
        )}
      </div>
    </>
  )
}

function ServerList({
  config,
  names,
  colors,
  onOpen,
  onClose,
}: {
  config: ConfigState
  names: string[]
  colors: Map<string, string>
  onOpen: (name: string) => void
  onClose: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => first.current?.focus(), [])
  return (
    <section
      aria-label="MCP servers"
      className="flex min-h-0 flex-1 animate-[er-fade_140ms_ease-out] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
    >
      <header className="flex items-center gap-2.5 px-5 pt-5 pb-3">
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">MCP Servers</h2>
        <IconButton label="Close" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="rounded-card bg-card shadow-card">
          {names.length === 0 ? (
            <p className="px-3 py-2.5 text-small text-ink-2 italic">No servers yet</p>
          ) : (
            <ul>
              {names.map((name, i) => {
                const server = config.mcpServers[name]
                const users = profilesUsing(config, name)
                return (
                  <li key={name} className="[&+&]:hair-t">
                    <button
                      ref={i === 0 ? first : undefined}
                      type="button"
                      onClick={() => onOpen(name)}
                      className="group/row flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)] focus-visible:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]"
                    >
                      <span className="text-ink-2">
                        <PlugIcon />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline gap-2">
                          <span className="truncate font-mono text-small text-ink">{name}</span>
                          <span className="shrink-0 text-caption text-ink-2">{TRANSPORTS.find(([t]) => t === server.transport)?.[1]}</span>
                        </span>
                        <span className="block truncate font-mono text-caption text-ink-2" title={serverSummary(server)}>
                          {serverSummary(server)}
                        </span>
                      </span>
                      {users.length > 0 && (
                        <span className="flex shrink-0 items-center -space-x-0.5" title={`Used by ${users.map((p) => p.name).join(', ')}`}>
                          {users.slice(0, 4).map((p) => (
                            <ProfileDot key={p.id} color={colors.get(p.id) ?? ''} className="size-2 ring-2 ring-card" />
                          ))}
                          <span className="sr-only">Used by {users.map((p) => p.name).join(', ')}</span>
                        </span>
                      )}
                      <span className="text-ink-2 opacity-60 group-hover/row:opacity-100">
                        <ChevronIcon />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        <Button className="mt-2" onClick={() => onOpen('')}>
          <PlusIcon />
          Add Server…
        </Button>
      </div>
      <footer className="flex items-center justify-end gap-2 bg-card-muted px-5 py-3 hair-t">
        <Button onClick={onClose}>Done</Button>
      </footer>
    </section>
  )
}

function ServerEditor({
  name,
  server,
  taken,
  usedBy,
  onBack,
  onClose,
  onSave,
  onDelete,
}: {
  /** null for a new server. */
  name: string | null
  server: McpServer | undefined
  /** Other servers' names, which this one can't take. */
  taken: string[]
  usedBy: { name: string; color: string }[]
  onBack: () => void
  onClose: () => void
  onSave: (name: string, server: McpServer, secrets: Record<string, string>) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const initial = useRef(draftOf(name ?? '', server))
  const [draft, setDraft] = useState<ServerDraft>(initial.current)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const asking = useRef(false)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current)

  useEffect(() => {
    nameField.current?.focus()
    if (name) nameField.current?.select()
  }, [name])

  const set = <K extends keyof ServerDraft>(key: K, value: ServerDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  /** Back, close and Escape all leave the form; unsaved edits only go once the user says so. */
  const leave = async (then: () => void) => {
    if (saving || asking.current) return
    if (dirty) {
      asking.current = true
      const discard = await confirmDiscardServer(name).finally(() => {
        asking.current = false
      })
      if (!discard) return
    }
    then()
  }

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
      await onSave(trimmed, built.server, built.secrets)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!onDelete || !name) return
    if (
      !(await confirmDeleteServer(
        name,
        usedBy.map((p) => p.name),
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
  return (
    <form
      aria-label={name ? `Edit ${name}` : 'New MCP server'}
      className="flex min-h-0 flex-1 animate-[er-fade_140ms_ease-out] flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') leave(onClose)
      }}
    >
      <header className="flex items-center gap-1.5 pt-5 pr-5 pb-3 pl-3">
        <IconButton label="All servers" onClick={() => leave(onBack)} disabled={saving}>
          <BackIcon />
        </IconButton>
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{name ?? 'New Server'}</h2>
        <IconButton label="Close" onClick={() => leave(onClose)} disabled={saving}>
          <CloseIcon />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-5">
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
          <Segmented label="Transport" options={TRANSPORTS} value={draft.transport} onChange={(t: Transport) => set('transport', t)} />
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
            <ValueList label="Arguments" add="Add Argument" placeholder="-y" values={draft.args} onChange={(args) => set('args', args)} />
            <PairList label="Environment" add="Add Variable" keyPlaceholder="API_KEY" rows={draft.env} onChange={(env) => set('env', env)} />
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
            <PairList
              label="Headers"
              add="Add Header"
              keyPlaceholder="Authorization"
              rows={draft.headers}
              onChange={(headers) => set('headers', headers)}
            />
          </>
        )}

        <CheckSection name={draft.name.trim()} draft={draft} />

        {name && (
          <div>
            <h3 className="mb-1.5 text-small font-medium text-ink-2">Used by</h3>
            {usedBy.length === 0 ? (
              <p className="text-small text-ink-2 italic">No profile loads it yet</p>
            ) : (
              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-small">
                {usedBy.map((p) => (
                  <li key={p.name} className="flex items-center gap-1.5">
                    <ProfileDot color={p.color} className="size-2" />
                    {p.name}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <footer className="flex items-center gap-2 bg-card-muted px-5 py-3 hair-t">
        {onDelete && (
          <Button onClick={remove} disabled={saving}>
            Delete…
          </Button>
        )}
        <p role="alert" className="min-w-0 flex-1 text-small text-problem">
          {error}
        </p>
        <Button onClick={() => leave(onBack)} disabled={saving}>
          Cancel
        </Button>
        <Button kind="primary" type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </footer>
    </form>
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
}: {
  value: DraftValue
  onChange: (value: DraftValue) => void
  label: string
  placeholder: string
}) {
  if (!isPending(value) && typeof value !== 'string') {
    return (
      <span className="flex h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-control bg-card-muted pr-1 pl-2 text-small text-ink-2 shadow-[inset_0_0_0_1px_var(--er-rule)]">
        <LockIcon />
        <span className="flex-1 italic">In Keychain</span>
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
        placeholder={pending ? 'Saved to the Keychain' : placeholder}
        className="w-full pr-8"
      />
      <IconButton
        label={pending ? `Keep ${label} in config.json` : `Keep ${label} in the Keychain`}
        aria-pressed={pending}
        onClick={() => onChange(pending ? value.value : { secret: newSecretId(), value })}
        className={`absolute top-px right-px !size-[26px] ${pending ? '!text-accent' : 'opacity-60 hover:opacity-100 focus-visible:opacity-100'}`}
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
}: {
  label: string
  add: string
  placeholder: string
  values: DraftValue[]
  onChange: (values: DraftValue[]) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-small font-medium text-ink-2">{label}</legend>
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
}: {
  label: string
  add: string
  keyPlaceholder: string
  rows: Pair[]
  onChange: (rows: Pair[]) => void
}) {
  const update = (i: number, row: Pair) => onChange(rows.map((r, j) => (j === i ? row : r)))
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-small font-medium text-ink-2">{label}</legend>
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
                label={row.key || `${label.toLowerCase()} ${i + 1}`}
                value={row.value}
                onChange={(value) => update(i, { ...row, value })}
                placeholder="value"
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

const CHECK_TONE: Record<ServerCheck['status'], Tone> = {
  ok: 'ok',
  needsLogin: 'warn',
  failed: 'problem',
  timedOut: 'problem',
  unsupported: 'neutral',
}

/**
 * Check Server: starts the server as the form describes it, unsaved edits and typed secrets
 * included, and shows what it offers or why it didn't answer. Editing the form clears the result.
 */
function CheckSection({ name, draft }: { name: string; draft: ServerDraft }) {
  const [state, setState] = useState<{ key: string; result: ServerCheck | 'running' | { error: string } } | null>(null)
  const key = JSON.stringify(draft)
  const current = state?.key === key ? state.result : null

  const run = async () => {
    const built = serverOf(draft)
    if ('error' in built) {
      setState({ key, result: { error: built.error } })
      return
    }
    setState({ key, result: 'running' })
    try {
      const result = await checkMcpServer(name, built.server, built.secrets)
      setState((s) => (s?.key === key ? { key, result } : s))
    } catch (err) {
      setState((s) => (s?.key === key ? { key, result: { error: errorMessage(err) } } : s))
    }
  }

  const running = current === 'running'
  const result = current && current !== 'running' && 'status' in current ? current : null
  const problem = current && current !== 'running' && 'error' in current ? current.error : null
  const tone: Tone = running ? 'pending' : result ? CHECK_TONE[result.status] : problem ? 'problem' : 'neutral'
  const headline = running
    ? 'Starting the server…'
    : result?.status === 'ok'
      ? `${result.tools.length} ${result.tools.length === 1 ? 'tool' : 'tools'}`
      : result?.status === 'needsLogin'
        ? 'Needs a sign-in'
        : result?.status === 'unsupported'
          ? 'Not checked'
          : result
            ? "Didn't answer"
            : problem
              ? "Can't check yet"
              : null

  return (
    <section aria-label="Server check" aria-live="polite">
      <div className="flex items-center gap-2.5">
        {headline ? (
          <>
            <StatusTile tone={tone} size={28} />
            <p className="min-w-0 flex-1 truncate font-medium">{headline}</p>
          </>
        ) : (
          <p className="min-w-0 flex-1 text-small text-ink-2 italic">Not checked yet</p>
        )}
        <Button onClick={run} disabled={running}>
          {result || problem ? 'Check Again' : 'Check Server'}
        </Button>
      </div>
      {(result?.message || problem) && <p className="mt-1.5 text-small text-ink-2">{result?.message ?? problem}</p>}
      {result?.log && (
        <pre className="mt-2 max-h-[120px] overflow-auto rounded-control bg-card-muted px-2 py-1.5 font-mono text-caption whitespace-pre-wrap text-ink-2 select-text shadow-[inset_0_0_0_1px_var(--er-rule)]">
          {result.log}
        </pre>
      )}
      {result?.status === 'ok' && result.tools.length > 0 && (
        <p className="mt-1.5 font-mono text-caption leading-[18px] text-ink-2 select-text">{result.tools.map((t) => t.name).join('  ')}</p>
      )}
    </section>
  )
}
