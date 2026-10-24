import { listen } from '@tauri-apps/api/event'
import { Menu } from '@tauri-apps/api/menu'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react'
import { Docket } from './components/Docket'
import { type DropTarget, Frame } from './components/Frame'
import { HealthLine } from './components/Health'
import { EditorsPopover, editorsToShow, ShellsPopover } from './components/Popovers'
import { ProfileInspector } from './components/ProfileInspector'
import { type Detail, ServersView } from './components/Servers'
import { TitleBand } from './components/Titlebar'
import { profileColors } from './components/ui'
import { Welcome } from './components/Welcome'
import {
  errorMessage,
  getEditorStatus,
  getMcpTools,
  openInEditor,
  previewFolder,
  quitApp,
  setEditorIntegration,
  setShellIntegration,
  setUnsavedEdits,
} from './lib/api'
import { confirmDelete, confirmDiscardServer, confirmQuit } from './lib/confirm'
import { accentsOf, docketHasAction, healthOf } from './lib/health'
import { withoutServer, withServer, withUsedBy } from './lib/mcp'
import { guessPlatform, PlatformContext, platformInfo } from './lib/platform'
import { ideHooks, KNOWN_TOOLS, toolByCommand } from './lib/tools'
import type { ConfigState, Editor, EditorStatus, Profile, Shell, ToolInfo } from './lib/types'
import { hasUnsaved } from './lib/unsaved'
import { useConfigStore } from './lib/useConfigStore'
import { useFolderCheck } from './lib/useFolderCheck'
import { useFolderDrop } from './lib/useFolderDrop'
import { useShortcuts } from './lib/useShortcuts'
import type { VerdictAction } from './lib/verdict'

export default function App() {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  // What a new profile starts from when it's a copy; gone once the inspector closes.
  const [template, setTemplate] = useState<Profile | null>(null)
  // The window's two places. A dev-only `?view=servers` opens on the second, for review.
  const [view, setViewState] = useState<'profiles' | 'servers'>(() =>
    import.meta.env.DEV && new URLSearchParams(location.search).get('view') === 'servers' ? 'servers' : 'profiles',
  )
  const [serverDetail, setServerDetail] = useState<Detail>({ kind: 'none' })
  // Whether the server editor holds unsaved edits, for leaving it from outside the Servers view.
  const serverDirty = useRef(false)
  // Each server's checked tools, read again whenever the profile editor opens.
  const [mcpTools, setMcpTools] = useState<Record<string, ToolInfo[]>>({})
  const [shellsOpen, setShellsOpen] = useState(false)
  const [editorsOpen, setEditorsOpen] = useState(false)
  // Read at launch, to know whether to offer Editors…, and each time it opens: the editors' own settings may have changed meanwhile.
  const [editors, setEditors] = useState<EditorStatus[] | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  // The id the next new profile is saved with, so the inspector can show the colour it will get.
  const [newId, setNewId] = useState(() => crypto.randomUUID())

  const refreshEditors = useCallback(async () => {
    try {
      setEditors(await getEditorStatus(ideHooks()))
    } catch {
      // Without a readable status Editors… stays hidden; routing in shells doesn't depend on it.
    }
  }, [])

  const {
    home,
    config,
    setup,
    setSetup,
    loadError,
    openError,
    setOpenError,
    setupError,
    actionError,
    setActionError,
    refreshSetup,
    load,
    commit: save,
  } = useConfigStore(refreshEditors)
  // A check compares against the config; with config.json unreadable (or not read yet) there's none.
  const canCheck = config !== null
  const { check, slip, blocked, checkedOnce, routedTools, defaultShell, runCheck, isLatest, dismiss, reset, unblock } = useFolderCheck(
    config,
    setup,
    home,
  )
  // A saved change drops the shown check: it may have moved the folder to another slot.
  const commit = (edited: ConfigState, secrets: Record<string, string> = {}) => save(edited, secrets, reset)

  // config.json and the startup files can change from a terminal while the window is open, so
  // coming back reads both again. Not the config while the inspector is open: it saves on top
  // of the config it opened with.
  const inspecting = editing !== null
  const editingId = editing === 'new' ? newId : editing
  // Closing a panel puts focus back where it was before the panel opened (the pencil, the
  // titlebar button, a card), whichever way it was opened: button, shortcut or menu.
  const lastOutside = useRef<HTMLElement | null>(null)
  // The profile the inspector showed last, whose card takes focus when what opened the inspector is gone.
  const lastEdited = useRef<string | null>(null)
  useEffect(() => {
    if (editingId !== null) lastEdited.current = editingId
  }, [editingId])
  useEffect(() => {
    const onFocus = (event: FocusEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('[data-inspector]')) lastOutside.current = target
    }
    document.addEventListener('focusin', onFocus)
    return () => document.removeEventListener('focusin', onFocus)
  }, [])
  const wasInspecting = useRef(false)
  useEffect(() => {
    if (wasInspecting.current && !inspecting) {
      const last = lastOutside.current
      // A card swaps its pencil for "Editing" while open, so the pencil that was pressed is a
      // new element now: find it again by its accessible name.
      const label = last?.getAttribute('aria-label')
      const opener = last?.isConnected ? last : label ? document.querySelector<HTMLElement>(`[aria-label="${CSS.escape(label)}"]`) : null
      // Gone after a delete, a rename or Welcome's first save: then the profile's own pencil if its card is
      // still there, else New Profile.
      const edited = lastEdited.current ? `[data-profile="${CSS.escape(lastEdited.current)}"] [aria-label^="Edit "]` : null
      const target = opener ?? (edited ? document.querySelector<HTMLElement>(edited) : null) ?? document.getElementById('new-profile')
      target?.focus()
    }
    wasInspecting.current = inspecting
  }, [inspecting])
  useEffect(() => {
    if (editing === null) {
      setTemplate(null)
      return
    }
    let current = true
    getMcpTools()
      .then((tools) => current && setMcpTools(tools))
      .catch(() => current && setMcpTools({}))
    return () => {
      current = false
    }
  }, [editing])
  useEffect(() => {
    const onFocus = inspecting ? refreshSetup : load
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [inspecting, load, refreshSetup])

  const setView = (next: 'profiles' | 'servers') => {
    setShellsOpen(false)
    setEditorsOpen(false)
    setViewState(next)
  }
  /**
   * Opens a server in the Servers view, from a card's footer. Unsaved edits to another server
   * ask first, as picking one from the list does; the same server comes back as it was left.
   */
  const openServer = async (name: string) => {
    const open = serverDetail.kind === 'edit' ? serverDetail.name : null
    if (open !== name) {
      if (serverDirty.current && !(await confirmDiscardServer(open))) return
      serverDirty.current = false
      setServerDetail({ kind: 'edit', name })
    }
    setView('servers')
  }

  // A check's answer files into the Profiles map, so checking from Servers goes there.
  const pickAndCheck = async () => {
    if (!canCheck) return
    const picked = await open({ directory: true, defaultPath: home || undefined, title: 'Check Folder' })
    if (typeof picked !== 'string') return
    setView('profiles')
    runCheck(picked, defaultShell(), null)
  }

  // While the inspector is open a check stands down, as it does for a folder dropped on the window.
  const shortcuts = {
    checkFolder: () => {
      if (!inspecting) pickAndCheck()
    },
    newProfile: () => {
      if (!config) return
      setView('profiles')
      setEditing((e) => e ?? 'new')
    },
    view: (next: 'profiles' | 'servers') => {
      if (!inspecting) setView(next)
    },
  }
  const platform = platformInfo(setup?.platform ?? guessPlatform(), setup?.secretStore)

  // The app asks before quitting only while an editor holds unsaved edits (`src-tauri/src/quit.rs`).
  useEffect(() => {
    const unlisten = listen('quit-requested', async () => {
      if (await confirmQuit()) await quitApp()
      else await setUnsavedEdits(hasUnsaved())
    })
    return () => {
      unlisten.then((stop) => stop())
    }
  }, [])

  useShortcuts(platform, shortcuts)

  // The open inspector takes a drop as a trigger folder itself (ProfileInspector), so the window only checks one.
  const hovering = useFolderDrop(({ path, origin }) => {
    if (inspecting || !canCheck) return
    setView('profiles')
    runCheck(path, defaultShell(), origin)
  })

  // While a folder is dragged over the window, light up the slot it would file into.
  useEffect(() => {
    if (!hovering || !config || inspecting) {
      setDropTarget(null)
      return
    }
    let current = true
    previewFolder(config, hovering, KNOWN_TOOLS[0].command)
      .then((preview) => current && setDropTarget({ profileId: preview.profileId }))
      .catch(() => current && setDropTarget(null))
    return () => {
      current = false
    }
  }, [hovering, config, inspecting])

  const saveProfile = async (profile: Profile) => {
    if (!config) return
    const exists = config.profiles.some((p) => p.id === profile.id)
    await commit({ ...config, profiles: exists ? config.profiles.map((p) => (p.id === profile.id ? profile : p)) : [...config.profiles, profile] })
    if (!exists) setNewId(crypto.randomUUID())
    setEditing(null)
  }

  const deleteProfile = async (profile: Profile) => {
    if (!config) return
    await commit({ ...config, profiles: config.profiles.filter((p) => p.id !== profile.id) })
    setEditing(null)
  }

  const setShell = async (shell: Shell, enabled: boolean) => {
    const shown = check
    const status = await setShellIntegration(shell, enabled)
    setActionError(null)
    unblock(shell)
    setSetup((s) => (s ? { ...s, shells: s.shells.map((x) => (x.shell === shell ? status : x)) } : s))
    refreshSetup()
    // The docket's result describes this shell before the switch; ask it again rather than
    // read the old answer against the new setting.
    if (shown?.shell === shell && isLatest(shown.key)) runCheck(shown.folder, shell, null, shown.tool)
  }

  useEffect(() => {
    if (editorsOpen) refreshEditors()
  }, [editorsOpen, refreshEditors])

  const setEditor = async (editor: Editor, command: string, enabled: boolean) => {
    const hook = toolByCommand(command)?.ide
    if (!hook) return
    const status = await setEditorIntegration(editor, command, hook, enabled)
    setEditors((list) => list?.map((e) => (e.editor === editor && e.command === command ? status : e)) ?? null)
  }

  const enableShell = (shell: Shell) =>
    setShell(shell, true).catch((err) => {
      setShellsOpen(true)
      setActionError(errorMessage(err))
    })

  const runAction = async (action: VerdictAction, shell: Shell) => {
    try {
      if (action.kind === 'enableShell') {
        await setShell(shell, true) // Checks the folder again itself.
      } else if (action.kind === 'reinstall') {
        if (config) await commit(config)
        if (check) runCheck(check.folder, shell, null, check.tool)
      } else {
        await openInEditor(action.path)
      }
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }

  /**
   * Opens a new profile copied from `profile`: its agents, servers and turned-off tools, but no
   * folders, since a folder belongs to one profile.
   */
  const duplicateProfile = (profile: Profile) => {
    setTemplate({ ...profile, id: newId, name: `${profile.name} copy`, triggerPaths: [] })
    setEditing('new')
  }

  const showSlotMenu = async (profile: Profile, folder: string | null, event: MouseEvent) => {
    event.preventDefault()
    try {
      const menu = await Menu.new({
        items: [
          { id: 'edit', text: 'Edit Profile…', action: () => setEditing(profile.id) },
          { id: 'duplicate', text: 'Duplicate Profile…', action: () => duplicateProfile(profile) },
          ...(folder
            ? [
                { id: 'check', text: 'Check This Folder', action: () => runCheck(folder, defaultShell(), null) },
                {
                  id: 'reveal',
                  text: platform.isMac ? 'Reveal in Finder' : 'Show in Files',
                  action: () => revealItemInDir(folder).catch((err) => setActionError(errorMessage(err))),
                },
              ]
            : []),
          { item: 'Separator' as const },
          {
            id: 'delete',
            text: 'Delete Profile…',
            action: () => {
              confirmDelete(profile)
                .then((ok) => {
                  if (ok) return deleteProfile(profile)
                })
                .catch((err) => setActionError(errorMessage(err)))
            },
          },
        ],
      })
      await menu.popup()
    } catch {
      // No native menu (the browser preview): editing stays reachable from the slot itself.
    }
  }

  const closeShells = useCallback(() => setShellsOpen(false), [])
  const closeEditors = useCallback(() => setEditorsOpen(false), [])
  const health = healthOf(config, setup, loadError, setupError, actionError, home, checkedOnce, blocked, openError)
  const accents = accentsOf(health, view, inspecting, docketHasAction(check, setup, routedTools, home))
  // Before the first profile there's no map to show: the window greets instead.
  const welcome = view === 'profiles' && health.kind === 'setup' && health.step === 1
  const summary = config
    ? {
        profiles: config.profiles.length,
        folders: config.profiles.reduce((n, p) => n + p.triggerPaths.length, 0),
        servers: Object.keys(config.mcpServers).length,
      }
    : undefined

  return (
    <PlatformContext.Provider value={platform}>
      <div className={`relative flex h-full flex-col ${hovering && canCheck && !inspecting ? 'shadow-[inset_0_0_0_2px_var(--er-accent-ink)]' : ''}`}>
        {/* While the inspector is open, everything behind it is out of reach: Tab, clicks and
          screen readers stay in the editor, so a stray Enter on a card can't drop its edits.
          `contents` keeps the window's layout as if this wrapper weren't there. */}
        <div className="contents" inert={inspecting}>
          <TitleBand
            setup={setup}
            blockedShell={blocked?.shell ?? null}
            primary={accents.titlebar}
            canCheck={canCheck}
            shellsOpen={shellsOpen}
            onToggleShells={() => {
              setEditorsOpen(false)
              setShellsOpen((o) => !o)
            }}
            editorsShown={editorsToShow(editors).length > 0}
            editorsOpen={editorsOpen}
            onToggleEditors={() => {
              setShellsOpen(false)
              setEditorsOpen((o) => !o)
            }}
            view={view}
            onView={setView}
            onCheckFolder={pickAndCheck}
          />
          {/* On Servers, the banner only shows when routing needs attention. */}
          {((view === 'profiles' && !welcome) || !['ok', 'loading', 'setup'].includes(health.kind)) && (
            // One live region for every health state, so a change is announced in place instead of a new region appearing.
            <div role="status" className="shrink-0 pt-2">
              <HealthLine
                health={health}
                home={home}
                summary={summary}
                quiet={accents.quiet}
                onNewProfile={() => setEditing('new')}
                onEnableShell={enableShell}
                onCheckFolder={pickAndCheck}
                onReinstall={() => config && commit(config).catch((err) => setActionError(errorMessage(err)))}
                onRecheck={(folder, shell, tool) => runCheck(folder, shell, null, tool)}
                onOpenConfig={() => {
                  setOpenError(null)
                  openInEditor(`${home}/.envrouter/config.json`).catch((err) => setOpenError(errorMessage(err)))
                }}
                onDismissError={() => setActionError(null)}
              />
            </div>
          )}
          {shellsOpen && setup && <ShellsPopover setup={setup} home={home} onSet={setShell} onClose={closeShells} />}
          {editorsOpen && editors && <EditorsPopover editors={editors} home={home} onSet={setEditor} onClose={closeEditors} />}
          {/* Soft edges where cards scroll under the banner and the floating check card. */}
          {/* Kept while Profiles shows, only hidden, so a server's unsaved edits survive a trip there and back. */}
          {config && (
            <div className={view === 'servers' ? 'contents' : 'hidden'}>
              <ServersView
                config={config}
                home={home}
                colors={profileColors(config.profiles.map((p) => p.id))}
                detail={serverDetail}
                onDetail={setServerDetail}
                onSave={(previous, name, server, secrets, usedBy) =>
                  commit(withUsedBy(withServer(config, previous, name, server), name, usedBy), secrets)
                }
                onImport={(servers, secrets) =>
                  commit(
                    servers.reduce((next, [name, server]) => withServer(next, null, name, server), config),
                    secrets,
                  )
                }
                onDelete={(name) => commit(withoutServer(config, name))}
                dirty={serverDirty}
              />
            </div>
          )}
          {view === 'profiles' && (
            <>
              {welcome && health.kind === 'setup' ? (
                <Welcome shell={health.shell?.shell ?? 'your shell'} primary={!inspecting} onNewProfile={() => setEditing('new')} />
              ) : (
                // A stable gutter on both sides: the scrollbar coming and going (a check result rising) never reflows the cards.
                <main className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges] [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-18px),transparent)]">
                  {config && (
                    <Frame
                      profiles={config.profiles}
                      home={home}
                      editing={editing}
                      slip={slip}
                      dropTarget={dropTarget}
                      onEdit={setEditing}
                      onContextMenu={showSlotMenu}
                      onOpenServer={openServer}
                    />
                  )}
                </main>
              )}
              {/* With nothing to check against, no drop zone invites one. */}
              {canCheck && (
                <Docket
                  check={check}
                  shells={setup?.shells ?? []}
                  home={home}
                  routedTools={routedTools}
                  shimsDir={setup?.shimsDir ?? `${home}/.envrouter/shims`}
                  hovering={inspecting ? null : hovering}
                  onRecheck={(shell, tool) => check && runCheck(check.folder, shell, null, tool)}
                  onAction={runAction}
                  primary={accents.docket}
                  onDismiss={() => {
                    dismiss()
                    // Dismiss leaves with the result; Check Folder… is where the next one starts.
                    document.getElementById('check-folder')?.focus()
                  }}
                />
              )}
            </>
          )}
        </div>
        {config && editingId !== null && (
          <ProfileInspector
            key={editingId}
            id={editingId}
            profile={config.profiles.find((p) => p.id === editing)}
            template={editing === 'new' ? (template ?? undefined) : undefined}
            color={profileColors([...config.profiles.map((p) => p.id), newId]).get(editingId) ?? ''}
            home={home}
            library={config.mcpServers}
            tools={mcpTools}
            onCancel={() => setEditing(null)}
            onSave={saveProfile}
            onDelete={
              editing === 'new'
                ? undefined
                : () => {
                    const profile = config.profiles.find((p) => p.id === editing)
                    return profile ? deleteProfile(profile) : Promise.resolve()
                  }
            }
            onDuplicate={
              editing === 'new'
                ? undefined
                : () => {
                    const profile = config.profiles.find((p) => p.id === editing)
                    if (profile) duplicateProfile(profile)
                  }
            }
          />
        )}
      </div>
    </PlatformContext.Provider>
  )
}
