import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { takeMenuRequest } from './api'
import type { View } from './lastView'
import { isShortcut, type PlatformInfo } from './platform'

export interface Shortcuts {
  checkFolder: () => void
  newProfile: () => void
  /** Settings…: there's no Preferences window, so it opens the Shells popover. */
  settings: () => void
  view: (next: View) => void
  /** The menu bar's Check Last Folder: the folder it names. */
  checkLastFolder: (folder: string) => void
}

/**
 * The menu bar's "Check Folder…", "Check Last Folder" and "Settings…" and the keyboard shortcuts (⌘ or Ctrl + N, O, comma, 1, 2). On
 * macOS the menu's Settings… takes ⌘, itself and sends the event; elsewhere there's no menu, so the key does. They reach the latest
 * `shortcuts` and `platform` through a ref, so the listeners are added once.
 */
export function useShortcuts(platform: PlatformInfo, shortcuts: Shortcuts) {
  const actions = useRef(shortcuts)
  actions.current = shortcuts
  const platformRef = useRef(platform)
  platformRef.current = platform

  useEffect(() => {
    // The menu bar leaves its choice in the backend and sends `menu-request`, which a window that isn't listening yet would miss: so it is
    // taken when heard, and once the listener is attached, for one left before that (the first show after a hidden launch, a reload).
    const takeRequest = () =>
      takeMenuRequest()
        .then((request) => {
          if (request?.kind === 'checkFolder') actions.current.checkFolder()
          else if (request?.kind === 'checkLastFolder') actions.current.checkLastFolder(request.folder)
        })
        .catch(() => {})
    // Each listener is released on its own, so one that failed to attach can't leave the others attached.
    const unlisten = [listen('menu-request', takeRequest), listen('open-settings', () => actions.current.settings())]
    Promise.all(unlisten).then(takeRequest, () => {})
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e, platformRef.current)) return
      if (e.key === 'n') {
        e.preventDefault()
        actions.current.newProfile()
      } else if (e.key === 'o') {
        e.preventDefault()
        actions.current.checkFolder()
      } else if (e.key === ',') {
        e.preventDefault()
        actions.current.settings()
      } else if (e.key === '1' || e.key === '2') {
        e.preventDefault()
        actions.current.view(e.key === '1' ? 'profiles' : 'servers')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      for (const attached of unlisten) attached.then((stop) => stop())
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
