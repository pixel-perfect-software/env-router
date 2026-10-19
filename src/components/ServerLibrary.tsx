// The MCP server library: a right-side inspector like the profile editor. It opens on the list
// of servers; picking one (or Add Server…) drills into its form, where Save takes the accent.
// Which profile loads a server is chosen in that profile's editor, not here.

import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'
import { confirmDeleteServer, confirmDiscardServer } from '../lib/confirm'
import {
  draftOf,
  isSecret,
  type Pair,
  profilesUsing,
  SERVER_NAME,
  type ServerDraft,
  serverOf,
  serverSummary,
  TRANSPORTS,
  type Transport,
} from '../lib/mcp'
import type { ConfigState, McpServer, McpValue } from '../lib/types'
import { BackIcon, Button, ChevronIcon, CloseIcon, IconButton, LockIcon, PlugIcon, PlusIcon, ProfileDot, Segmented, TextField } from './ui'

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
  onSave: (previous: string | null, name: string, server: McpServer) => Promise<void>
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
            onSave={async (name, server) => {
              await onSave(selected || null, name, server)
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
  onSave: (name: string, server: McpServer) => Promise<void>
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
      await onSave(trimmed, built.server)
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

/** A value kept in the Keychain, shown in place of a field. Setting secrets arrives with Keychain support. */
function SecretValue() {
  return (
    <span className="flex h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-control bg-card-muted px-2 text-small text-ink-2 italic shadow-[inset_0_0_0_1px_var(--er-rule)]">
      <LockIcon />
      In Keychain
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
  values: McpValue[]
  onChange: (values: McpValue[]) => void
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
              {isSecret(value) ? (
                <SecretValue />
              ) : (
                <TextField
                  mono
                  aria-label={`${label} ${i + 1}`}
                  value={value}
                  onChange={(e) => onChange(values.map((v, j) => (j === i ? e.target.value : v)))}
                  placeholder={placeholder}
                  className="flex-1"
                />
              )}
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
                onChange={(e) => update(i, { ...row, key: e.target.value })}
                placeholder={keyPlaceholder}
                className="w-[46%]"
              />
              {isSecret(row.value) ? (
                <SecretValue />
              ) : (
                <TextField
                  mono
                  aria-label={`${row.key || label} value`}
                  value={row.value}
                  onChange={(e) => update(i, { ...row, value: e.target.value })}
                  placeholder="value"
                  className="flex-1"
                />
              )}
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
