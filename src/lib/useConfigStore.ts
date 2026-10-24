import { homeDir } from '@tauri-apps/api/path'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage, getConfig, getSetupStatus, saveConfig } from './api'
import { confirmReplace, confirmRestore } from './confirm'
import { mergeConfig } from './merge'
import { withAgents } from './tools'
import type { ConfigState, SetupStatus } from './types'

/**
 * What the window knows of config.json and the shells' setup: reading both, the errors from reading them, and saving with the merge loop.
 * A load also reads the editors again, through `refreshEditors`.
 */
export function useConfigStore(refreshEditors: () => Promise<void>) {
  const [home, setHome] = useState('')
  const [config, setConfig] = useState<ConfigState | null>(null)
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  // config.json (or the home folder) couldn't be read, so there's nothing to show yet.
  const [loadError, setLoadError] = useState<string | null>(null)
  // Opening an unreadable config.json failed too; shown under the parse error, not instead of it.
  const [openError, setOpenError] = useState<string | null>(null)
  // A failed status refresh. Cleared by the next one that works.
  const [setupError, setSetupError] = useState<string | null>(null)
  // A failed one-off action (turning on a shell, reinstalling). Cleared by the next success.
  const [actionError, setActionError] = useState<string | null>(null)
  // Bumped by every save, so a read of config.json that started before it can't put the old file back.
  const configSeq = useRef(0)

  const refreshSetup = useCallback(async () => {
    try {
      setSetup(await getSetupStatus())
      setSetupError(null)
    } catch (err) {
      setSetupError(errorMessage(err))
    }
  }, [])

  const load = useCallback(async () => {
    refreshSetup()
    refreshEditors()
    const seq = configSeq.current
    try {
      // Home first: if the config can't be read, the banner still needs it to open the file.
      setHome(await homeDir())
      const loaded = await getConfig()
      if (seq !== configSeq.current) return
      setConfig(loaded)
      setLoadError(null)
      setOpenError(null)
    } catch (err) {
      if (seq !== configSeq.current) return
      // Nothing is editable until the file is fixed: a save would replace whatever is in it.
      setConfig(null)
      setLoadError(errorMessage(err))
    }
  }, [refreshSetup, refreshEditors])

  useEffect(() => {
    load()
  }, [load])

  /**
   * Saves `edited`, an edit of the window's `config`. If config.json changed meanwhile (the CLI
   * saved, or a hand edit), the edit is folded into the file as it is now, and only a profile or
   * server changed on both sides asks first. Declining shows the file's version and rejects. If
   * config.json is gone, the save asks before writing the window's version back. `onSaved` runs
   * as the new config is set, and not at all when the save is declined or fails.
   */
  const commit = async (edited: ConfigState, secrets: Record<string, string>, onSaved: () => void) => {
    if (!config) return
    const mine = withAgents(edited)
    let next = mine
    let base: ConfigState | null = config
    let replace = false
    // A file that keeps changing under the save gets a few tries, not a loop.
    for (let tries = 0; ; tries++) {
      const outcome = await saveConfig(next, secrets, base)
      if (outcome.status === 'saved') {
        next = outcome.config
        break
      }
      if (outcome.status === 'missing') {
        if (!(await confirmRestore())) throw new Error('Not saved. config.json is still missing.')
        base = null
        continue
      }
      if (tries === 2) throw new Error('config.json kept changing while saving. Save again.')
      const merged = mergeConfig(config, mine, outcome.config)
      if (merged.conflicts.length > 0 && !replace) {
        replace = await confirmReplace(merged.conflicts)
        if (!replace) {
          configSeq.current++
          setConfig(outcome.config)
          throw new Error('Not saved. The other change was kept.')
        }
      }
      next = withAgents(merged.config)
      base = outcome.config
    }
    configSeq.current++
    setActionError(null)
    setConfig(next)
    refreshSetup()
    onSaved()
  }

  return { home, config, setup, setSetup, loadError, openError, setOpenError, setupError, actionError, setActionError, refreshSetup, load, commit }
}
