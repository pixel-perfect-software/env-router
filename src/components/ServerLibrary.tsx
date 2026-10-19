// The Servers view: every MCP server in a list on the left, the chosen one's editor beside it.
// Catalog and Import open in the same place as the editor, so nothing drills more than one level
// deep. Which profiles load a server is set here (Used by) or in a profile's own editor.

import { useEffect, useRef, useState } from 'react'
import { checkMcpServer, errorMessage, getMcpTools } from '../lib/api'
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
import type { ConfigState, McpServer, ServerCheck, ToolInfo } from '../lib/types'
import { CatalogIcon, CheckIcon, ImportIcon, TransportIcon } from './icons'
import { ServerMark } from './ServerMark'
import { CatalogView, ImportView } from './ServerSources'
import { Button, CloseIcon, IconButton, LockIcon, PlusIcon, ProfileDot, Segmented, StatusTile, TextField, type Tone } from './ui'

/** What the detail side shows. `name` null: a new server, blank or from `template`. */
export type Detail = { kind: 'none' } | { kind: 'edit'; name: string | null; template?: ServerDraft } | { kind: 'catalog' } | { kind: 'import' }

/** A profile as the Used by toggles show it. */
interface ProfileChip {
  id: string
  name: string
  color: string
}

export function ServersView({
  config,
  home,
  colors,
  detail,
  onDetail,
  onSave,
  onImport,
  onDelete,
}: {
  config: ConfigState
  home: string
  /** Profile colours, so rows and toggles show who uses each server. */
  colors: Map<string, string>
  detail: Detail
  onDetail: (detail: Detail) => void
  onSave: (previous: string | null, name: string, server: McpServer, secrets: Record<string, string>, usedBy: string[]) => Promise<void>
  onImport: (servers: [string, McpServer][], secrets: Record<string, string>) => Promise<void>
  onDelete: (name: string) => Promise<void>
}) {
  const [tools, setTools] = useState<Record<string, ToolInfo[]>>({})
  // Unsaved edits in the editor; switching to another server asks before dropping them.
  const dirty = useRef(false)
  // Read again after every change of detail, so a check just run counts in the list.
  const detailKey = detail.kind === 'edit' ? `edit:${detail.name}` : detail.kind
  useEffect(() => {
    void detailKey
    let current = true
    getMcpTools()
      .then((found) => current && setTools(found))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [detailKey])
  const names = Object.keys(config.mcpServers).sort((a, b) => a.localeCompare(b))
  const profiles: ProfileChip[] = config.profiles.map((p) => ({ id: p.id, name: p.name, color: colors.get(p.id) ?? '' }))

  const go = async (next: Detail) => {
    if (dirty.current && !(await confirmDiscardServer(detail.kind === 'edit' ? detail.name : null))) return
    dirty.current = false
    onDetail(next)
  }
  const selected = detail.kind === 'edit' ? detail.name : null

  return (
    <div className="flex min-h-0 flex-1 gap-3 px-4 pt-1 pb-4">
      <aside aria-label="MCP servers" className="flex w-[232px] shrink-0 flex-col rounded-card bg-card shadow-card min-[820px]:w-[264px]">
        <header className="flex items-center gap-1 py-2 pr-2 pl-3.5 hair-b">
          <h2 className="min-w-0 flex-1 truncate text-title font-semibold">
            Servers <span className="font-normal text-ink-2">{names.length}</span>
          </h2>
          <IconButton label="Add Server" onClick={() => go({ kind: 'edit', name: null })}>
            <PlusIcon />
          </IconButton>
          <IconButton label="Add from Catalog" aria-pressed={detail.kind === 'catalog'} onClick={() => go({ kind: 'catalog' })}>
            <CatalogIcon />
          </IconButton>
          <IconButton label="Import from Your Agents" aria-pressed={detail.kind === 'import'} onClick={() => go({ kind: 'import' })}>
            <ImportIcon />
          </IconButton>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {names.length === 0 ? (
            <p className="px-2 py-2 text-small text-ink-2 italic">No servers yet</p>
          ) : (
            <ul className="space-y-px">
              {names.map((name) => {
                const server = config.mcpServers[name]
                const users = profilesUsing(config, name)
                const isSelected = name === selected
                return (
                  <li key={name}>
                    <button
                      type="button"
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => go({ kind: 'edit', name })}
                      className={`flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left ${
                        isSelected ? 'bg-tint' : 'hover:bg-[color-mix(in_srgb,var(--er-ink)_5%,transparent)]'
                      }`}
                    >
                      <ServerMark name={name} server={server} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-mono text-small ${isSelected ? 'text-accent' : 'text-ink'}`}>{name}</span>
                        <span className="flex items-center gap-1 text-caption text-ink-2">
                          <TransportIcon transport={server.transport} size={11} />
                          {TRANSPORTS.find(([t]) => t === server.transport)?.[1]}
                          {tools[name] && ` · ${tools[name].length} ${tools[name].length === 1 ? 'tool' : 'tools'}`}
                        </span>
                      </span>
                      {users.length > 0 && (
                        <span className="flex shrink-0 items-center gap-0.5" title={`Used by ${users.map((p) => p.name).join(', ')}`}>
                          {users.slice(0, 4).map((p) => (
                            <ProfileDot key={p.id} color={colors.get(p.id) ?? ''} className="size-2" />
                          ))}
                          <span className="sr-only">Used by {users.map((p) => p.name).join(', ')}</span>
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </aside>

      <section aria-label="Server details" className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-card bg-card shadow-card">
        {detail.kind === 'none' && <NoServer empty={names.length === 0} onPick={(next) => go(next)} />}
        {detail.kind === 'catalog' && (
          <CatalogView
            home={home}
            taken={names}
            onBack={() => onDetail({ kind: 'none' })}
            onPick={(template) => onDetail({ kind: 'edit', name: null, template })}
          />
        )}
        {detail.kind === 'import' && (
          <ImportView
            config={config}
            home={home}
            onBack={() => onDetail({ kind: 'none' })}
            onImport={async (servers, secrets) => {
              await onImport(servers, secrets)
              onDetail(servers.length === 1 ? { kind: 'edit', name: servers[0][0] } : { kind: 'none' })
            }}
          />
        )}
        {detail.kind === 'edit' && (
          <ServerEditor
            key={detail.name ?? `new-${detail.template?.name ?? ''}`}
            name={detail.name}
            server={detail.name ? config.mcpServers[detail.name] : undefined}
            template={detail.template}
            taken={names.filter((n) => n !== detail.name)}
            profiles={profiles}
            initialUsedBy={detail.name ? profilesUsing(config, detail.name).map((p) => p.id) : []}
            onDirty={(value) => {
              dirty.current = value
            }}
            onCancel={() => {
              dirty.current = false
              onDetail(detail.name ? { kind: 'edit', name: detail.name } : { kind: 'none' })
            }}
            onSave={async (name, server, secrets, usedBy) => {
              await onSave(detail.name, name, server, secrets, usedBy)
              dirty.current = false
              onDetail({ kind: 'edit', name })
            }}
            onDelete={
              detail.name
                ? async () => {
                    if (detail.name) await onDelete(detail.name)
                    dirty.current = false
                    onDetail({ kind: 'none' })
                  }
                : undefined
            }
          />
        )}
      </section>
    </div>
  )
}

/** The detail side with nothing chosen: the three ways a server gets here. */
function NoServer({ empty, onPick }: { empty: boolean; onPick: (detail: Detail) => void }) {
  return (
    <div className="grid flex-1 place-items-center p-6">
      <div className="flex max-w-[300px] flex-col items-center gap-3 text-center">
        <p className="text-small text-ink-2">{empty ? 'Add the MCP servers your agents should load.' : 'Choose a server, or add another.'}</p>
        <div className="flex flex-col gap-2">
          <Button onClick={() => onPick({ kind: 'catalog' })}>
            <CatalogIcon />
            Add from Catalog…
          </Button>
          <Button onClick={() => onPick({ kind: 'import' })}>
            <ImportIcon />
            Import from Your Agents…
          </Button>
          <Button onClick={() => onPick({ kind: 'edit', name: null })}>
            <PlusIcon />
            Add by Hand…
          </Button>
        </div>
      </div>
    </div>
  )
}

function ServerEditor({
  name,
  server,
  template,
  taken,
  profiles,
  initialUsedBy,
  onDirty,
  onCancel,
  onSave,
  onDelete,
}: {
  /** null for a new server. */
  name: string | null
  server: McpServer | undefined
  /** A new server's starting point, from the catalog. */
  template?: ServerDraft
  /** Other servers' names, which this one can't take. */
  taken: string[]
  profiles: ProfileChip[]
  /** Ids of the profiles that load this server now. */
  initialUsedBy: string[]
  onDirty: (dirty: boolean) => void
  onCancel: () => void
  onSave: (name: string, server: McpServer, secrets: Record<string, string>, usedBy: string[]) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const initial = useRef(template ?? draftOf(name ?? '', server))
  const [draft, setDraft] = useState<ServerDraft>(initial.current)
  const [usedBy, setUsedBy] = useState<string[]>(initialUsedBy)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(initial.current) ||
    usedBy.length !== initialUsedBy.length ||
    usedBy.some((id) => !initialUsedBy.includes(id))
  useEffect(() => onDirty(dirty), [dirty, onDirty])

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
                    onClick={() => setUsedBy((ids) => (on ? ids.filter((id) => id !== p.id) : [...ids, p.id]))}
                    className={`flex h-[28px] items-center gap-1.5 rounded-full pr-3 pl-2.5 text-small transition-[background-color,box-shadow] duration-150 ease-settle ${
                      on
                        ? 'text-ink'
                        : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--er-rule)] hover:bg-[color-mix(in_srgb,var(--er-ink)_5%,transparent)] hover:text-ink'
                    }`}
                    style={
                      on ? { background: `color-mix(in srgb, ${p.color} 16%, var(--er-card))`, boxShadow: `inset 0 0 0 1.5px ${p.color}` } : undefined
                    }
                  >
                    <ProfileDot color={p.color} className={`size-2 ${on ? '' : 'opacity-70'}`} />
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
          <p className="mt-1.5 text-caption text-ink-2">The agents load it in these profiles' folders.</p>
        </fieldset>
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
        <Button onClick={onCancel} disabled={saving || (!dirty && Boolean(name))}>
          {name ? 'Revert' : 'Cancel'}
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
  hint,
}: {
  value: DraftValue
  onChange: (value: DraftValue) => void
  label: string
  placeholder: string
  /** What to type, where it's known; shown in place of the placeholder. */
  hint?: string
}) {
  if (!isPending(value) && typeof value !== 'string') {
    return (
      <span className="flex h-[28px] min-w-0 flex-1 items-center gap-1.5 rounded-control bg-well pr-1 pl-2 text-small text-ink-2">
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
        placeholder={hint ?? (pending ? 'Saved to the Keychain' : placeholder)}
        className="w-full pr-8"
      />
      <IconButton
        // One name; aria-pressed says whether it's on. A name that flips with the state reads as its opposite.
        label={`Keep ${label} in the Keychain`}
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
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to the page. */}
        <Button onClick={running ? undefined : run} aria-disabled={running}>
          <CheckIcon />
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
