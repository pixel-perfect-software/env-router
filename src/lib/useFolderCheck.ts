import { useRef, useState } from 'react'
import type { CheckState } from '../components/Docket'
import type { Slip } from '../components/Frame'
import { checkFolder, errorMessage, previewFolder } from './api'
import type { Blocked } from './health'
import { owningTrigger } from './paths'
import { KNOWN_TOOLS } from './tools'
import type { ConfigState, SetupStatus, Shell } from './types'
import { verdictOf } from './verdict'

/**
 * The folder check: the docket's result, the slip filed on the map, and what the check found
 * blocking a shell. A check is asked of `config` and `home` as they are when `runCheck` is called.
 */
export function useFolderCheck(config: ConfigState | null, setup: SetupStatus | null, home: string) {
  const [check, setCheck] = useState<CheckState | null>(null)
  const [slip, setSlip] = useState<Slip | null>(null)
  const [blocked, setBlocked] = useState<Blocked | null>(null)
  // Routed in this window. Earlier ones are the backend's to remember (`SetupStatus.checkedBefore`), so a changed bundle identifier doesn't lose them.
  const [checkedOnce, setCheckedOnce] = useState(false)
  const checkKey = useRef(0)
  // A check reads the shell's status when its result arrives, not when it started: a switch may have flipped meanwhile.
  const latestSetup = useRef(setup)
  latestSetup.current = setup

  const defaultShell = (): Shell => {
    const available = setup?.shells.filter((s) => s.available) ?? []
    return (available.find((s) => s.isDefault) ?? available[0])?.shell ?? 'zsh'
  }
  /** Agents at least one profile sets, in registry order. Checks offer these. */
  // A profile's MCP servers give an agent a shim too, as `config::tool_names` decides.
  const routedTools = KNOWN_TOOLS.filter((tool) =>
    config?.profiles.some((p) => p.tools[tool.command]?.path.trim() || (tool.mcp && Object.keys(p.mcpServers).length > 0)),
  ).map((t) => t.command)
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
      const latest = latestSetup.current
      const status = latest?.shells.find((s) => s.shell === shell)
      const verdict = status && latest ? verdictOf(result, status, tool, routedTools.includes(tool), latest.shimsDir, home, trigger) : null
      if (verdict?.blocksShell) setBlocked({ shell, tool, headline: verdict.headline, folder })
      else setBlocked((b) => (b && b.shell === shell && b.tool === tool ? null : b))
      if (result.status === 'routed') {
        setCheckedOnce(true)
      }
    } catch (err) {
      if (key !== checkKey.current) return
      setCheck((c) => (c && c.key === key ? { ...c, error: errorMessage(err) } : c))
      setSlip((s) => (s && s.key === key ? { ...s, mark: 'problem' } : s))
    }
  }

  /** Whether `key` is still the latest check asked, not one a newer check or a dismissal has replaced. */
  const isLatest = (key: number) => key === checkKey.current

  /** Drops the shown result and the slip. A check still running is dropped too: its answer is no longer wanted. */
  const dismiss = () => {
    checkKey.current++
    setCheck(null)
    setSlip(null)
  }

  /** A saved change can move a checked folder to another slot; the next check says where. A check still running was asked of the old config. */
  const reset = () => {
    checkKey.current++
    setSlip(null)
    setCheck(null)
    setBlocked(null)
  }

  /** `shell` was switched, so what a check found blocking it no longer holds. */
  const unblock = (shell: Shell) => setBlocked((b) => (b && b.shell === shell ? null : b))

  return { check, slip, blocked, checkedOnce, routedTools, defaultShell, runCheck, isLatest, dismiss, reset, unblock }
}
