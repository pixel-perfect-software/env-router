// Two more ways into the library, shown beside the server list: the catalog of well-known
// servers (a pick opens the editor, prefilled) and importing what the agents already define in
// their own files. Imports copy; the source files are never changed.

import { useEffect, useRef, useState } from 'react'
import { errorMessage, importCandidates } from '../lib/api'
import {
  draftFromCatalog,
  draftOf,
  freeName,
  isPending,
  type ServerDraft,
  sameEndpoint,
  serverOf,
  serverSummary,
  withSecretsLocked,
} from '../lib/mcp'
import { catalog } from '../lib/mcpCatalog'
import { tildify } from '../lib/paths'
import { usePlatform } from '../lib/platform'
import { withAgents } from '../lib/tools'
import type { ConfigState, ImportCandidate, McpServer } from '../lib/types'
import { TransportIcon } from './icons'
import { ServerMark } from './ServerMark'
import { Button, CheckBox, ChevronIcon, CloseIcon, IconButton, LockIcon, Mark } from './ui'

/**
 * The view's title bar. Its close button takes focus when the view opens: the button that
 * opened it may be gone, and focus would otherwise fall out of the view.
 */
function Header({ title, onClose, disabled }: { title: string; onClose: () => void; disabled?: boolean }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => close.current?.focus(), [])
  return (
    <header className="flex items-center gap-1.5 px-5 pt-4 pb-3">
      <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
      <IconButton ref={close} label={`Close ${title}`} onClick={onClose} disabled={disabled}>
        <CloseIcon />
      </IconButton>
    </header>
  )
}

const TRANSPORT_LABEL: Record<McpServer['transport'], string> = { stdio: 'Command', http: 'HTTP', sse: 'SSE' }

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
  return (
    <section
      aria-label="Server catalog"
      className="flex min-h-0 flex-1 animate-[er-fade_160ms_var(--ease-settle)] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onBack()
      }}
    >
      <Header title="Catalog" onClose={onBack} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-0.5 pb-5">
        <ul className="rounded-[8px] bg-well">
          {catalog(home).map((entry) => {
            // "In the library" only when it's the same server, not just the same name.
            const added = Object.values(library).some((server) => sameEndpoint(server, entry.server))
            return (
              <li key={entry.name} className="[&+&]:hair-t">
                <button
                  type="button"
                  onClick={() => onPick(draftFromCatalog(freeName(entry.name, names), entry.server, entry.secrets ?? {}))}
                  className="group/row flex w-full items-start gap-2.5 rounded-control px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]"
                >
                  <ServerMark name={entry.name} server={entry.server} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-medium">{entry.label}</span>
                      <span className="flex items-center gap-1 text-caption text-ink-2">
                        <TransportIcon transport={entry.server.transport} size={11} />
                        {TRANSPORT_LABEL[entry.server.transport]}
                      </span>
                      {entry.secrets && (
                        <span className="self-center text-ink-2" title={`Takes a secret, kept in the ${platform.secretStore}`}>
                          <LockIcon />
                        </span>
                      )}
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
}

function rowsOf(candidates: ImportCandidate[], config: ConfigState): Row[] {
  const taken = new Set(Object.keys(config.mcpServers))
  return candidates.map((candidate) => {
    const existing = config.mcpServers[candidate.name]
    const present = existing !== undefined && JSON.stringify(existing) === JSON.stringify(candidate.server)
    const as = present ? candidate.name : freeName(candidate.name, taken)
    if (!present) taken.add(as)
    const draft = withSecretsLocked(draftOf(as, candidate.server))
    const locked = [...draft.env, ...draft.headers].filter((row) => isPending(row.value)).map((row) => row.key)
    return { candidate, as, present, draft, locked }
  })
}

export function ImportView({
  config,
  home,
  onBack,
  onImport,
}: {
  config: ConfigState
  home: string
  onBack: () => void
  onImport: (servers: [string, McpServer][], secrets: Record<string, string>) => Promise<void>
}) {
  const platform = usePlatform()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let current = true
    importCandidates(withAgents(config))
      .then((found) => {
        if (!current) return
        const next = rowsOf(found, config)
        setRows(next)
        setPicked(new Set(next.flatMap((row, i) => (row.present ? [] : [i]))))
      })
      .catch((err) => current && setError(errorMessage(err)))
    return () => {
      current = false
    }
  }, [config])

  const run = async () => {
    if (!rows) return
    const servers: [string, McpServer][] = []
    const secrets: Record<string, string> = {}
    for (const i of picked) {
      const built = serverOf(rows[i].draft)
      if ('error' in built) {
        setError(`${rows[i].as}: ${built.error}`)
        return
      }
      servers.push([rows[i].as, built.server])
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

  const toggle = (i: number) =>
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(i)) next.delete(i)
      else next.add(i)
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
      <Header title="Import from Your Agents" onClose={onBack} disabled={saving} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-0.5 pb-5">
        {rows === null ? (
          !error && (
            <p className="flex items-center gap-2 text-small text-ink-2">
              <Mark kind="pending" />
              Reading your agents' MCP files…
            </p>
          )
        ) : rows.length === 0 ? (
          <p className="rounded-[8px] bg-well px-3 py-2.5 text-small text-ink-2 italic">Your agents don't define any servers yet</p>
        ) : (
          <ul className="rounded-[8px] bg-well">
            {rows.map((row, i) => (
              <li key={`${row.candidate.name}-${row.candidate.sources.join()}`} className="[&+&]:hair-t">
                <label
                  className={`relative flex w-full items-start gap-2.5 rounded-control px-3 py-2 focus-within-ring ${
                    row.present ? '' : 'hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={picked.has(i)} disabled={row.present} onChange={() => toggle(i)} />
                  {/* A server already in the library fades its control and tile, never its text. */}
                  <span className={`mt-[7px] ${row.present ? 'opacity-40' : ''}`}>
                    <CheckBox checked={picked.has(i)} />
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
                            <span className="font-mono">{row.candidate.name}</span> is taken
                          </span>
                        )
                      )}
                    </span>
                    <span className="block truncate font-mono text-caption text-ink-2" title={serverSummary(row.candidate.server)}>
                      {serverSummary(row.candidate.server)}
                    </span>
                    <span className="block truncate text-caption text-ink-2" title={row.candidate.sources.join('\n')}>
                      from <span className="font-mono">{tildify(row.candidate.sources[0], home)}</span>
                      {row.candidate.sources.length > 1 && ` and ${row.candidate.sources.length - 1} more`}
                    </span>
                    {row.locked.length > 0 && !row.present && (
                      <span className="mt-0.5 flex items-center gap-1 text-caption text-ink-2">
                        <LockIcon />
                        <span className="font-mono">{row.locked.join(', ')}</span> {row.locked.length === 1 ? 'goes' : 'go'} to the{' '}
                        {platform.secretStore}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </div>
      <footer className="flex items-center gap-2 bg-card-muted px-5 py-3 hair-t">
        <p role="alert" className="min-w-0 flex-1 text-small text-problem">
          {error}
        </p>
        <Button onClick={onBack} disabled={saving}>
          Cancel
        </Button>
        <Button kind="primary" onClick={run} disabled={saving || picked.size === 0}>
          {saving ? 'Importing…' : picked.size > 1 ? `Import ${picked.size} Servers` : 'Import Server'}
        </Button>
      </footer>
    </section>
  )
}
