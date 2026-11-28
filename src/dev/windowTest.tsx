// What the window's component tests share: each boots the dev mock for one URL, renders App and drives it as a user would.
// Importing this registers the cleanup that runs after every test.

import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, resetModules, spyOn } from 'provino'
import App from '../App'

export type User = ReturnType<typeof userEvent.setup>

export const open = async (search: string) => {
  resetModules()
  history.replaceState(null, '', search)
  await import('./mockTauri')
  render(<App />)
  return userEvent.setup()
}

afterEach(async () => {
  cleanup()
  // The window remembers its view there; a test mustn't open on the last one's.
  localStorage.clear()
})

export const inspector = () => within(screen.getByRole('dialog'))

export const isAccent = (button: HTMLElement) => button.classList.contains('bg-accent')

/** The accent-filled buttons a user can reach: not inside an `inert` subtree. */
export const reachableAccents = () => screen.getAllByRole('button').filter((b) => isAccent(b) && !b.closest('[inert]'))

/** The calls the window makes to the backend, from here on. */
export const spyOnInvoke = () => {
  const { __TAURI_INTERNALS__: internals } = window as unknown as {
    __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> }
  }
  return spyOn(internals, 'invoke')
}
