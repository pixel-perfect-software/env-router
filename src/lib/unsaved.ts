// Which editors hold edits that haven't been saved, so that quitting (the menu bar's Quit, ⌘Q,
// closing the window off macOS) asks first. The app asks the window only while one does, so a
// window that fails can never stop EnvRouter quitting.

import { setUnsavedEdits } from './api'

const holding = new Set<string>()

/** `source` (an editor) holds unsaved edits, or doesn't any more. */
export function setUnsaved(source: 'profile' | 'server', unsaved: boolean) {
  const before = holding.size > 0
  if (unsaved) holding.add(source)
  else holding.delete(source)
  if (holding.size > 0 !== before) void setUnsavedEdits(holding.size > 0).catch(() => {})
}

/** Whether any editor holds unsaved edits now. */
export const hasUnsaved = () => holding.size > 0
