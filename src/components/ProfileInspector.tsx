// The profile inspector: a panel that slides in from the right edge. It's always fully visible
// at the window's height, its body scrolls on its own, and Save stays pinned at the bottom.
// The profile grid stays in place behind it. Removals stay struck through until saved.

import { open } from '@tauri-apps/plugin-dialog'
import { useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/api'
import { confirmDelete, confirmDiscard } from '../lib/confirm'
import { splitLeaf, tildify } from '../lib/paths'
import { KNOWN_TOOLS } from '../lib/tools'
import type { Profile } from '../lib/types'
import { Button, CloseIcon, FolderIcon, IconButton, PlusIcon, ProfileDot, TextField } from './ui'

interface FolderRow {
  path: string
  removed: boolean
}

export function ProfileInspector({
  id,
  profile,
  color,
  home,
  onCancel,
  onSave,
  onDelete,
}: {
  /** The profile's id, or the one a new profile will be saved with. */
  id: string
  profile?: Profile
  /** The profile's colour dot; a new profile shows the colour it will get. */
  color: string
  home: string
  onCancel: () => void
  onSave: (profile: Profile) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [name, setName] = useState(profile?.name ?? '')
  const [folders, setFolders] = useState<FolderRow[]>(() => (profile?.triggerPaths ?? []).map((path) => ({ path, removed: false })))
  const [toolPaths, setToolPaths] = useState<Record<string, string>>(() =>
    Object.fromEntries(KNOWN_TOOLS.map((tool) => [tool.command, profile?.tools[tool.command]?.path ?? ''])),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nameField = useRef<HTMLInputElement>(null)
  const asking = useRef(false)

  useEffect(() => {
    nameField.current?.focus()
    if (profile) nameField.current?.select()
  }, [profile])

  // Rows keep their order and removals stay struck through, so any change shows up as a
  // struck row or a different count. Undoing an edit makes the form clean again.
  const dirty =
    name !== (profile?.name ?? '') ||
    folders.some((f) => f.removed) ||
    folders.length !== (profile?.triggerPaths.length ?? 0) ||
    KNOWN_TOOLS.some((tool) => toolPaths[tool.command] !== (profile?.tools[tool.command]?.path ?? ''))

  /** Escape, the close button and Cancel. Unsaved edits are only dropped once the user says so. */
  const close = async () => {
    // While saving, stay open: a save Rust rejects reports its reason here.
    if (saving || asking.current) return
    if (dirty) {
      asking.current = true
      const discard = await confirmDiscard(profile?.name).finally(() => {
        asking.current = false
      })
      if (!discard) return
    }
    onCancel()
  }

  const addFolders = async () => {
    const picked = await open({ directory: true, multiple: true, defaultPath: home, title: 'Add Trigger Folders' })
    if (!picked) return
    const paths = (Array.isArray(picked) ? picked : [picked]).map((p) => tildify(p, home))
    // Picking a folder that's struck through brings it back rather than adding it twice.
    setFolders((rows) => [
      ...rows.map((r) => (r.removed && paths.includes(r.path) ? { ...r, removed: false } : r)),
      ...paths.filter((p) => !rows.some((r) => r.path === p)).map((path) => ({ path, removed: false })),
    ])
  }

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
    const tools = { ...profile?.tools }
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
      })
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
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
        aria-label={profile ? `Edit ${profile.name}` : 'New profile'}
        className="absolute inset-y-0 right-0 z-40 flex w-[min(440px,calc(100%-40px))] animate-[er-slide_220ms_var(--ease-settle)] flex-col bg-raised shadow-raised"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
        }}
      >
        <header className="flex items-center gap-2.5 px-5 pt-5 pb-3">
          <ProfileDot color={color} className="size-3" />
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
              {folders.length === 0 && <p className="px-3 py-2.5 text-small text-ink-2">Each folder covers everything inside it.</p>}
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
                  <label htmlFor={`tool-${tool.command}`} className="mb-1 flex items-baseline gap-2 text-small">
                    <span className="font-medium">{tool.label}</span>
                    <code className="font-mono text-caption text-ink-2">{tool.envVar}</code>
                  </label>
                  <div className="flex gap-1.5">
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
                </li>
              ))}
            </ul>
            <p className="mt-3 text-caption text-ink-2">A new folder starts logged out: run the agent there once and sign in.</p>
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
          <Button onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button kind="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </form>
    </>
  )
}
