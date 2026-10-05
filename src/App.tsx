import { listen } from '@tauri-apps/api/event'
import { Menu } from '@tauri-apps/api/menu'
import { homeDir } from '@tauri-apps/api/path'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { type MouseEvent, useCallback, useEffect, useRef, useState } from 'react'
import { type Health, HealthLine, ShellsPopover, TitleBand } from './components/Chrome'
import { type CheckState, Docket } from './components/Docket'
import { type DropTarget, Frame, type Slip } from './components/Frame'
import { ProfileInspector } from './components/ProfileInspector'
import { profileColors } from './components/ui'
import { checkFolder, errorMessage, getConfig, getSetupStatus, openInEditor, previewFolder, saveConfig, setShellIntegration } from './lib/api'
import { confirmDelete } from './lib/confirm'
import { owningTrigger } from './lib/paths'
import { KNOWN_TOOLS } from './lib/tools'
import type { ConfigState, Profile, SetupStatus, Shell } from './lib/types'
import { useFolderDrop } from './lib/useFolderDrop'
import { type VerdictAction, verdictOf } from './lib/verdict'

const CHECKED_KEY = 'envrouter.checkedOnce'

/** Per-viewer convenience: whether first-run's third step has been done on this Mac. */
const readChecked = () => {
  try {
    return localStorage.getItem(CHECKED_KEY) === '1'
  } catch {
    return false
  }
}
const writeChecked = () => {
  try {
    localStorage.setItem(CHECKED_KEY, '1')
  } catch {
    // Storage unavailable: first-run just shows its last step again next launch.
  }
}

/** A check that found something stopping the shim in a shell, until a later check clears it. */
type Blocked = { shell: Shell; tool: string; headline: string; folder: string }

function healthOf(
  config: ConfigState | null,
  setup: SetupStatus | null,
  error: string | null,
  checkedOnce: boolean,
  blocked: Blocked | null,
): Health {
  if (error) return { kind: 'error', message: error }
  if (!config || !setup) return { kind: 'loading' }
  const available = setup.shells.filter((s) => s.available)
  const login = available.find((s) => s.isDefault) ?? available[0]
  const on = available.filter((s) => s.installed).map((s) => s.shell)

  if (config.profiles.length === 0) return { kind: 'setup', step: 1, shell: login }
  if (on.length === 0 && login) return checkedOnce ? { kind: 'off', shell: login } : { kind: 'setup', step: 2, shell: login }
  if (!setup.shimInstalled) return { kind: 'shim' }
  // What a real shell reported outranks what the config and startup files suggest.
  if (blocked && on.includes(blocked.shell)) return { kind: 'blocked', ...blocked }
  if (!checkedOnce) return { kind: 'setup', step: 3, shell: login }
  if (login && !login.installed) return { kind: 'partial', on, shell: login }
  return { kind: 'ok', on }
}

export default function App() {
  const [home, setHome] = useState('')
  const [config, setConfig] = useState<ConfigState | null>(null)
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // A failed one-off action (turning on a shell, reinstalling). Cleared by the next success.
  const [actionError, setActionError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [shellsOpen, setShellsOpen] = useState(false)
  const [check, setCheck] = useState<CheckState | null>(null)
  const [slip, setSlip] = useState<Slip | null>(null)
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
  const [checkedOnce, setCheckedOnce] = useState(readChecked)
  const checkKey = useRef(0)

  const refreshSetup = useCallback(async () => {
    try {
      setSetup(await getSetupStatus())
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    Promise.all([homeDir(), getConfig(), getSetupStatus()])
      .then(([h, c, s]) => {
        setHome(h)
        setConfig(c)
        setSetup(s)
      })
      .catch((err) => setLoadError(errorMessage(err)))
    // Startup files can change from a terminal while the window is open.
    window.addEventListener('focus', refreshSetup)
    return () => window.removeEventListener('focus', refreshSetup)
  }, [refreshSetup])

  const defaultShell = (): Shell => {
    const available = setup?.shells.filter((s) => s.available) ?? []
    return (available.find((s) => s.isDefault) ?? available[0])?.shell ?? 'zsh'
  }
  /** Agents at least one profile sets, in registry order. Checks offer these. */
  const routedTools = KNOWN_TOOLS.map((t) => t.command).filter((command) => config?.profiles.some((p) => p.tools[command]?.path.trim()))
  const defaultTool = () => (check && routedTools.includes(check.tool) ? check.tool : (routedTools[0] ?? KNOWN_TOOLS[0].command))

  const runCheck = async (folder: string, shell: Shell, origin: { x: number; y: number } | null, tool = defaultTool()) => {
    if (!config) return
    const key = ++checkKey.current
    setCheck({ key, folder, shell, tool, trigger: null, preview: null, result: null, error: null })
    let preview = null
    try {
      preview = await previewFolder(config, folder, tool)
    } catch {
      // The real check below reports anything wrong with the folder.
    }
    if (key !== checkKey.current) return
    // Which trigger won, for display; only trusted when it agrees with Rust's answer.
    const owner = owningTrigger(config.profiles, folder, home)
    const trigger = owner && owner.profileId === preview?.profileId ? owner.base : null
    setCheck((c) => (c && c.key === key ? { ...c, preview, trigger } : c))
    setSlip({ key, folder, profileId: preview?.profileId ?? null, trigger, mark: 'pending', origin })
    try {
      const result = await checkFolder(shell, folder, tool)
      if (key !== checkKey.current) return
      setCheck((c) => (c && c.key === key ? { ...c, result } : c))
      setSlip((s) => (s && s.key === key ? { ...s, mark: result.status === 'routed' ? 'on' : 'problem' } : s))
      const status = setup?.shells.find((s) => s.shell === shell)
      const verdict = status && setup ? verdictOf(result, status, tool, routedTools.includes(tool), setup.shimsDir, home, trigger) : null
      if (verdict?.blocksShell) setBlocked({ shell, tool, headline: verdict.headline, folder })
      else setBlocked((b) => (b && b.shell === shell && b.tool === tool ? null : b))
      if (result.status === 'routed') {
        setCheckedOnce(true)
        writeChecked()
      }
    } catch (err) {
      if (key !== checkKey.current) return
      setCheck((c) => (c && c.key === key ? { ...c, error: errorMessage(err) } : c))
      setSlip((s) => (s && s.key === key ? { ...s, mark: 'problem' } : s))
    }
  }

  const pickAndCheck = async () => {
    const picked = await open({ directory: true, defaultPath: home || undefined, title: 'Check Folder' })
    if (typeof picked === 'string') runCheck(picked, defaultShell(), null)
  }
  // The menu bar's "Check Folder…" and keyboard shortcuts reach the latest handlers through a ref.
  const actions = useRef({ pickAndCheck, newProfile: () => setEditing('new') })
  actions.current = { pickAndCheck, newProfile: () => setEditing((e) => e ?? 'new') }

  useEffect(() => {
    const unlisten = listen('check-folder', () => actions.current.pickAndCheck())
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      if (e.key === 'n') {
        e.preventDefault()
        actions.current.newProfile()
      } else if (e.key === 'o') {
        e.preventDefault()
        actions.current.pickAndCheck()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unlisten.then((stop) => stop())
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const hovering = useFolderDrop(({ path, origin }) => {
    if (editing === null) runCheck(path, defaultShell(), origin)
  })

  // While a folder is dragged over the window, light up the slot it would file into.
  useEffect(() => {
    if (!hovering || !config || editing !== null) {
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
  }, [hovering, config, editing])

  const commit = async (next: ConfigState) => {
    await saveConfig(next)
    setActionError(null)
    setConfig(next)
    refreshSetup()
    // A saved change can move a checked folder to another slot; the next check says where.
    setSlip(null)
    setCheck(null)
    setBlocked(null)
  }

  const saveProfile = async (profile: Profile) => {
    if (!config) return
    const exists = config.profiles.some((p) => p.id === profile.id)
    await commit({ ...config, profiles: exists ? config.profiles.map((p) => (p.id === profile.id ? profile : p)) : [...config.profiles, profile] })
    setEditing(null)
  }

  const deleteProfile = async (profile: Profile) => {
    if (!config) return
    await commit({ ...config, profiles: config.profiles.filter((p) => p.id !== profile.id) })
    setEditing(null)
  }

  const setShell = async (shell: Shell, enabled: boolean) => {
    const status = await setShellIntegration(shell, enabled)
    setActionError(null)
    setBlocked((b) => (b && b.shell === shell ? null : b))
    setSetup((s) => (s ? { ...s, shells: s.shells.map((x) => (x.shell === shell ? status : x)) } : s))
    refreshSetup()
  }

  const enableShell = (shell: Shell) =>
    setShell(shell, true).catch((err) => {
      setShellsOpen(true)
      setActionError(errorMessage(err))
    })

  const runAction = async (action: VerdictAction, shell: Shell) => {
    try {
      if (action.kind === 'enableShell') {
        await setShell(shell, true)
      } else if (action.kind === 'reinstall') {
        if (config) await commit(config)
      } else {
        await openInEditor(action.path)
        return
      }
      if (check) runCheck(check.folder, shell, null, check.tool)
    } catch (err) {
      setActionError(errorMessage(err))
    }
  }

  const showSlotMenu = async (profile: Profile, folder: string | null, event: MouseEvent) => {
    event.preventDefault()
    try {
      const menu = await Menu.new({
        items: [
          { id: 'edit', text: 'Edit Profile…', action: () => setEditing(profile.id) },
          ...(folder
            ? [
                { id: 'check', text: 'Check This Folder', action: () => runCheck(folder, defaultShell(), null) },
                { id: 'reveal', text: 'Reveal in Finder', action: () => revealItemInDir(folder).catch((err) => setActionError(errorMessage(err))) },
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
  // A Mac window has one default button. The banner's action outranks the check result's,
  // which outranks Check Folder… in the titlebar.
  const bannerHasPrimary = (h: Health) => h.kind === 'setup' || h.kind === 'shim' || h.kind === 'off'
  const docketHasAction = (() => {
    const status = check?.result && setup?.shells.find((s) => s.shell === check.shell)
    return status && check?.result && setup
      ? Boolean(verdictOf(check.result, status, check.tool, routedTools.includes(check.tool), setup.shimsDir, home).action)
      : false
  })()
  const health = healthOf(config, setup, loadError ?? actionError, checkedOnce, blocked)

  return (
    <div className={`relative flex h-full flex-col ${hovering ? 'shadow-[inset_0_0_0_2px_var(--er-accent)]' : ''}`}>
      <TitleBand
        setup={setup}
        blockedShell={blocked?.shell ?? null}
        primary={editing === null && !bannerHasPrimary(health) && !docketHasAction}
        shellsOpen={shellsOpen}
        onToggleShells={() => setShellsOpen((o) => !o)}
        onCheckFolder={pickAndCheck}
      />
      <HealthLine
        health={health}
        onNewProfile={() => setEditing('new')}
        onEnableShell={enableShell}
        onCheckFolder={pickAndCheck}
        onReinstall={() => config && commit(config).catch((err) => setActionError(errorMessage(err)))}
        onRecheck={(folder, shell, tool) => runCheck(folder, shell, null, tool)}
      />
      {shellsOpen && setup && <ShellsPopover setup={setup} home={home} onSet={setShell} onClose={closeShells} />}
      {/* Soft edges where cards scroll under the banner and the floating check card. */}
      <main className="min-h-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_10px,black_calc(100%-18px),transparent)]">
        {config && (
          <Frame
            profiles={config.profiles}
            home={home}
            editing={editing}
            slip={slip}
            dropTarget={dropTarget}
            onEdit={setEditing}
            onContextMenu={showSlotMenu}
          />
        )}
      </main>
      <Docket
        check={check}
        shells={setup?.shells ?? []}
        home={home}
        routedTools={routedTools}
        shimsDir={setup?.shimsDir ?? `${home}/.envrouter/shims`}
        hovering={hovering}
        onRecheck={(shell, tool) => check && runCheck(check.folder, shell, null, tool)}
        onAction={runAction}
        primary={editing === null && !bannerHasPrimary(health)}
        onDismiss={() => {
          checkKey.current++
          setCheck(null)
          setSlip(null)
        }}
      />
      {config && editing !== null && (
        <ProfileInspector
          key={editing}
          profile={config.profiles.find((p) => p.id === editing)}
          color={profileColors([...config.profiles.map((p) => p.id), 'new']).get(editing) ?? ''}
          home={home}
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
        />
      )}
    </div>
  )
}
