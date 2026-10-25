// The window's two places, and which one it opens on: the one it was left on. Per viewer, like the
// first-run step in `useFolderCheck`; the window's frame is remembered by the backend.

export type View = 'profiles' | 'servers'

const KEY = 'envrouter.view'

export const readView = (): View => {
  try {
    return localStorage.getItem(KEY) === 'servers' ? 'servers' : 'profiles'
  } catch {
    return 'profiles'
  }
}

export const writeView = (view: View) => {
  try {
    localStorage.setItem(KEY, view)
  } catch {
    // Storage unavailable: the window just opens on Profiles next time.
  }
}
