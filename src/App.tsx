import { LogicalPosition } from '@tauri-apps/api/dpi'
import { listen } from '@tauri-apps/api/event'
import { Menu, type MenuOptions } from '@tauri-apps/api/menu'
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
  resetUnreadableConfig,
  revealPlace,
  setEditorIntegration,
  setShellIntegration,
  setUnsavedEdits,
  uninstall,
} from './lib/api'
import {
  confirmDelete,
  confirmDiscardServer,
  confirmQuit,
  confirmStartOver,
  confirmUninstall,
  tellBackedUp,
  tellRevealFailed,
  tellUninstalled,
} from './lib/confirm'
import { accentsOf, docketHasFix, type Health, healthOf } from './lib/health'
import { hasMcpFiles, withoutServer, withServer, withUsedBy } from './lib/mcp'
import { tildify } from './lib/paths'
import { guessPlatform, PlatformContext, platformInfo } from './lib/platform'
import { ideHooks, KNOWN_TOOLS, toolByCommand } from './lib/tools'
import type { ConfigState, Editor, EditorStatus, Place, Profile, RevealFailed, Shell, ToolInfo } from './lib/types'
import { hasUnsaved } from './lib/unsaved'
import { useConfigStore } from './lib/useConfigStore'
import { useFolderCheck } from './lib/useFolderCheck'
import { useFolderDrop } from './lib/useFolderDrop'
import { useShortcuts } from './lib/useShortcuts'
import type { VerdictAction } from './lib/verdict'

/** The error banner's title when an uninstall is what stopped. */
const STOPPED = 'Uninstall stopped'

/** The error banner's title when the uninstall finished and only quitting failed. */
const UNINSTALLED = 'EnvRouter is uninstalled'

/** What a failed one-off action was doing, as data, so Try Again asks for the same thing against the window as it is by then. */
type Retry =
  | { kind: 'verdict'; action: VerdictAction; shell: Shell }
  | { kind: 'reveal'; path: string }
  | { kind: 'place'; place: Place }
  | { kind: 'deleteProfile'; profileId: string }
  | { kind: 'uninstall' }
  | { kind: 'quit' }

/** The error banner's title when showing one of EnvRouter's places failed. */
const placeTitle = (place: Place) =>
  place.kind === 'config' ? "Couldn't show config.json" : place.kind === 'root' ? "Couldn't open ~/.envrouter" : "Couldn't show the MCP folder"

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
    saveWarning,
    setSaveWarning,
    refreshSetup,
    load,
    commit: save,
  } = useConfigStore(refreshEditors)
  // The banner's message as of the latest render, for a Try Again that finishes later to tell whether the banner is still its own.
  const shownError = useRef<string | null>(null)
  shownError.current = actionError
  // What the failed action in `actionError` was, for the banner's Try Again.
  const [retry, setRetry] = useState<Retry | null>(null)
  // Counts the failures shown, so a repeat of the same message is a new line in the banner, which the status region announces again.
  const [attempt, setAttempt] = useState(0)
  const fail = (err: unknown, again: Retry) => {
    setActionError(errorMessage(err))
    setRetry(again)
    setAttempt((n) => n + 1)
  }
  // Whether Try Again for a reveal is waiting on its answer.
  const [retrying, setRetrying] = useState(false)
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
  // Held from the moment an uninstall starts until it stops, and for good once it finishes: reading ~/.envrouter in between would
  // only fail, or (the part the app's own guard stops too) put it back.
  const uninstalling = useRef(false)
  // Whether the uninstall itself is running, past its confirmation: the window shows it and holds still (see `health`).
  const [running, setRunning] = useState(false)
  // Set when an uninstall stops, so Try Again takes focus once its banner is on screen (the Shells button that held it is gone).
  const focusRetry = useRef(false)
  useEffect(() => {
    const onFocus = () => {
      if (!uninstalling.current) (inspecting ? refreshSetup : load)()
    }
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
    if (!canCheck || uninstalling.current) return
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
  const platform = platformInfo(setup?.platform ?? guessPlatform(), setup?.secretStore, setup?.secretStoreProblem)

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
    if (inspecting || !canCheck || uninstalling.current) return
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
      fail(err, { kind: 'verdict', action: { kind: 'enableShell' }, shell })
    })

  const runAction = async (action: VerdictAction, shell: Shell) => {
    // The check result may still be showing a fix (Turn On…) from before the uninstall began.
    if (uninstalling.current) return
    try {
      if (action.kind === 'enableShell') {
        await setShell(shell, true) // Checks the folder again itself.
      } else if (action.kind === 'reinstall') {
        if (config) await commit(config)
        if (check) runCheck(check.folder, shell, null, check.tool)
      } else if (action.kind === 'editProfile') {
        // A hand edit may have removed it since the check: ask again rather than open an editor for nothing.
        if (config?.profiles.some((p) => p.id === action.profileId)) setEditing(action.profileId)
        else if (check) runCheck(check.folder, shell, null, check.tool)
      } else if (action.kind === 'newProfile') {
        // The folder starts as the new profile's, written as the config writes one under home. When no profile sets the checked
        // agent, the profile sets it too (its variable at its default folder): that is what gives the agent a shim.
        if (check) {
          const agent = routedTools.includes(check.tool) ? undefined : toolByCommand(check.tool)
          const tools = agent ? { [agent.command]: { envVar: agent.envVar, path: agent.defaultPath } } : {}
          setTemplate({ id: newId, name: '', triggerPaths: [tildify(check.folder, home)], tools, mcpServers: {} })
        }
        setEditing('new')
      } else if (action.kind === 'recheck') {
        if (check) runCheck(check.folder, shell, null, check.tool)
      } else {
        await openInEditor(action.path)
      }
    } catch (err) {
      fail(err, { kind: 'verdict', action, shell })
    }
  }

  const reveal = (path: string) => revealItemInDir(path).catch((err) => fail(err, { kind: 'reveal', path }))
  /** One of EnvRouter's own places (the menu on a card, Try Again); the backend says where it is. */
  const showPlace = (place: Place) => revealPlace(place).catch((err) => fail(err, { kind: 'place', place }))

  // Asking again re-confirms: the window may have changed since the first answer.
  const confirmAndDelete = (profile: Profile) =>
    confirmDelete(profile)
      .then((ok) => {
        if (ok) return deleteProfile(profile)
      })
      .catch((err) => fail(err, { kind: 'deleteProfile', profileId: profile.id }))

  /** The unreadable banner's Back Up and Start Over…: after the user agrees, the file is copied aside and replaced, then read again. */
  const startOver = () =>
    confirmStartOver()
      .then(async (ok) => {
        if (!ok) return
        setOpenError(null)
        const backup = await resetUnreadableConfig()
        await load()
        // The reset is done; a note that can't show changes nothing, so it stays out of the catch below.
        tellBackedUp(tildify(backup, home)).catch(() => {})
      })
      .catch((err) => {
        // Refused or failed: say why, and read the file again in case it was fixed meanwhile (that clears the message).
        setOpenError({ action: 'startOver', message: errorMessage(err) })
        load()
      })

  /**
   * Quits once the uninstall has finished, or says to. That's no failed uninstall, and asking it again would only find nothing to
   * do: the banner says it's uninstalled, and Try Again quits. The app's guard keeps every other command off the folder meanwhile.
   */
  const quit = () =>
    quitApp().catch((err) => {
      setRunning(false)
      focusRetry.current = true
      fail(`Quit EnvRouter yourself to finish.\n${errorMessage(err)}`, { kind: 'quit' })
    })
  /**
   * Shells' Uninstall EnvRouter… and the menu bar's. After a finished run the app quits, so there is no window to put right; a
   * stop leaves the app open with the reason in the banner, and asking again finishes the job. Asking again from that banner
   * keeps it on screen, Try Again busy, until the answer: clearing it would show the setup the first try left behind
   * (shells off, so "Turn On") for as long as the run takes.
   */
  const startUninstall = async () => {
    if (uninstalling.current) return
    uninstalling.current = true
    setShellsOpen(false)
    setEditorsOpen(false)
    const again = actionError !== null && retry?.kind === 'uninstall'
    const stop = (err: unknown) => {
      uninstalling.current = false
      setRunning(false)
      focusRetry.current = true
      fail(err, { kind: 'uninstall' })
      // Shells and editors may have been turned off before it stopped.
      refreshSetup()
      refreshEditors()
    }
    try {
      if (!(await confirmUninstall(platform.secretStore, hasUnsaved()))) {
        uninstalling.current = false
        // The popover that held the button is gone; its toolbar button, or the banner's Try Again, is where the user was.
        document.querySelector<HTMLElement>(again ? '#try-again' : '[aria-controls="shells-panel"]')?.focus()
        return
      }
      if (!again) setActionError(null)
      setRunning(true)
      const report = await uninstall(false)
      // One line per problem, as the banner shows them.
      if (report.problems.length > 0) return stop(report.problems.join('\n'))
      setActionError(null)
      // It's done; a note that can't show changes nothing.
      await tellUninstalled(report, platform.secretStore, home).catch(() => {})
    } catch (err) {
      return stop(err)
    }
    await quit()
  }
  const requestUninstall = useRef(startUninstall)
  requestUninstall.current = startUninstall
  useEffect(() => {
    const unlisten = listen('uninstall-requested', () => requestUninstall.current())
    return () => {
      unlisten.then((stop) => stop())
    }
  }, [])

  // The menu bar reveals without the window; when that fails it comes forward and says why, with Try Again. Only where the banner
  // can show it: a load or status error outranks an action's, and an uninstall owns the banner (a stopped one's Try Again must stay).
  const revealFailed = useRef((_: RevealFailed) => {})
  revealFailed.current = ({ place, message }) => {
    if (uninstalling.current || (actionError !== null && (retry?.kind === 'uninstall' || retry?.kind === 'quit'))) return
    // The unreadable-config banner has a slot for config.json's Reveal alone; every other place has nowhere in it. The status error's
    // banner has no slot, and the open inspector keeps the banner behind its scrim, out of reach, so those are told natively.
    if (loadError && place.kind === 'config') setOpenError({ action: 'reveal', message })
    else if (loadError || setupError || inspecting) tellRevealFailed(placeTitle(place), message).catch(() => {})
    else {
      focusRetry.current = true
      fail(message, { kind: 'place', place })
    }
  }
  useEffect(() => {
    const unlisten = listen<RevealFailed>('reveal-failed', (event) => revealFailed.current(event.payload))
    return () => {
      unlisten.then((stop) => stop())
    }
  }, [])

  // Set when a reveal's Try Again succeeds with focus on it, so Check Folder… takes focus once the banner has gone.
  const focusAfterRetry = useRef(false)

  /**
   * Try Again for a reveal. The banner stays as it was, Try Again busy, until the answer, so focus stays on the button instead of
   * falling to the page when the banner goes and comes back; a success clears it, another failure is shown as a new one. Only while
   * the banner is still this reveal's own: one that something else replaced or cleared meanwhile (a newer failure, a save) stays as
   * that left it.
   */
  const retryReveal = async (work: () => Promise<void>) => {
    const mine = shownError.current
    setRetrying(true)
    try {
      await work()
      if (shownError.current === mine) {
        focusAfterRetry.current = document.activeElement?.id === 'try-again'
        setActionError(null)
      }
    } catch (err) {
      if (shownError.current === mine) {
        setActionError(errorMessage(err))
        setAttempt((n) => n + 1)
      }
    } finally {
      setRetrying(false)
    }
  }

  /** The banner's Try Again: whatever failed is asked for again, the error gone while it runs. */
  const tryAgain = () => {
    if (health.kind === 'unloaded') {
      load()
    } else if (health.kind === 'error' && !health.dismissible) {
      refreshSetup()
    } else if (retry) {
      // An uninstall's banner stays up while it runs again (`startUninstall`), and so does a reveal's (`retryReveal`).
      if (retry.kind !== 'uninstall' && retry.kind !== 'reveal' && retry.kind !== 'place') setActionError(null)
      if (retry.kind === 'verdict') runAction(retry.action, retry.shell)
      else if (retry.kind === 'reveal') retryReveal(() => revealItemInDir(retry.path))
      else if (retry.kind === 'place') retryReveal(() => revealPlace(retry.place))
      else if (retry.kind === 'uninstall') startUninstall()
      else if (retry.kind === 'quit') quit()
      else {
        const profile = config?.profiles.find((p) => p.id === retry.profileId)
        if (profile) confirmAndDelete(profile)
      }
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

  /** What a folder's menus offer: asking about it, and showing it. */
  const folderItems = (folder: string) => [
    { id: 'check', text: 'Check This Folder', action: () => runCheck(folder, defaultShell(), null) },
    { id: 'reveal', text: platform.revealLabel, action: () => reveal(folder) },
  ]

  // The menu last shown. A native menu is a resource Tauri keeps until it's closed, and `popup` may resolve before an item's action
  // has run, so the previous one is closed when the next is built, never right after its own popup.
  const shownMenu = useRef<Menu | null>(null)
  // Counts the menus asked for, so a call that a newer one overtook while it awaited gives its menu up instead of leaving it open.
  const menuAsk = useRef(0)
  useEffect(
    () => () => {
      menuAsk.current++
      shownMenu.current?.close().catch(() => {})
    },
    [],
  )
  /** Pops a native menu: at `at` in the window, or at the pointer. The latest ask wins. */
  const popupMenu = async (items: MenuOptions['items'], at?: LogicalPosition) => {
    const ask = ++menuAsk.current
    const previous = shownMenu.current
    shownMenu.current = null
    await previous?.close().catch(() => {})
    if (ask !== menuAsk.current) return
    const menu = await Menu.new({ items })
    if (ask !== menuAsk.current) {
      await menu.close().catch(() => {})
      return
    }
    shownMenu.current = menu
    await menu.popup(at)
  }

  const showSlotMenu = async (profile: Profile, folder: string | null, event: MouseEvent) => {
    event.preventDefault()
    try {
      await popupMenu([
        { id: 'edit', text: 'Edit Profile…', action: () => setEditing(profile.id) },
        { id: 'duplicate', text: 'Duplicate Profile…', action: () => duplicateProfile(profile) },
        // Only a saved profile with servers has rendered files to show.
        ...(hasMcpFiles(profile)
          ? [{ id: 'mcp', text: platform.revealLabelOf('MCP Folder'), action: () => showPlace({ kind: 'mcpFiles', profileId: profile.id }) }]
          : []),
        ...(folder ? [{ item: 'Separator' as const }, ...folderItems(folder)] : []),
        { item: 'Separator' as const },
        {
          id: 'delete',
          text: 'Delete Profile…',
          action: () => confirmAndDelete(profile),
        },
      ])
    } catch {
      // No native menu (the browser preview): editing stays reachable from the slot itself.
    }
  }

  // The folder whose "…" menu is open, which keeps its button in view: `popup` answers when the menu is dismissed (Tauri waits on the main thread).
  const [menuFolder, setMenuFolder] = useState<string | null>(null)

  /** A folder row's "…": the folder's own menu, under the button, so the keyboard reaches what the right-click offers. */
  const showFolderMenu = async (folder: string, anchor: HTMLElement) => {
    try {
      // Under the button where a position is the webview's own (`anchorsMenus`); elsewhere the pointer, as the right-click menu opens.
      const box = anchor.getBoundingClientRect()
      setMenuFolder(folder)
      await popupMenu(folderItems(folder), platform.anchorsMenus ? new LogicalPosition(box.left, box.bottom) : undefined)
    } catch {
      // No native menu (the browser preview): the right-click menu carries the same items.
    } finally {
      setMenuFolder(null)
    }
  }

  const closeShells = useCallback(() => setShellsOpen(false), [])
  const closeEditors = useCallback(() => setEditorsOpen(false), [])
  const reported = healthOf(config, setup, loadError, setupError, actionError, home, checkedOnce, blocked, openError, saveWarning)
  // While an uninstall runs the region holds one state, whatever the files it is changing say: the pending line, or on a retry the
  // stop's banner with Try Again busy. Nothing in it is an accent action, so no shell can be turned back on meanwhile.
  const titled: Health = running
    ? actionError
      ? { kind: 'error', message: actionError, dismissible: true, busy: true, title: STOPPED }
      : { kind: 'uninstalling' }
    : reported.kind === 'error' && reported.dismissible && (retry?.kind === 'uninstall' || retry?.kind === 'quit')
      ? { ...reported, title: retry.kind === 'quit' ? UNINSTALLED : STOPPED }
      : reported.kind === 'error' && reported.dismissible && retry?.kind === 'place'
        ? { ...reported, title: placeTitle(retry.place) }
        : reported
  const health: Health = titled.kind === 'error' ? { ...titled, busy: titled.busy || retrying, attempt } : titled
  useEffect(() => {
    if (focusRetry.current && health.kind === 'error' && !health.busy) {
      focusRetry.current = false
      document.getElementById('try-again')?.focus()
    } else if (focusAfterRetry.current && health.kind !== 'error') {
      // The banner that held focus is gone; Check Folder… is where the next thing starts, as after the docket's Dismiss.
      focusAfterRetry.current = false
      document.getElementById('check-folder')?.focus()
    }
  })
  const accents = accentsOf(health, view, inspecting, docketHasFix(check, setup, routedTools, home))
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
            canCheck={canCheck && !running}
            busy={running}
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
                onReinstall={() =>
                  config &&
                  commit(config).catch((err) => fail(err, { kind: 'verdict', action: { kind: 'reinstall' }, shell: check?.shell ?? defaultShell() }))
                }
                onRecheck={(folder, shell, tool) => runCheck(folder, shell, null, tool)}
                onOpenConfig={() => {
                  setOpenError(null)
                  openInEditor(`${home}/.envrouter/config.json`).catch((err) => setOpenError({ action: 'open', message: errorMessage(err) }))
                }}
                onRevealConfig={() => {
                  setOpenError(null)
                  revealPlace({ kind: 'config' }).catch((err) => setOpenError({ action: 'reveal', message: errorMessage(err) }))
                }}
                onStartOver={startOver}
                onRetry={tryAgain}
                onDismissError={() => setActionError(null)}
                onDismissWarning={() => setSaveWarning(null)}
              />
            </div>
          )}
          {shellsOpen && setup && (
            <ShellsPopover
              setup={setup}
              home={home}
              onSet={setShell}
              onRevealConfig={() => revealPlace({ kind: 'config' })}
              onOpenRoot={() => revealPlace({ kind: 'root' })}
              onUninstall={startUninstall}
              onClose={closeShells}
            />
          )}
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
                      onFolderMenu={showFolderMenu}
                      menuFolder={menuFolder}
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
                  onRecheck={(shell, tool) => check && !uninstalling.current && runCheck(check.folder, shell, null, tool)}
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
            onRevealMcp={editing === 'new' ? undefined : () => revealPlace({ kind: 'mcpFiles', profileId: editingId })}
            onShowServers={() => {
              setEditing(null)
              setView('servers')
              // The profile's card has gone with the view, so focus goes where a library starts.
              requestAnimationFrame(() => document.getElementById('add-server')?.focus())
            }}
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
