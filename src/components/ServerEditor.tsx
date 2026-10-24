// The server editor: one MCP server's form (name, transport, command or URL, arguments, environment or
// headers, which profiles use it) with its Save, Revert, Duplicate and Delete footer.

import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'
import { confirmDeleteServer } from '../lib/confirm'
import {
  draftOf,
  initSlot,
  type ProfileChip,
  plainCredentials,
  plainNote,
  SERVER_NAME,
  type ServerDraft,
  serverOf,
  serverSummary,
  TRANSPORTS,
  type Transport,
  withInit,
} from '../lib/mcp'
import { usePlatform } from '../lib/platform'
import type { McpServer, ToolInfo } from '../lib/types'
import { setUnsaved } from '../lib/unsaved'
import { TransportIcon } from './icons'
import { Caution, LockLegend, PairList, ValueList } from './ServerFields'
import { ServerMark } from './ServerMark'
import { CheckSection } from './ServerTools'
import { VersionRow } from './ServerVersion'
import { Button, Footer, ProfileDot, Segmented, TextField } from './ui'

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
  const platform = usePlatform()
  const preview = serverOf(draft, platform.canLock)

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
    const built = serverOf(draft, platform.canLock)
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
  const plain = plainCredentials(draft, platform.canLock)
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
                    title={p.name}
                    className={`flex h-[28px] max-w-full items-center gap-1.5 rounded-full pr-3 pl-2.5 text-small transition-[background-color,box-shadow] duration-150 ease-settle ${
                      on
                        ? 'text-ink'
                        : 'text-ink-2 shadow-[inset_0_0_0_1px_var(--er-rule)] hover:bg-[color-mix(in_srgb,var(--er-ink)_5%,transparent)] hover:text-ink'
                    }`}
                    style={
                      on ? { background: `color-mix(in srgb, ${p.color} 16%, var(--er-card))`, boxShadow: `inset 0 0 0 1.5px ${p.color}` } : undefined
                    }
                  >
                    <ProfileDot color={p.color} size={2} className={on ? '' : 'opacity-70'} />
                    <span className="min-w-0 truncate">{p.name}</span>
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
            {plain.length > 0 && <Caution>{plainNote(plain, platform)}</Caution>}
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
            {plain.length > 0 && <Caution>{plainNote(plain, platform)}</Caution>}
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
