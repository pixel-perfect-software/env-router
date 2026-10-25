// The Servers view: every MCP server in a list on the left, the chosen one's editor beside it.
// Catalog and Import open in the same place as the editor, so nothing drills more than one level
// deep. Which profiles load a server is set here (Used by) or in a profile's own editor.

import type { MenuOptions } from '@tauri-apps/api/menu'
import { type ReactNode, type RefObject, useCallback, useEffect, useRef, useState } from 'react'
// The mark's folder handing its tracks to three servers: an empty library's hero.
import libraryArt from '../assets/servers-library.svg'
import { getMcpTools } from '../lib/api'
import { confirmDiscardServer } from '../lib/confirm'
import { duplicateDraft, type ProfileChip, profilesUsing, type ServerDraft, serverMatches, TRANSPORTS } from '../lib/mcp'
import { plural, queryWords } from '../lib/text'
import type { ConfigState, McpServer, ToolInfo } from '../lib/types'
import { CatalogIcon, ImportIcon, MoreIcon, PasteIcon, TransportIcon } from './icons'
import { ServerEditor } from './ServerEditor'
import { ServerMark } from './ServerMark'
import { CatalogView, ImportView, type PastedServers, PasteView } from './ServerSources'
import type { CheckRequest } from './ServerTools'
import { Button, ChevronIcon, IconButton, PlugIcon, PlusIcon, ProfileDot, SearchField } from './ui'

/** The filter field shows once the library has more servers than this: a handful reads at a glance. */
const FILTER_FROM = 5

/** What the detail side shows. `name` null: a new server, blank or from `template`. */
export type Detail =
  | { kind: 'none' }
  | { kind: 'edit'; name: string | null; template?: ServerDraft; pin?: boolean }
  | { kind: 'catalog' }
  | { kind: 'paste' }
  /** The agents' own servers, or `pasted` ones. */
  | { kind: 'import'; pasted?: PastedServers }

export function ServersView({
  config,
  home,
  colors,
  detail,
  onDetail,
  onSave,
  onImport,
  onConfirmDelete,
  onMenu,
  dirty,
}: {
  config: ConfigState
  home: string
  /** Profile colours, so rows and toggles show who uses each server. */
  colors: Map<string, string>
  detail: Detail
  onDetail: (detail: Detail) => void
  onSave: (previous: string | null, name: string, server: McpServer, secrets: Record<string, string>, usedBy: string[]) => Promise<void>
  onImport: (servers: [string, McpServer][], secrets: Record<string, string>) => Promise<void>
  /** Delete…, from the editor or a row's menu: asks first, deletes, and answers whether the server went. A failure is the window's banner to show. */
  onConfirmDelete: (name: string) => Promise<boolean>
  /** Pops a native menu at the pointer, or under `below` (the window's `popupMenu`). */
  onMenu: (items: MenuOptions['items'], below?: HTMLElement) => Promise<void>
  /** Unsaved edits in the editor; switching to another server asks before dropping them. The window's, so a card's server link asks too. */
  dirty: RefObject<boolean>
}) {
  const [tools, setTools] = useState<Record<string, ToolInfo[]>>({})
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
  // While the editor holds edits, it keeps the definition it opened with: a focus reload that
  // brings an outside change to this server (the CLI, a hand edit) would otherwise remount it
  // and drop the draft. The editor says what changed under it instead.
  const [holding, setHolding] = useState(false)
  const saved = detail.kind === 'edit' && detail.name ? JSON.stringify(config.mcpServers[detail.name] ?? null) : null
  const [openedWith, setOpenedWith] = useState(saved)
  if (!holding && openedWith !== saved) setOpenedWith(saved)
  const changedOutside = holding && openedWith !== saved ? (saved === 'null' ? 'deleted' : 'changed') : null
  // Stable, so the editor reports only when its dirty state flips, never mid-save.
  const onEditorDirty = useCallback(
    (value: boolean) => {
      dirty.current = value
      setHolding(value)
    },
    [dirty],
  )
  const names = Object.keys(config.mcpServers).sort((a, b) => a.localeCompare(b))
  const profiles: ProfileChip[] = config.profiles.map((p) => ({ id: p.id, name: p.name, color: colors.get(p.id) ?? '' }))

  /** Moves the detail side to `next`, asking before it drops unsaved edits. Answers whether it moved. */
  const go = async (next: Detail) => {
    if (dirty.current && !(await confirmDiscardServer(detail.kind === 'edit' ? detail.name : null))) return false
    dirty.current = false
    onDetail(next)
    return true
  }
  const selected = detail.kind === 'edit' ? detail.name : null

  // The list's filter lives as long as the window, not in config.json. The view stays mounted while Profiles shows, so it holds across a trip there.
  const [query, setQuery] = useState('')
  const search = useRef<HTMLInputElement>(null)
  const filtering = query.trim() !== ''
  // Typed words keep the field on screen even when deleting servers brings the library back under the threshold.
  const showFilter = names.length > FILTER_FROM || query !== ''
  const words = queryWords(query)
  const shown = names.filter((name) => serverMatches(name, config.mcpServers[name], words))
  const clearFilter = () => {
    setQuery('')
    search.current?.focus()
  }

  const duplicate = (name: string) => go({ kind: 'edit', name: null, template: duplicateDraft(name, config.mcpServers[name], new Set(names)) })
  // A click on a row's Check Server, until that server's editor takes it (once: a later remount mustn't check again, since a check is a click's).
  const [checkRequest, setCheckRequest] = useState<CheckRequest | null>(null)
  /** Checks in the editor, where the result files. The open server is checked as its form stands (edits too); another one opens first, asking about edits. */
  const check = async (name: string) => {
    if ((detail.kind === 'edit' && detail.name === name) || (await go({ kind: 'edit', name }))) setCheckRequest({ name })
  }
  /** The row that takes a deleted server's place, for focus: the next one in the library that the filter shows, else the one before it. */
  const neighbourOf = (name: string) => {
    const at = names.indexOf(name)
    return (
      names.slice(at + 1).find((n) => shown.includes(n)) ??
      names
        .slice(0, at)
        .reverse()
        .find((n) => shown.includes(n))
    )
  }
  /** Focus after a server left the list: the row that took its place, or the + button. */
  const focusRow = (name: string | undefined) =>
    requestAnimationFrame(() => {
      const row = name ? document.querySelector<HTMLElement>(`[data-server="${CSS.escape(name)}"]`) : null
      if (document.activeElement === document.body) (row ?? document.getElementById('add-server'))?.focus()
    })
  const remove = async (name: string) => {
    const next = neighbourOf(name)
    if (await onConfirmDelete(name)) focusRow(next)
  }

  // The server whose menu is open, which keeps its "…" in view and its row washed: `popup` answers when the menu is dismissed.
  const [menuFor, setMenuFor] = useState<string | null>(null)
  /** A row's menu, from a right-click (at the pointer) or its "…" (under the button), so the keyboard reaches what the pointer does. */
  const showMenu = async (name: string, below?: HTMLElement) => {
    setMenuFor(name)
    try {
      await onMenu(
        [
          { id: 'duplicate', text: 'Duplicate…', action: () => duplicate(name) },
          { id: 'check', text: 'Check Server', action: () => check(name) },
          { item: 'Separator' as const },
          { id: 'delete', text: 'Delete…', action: () => remove(name) },
        ],
        below,
      )
    } catch {
      // No native menu (the browser preview): the editor carries the same three.
    } finally {
      setMenuFor(null)
    }
  }
  /** Leaves Catalog, Paste or Import with focus on the header button that opens it, rather than on the page. */
  const back = (opener: string) => {
    onDetail({ kind: 'none' })
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLElement>(`aside [aria-label="${opener}"]`)?.focus()
    })
  }

  return (
    <main aria-label="MCP Servers" className="flex min-h-0 flex-1 gap-3 px-4 pt-2 pb-4">
      <aside aria-label="MCP servers" className="flex w-[232px] shrink-0 flex-col rounded-card bg-card shadow-card min-[820px]:w-[264px]">
        <header className="flex items-center gap-1 py-2 pr-2 pl-3.5 hair-b">
          <h2 className="min-w-0 flex-1 truncate text-title font-semibold">
            Servers <span className="font-normal text-ink-2">{filtering ? `${shown.length}/${names.length}` : names.length}</span>
          </h2>
          <IconButton id="add-server" label="Add by Hand" onClick={() => go({ kind: 'edit', name: null })}>
            <PlusIcon />
          </IconButton>
          {/* Each opens its view in the detail card, and pressed again, closes it. */}
          <IconButton
            label="Add from Catalog"
            aria-pressed={detail.kind === 'catalog'}
            onClick={() => go(detail.kind === 'catalog' ? { kind: 'none' } : { kind: 'catalog' })}
          >
            <CatalogIcon />
          </IconButton>
          <IconButton
            label="Import from Your Agents"
            aria-pressed={detail.kind === 'import' && !detail.pasted}
            onClick={() => go(detail.kind === 'import' && !detail.pasted ? { kind: 'none' } : { kind: 'import' })}
          >
            <ImportIcon />
          </IconButton>
          <IconButton
            label="Paste JSON"
            aria-pressed={detail.kind === 'paste' || (detail.kind === 'import' && Boolean(detail.pasted))}
            onClick={() => go(detail.kind === 'paste' || (detail.kind === 'import' && detail.pasted) ? { kind: 'none' } : { kind: 'paste' })}
          >
            <PasteIcon />
          </IconButton>
        </header>
        {showFilter && (
          <div className="px-1.5 pt-1.5">
            <SearchField ref={search} label="Filter servers" placeholder="Filter servers" value={query} onChange={setQuery} />
            {/* The count, for a screen reader, as the filter narrows the list. */}
            <p role="status" className="sr-only">
              {filtering ? `${plural(shown.length, 'server', 'servers')} shown` : ''}
            </p>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {names.length === 0 ? (
            <p className="px-2 py-2 text-small text-ink-2 italic">No servers yet</p>
          ) : shown.length === 0 ? (
            // Stacked, not side by side as in the Catalog: the list is 232px wide at the minimum window.
            <div className="rounded-[8px] bg-well px-3 py-2">
              <p className="text-small text-ink-2 italic">No servers match</p>
              <Button kind="plain" onClick={clearFilter}>
                Clear Filter
              </Button>
            </div>
          ) : (
            <ul className="space-y-px">
              {shown.map((name) => {
                const server = config.mcpServers[name]
                const users = profilesUsing(config, name)
                const isSelected = name === selected
                return (
                  <li
                    key={name}
                    className={`group/row relative rounded-[7px] ${
                      isSelected
                        ? 'bg-tint'
                        : `hover:bg-[color-mix(in_srgb,var(--er-ink)_5%,transparent)] ${menuFor === name ? 'bg-[color-mix(in_srgb,var(--er-ink)_5%,transparent)]' : ''}`
                    }`}
                  >
                    <button
                      type="button"
                      data-server={name}
                      aria-current={isSelected ? 'true' : undefined}
                      onClick={() => go({ kind: 'edit', name })}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        // The context-menu key (or Shift+F10) sends a `contextmenu` with no right button: it opens under the row, not at a pointer that's elsewhere.
                        // Ctrl-click on a Mac is a pointer's.
                        const fromKeyboard = event.button === 0 && !event.ctrlKey
                        void showMenu(name, fromKeyboard ? event.currentTarget : undefined)
                      }}
                      className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-left"
                    >
                      <ServerMark name={name} server={server} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-mono text-small ${isSelected ? 'text-accent-ink' : 'text-ink'}`}>{name}</span>
                        <span className="flex items-center gap-1 text-caption text-ink-2">
                          <TransportIcon transport={server.transport} size={11} />
                          {TRANSPORTS.find(([t]) => t === server.transport)?.[1]}
                          {tools[name] && ` · ${plural(tools[name].length, 'tool', 'tools')}`}
                        </span>
                      </span>
                      {/* The right edge is the dots' place, 26px wide at least: the "…" sits over it, so no row's text runs under that button.
                          The dots give way while the row is hovered or the button focused or open. */}
                      <span
                        className="flex min-w-[26px] shrink-0 items-center justify-end gap-0.5 group-hover/row:opacity-0 group-has-[[aria-haspopup]:focus-visible]/row:opacity-0 group-has-[[aria-expanded=true]]/row:opacity-0"
                        title={users.length > 0 ? `Used by ${users.map((p) => p.name).join(', ')}` : undefined}
                      >
                        {users.slice(0, 4).map((p) => (
                          <ProfileDot key={p.id} color={colors.get(p.id) ?? ''} size={2} />
                        ))}
                        {users.length > 0 && <span className="sr-only">Used by {users.map((p) => p.name).join(', ')}</span>}
                      </span>
                    </button>
                    {/* The right-click menu for the keyboard, as a folder row has: quiet until the row is hovered or the button focused, and held in
                        view, pressed, while its menu is open. A sibling of the row's button, since a button can't hold one. */}
                    <IconButton
                      label={`Actions for ${name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuFor === name}
                      className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
                      onClick={(event) => void showMenu(name, event.currentTarget)}
                    >
                      <MoreIcon />
                    </IconButton>
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
            library={config.mcpServers}
            onBack={() => back('Add from Catalog')}
            onPick={(template) => onDetail({ kind: 'edit', name: null, template, pin: true })}
          />
        )}
        {detail.kind === 'paste' && (
          <PasteView
            taken={names}
            onBack={() => back('Paste JSON')}
            onOne={(template) => onDetail({ kind: 'edit', name: null, template })}
            onMany={(pasted) => onDetail({ kind: 'import', pasted })}
          />
        )}
        {detail.kind === 'import' && (
          <ImportView
            // Agents' and pasted servers are separate reviews; switching starts the other afresh.
            key={detail.pasted ? 'pasted' : 'agents'}
            config={config}
            home={home}
            pasted={detail.pasted}
            onBack={() => back(detail.pasted ? 'Paste JSON' : 'Import from Your Agents')}
            onElsewhere={(where) => onDetail({ kind: where })}
            onImport={async (servers, secrets) => {
              await onImport(servers, secrets)
              // What came in shows, whatever the filter was.
              setQuery('')
              onDetail(servers.length === 1 ? { kind: 'edit', name: servers[0][0] } : { kind: 'none' })
            }}
          />
        )}
        {detail.kind === 'edit' && (
          <ServerEditor
            // Keyed by the definition it opened with, so saving a change reopens the editor from
            // what was saved (a typed secret sealed again) instead of leaving the draft in place.
            key={detail.name ? `${detail.name}:${openedWith}` : `new-${detail.template?.name ?? ''}`}
            name={detail.name}
            server={detail.name ? config.mcpServers[detail.name] : undefined}
            template={detail.template}
            pinOnOpen={detail.pin}
            checkRequest={checkRequest?.name === detail.name ? checkRequest : null}
            onCheckTaken={() => setCheckRequest(null)}
            taken={names.filter((n) => n !== detail.name)}
            profiles={profiles}
            initialUsedBy={detail.name ? profilesUsing(config, detail.name).map((p) => p.id) : []}
            cachedTools={detail.name ? tools[detail.name] : undefined}
            toolsOff={detail.name ? toolsOffIn(config, detail.name, profiles) : {}}
            changedOutside={changedOutside}
            onDirty={onEditorDirty}
            onCancel={() => {
              dirty.current = false
              onDetail({ kind: 'none' })
            }}
            onSave={async (name, server, secrets, usedBy) => {
              // Let go first, as a clean editor would: the save reopens it from what it wrote.
              setHolding(false)
              try {
                await onSave(detail.name, name, server, secrets, usedBy)
              } catch (err) {
                setHolding(true)
                throw err
              }
              dirty.current = false
              // A server the filter would hide (new, or renamed or edited out of it) shows in the list all the same, and takes focus.
              if (!serverMatches(name, server, words)) setQuery('')
              onDetail({ kind: 'edit', name })
              // The editor reopens from what was saved, so focus goes to the server's row rather than the page.
              requestAnimationFrame(() => {
                if (document.activeElement === document.body) document.querySelector<HTMLElement>(`[data-server="${CSS.escape(name)}"]`)?.focus()
              })
            }}
            onDelete={selected ? () => remove(selected) : undefined}
            onDuplicate={selected && config.mcpServers[selected] ? () => duplicate(selected) : undefined}
          />
        )}
      </section>
    </main>
  )
}

/** For each of a server's tools, the profiles that turn it off. */
function toolsOffIn(config: ConfigState, server: string, profiles: ProfileChip[]): Record<string, ProfileChip[]> {
  const off: Record<string, ProfileChip[]> = {}
  for (const p of config.profiles) {
    const chip = profiles.find((c) => c.id === p.id)
    for (const tool of p.mcpServers[server]?.disabledTools ?? []) if (chip) off[tool] = [...(off[tool] ?? []), chip]
  }
  return off
}

/** The detail side with nothing chosen: the ways a server gets here, each saying what it starts from. */
function NoServer({ empty, onPick }: { empty: boolean; onPick: (detail: Detail) => void }) {
  const ways: [Detail, string, string, ReactNode][] = [
    [{ kind: 'catalog' }, 'Add from Catalog…', "Vendors' own servers, ready to fill in", <CatalogIcon key="c" />],
    [{ kind: 'import' }, 'Import from Your Agents…', 'Servers your agents already define', <ImportIcon key="i" />],
    [{ kind: 'paste' }, 'Paste JSON…', 'A config from a README or agent file', <PasteIcon key="p" />],
    [{ kind: 'edit', name: null }, 'Add by Hand…', 'A command to run, or a URL to connect to', <PlusIcon key="h" />],
  ]
  return (
    <div className="grid flex-1 place-items-center overflow-y-auto p-6">
      <div className="flex w-full max-w-[420px] animate-[er-fade_160ms_var(--ease-settle)] flex-col items-center text-center">
        {/* An empty library gets its illustration, as first run does; with servers in the list, the plug stands for MCP. */}
        {empty ? (
          <img src={libraryArt} alt="" width={112} height={108} draggable={false} className="mb-1 h-auto [@media(max-height:520px)]:w-[64px]" />
        ) : (
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-[12px] bg-track text-ink-2 [@media(max-height:520px)]:size-10">
            <PlugIcon size={24} />
          </span>
        )}
        <h2 className="mt-3 text-heading font-semibold">{empty ? 'Add your first server' : 'Add a server'}</h2>
        <p className="mt-1 text-small text-ink-2">
          {empty ? 'Profiles hand MCP servers to the agents in their folders.' : 'Or pick one in the list to edit it.'}
        </p>
        <ul className="mt-5 w-full overflow-hidden rounded-[10px] bg-well text-left [@media(max-height:520px)]:mt-3">
          {ways.map(([detail, label, description, icon]) => (
            <li key={label} className="[&+&]:hair-t">
              <button
                type="button"
                onClick={() => onPick(detail)}
                className="group flex w-full items-center gap-3 px-3 py-2.5 text-left [@media(max-height:520px)]:py-2 hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)] focus-visible:rounded-[10px] focus-visible:outline-offset-[-2px]"
              >
                <span
                  aria-hidden="true"
                  className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-button text-ink-2 shadow-push group-hover:text-ink"
                >
                  {icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{label}</span>
                  <span className="block text-small text-pretty text-ink-2">{description}</span>
                </span>
                <span className="text-ink-2">
                  <ChevronIcon />
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
