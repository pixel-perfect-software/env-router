// The window follows the conventions of the system it runs on: ⌘ or Ctrl in shortcuts, the
// Keychain or a keyring, Finder or the file manager. The backend reports the platform in
// `SetupStatus`; until that arrives the browser's user agent stands in, so the first render
// already uses the right modifier.

import { createContext, useContext } from 'react'
import type { Platform } from './types'

export interface PlatformInfo {
  platform: Platform
  isMac: boolean
  /** What the store MCP secrets go to is called: "Keychain", "keyring". */
  secretStore: string
}

/** A guess from the user agent, for before the backend has answered. */
export const guessPlatform = (): Platform => (/Mac/.test(navigator.userAgent) ? 'macos' : /Windows/.test(navigator.userAgent) ? 'windows' : 'linux')

export const platformInfo = (platform: Platform, secretStore?: string): PlatformInfo => ({
  platform,
  isMac: platform === 'macos',
  secretStore: secretStore ?? (platform === 'macos' ? 'Keychain' : platform === 'windows' ? 'Credential Manager' : 'keyring'),
})

export const PlatformContext = createContext<PlatformInfo>(platformInfo(guessPlatform()))

export const usePlatform = () => useContext(PlatformContext)

/** The label for a shortcut on `key`: `⌘O` on macOS, `Ctrl+O` elsewhere. */
export const shortcutLabel = (key: string, info: PlatformInfo) => (info.isMac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`)

/** Whether a key event is the platform's shortcut modifier on its own (⌘ on macOS, Ctrl elsewhere). */
export const isShortcut = (e: KeyboardEvent, info: PlatformInfo) =>
  !e.altKey && (info.isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey && !e.shiftKey)
