// The profile inspector: a panel that slides in from the right edge. It's always fully visible
// at the window's height, its body scrolls on its own, and Save stays pinned at the bottom.
// The profile grid stays in place behind it. Removals stay struck through until saved.

import { open } from '@tauri-apps/plugin-dialog'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'
import { confirmDelete, confirmDiscard } from '../lib/confirm'
import { hasMcpFiles, mcpAgentLabels, serverSummary } from '../lib/mcp'
import { splitLeaf, tildify } from '../lib/paths'
import { usePlatform } from '../lib/platform'
import { listOf, plural } from '../lib/text'
import { KNOWN_TOOLS } from '../lib/tools'
import type { McpServer, Profile, ToolInfo } from '../lib/types'
import { setUnsaved } from '../lib/unsaved'
import { useFolderDrop } from '../lib/useFolderDrop'
import { AgentMark } from './icons'
import { ServerMark } from './ServerMark'
import { Button, CheckBox, ChevronIcon, CloseIcon, DropIcon, FolderIcon, Footer, IconButton, PlusIcon, ProfileDot, TextField, ValueText } from './ui'

interface FolderRow {
  path: string
  removed: boolean
}

export function ProfileInspector({
  id,
  profile,
  color,
  home,
  library,
  tools,
  missingAgents,
  onCancel,
  onSave,
  onDelete,
  onDuplicate,
  onRevealMcp,
  onShowServers,
  template,
}: {
  /** The profile's id, or the one a new profile will be saved with. */
  id: string
  profile?: Profile
  /** The profile's colour dot; a new profile shows the colour it will get. */
  color: string
  home: string
  /** The MCP server library to choose from. */
  library: Record<string, McpServer>
  /** Each server's tools, where a check has listed them. */
  tools: Record<string, ToolInfo[]>
  /** The offered agents a new terminal doesn't find on its PATH: still offered, marked. */
  missingAgents: string[]
  onCancel: () => void
  /** Closes the inspector for the MCP Servers view, where the library is built. */
  onShowServers: () => void
  onSave: (profile: Profile) => Promise<void>
  onDelete?: () => Promise<void>
  /** Opens a new profile copied from this one. */
  onDuplicate?: () => void
  /** Shows the folder this profile's MCP files are rendered into; a saved profile's. A rejection shows under its button. */
  onRevealMcp?: () => Promise<void>
  /** A new profile's starting point, when it's a copy of another. */
  template?: Profile
}) {
  // What the form starts from, and what counts as unchanged.
  const base = profile ?? template
  const [name, setName] = useState(base?.name ?? '')
  const [folders, setFolders] = useState<FolderRow[]>(() => (base?.triggerPaths ?? []).map((path) => ({ path, removed: false })))
  const [toolPaths, setToolPaths] = useState<Record<string, string>>(() =>
    Object.fromEntries(KNOWN_TOOLS.map((tool) => [tool.command, base?.tools[tool.command]?.path ?? ''])),
  )
  const [servers, setServers] = useState<Set<string>>(() => new Set(Object.keys(base?.mcpServers ?? {})))
  const [disabled, setDisabled] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(Object.entries(base?.mcpServers ?? {}).map(([name, using]) => [name, using.disabledTools])),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // Why the MCP folder couldn't be shown. Under its button, not in the footer: a footer that grows would push the button, which still
  // has focus, under the error.
  const [revealError, setRevealError] = useState<string | null>(null)
  // Whether Reveal MCP Folder is waiting on its answer, so a second press can't start another and flicker the error.
  const [revealing, setRevealing] = useState(false)
  const revealErrorLine = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (revealError) revealErrorLine.current?.scrollIntoView({ block: 'nearest' })
  }, [revealError])
  const nameField = useRef<HTMLInputElement>(null)
  const asking = useRef(false)
  const libraryNames = Object.keys(library).sort((a, b) => a.localeCompare(b))
  const mcpAgents = mcpAgentLabels()
  const { revealLabelOf } = usePlatform()

  useEffect(() => {
    nameField.current?.focus()
    if (base) nameField.current?.select()
  }, [base])

  // Rows keep their order and removals stay struck through, so any change shows up as a
  // struck row or a different count. Undoing an edit makes the form clean again.
  const dirty =
    name !== (base?.name ?? '') ||
    folders.some((f) => f.removed) ||
    folders.length !== (base?.triggerPaths.length ?? 0) ||
    KNOWN_TOOLS.some((tool) => toolPaths[tool.command] !== (base?.tools[tool.command]?.path ?? '')) ||
    servers.size !== Object.keys(base?.mcpServers ?? {}).length ||
    [...servers].some((name) => !base?.mcpServers[name] || !sameTools(disabled[name] ?? [], base.mcpServers[name].disabledTools))

  useEffect(() => {
    setUnsaved('profile', dirty)
    return () => setUnsaved('profile', false)
  }, [dirty])

  /** Escape, the close button and Cancel, or leaving for MCP Servers. Unsaved edits are only dropped once the user says so. */
  const leave = async (then: () => void) => {
    // While saving, stay open: a save Rust rejects reports its reason here.
    if (saving || asking.current) return
    if (dirty) {
      asking.current = true
      const discard = await confirmDiscard(profile?.name).finally(() => {
        asking.current = false
      })
      if (!discard) return
    }
    then()
  }
  const close = () => leave(onCancel)

  const addPaths = (picked: string[]) => {
    const paths = picked.map((p) => tildify(p, home))
    // Picking a folder that's struck through brings it back rather than adding it twice.
    setFolders((rows) => [
      ...rows.map((r) => (r.removed && paths.includes(r.path) ? { ...r, removed: false } : r)),
      ...paths.filter((p) => !rows.some((r) => r.path === p)).map((path) => ({ path, removed: false })),
    ])
  }
  const addFolders = async () => {
    const picked = await open({ directory: true, multiple: true, defaultPath: home, title: 'Add Trigger Folders' })
    if (picked) addPaths(Array.isArray(picked) ? picked : [picked])
  }
  // While the inspector is open, a folder dropped on the window is one more trigger, not a check.
  const dropping = useFolderDrop(({ path }) => addPaths([path]))

  const chooseToolPath = async (command: string) => {
    const picked = await open({ directory: true, defaultPath: home, title: 'Choose Config Folder' })
    if (typeof picked === 'string') setToolPaths((paths) => ({ ...paths, [command]: tildify(picked, home) }))
  }

  const save = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Give the profile a name.')
      nameField.current?.focus()
      return
    }
    // Tools the window doesn't offer (from a newer app or a hand edit) pass through untouched.
    const tools = { ...base?.tools }
    for (const tool of KNOWN_TOOLS) {
      const path = toolPaths[tool.command].trim()
      if (path) tools[tool.command] = { envVar: tool.envVar, path }
      else delete tools[tool.command]
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id,
        name: trimmed,
        triggerPaths: folders.filter((f) => !f.removed).map((f) => f.path),
        tools,
        mcpServers: Object.fromEntries([...servers].map((name) => [name, { disabledTools: disabled[name] ?? [] }])),
      })
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  /** Unsaved edits are only dropped once the user says so, as when closing. */
  const duplicate = async () => {
    if (!onDuplicate || saving || asking.current) return
    if (dirty) {
      asking.current = true
      const discard = await confirmDiscard(profile?.name).finally(() => {
        asking.current = false
      })
      if (!discard) return
    }
    onDuplicate()
  }

  const revealMcp = async () => {
    if (!onRevealMcp) return
    setRevealing(true)
    setRevealError(null)
    try {
      await onRevealMcp()
    } catch (err) {
      setRevealError(errorMessage(err))
    } finally {
      setRevealing(false)
    }
  }

  const remove = async () => {
    if (!onDelete || !profile) return
    const confirmed = await confirmDelete(profile)
    if (!confirmed) return
    setSaving(true)
    try {
      await onDelete()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <>
      {/* Dims the grid behind; it stays visible so other profiles' folders are in view. */}
      <div aria-hidden="true" className="absolute inset-0 z-30 animate-[er-fade_160ms_ease-out] bg-black/15 dark:bg-black/35" />
      <form
        role="dialog"
        aria-modal="true"
        aria-label={profile ? `Edit ${profile.name}` : 'New profile'}
        data-inspector
        className="absolute inset-y-0 right-0 z-40 flex w-[min(440px,calc(100%-40px))] animate-[er-slide_220ms_var(--ease-settle)] flex-col bg-raised shadow-raised"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'Tab') wrapTab(e)
        }}
      >
        <header className="flex items-center gap-2.5 px-5 pt-5 pb-3">
          <ProfileDot color={color} size={3} />
          <h2 className="min-w-0 flex-1 truncate text-title font-semibold">{profile ? profile.name : 'New Profile'}</h2>
          <IconButton label="Close" onClick={close} disabled={saving}>
            <CloseIcon />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 pb-5">
          <div>
            <label htmlFor="profile-name" className="mb-1.5 block text-small font-medium text-ink-2">
              Name
            </label>
            <TextField
              ref={nameField}
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Work"
              className="w-full !h-[32px] !text-title"
            />
          </div>

          <fieldset>
            <legend className="mb-1.5 text-small font-medium text-ink-2">Trigger folders</legend>
            <div className="rounded-card bg-card shadow-card">
              {folders.length === 0 && <p className="px-3 py-2.5 text-small text-ink-2 italic">Each folder covers everything inside it.</p>}
              <ul>
                {folders.map((row) => {
                  const { parent, leaf } = splitLeaf(row.path)
                  return (
                    <li key={row.path} className="group/row flex items-center gap-2 px-3 py-1.5 [&+&]:hair-t">
                      <span className="text-ink-2">
                        <FolderIcon />
                      </span>
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-small ${row.removed ? 'text-ink-2 line-through' : ''}`}
                        title={row.path}
                      >
                        <span className="text-ink-2">{parent}</span>
                        {leaf}
                      </span>
                      {row.removed ? (
                        <Button kind="plain" onClick={() => setFolders((rows) => rows.map((r) => (r === row ? { ...r, removed: false } : r)))}>
                          Undo
                        </Button>
                      ) : (
                        <IconButton
                          label={`Remove ${row.path}`}
                          className="opacity-60 group-hover/row:opacity-100 focus-visible:opacity-100"
                          onClick={() => setFolders((rows) => rows.map((r) => (r === row ? { ...r, removed: true } : r)))}
                        >
                          <CloseIcon />
                        </IconButton>
                      )}
                    </li>
                  )
                })}
              </ul>
              {dropping && (
                <p className="m-1.5 flex items-center gap-2 rounded-[8px] bg-tint px-2.5 py-1.5 text-small text-accent-ink shadow-[0_0_0_1.5px_var(--er-accent-ink)]">
                  <DropIcon />
                  <span className="min-w-0 truncate">
                    Release to add <span className="font-mono">{tildify(dropping, home)}</span>
                  </span>
                </p>
              )}
            </div>
            <Button className="mt-2" onClick={addFolders}>
              <PlusIcon />
              Add Folder…
            </Button>
          </fieldset>

          <fieldset>
            <legend className="mb-1.5 text-small font-medium text-ink-2">Agents</legend>
            <ul className="space-y-3">
              {KNOWN_TOOLS.map((tool) => (
                <li key={tool.command}>
                  <label htmlFor={`tool-${tool.command}`} className="mb-1 flex items-center gap-2 text-small">
                    <AgentMark command={tool.command} className="text-ink-2" />
                    <span className="font-medium">{tool.label}</span>
                    <code className="font-mono text-caption text-ink-2">{tool.envVar}</code>
                    {missingAgents.includes(tool.command) && (
                      <span title="Not found on a new terminal's PATH, nor in an editor" className="ml-auto text-caption text-ink-2 italic">
                        Not installed
                      </span>
                    )}
                  </label>
                  <div className="flex items-center gap-1.5">
                    <TextField
                      mono
                      id={`tool-${tool.command}`}
                      value={toolPaths[tool.command]}
                      onChange={(e) => setToolPaths((paths) => ({ ...paths, [tool.command]: e.target.value }))}
                      placeholder={`Not set · uses ${tool.defaultPath}`}
                      aria-describedby={tool.note ? `tool-${tool.command}-note` : undefined}
                      className="flex-1"
                    />
                    <Button onClick={() => chooseToolPath(tool.command)}>Choose…</Button>
                  </div>
                  {tool.note && (
                    <p id={`tool-${tool.command}-note`} className="mt-1 text-caption text-ink-2">
                      {tool.note}
                    </p>
                  )}
                  {/* The vendor's own installer, to copy: the same line the check's "isn't installed" verdict gives. */}
                  {tool.install && missingAgents.includes(tool.command) && (
                    <p className="mt-1 text-caption text-ink-2">
                      Install it with <code className="font-mono break-all text-ink select-text">{tool.install}</code>
                    </p>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-caption text-ink-2">A new folder starts logged out: run the agent there once and sign in.</p>
          </fieldset>

          <fieldset className="min-w-0">
            <legend className="mb-1.5 text-small font-medium text-ink-2">MCP servers</legend>
            <div className="rounded-card bg-card shadow-card">
              {libraryNames.length === 0 ? (
                // ⌘2 stands down while the inspector is open, so the way there is this button.
                <p className="px-3 py-2.5 text-small text-ink-2 italic">
                  No servers yet. Add them in{' '}
                  <button
                    type="button"
                    onClick={() => leave(onShowServers)}
                    className="rounded-[3px] underline decoration-[color-mix(in_srgb,var(--er-ink)_28%,transparent)] underline-offset-[3px] hover:text-accent-ink hover:decoration-current"
                  >
                    MCP Servers
                  </button>
                  .
                </p>
              ) : (
                <ul>
                  {libraryNames.map((server) => {
                    const on = servers.has(server)
                    return (
                      <li key={server} className="[&+&]:hair-t">
                        {/* A real checkbox, hidden, so the whole row is its label; the drawn box shows its state and focus. */}
                        <label className="relative flex w-full items-center gap-2.5 rounded-control px-3 py-1.5 hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)] focus-within-ring">
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={on}
                            onChange={() =>
                              setServers((current) => {
                                const next = new Set(current)
                                if (on) next.delete(server)
                                else next.add(server)
                                return next
                              })
                            }
                          />
                          <CheckBox checked={on} />
                          <ServerMark name={server} server={library[server]} size={20} />
                          <span className={`max-w-[60%] shrink-0 truncate font-mono text-small ${on ? 'text-ink' : 'text-ink-2'}`} title={server}>
                            {server}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-caption text-ink-2" title={serverSummary(library[server])}>
                            {serverSummary(library[server])}
                          </span>
                        </label>
                        {on && (
                          <ToolFilter
                            server={server}
                            tools={tools[server]}
                            off={disabled[server] ?? []}
                            onChange={(off) => setDisabled((current) => ({ ...current, [server]: off }))}
                          />
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            {libraryNames.length > 0 && mcpAgents.length > 0 && (
              <p className="mt-2 text-caption text-ink-2">
                {listOf(mcpAgents)} {mcpAgents.length > 1 ? 'load' : 'loads'} these in this profile's folders.
              </p>
            )}
            {/* What the saved profile hands out, so it follows the saved servers, not the checkboxes above. */}
            {onRevealMcp && profile && hasMcpFiles(profile) && (
              <>
                <Button className="mt-2" busy={revealing} onClick={revealMcp}>
                  {revealLabelOf('MCP Folder')}
                </Button>
                <p ref={revealErrorLine} role="alert" className="mt-1.5 text-small text-problem select-text empty:hidden">
                  {revealError && <ValueText text={revealError} home={home} />}
                </p>
              </>
            )}
          </fieldset>
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
                <Button onClick={duplicate} disabled={saving}>
                  Duplicate
                </Button>
              )}
            </>
          }
          error={error}
        >
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" data-save busy={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Footer>
      </form>
    </>
  )
}

/** What a Tab can land on in the dialog. */
const TABBABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'

/**
 * Whether Tab really lands on `el`: not taken out of the order (`tabindex=-1`), not disabled or hidden, and, of a radio group, only the
 * checked one (or the first when none is), which is the one the browser stops on.
 */
function isStop(el: HTMLElement) {
  if (el.tabIndex < 0 || el.matches(':disabled') || el.getClientRects().length === 0) return false
  if (!(el instanceof HTMLInputElement) || el.type !== 'radio' || !el.name) return true
  const group = Array.from(el.form?.elements ?? el.ownerDocument.querySelectorAll('input[type=radio]')).filter(
    (other): other is HTMLInputElement => other instanceof HTMLInputElement && other.type === 'radio' && other.name === el.name,
  )
  return el === (group.find((radio) => radio.checked) ?? group[0])
}

/**
 * Keeps Tab inside the dialog: everything behind it is `inert`, so past either end focus would fall to the page (a dead stop in the
 * window) before it came back. At the last stop Tab goes to the first, and Shift+Tab at the first goes to the last.
 */
function wrapTab(e: KeyboardEvent<HTMLElement>) {
  const stops = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(TABBABLE)).filter(isStop)
  const [first, last] = [stops[0], stops[stops.length - 1]]
  if (!first || !last) return
  if (e.shiftKey ? document.activeElement === first : document.activeElement === last) {
    e.preventDefault()
    ;(e.shiftKey ? last : first).focus()
  }
}

const sameTools = (a: string[], b: string[]) => a.length === b.length && a.every((tool) => b.includes(tool))

/**
 * Under a server that's on: which of its tools the agent may use. A deny list, so a tool the
 * server adds later is on. Without a checked tool list, it says how many are off, if any.
 */
function ToolFilter({
  server,
  tools,
  off,
  onChange,
}: {
  server: string
  tools: ToolInfo[] | undefined
  off: string[]
  onChange: (off: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  // Aligned with the server's mark, past the checkbox.
  const indent = 'pl-[36px] pr-3'
  if (!tools) {
    return (
      <p
        className={`${indent} pb-1.5 text-caption text-ink-2 ${off.length ? '' : 'italic'}`}
        title="Check the server in MCP Servers to choose its tools."
      >
        {off.length ? `${plural(off.length, 'tool', 'tools')} off` : 'All tools'}
      </p>
    )
  }
  const offHere = tools.filter((t) => off.includes(t.name)).length
  const summary = offHere === 0 ? `All ${tools.length} tools` : `${tools.length - offHere} of ${tools.length} tools on`
  const id = `tools-${server}`
  return (
    <div className={`${indent} pb-1`}>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="-ml-1 flex min-h-[26px] items-center gap-1 rounded-control px-1 text-caption text-ink-2 hover:text-ink"
        >
          <span className={`transition-transform duration-150 ease-settle ${open ? 'rotate-90' : ''}`}>
            <ChevronIcon />
          </span>
          {summary}
        </button>
        {open && (
          <span className="ml-auto flex gap-3">
            <Button
              kind="plain"
              className="!mx-0 !h-[22px] !px-1 text-small"
              disabled={offHere === 0}
              onClick={() => onChange(off.filter((name) => !tools.some((t) => t.name === name)))}
            >
              All On
            </Button>
            <Button
              kind="plain"
              className="!mx-0 !h-[22px] !px-1 text-small"
              disabled={offHere === tools.length}
              onClick={() => onChange([...new Set([...off, ...tools.map((t) => t.name)])])}
            >
              All Off
            </Button>
          </span>
        )}
      </div>
      {open && (
        <ul id={id} className="mt-1 ml-[5px] pl-2.5 hair-l">
          {tools.map((tool) => {
            const enabled = !off.includes(tool.name)
            return (
              <li key={tool.name}>
                <label className="relative flex min-h-[28px] items-center gap-2 rounded-control px-1 hover:bg-[color-mix(in_srgb,var(--er-ink)_4%,transparent)] focus-within-ring">
                  <input
                    type="checkbox"
                    className="sr-only"
                    checked={enabled}
                    onChange={() => onChange(enabled ? [...off, tool.name] : off.filter((name) => name !== tool.name))}
                  />
                  <CheckBox checked={enabled} />
                  <span className={`shrink-0 font-mono text-caption ${enabled ? 'text-ink' : 'text-ink-2 line-through'}`}>{tool.name}</span>
                  {tool.description && (
                    <span className="min-w-0 flex-1 truncate text-caption text-ink-2" title={tool.description}>
                      {tool.description}
                    </span>
                  )}
                </label>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
