import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { isShortcut, type PlatformInfo } from './platform'

export interface Shortcuts {
  checkFolder: () => void
  newProfile: () => void
  /** Settings…: there's no Preferences window, so it opens the Shells popover. */
  settings: () => void
  view: (next: 'profiles' | 'servers') => void
}

/**
 * The menu bar's "Check Folder…" and "Settings…" and the keyboard shortcuts (⌘ or Ctrl + N, O, comma, 1, 2). On macOS the menu's
 * Settings… takes ⌘, itself and sends the event; elsewhere there's no menu, so the key does. They reach the latest `shortcuts` and
 * `platform` through a ref, so the listeners are added once.
 */
export function useShortcuts(platform: PlatformInfo, shortcuts: Shortcuts) {
  const actions = useRef(shortcuts)
  actions.current = shortcuts
  const platformRef = useRef(platform)
  platformRef.current = platform

  useEffect(() => {
    // Each listener is released on its own, so one that failed to attach can't leave the other attached.
    const unlisten = [listen('check-folder', () => actions.current.checkFolder()), listen('open-settings', () => actions.current.settings())]
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
