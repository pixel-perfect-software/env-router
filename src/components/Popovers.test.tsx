// The Shells and Editors popovers, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { emit } from '@tauri-apps/api/event'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, fn, it, spyOn, stubGlobal } from 'provino'
import { isAccent, open, reachableAccents, type User } from '../dev/windowTest'

describe('Uninstall EnvRouter…', () => {
  const uninstallFromShells = async (user: User) => {
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    await user.click(screen.getByRole('button', { name: 'Uninstall EnvRouter…' }))
  }

  it('is a push button, and nothing changes unless the user agrees', async () => {
    const confirm = fn().mockReturnValue(false)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    const button = screen.getByRole('button', { name: 'Uninstall EnvRouter…' })
    expect(isAccent(button)).toBe(false)
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }
    const invoked = spyOn(internals, 'invoke')

    await user.click(button)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Uninstall EnvRouter?'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('any MCP secrets EnvRouter kept in the Keychain are deleted'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(invoked.mock.calls.map(([command]) => command)).not.toContain('uninstall')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Shells/ }))
  })

  it('names what is left to remove, then quits', async () => {
    const confirm = fn().mockReturnValue(true)
    stubGlobal('confirm', confirm)
    const log = spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }
    const invoked = spyOn(internals, 'invoke')
    await uninstallFromShells(user)

    await waitFor(() => expect(log).toHaveBeenCalledWith('quit'))
    // The note giving focus back to the window must not read the folder that was just deleted.
    invoked.mockClear()
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(invoked).not.toHaveBeenCalled()
    const note = confirm.mock.calls.map(([text]) => String(text)).find((text) => text.includes('EnvRouter is uninstalled'))
    expect(note).toContain('To remove the app: brew uninstall --zap --cask envrouter')
    expect(note).toContain('To remove the envrouter CLI: brew uninstall envrouter-cli')
    expect(note).toContain('EnvRouter quits now, and deletes its own saved data as it goes.')
  })

  it('stays open when it stops, with the reason and Try Again, and finishes when asked again', async () => {
    const confirm = fn().mockReturnValue(true)
    stubGlobal('confirm', confirm)
    const log = spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated&fail=uninstall')
    await uninstallFromShells(user)

    await screen.findByText('Uninstall stopped')
    expect(log).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Shells/ }))
    expect(screen.getByRole('switch', { name: 'EnvRouter in zsh' }).getAttribute('aria-checked')).toBe('false')

    window.__mockFix()
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(log).toHaveBeenCalledWith('quit'))
  })

  it('titles the stop as the uninstall, with a line and mono values for each problem', async () => {
    stubGlobal('confirm', fn().mockReturnValue(true))
    const user = await open('?scenario=populated&fail=uninstall')
    await uninstallFromShells(user)

    await screen.findByText('Uninstall stopped')
    expect(screen.queryByText('Something went wrong')).toBeNull()
    const lines = screen.getAllByText(/couldn't be read, and it names EnvRouter's shim/)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.textContent).toContain('Code/User/settings.json')
    expect(lines[1]?.textContent).toContain('Cursor/User/settings.json')
    // The path has a space in it and the setting is a name: both are values.
    expect(screen.getByText('~/Library/Application Support/Code/User/settings.json').tagName).toBe('CODE')
    for (const setting of screen.getAllByText('claudeCode.claudeProcessWrapper')) expect(setting.tagName).toBe('CODE')
  })

  it('says it is uninstalled when only quitting fails, and Try Again quits instead of uninstalling again', async () => {
    stubGlobal('confirm', fn().mockReturnValue(true))
    const log = spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    let stuck = true
    const invoked = spyOn(internals, 'invoke').mockImplementation((command, ...rest) =>
      command === 'quit_app' && stuck ? Promise.reject('the window is stuck') : real.call(internals, command, ...rest),
    )
    await uninstallFromShells(user)

    await screen.findByText('EnvRouter is uninstalled')
    expect(screen.getByText('Quit EnvRouter yourself to finish.')).toBeTruthy()
    expect(screen.queryByText('Uninstall stopped')).toBeNull()
    expect(log).not.toHaveBeenCalled()

    stuck = false
    invoked.mockClear()
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(log).toHaveBeenCalledWith('quit'))
    expect(invoked.mock.calls.map(([command]) => command)).toEqual(['quit_app'])
  })

  it('keeps its banner when a reveal from the menu bar fails meanwhile, with the uninstall as its reason', async () => {
    stubGlobal('confirm', fn().mockReturnValue(true))
    spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    spyOn(internals, 'invoke').mockImplementation((command, ...rest) =>
      command === 'quit_app' ? Promise.reject('the window is stuck') : real.call(internals, command, ...rest),
    )
    await uninstallFromShells(user)
    await screen.findByText('EnvRouter is uninstalled')

    // The tray itself says nothing once the uninstall has begun; an event that still arrives (one sent just before) changes nothing.
    await emit('reveal-failed', { place: { kind: 'root' }, message: 'No file manager could show it.' })
    await new Promise((resolve) => setTimeout(resolve))
    expect(screen.getByText('EnvRouter is uninstalled')).toBeTruthy()
    expect(screen.getByText('Quit EnvRouter yourself to finish.')).toBeTruthy()
  })

  it('moves focus to Try Again when it stops, since the button that held it is gone', async () => {
    stubGlobal('confirm', fn().mockReturnValue(true))
    const user = await open('?scenario=populated&fail=uninstall')
    await uninstallFromShells(user)

    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })
    await waitFor(() => expect(document.activeElement).toBe(tryAgain))
  })

  it('holds one state while it runs, with no accent and no way to turn a shell on, and keeps the stop up while it runs again', async () => {
    stubGlobal('confirm', fn().mockReturnValue(true))
    const user = await open('?scenario=populated&fail=uninstall&pace=real')
    await uninstallFromShells(user)

    await screen.findByText('Uninstalling EnvRouter…')
    expect(reachableAccents()).toEqual([])
    expect(screen.getByRole('button', { name: /Shells/ }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'Check Folder…' }).hasAttribute('disabled')).toBe(true)
    // Settings… would open the switches the titlebar's control holds still.
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    await emit('open-settings')
    expect(screen.queryByRole('dialog', { name: 'Shell setup' })).toBeNull()

    // The first try left every shell off, which on its own would read "Routing is off" with a Turn On.
    await user.click(await screen.findByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try Again' }).getAttribute('aria-disabled')).toBe('true'))
    expect(screen.getByText('Uninstall stopped')).toBeTruthy()
    expect(screen.queryByText('Routing is off')).toBeNull()
    expect(screen.queryByRole('button', { name: /Turn On/ })).toBeNull()
    expect(reachableAccents()).toEqual([])

    await waitFor(() => expect(screen.getByRole('button', { name: 'Try Again' }).getAttribute('aria-disabled')).toBeNull())
  })
})

describe('settings and help', () => {
  const shellsPanel = () => screen.queryByRole('dialog', { name: 'Shell setup' })

  it("opens the Shells popover on ⌘, and on the menu bar's Settings…, takes focus into it, and leaves it open when both arrive", async () => {
    await open('?scenario=populated')
    await screen.findByText(/Routing is on in zsh/)
    expect(shellsPanel()).toBeNull()

    fireEvent.keyDown(window, { key: ',', metaKey: true })
    const panel = await screen.findByRole('dialog', { name: 'Shell setup' })
    expect(panel.contains(document.activeElement)).toBe(true)

    // macOS takes ⌘, for the menu's item, which sends this event; the key may arrive as well. Neither toggles.
    await emit('open-settings')
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    expect(shellsPanel()).toBe(panel)
  })

  it('swaps the Editors popover for it, and stands down while the profile inspector is open', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Editors…' }))
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    await screen.findByRole('dialog', { name: 'Shell setup' })
    expect(screen.queryByRole('dialog', { name: 'Editor setup' })).toBeNull()

    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    fireEvent.keyDown(window, { key: ',', metaKey: true })
    expect(shellsPanel()).toBeNull()
  })

  it('says in Editors… what the process wrapper does to the permission mode', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Editors…' }))
    const editors = within(screen.getByRole('dialog', { name: 'Editor setup' }))
    expect(editors.getByText(/doesn't pick a permission mode starts in “default”/)).toBeTruthy()
  })

  it('opens the docs and the issue tracker from the Shells popover, and shows why when no browser does', async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    await user.click(screen.getByRole('button', { name: 'Report an Issue' }))
    expect(await screen.findByText(/It's at .*\/issues\/new\./)).toBeTruthy()
  })

  it("tells a Help menu item's failure in the banner, as a menu bar reveal's, and tries again", async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockMenuHelp('reportIssue')
    expect(await screen.findByText("Couldn't open Report an Issue")).toBeTruthy()
    const tryAgain = screen.getByRole('button', { name: 'Try Again' })
    await waitFor(() => expect(document.activeElement).toBe(tryAgain))

    window.__mockFix()
    await user.click(tryAgain)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull())
  })
})
