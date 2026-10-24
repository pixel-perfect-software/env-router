import { listen } from '@tauri-apps/api/event'
import { useEffect, useRef } from 'react'
import { isShortcut, type PlatformInfo } from './platform'

export interface Shortcuts {
  checkFolder: () => void
  newProfile: () => void
  view: (next: 'profiles' | 'servers') => void
}

/**
 * The menu bar's "Check Folder…" and the keyboard shortcuts (⌘ or Ctrl + N, O, 1, 2). They reach
 * the latest `shortcuts` and `platform` through a ref, so the listeners are added once.
 */
export function useShortcuts(platform: PlatformInfo, shortcuts: Shortcuts) {
  const actions = useRef(shortcuts)
  actions.current = shortcuts
  const platformRef = useRef(platform)
  platformRef.current = platform

  useEffect(() => {
    const unlisten = listen('check-folder', () => actions.current.checkFolder())
    const onKey = (e: KeyboardEvent) => {
      if (!isShortcut(e, platformRef.current)) return
      if (e.key === 'n') {
        e.preventDefault()
        actions.current.newProfile()
      } else if (e.key === 'o') {
        e.preventDefault()
        actions.current.checkFolder()
      } else if (e.key === '1' || e.key === '2') {
        e.preventDefault()
        actions.current.view(e.key === '1' ? 'profiles' : 'servers')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unlisten.then((stop) => stop())
      window.removeEventListener('keydown', onKey)
    }
  }, [])
}
