// Two more ways into the library, shown beside the server list: the catalog of well-known
// servers (a pick opens the editor, prefilled) and importing what the agents already define in
// their own files. Imports copy; the source files are never changed.

import { type ReactNode, useEffect, useRef, useState } from 'react'
import { errorMessage, importCandidates, parseMcpJson } from '../lib/api'
import {
  asServerName,
  draftFromCatalog,
  draftOf,
  freeName,
  isPending,
  plainCredentials,
  plainNote,
  SERVER_NAME,
  type ServerDraft,
  sameDefinition,
  sameEndpoint,
  serverOf,
  serverSummary,
  serverWithInit,
  suggestName,
  withSecretsLocked,
} from '../lib/mcp'
import { type Access, accessOf, type CatalogFilter, catalog, filterCatalog, isLocal } from '../lib/mcpCatalog'
import { tildify } from '../lib/paths'
import { usePlatform } from '../lib/platform'
import { withAgents } from '../lib/tools'
import type { ConfigState, ImportCandidate, McpServer } from '../lib/types'
import { LocalIcon, OpenIcon, RemoteIcon, SearchIcon, SignInIcon } from './icons'
import { ServerMark } from './ServerMark'
import { Button, CheckBox, ChevronIcon, CloseIcon, Footer, IconButton, LockIcon, Mark, Segmented, StatusTile, TextField } from './ui'

/**
 * The view's title bar. Its close button takes focus when the view opens: the button that
 * opened it may be gone, and focus would otherwise fall out of the view.
 */
function Header({
  title,
  count,
  onClose,
  disabled,
  focusClose = true,
}: {
  title: string
  /** Shown after the title in secondary ink, as the server list shows its own. */
  count?: number
  onClose: () => void
  disabled?: boolean
  /** Off where something in the view takes focus itself. */
  focusClose?: boolean
}) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (focusClose) close.current?.focus()
  }, [focusClose])
  return (
    <header className="flex items-center gap-1.5 px-5 pt-4 pb-3">
      <h2 className="min-w-0 flex-1 truncate text-title font-semibold">
        {title}
        {count !== undefined && <span className="font-normal text-ink-2"> {count}</span>}
      </h2>
      <IconButton ref={close} label={`Close ${title}`} onClick={onClose} disabled={disabled}>
        <CloseIcon />
      </IconButton>
    </header>
  )
}

/** What each kind of access reads as on a row, with its icon. */
const ACCESS: Record<Access, [string, ReactNode]> = {
  secret: ['Needs a secret', <LockIcon key="secret" />],
  mcp: ['Sign in with /mcp', <SignInIcon key="mcp" />],
  own: ['Signs in', <SignInIcon key="own" />],
  none: ['No sign-in', <OpenIcon key="none" />],
}

const NO_FILTER: CatalogFilter = { query: '', where: 'all', access: 'all' }

export function CatalogView({
  home,
  taken,
  library,
  onBack,
  onPick,
}: {
  home: string
  taken: string[]
  library: Record<string, McpServer>
  onBack: () => void
  onPick: (draft: ServerDraft) => void
}) {
  const platform = usePlatform()
  const names = new Set(taken)
  const [filter, setFilter] = useState<CatalogFilter>(NO_FILTER)
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => search.current?.focus(), [])
  const entries = filterCatalog(catalog(home), filter)
  const set = <K extends keyof CatalogFilter>(key: K, value: CatalogFilter[K]) => setFilter((f) => ({ ...f, [key]: value }))
  return (
    <section
      aria-label="Server catalog"
      className="flex min-h-0 flex-1 animate-[er-fade_160ms_var(--ease-settle)] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onBack()
      }}
    >
      <Header title="Catalog" count={entries.length} onClose={onBack} focusClose={false} />
      {/* The count, for a screen reader, as the search and filters narrow the list. */}
      <p role="status" className="sr-only">
        {entries.length === 1 ? '1 server' : `${entries.length} servers`}
      </p>
      <div className="flex flex-col gap-2 px-5 pb-3">
        <span className="relative flex">
          <span className="pointer-events-none absolute top-[7px] left-2 text-ink-2">
            <SearchIcon />
          </span>
          <TextField
            ref={search}
            type="text"
            role="searchbox"
            aria-label="Search the catalog"
            placeholder="Search by name or what it does"
            value={filter.query}
            onChange={(e) => set('query', e.target.value)}
            onKeyDown={(e) => {
              // Escape clears a search before it closes the catalog.
              if (e.key === 'Escape' && filter.query) {
                e.stopPropagation()
                set('query', '')
              }
            }}
            className="w-full pl-7"
          />
        </span>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Where it runs"
            options={[
              ['all', 'All'],
              ['remote', 'Hosted', <RemoteIcon key="remote" />],
              ['local', 'Runs locally', <LocalIcon key="local" />],
            ]}
            value={filter.where}
            onChange={(where) => set('where', where)}
          />
          <Segmented
            label="What it needs"
            options={[
              ['all', 'All'],
              ['none', 'No sign-in'],
              ['sign-in', 'Sign-in'],
              ['secret', 'Secret'],
            ]}
            value={filter.access}
            onChange={(access) => set('access', access)}
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-0.5 pb-5">
        {entries.length === 0 ? (
          <div className="flex items-center gap-2 rounded-[8px] bg-well py-1.5 pr-1.5 pl-3">
            <p className="min-w-0 flex-1 text-small text-ink-2 italic">No servers match</p>
            <Button kind="plain" onClick={() => setFilter(NO_FILTER)}>
              Clear Filters
            </Button>
          </div>
        ) : (
          <ul className="rounded-[8px] bg-well">
            {entries.map((entry) => {
              // "In the library" only when it's the same server, not just the same name.
              const added = Object.values(library).some((server) => sameEndpoint(server, entry.server))
              const local = isLocal(entry.server)
              const [needs, needsIcon] = ACCESS[accessOf(entry)]
              return (
                <li key={entry.name} className="[&+&]:hair-t">
                  <button
                    type="button"
                    onClick={() => onPick(draftFromCatalog(freeName(entry.name, names), entry.server, entry.secrets ?? {}))}
                    className="group/row flex w-full items-start gap-2.5 rounded-control px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]"
                  >
                    <ServerMark name={entry.name} server={entry.server} size={28} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
                        <span className="font-medium">{entry.label}</span>
                        <span className="flex items-center gap-1 text-caption text-ink-2">
                          {local ? <LocalIcon /> : <RemoteIcon />}
                          {local ? 'Runs locally' : 'Hosted'}
                        </span>
                        <span
                          className="flex items-center gap-1 text-caption text-ink-2"
                          title={accessOf(entry) === 'secret' ? `Kept in the ${platform.secretStore}` : undefined}
                        >
                          {needsIcon}
                          {needs}
                        </span>
                        {added && <span className="ml-auto text-caption text-ink-2">In the library</span>}
                      </span>
                      <span className="block text-small text-ink-2">{entry.description}</span>
                    </span>
                    <span className="mt-[3px] text-ink-2 opacity-60 group-hover/row:opacity-100">
                      <ChevronIcon />
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

interface Row {
  candidate: ImportCandidate
  /** The name it imports as: its own, or a free variant when the library or another row has it. */
  as: string
  /** Same name and definition as a library server: nothing to import. */
  present: boolean
  draft: ServerDraft
  /** Values that go to the Keychain. */
  locked: string[]
  /** A container that gets `--init`, so it stops when the agent does. */
  init: boolean
  /** Where it holds a credential that would stay plain text, as `plainCredentials` names them. */
  plain: string[]
}

/** A row's identity across reloads: its name and the files it came from. */
const keyOf = (row: Row) => [row.candidate.name, ...row.candidate.sources].join('\0')

function rowsOf(candidates: ImportCandidate[], config: ConfigState): Row[] {
  const taken = new Set(Object.keys(config.mcpServers))
  return candidates.map((candidate) => {
    const server = serverWithInit(candidate.server)
    const saved = config.mcpServers[candidate.name]
    // An earlier import may have added the --init, and moved a credential to the secret store.
    const present = sameDefinition(saved, candidate.server) || sameDefinition(saved, server)
    // A name agents can't take (`my server`) becomes one they can.
    const as = present ? candidate.name : freeName(asServerName(candidate.name), taken)
    if (!present) taken.add(as)
    const draft = withSecretsLocked(draftOf(as, server))
    const locked = [...draft.env, ...draft.headers].filter((row) => isPending(row.value)).map((row) => row.key)
    return { candidate, as, present, draft, locked, init: server !== candidate.server, plain: plainCredentials(draft) }
  })
}

/** Servers read from pasted JSON, named, and the entries that couldn't be used. */
export interface PastedServers {
  candidates: ImportCandidate[]
  skipped: string[]
}

export function ImportView({
  config,
  home,
  pasted,
  onBack,
  onImport,
  onElsewhere,
}: {
  config: ConfigState
  home: string
  /** Pasted servers to review in place of the agents' own. */
  pasted?: PastedServers
  onBack: () => void
  /** With nothing to import, the other ways to add a server. */
  onElsewhere: (where: 'catalog' | 'paste') => void
  onImport: (servers: [string, McpServer][], secrets: Record<string, string>) => Promise<void>
}) {
  const platform = usePlatform()
  const [rows, setRows] = useState<Row[] | null>(null)
  // By row identity, not position, so a reload keeps what the user ticked.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const seen = useRef(new Set<string>())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Runs again whenever the config is read again (the window regaining focus does that).
  useEffect(() => {
    let current = true
    setError(null)
    ;(pasted ? Promise.resolve(pasted.candidates) : importCandidates(withAgents(config)))
      .then((found) => {
        if (!current) return
        const next = rowsOf(found, config)
        // Rows shown before keep the user's choice; new ones start ticked unless they're in the library.
        const fresh = new Set(next.map(keyOf).filter((key) => !seen.current.has(key)))
        for (const row of next) seen.current.add(keyOf(row))
        setRows(next)
        setPicked((before) => new Set(next.filter((row) => !row.present && (fresh.has(keyOf(row)) || before.has(keyOf(row)))).map(keyOf)))
      })
      .catch((err) => current && setError(errorMessage(err)))
    return () => {
      current = false
    }
  }, [config, pasted])

  const run = async () => {
    if (!rows) return
    const servers: [string, McpServer][] = []
    const secrets: Record<string, string> = {}
    for (const row of rows.filter((r) => picked.has(keyOf(r)))) {
      const built = serverOf(row.draft)
      if ('error' in built) {
        setError(`${row.as}: ${built.error}`)
        return
      }
      servers.push([row.as, built.server])
      Object.assign(secrets, built.secrets)
    }
    setSaving(true)
    setError(null)
    try {
      await onImport(servers, secrets)
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const toggle = (key: string) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <section
      aria-label="Import servers"
      className="flex min-h-0 flex-1 animate-[er-fade_160ms_var(--ease-settle)] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) onBack()
      }}
    >
      <Header title={pasted ? 'Import Pasted Servers' : 'Import from Your Agents'} onClose={onBack} disabled={saving} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-0.5 pb-5">
        {pasted && pasted.skipped.length > 0 && (
          <p className="mb-2 text-small text-ink-2">
            Left out <span className="font-mono">{pasted.skipped.join(', ')}</span>: EnvRouter can't use{' '}
            {pasted.skipped.length === 1 ? 'its transport, values or sign-in' : 'their transports, values or sign-in'}.
          </p>
        )}
        {rows === null ? (
          !error && (
            <p className="flex items-center gap-2 text-small text-ink-2">
              <Mark kind="pending" />
              Reading your agents' MCP files…
            </p>
          )
        ) : rows.length === 0 ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-[8px] bg-well px-3 py-2">
            <p className="mr-auto text-small text-ink-2 italic">Your agents don't define any servers yet</p>
            <Button kind="plain" className="!mx-0 !h-[22px]" onClick={() => onElsewhere('catalog')}>
              Add from Catalog…
            </Button>
            <Button kind="plain" className="!mx-0 !h-[22px]" onClick={() => onElsewhere('paste')}>
              Paste JSON…
            </Button>
          </div>
        ) : (
          <ul className="rounded-[8px] bg-well">
            {rows.map((row) => (
              <li key={keyOf(row)} className="[&+&]:hair-t">
                <label
                  className={`relative flex w-full items-start gap-2.5 rounded-control px-3 py-2 focus-within-ring ${
                    row.present ? '' : 'hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={picked.has(keyOf(row))}
                    disabled={row.present}
                    onChange={() => toggle(keyOf(row))}
                  />
                  {/* A server already in the library fades its control and tile, never its text. */}
                  <span className={`mt-[7px] ${row.present ? 'opacity-40' : ''}`}>
                    <CheckBox checked={picked.has(keyOf(row))} />
                  </span>
                  <span className={row.present ? 'opacity-50' : ''}>
                    <ServerMark name={row.candidate.name} server={row.candidate.server} size={28} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-small text-ink">{row.as}</span>
                      {row.present ? (
                        <span className="text-caption text-ink-2">In the library</span>
                      ) : (
                        row.as !== row.candidate.name && (
                          <span className="text-caption text-ink-2">
                            <span className="font-mono">{row.candidate.name}</span>{' '}
                            {SERVER_NAME.test(row.candidate.name) ? 'is taken' : "isn't a name agents accept"}
                          </span>
                        )
                      )}
                    </span>
                    <span className="block truncate font-mono text-caption text-ink-2" title={serverSummary(row.candidate.server)}>
                      {serverSummary(row.candidate.server)}
                    </span>
                    {row.candidate.sources.length > 0 && (
                      <span className="block truncate text-caption text-ink-2" title={row.candidate.sources.join('\n')}>
                        from <span className="font-mono">{tildify(row.candidate.sources[0], home)}</span>
                        {row.candidate.sources.length > 1 && ` and ${row.candidate.sources.length - 1} more`}
                      </span>
                    )}
                    {row.locked.length > 0 && !row.present && (
                      <span className="mt-0.5 flex items-center gap-1 text-caption text-ink-2">
                        <LockIcon />
                        <span className="font-mono">{row.locked.join(', ')}</span> {row.locked.length === 1 ? 'goes' : 'go'} to the{' '}
                        {platform.secretStore}
                      </span>
                    )}
                    {row.plain.length > 0 && !row.present && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-caption text-ink-2">
                        <StatusTile tone="warn" size={14} />
                        {plainNote(row.plain)}
                      </span>
                    )}
                    {row.init && !row.present && (
                      <span className="mt-0.5 block text-caption text-ink-2">
                        Adds <span className="font-mono">--init</span>, so the container stops when the agent does
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Footer error={error}>
        <Button onClick={onBack} disabled={saving}>
          Cancel
        </Button>
        <Button kind="primary" onClick={run} disabled={saving || picked.size === 0}>
          {saving ? 'Importing…' : picked.size > 1 ? `Import ${picked.size} Servers` : 'Import Server'}
        </Button>
      </Footer>
    </section>
  )
}

/**
 * Paste JSON: a server's config as READMEs and agents write it. One server opens in the editor
 * to be named and finished; several go to the import review, like the agents' own.
 */
export function PasteView({
  taken,
  onBack,
  onOne,
  onMany,
}: {
  taken: string[]
  onBack: () => void
  onOne: (draft: ServerDraft) => void
  onMany: (pasted: PastedServers) => void
}) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const field = useRef<HTMLTextAreaElement>(null)
  useEffect(() => field.current?.focus(), [])

  const read = async () => {
    if (!text.trim() || reading) return
    setReading(true)
    setError(null)
    try {
      const { servers, skipped } = await parseMcpJson(text)
      const named = servers.map(({ name, server }) => ({ name: name ?? suggestName(server), server }))
      if (named.length === 1 && skipped.length === 0) {
        const [{ name, server }] = named
        onOne(withSecretsLocked(draftOf(freeName(name, new Set(taken)), serverWithInit(server))))
      } else {
        onMany({ candidates: named.map(({ name, server }) => ({ name, server, sources: [] })), skipped })
      }
    } catch (err) {
      setError(errorMessage(err))
      setReading(false)
    }
  }

  return (
    <section
      aria-label="Paste JSON"
      className="flex min-h-0 flex-1 animate-[er-fade_160ms_var(--ease-settle)] flex-col"
      onKeyDown={(e) => {
        // A paste isn't thrown away by a stray Escape; the close button still leaves.
        if (e.key === 'Escape' && !text.trim()) onBack()
      }}
    >
      <Header title="Paste JSON" onClose={onBack} focusClose={false} />
      <div className="flex min-h-0 flex-1 flex-col px-5 pt-0.5 pb-5">
        <textarea
          ref={field}
          aria-label="Server JSON"
          aria-describedby={error ? 'paste-note paste-error' : 'paste-note'}
          aria-invalid={error ? true : undefined}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void read()
            }
          }}
          placeholder={
            '{\n  "mcpServers": {\n    "github": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-github"]\n    }\n  }\n}'
          }
          className="min-h-[180px] flex-1 resize-none rounded-control bg-field px-2.5 py-2 font-mono text-small text-ink select-text shadow-[inset_0_0_0_1px_var(--er-field-edge)] placeholder:text-ink-2 placeholder:italic focus:shadow-[inset_0_0_0_1.5px_var(--er-accent-ink)] focus:outline-none forced-colors:border forced-colors:border-[ButtonText]"
        />
        <p id="paste-note" className="mt-1.5 text-caption text-ink-2">
          An mcpServers block from a README or an agent's file, VS Code's servers, or one server on its own.
        </p>
      </div>
      <Footer error={error} errorId="paste-error">
        <Button onClick={onBack} disabled={reading}>
          Cancel
        </Button>
        <Button kind="primary" onClick={read} disabled={reading || !text.trim()}>
          {reading ? 'Reading…' : 'Continue'}
        </Button>
      </Footer>
    </section>
  )
}
