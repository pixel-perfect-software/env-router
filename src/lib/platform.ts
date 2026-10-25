// The window follows the conventions of the system it runs on: ⌘ or Ctrl in shortcuts, the
// Keychain or a keyring, Finder or the file manager. The backend reports the platform in
// `SetupStatus`; until that arrives the browser's user agent stands in, so the first render
// already uses the right modifier and titlebar.

import { createContext, useContext } from 'react'
import platformWords from './platformWords.json'
import type { Platform, SetupStatus } from './types'

export interface PlatformInfo {
  platform: Platform
  isMac: boolean
  /** What the store MCP secrets go to is called: "Keychain", "keyring", "Credential Manager" (Windows, and inside WSL). */
  secretStore: string
  /** Why that store can't keep a secret right now, in its own words, or null when it can. */
  storeProblem: string | null
  /** Whether a value can go to the store at all. Decided here, once: the editor locks nothing, and saves what was typed as plain text, when it can't. */
  canLock: boolean
  /**
   * Whether a native menu can be popped at a point of the webview. On macOS a position is the webview's own. On Linux it is the toplevel
   * window's, which with the system's title bar starts above the webview (muda's GTK `show_context_menu`), and nothing the window may call
   * says by how much, so menus open at the pointer there.
   */
  anchorsMenus: boolean
  /** What revealing a file in the file manager is called: "Reveal in Finder" on macOS, "Show in Files" elsewhere. */
  revealLabel: string
  /** The same for something named: "Reveal config.json in Finder", "Show config.json in Files". The menu bar's words come from `Platform::reveal_label`. */
  revealLabelOf: (what: string) => string
  /** What a value sealed in the store reads as in its field: "In Keychain", "In the keyring". */
  sealedLabel: string
  /**
   * Whether the window draws its own title bar (the band beside the traffic lights, which need room at the left) rather than sitting
   * under the system's. The build decides, in `tauri.conf.json` and `tauri.linux.conf.json`, and nothing can ask it before the first paint.
   */
  ownsTitlebar: boolean
  /** Whether the ground is translucent over the system's vibrancy (`windowEffects` in `tauri.conf.json`), decided before the first paint like `ownsTitlebar`. */
  vibrant: boolean
}

/** What `SetupStatus` says that the window words itself: the backend's answer where it has one, else the platform's own. */
export type PlatformWords = Pick<SetupStatus, 'secretStore' | 'sealedLabel' | 'secretStoreProblem' | 'fileManager' | 'revealVerb'>

/** A guess from the user agent, for before the backend has answered. */
export const guessPlatform = (): Platform => (/Mac/.test(navigator.userAgent) ? 'macos' : /Windows/.test(navigator.userAgent) ? 'windows' : 'linux')

/**
 * What the backend answers (`Platform::secret_store_name`, `sealed_label`, `file_manager`, `reveal_verb`), for the window's first render
 * and for when the status can't be read. `platformWords.json` is the one copy; a Rust test holds it to `platform.rs`, and the browser
 * mock answers from it too. The backend's words replace these once they arrive.
 */
const defaultWords = (platform: Platform): PlatformWords => ({ ...platformWords[platform], secretStoreProblem: null })

/** "Reveal in Finder" and "Reveal config.json in Finder", or "Show … in Files": the file manager is named once. */
const revealing = ({ revealVerb, fileManager }: PlatformWords, what?: string) =>
  what ? `${revealVerb} ${what} in ${fileManager}` : `${revealVerb} in ${fileManager}`

export const platformInfo = (platform: Platform, words: PlatformWords = defaultWords(platform)): PlatformInfo => ({
  platform,
  isMac: platform === 'macos',
  anchorsMenus: platform === 'macos',
  secretStore: words.secretStore,
  storeProblem: words.secretStoreProblem,
  canLock: words.secretStoreProblem === null,
  revealLabel: revealing(words),
  revealLabelOf: (what) => revealing(words, what),
  sealedLabel: words.sealedLabel,
  ownsTitlebar: platform === 'macos',
  vibrant: platform === 'macos',
})

export const PlatformContext = createContext<PlatformInfo>(platformInfo(guessPlatform()))

export const usePlatform = () => useContext(PlatformContext)

/** The label for a shortcut on `key`: `⌘O` on macOS, `Ctrl+O` elsewhere. */
export const shortcutLabel = (key: string, info: PlatformInfo) => (info.isMac ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`)

/** Whether a key event is the platform's shortcut modifier on its own (⌘ on macOS, Ctrl elsewhere). */
export const isShortcut = (e: KeyboardEvent, info: PlatformInfo) =>
  !e.altKey && (info.isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey && !e.shiftKey)

// The last pointer activity (down, up or cancel), to tell a long-press's `contextmenu` from the context-menu key's: a touch or pen long-press
// says `button` 0 and 2 depending on the engine, and the key says 0 in WebKit and -1 in Chromium, so `button` alone can't tell them apart.
let pointer = { down: false, at: -Infinity, target: null as EventTarget | null }
if (typeof document !== 'undefined') {
  const note = (down: boolean) => (e: Event) => {
    pointer = { down, at: performance.now(), target: e.target }
  }
  document.addEventListener('pointerdown', note(true), true)
  document.addEventListener('pointerup', note(false), true)
  document.addEventListener('pointercancel', note(false), true)
}

/** How long after a pointer lets go a `contextmenu` still counts as its. */
const POINTER_GRACE_MS = 500

/**
 * Whether a `contextmenu` event came from the keyboard (the context-menu key, Shift+F10), so the menu opens under the focused control
 * rather than at a pointer that's elsewhere. A right button, Ctrl-click on a Mac, and a pointer that is down or let go within half a
 * second on the same control are the pointer's, whatever `button` says (a long-press); anything else is the keyboard's.
 */
export const isKeyboardContextMenu = (e: { button: number; ctrlKey: boolean; target: EventTarget | null }) => {
  if (e.button === 2 || e.ctrlKey) return false
  const near = (a: EventTarget | null, b: EventTarget | null) => a instanceof Node && b instanceof Node && (a.contains(b) || b.contains(a))
  const recent = pointer.down || performance.now() - pointer.at < POINTER_GRACE_MS
  return !(recent && near(pointer.target, e.target))
}
