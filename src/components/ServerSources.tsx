// Two more ways into the library, as views of its inspector: the catalog of well-known servers
// (a pick opens the editor, prefilled) and importing what the agents already define in their
// own files. Imports copy; the source files are never changed.

import { useEffect, useState } from 'react'
import { errorMessage, importCandidates } from '../lib/api'
import { draftFromCatalog, draftOf, freeName, isPending, type ServerDraft, serverOf, serverSummary, withSecretsLocked } from '../lib/mcp'
import { catalog } from '../lib/mcpCatalog'
import { tildify } from '../lib/paths'
import { withAgents } from '../lib/tools'
import type { ConfigState, ImportCandidate, McpServer } from '../lib/types'
import { BackIcon, Button, CheckBox, ChevronIcon, CloseIcon, IconButton, LockIcon, Mark } from './ui'

function Header({ title, onBack, onClose, disabled }: { title: string; onBack: () => void; onClose: () => void; disabled?: boolean }) {
  return (
    <header className="flex items-center gap-1.5 pt-5 pr-5 pb-3 pl-3">
      <IconButton label="All servers" onClick={onBack} disabled={disabled}>
        <BackIcon />
      </IconButton>
      <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{title}</h2>
      <IconButton label="Close" onClick={onClose} disabled={disabled}>
        <CloseIcon />
      </IconButton>
    </header>
  )
}

const TRANSPORT_LABEL: Record<McpServer['transport'], string> = { stdio: 'Command', http: 'HTTP', sse: 'SSE' }

export function CatalogView({
  home,
  taken,
  onBack,
  onClose,
  onPick,
}: {
  home: string
  taken: string[]
  onBack: () => void
  onClose: () => void
  onPick: (draft: ServerDraft) => void
}) {
  const names = new Set(taken)
  return (
    <section
      aria-label="Server catalog"
      className="flex min-h-0 flex-1 animate-[er-fade_140ms_ease-out] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onBack()
      }}
    >
      <Header title="Catalog" onBack={onBack} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <ul className="rounded-card bg-card shadow-card">
          {catalog(home).map((entry) => {
            const added = names.has(entry.name)
            return (
              <li key={entry.name} className="[&+&]:hair-t">
                <button
                  type="button"
                  onClick={() => onPick(draftFromCatalog(freeName(entry.name, names), entry.server, entry.secrets ?? {}))}
                  className="group/row flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-medium">{entry.label}</span>
                      <span className="text-caption text-ink-2">{TRANSPORT_LABEL[entry.server.transport]}</span>
                      {entry.secrets && (
                        <span className="self-center text-ink-2" title="Takes a secret, kept in the Keychain">
                          <LockIcon />
                        </span>
                      )}
                      {added && <span className="ml-auto text-caption text-ink-2">In the library</span>}
                    </span>
                    <span className="block text-small text-ink-2">{entry.description}</span>
                  </span>
                  <span className="text-ink-2 opacity-60 group-hover/row:opacity-100">
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
  onClose,
  onImport,
}: {
  config: ConfigState
  home: string
  onBack: () => void
  onClose: () => void
  onImport: (servers: [string, McpServer][], secrets: Record<string, string>) => Promise<void>
}) {
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
      className="flex min-h-0 flex-1 animate-[er-fade_140ms_ease-out] flex-col"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) onBack()
      }}
    >
      <Header title="Import Servers" onBack={onBack} onClose={onClose} disabled={saving} />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        {rows === null ? (
          !error && (
            <p className="flex items-center gap-2 text-small text-ink-2">
              <Mark kind="pending" />
              Reading your agents' MCP files…
            </p>
          )
        ) : rows.length === 0 ? (
          <p className="rounded-card bg-card px-3 py-2.5 text-small text-ink-2 italic shadow-card">Your agents don't define any servers yet</p>
        ) : (
          <ul className="rounded-card bg-card shadow-card">
            {rows.map((row, i) => (
              <li key={`${row.candidate.name}-${row.candidate.sources.join()}`} className="[&+&]:hair-t">
                <label
                  className={`flex w-full items-start gap-2.5 rounded-control px-3 py-2 has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-[color-mix(in_srgb,var(--er-accent)_50%,transparent)] has-[:focus-visible]:outline-solid ${
                    row.present ? 'opacity-60' : 'hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)]'
                  }`}
                >
                  <input type="checkbox" className="sr-only" checked={picked.has(i)} disabled={row.present} onChange={() => toggle(i)} />
                  <span className="mt-[2px]">
                    <CheckBox checked={picked.has(i)} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="font-mono text-small text-ink">{row.as}</span>
                      {row.present ? (
                        <span className="text-caption text-ink-2">In the library</span>
                      ) : (
                        row.as !== row.candidate.name && <span className="text-caption text-ink-2">{row.candidate.name} is taken</span>
                      )}
                    </span>
                    <span className="block truncate font-mono text-caption text-ink-2" title={serverSummary(row.candidate.server)}>
                      {serverSummary(row.candidate.server)}
                    </span>
                    <span className="block truncate text-caption text-ink-2" title={row.candidate.sources.join('\n')}>
                      from {tildify(row.candidate.sources[0], home)}
                      {row.candidate.sources.length > 1 && ` and ${row.candidate.sources.length - 1} more`}
                    </span>
                    {row.locked.length > 0 && !row.present && (
                      <span className="mt-0.5 flex items-center gap-1 text-caption text-ink-2">
                        <LockIcon />
                        {row.locked.join(', ')} {row.locked.length === 1 ? 'goes' : 'go'} to the Keychain
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
