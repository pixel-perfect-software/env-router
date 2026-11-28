// The whole window against the dev mock, which answers every command as the real backend does. Each test boots
// the mock for one URL, renders App and drives it as a user would. jsdom loads no CSS, so what a rule means
// on screen is read from the DOM: `inert` and the accent fill's `bg-accent` class. What one component owns is tested beside it
// (Frame, Docket, Servers, ServerTools, ServerSources, ServerFields, ProfileInspector, Popovers), with the helpers in `./dev/windowTest`.

import { emit } from '@tauri-apps/api/event'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, fn, it, resetModules, spyOn, stubGlobal } from 'provino'
import App from './App'
import { inspector, isAccent, open, reachableAccents, spyOnInvoke, type User } from './dev/windowTest'
import { hasUnsaved } from './lib/unsaved'

describe('the one accent button', () => {
  it('goes to Check Folder… when routing works and nothing else asks for it', async () => {
    await open('?scenario=populated')
    await screen.findByText(/Routing is on in zsh/)
    expect(reachableAccents()).toEqual([screen.getByRole('button', { name: 'Check Folder…' })])
  })

  it('goes to Save under the open inspector, though the banner keeps its accent action behind it', async () => {
    const user = await open('?scenario=populated&shim=stale')
    await screen.findByText('The shim is missing or out of date')
    const reinstall = screen.getByRole('button', { name: 'Reinstall Shim' })
    expect(reachableAccents()).toEqual([reinstall])

    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    expect(isAccent(reinstall)).toBe(true)
    expect(reinstall.closest('[inert]')).not.toBeNull()
    expect(reachableAccents()).toEqual([inspector().getByRole('button', { name: 'Save' })])
  })
})

describe('Try Again', () => {
  it('asks for the setup status again after a failed refresh, as a push button', async () => {
    const user = await open('?scenario=populated&fail=status')
    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })
    expect(reachableAccents()).toEqual([screen.getByRole('button', { name: 'Check Folder…' })])

    window.__mockFix()
    await user.click(tryAgain)
    await screen.findByText(/Routing is on in zsh/)
  })

  it('does the failed action again, not just clears the error', async () => {
    const user = await open('?scenario=first-run&fail=shell')
    await user.click(await screen.findByRole('button', { name: 'New Profile' }))
    await user.type(inspector().getByLabelText('Name'), 'Mine')
    await user.click(inspector().getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Turn On zsh' }))
    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })
    const zsh = () => screen.getByRole('switch', { name: 'EnvRouter in zsh' })
    expect(zsh().getAttribute('aria-checked')).toBe('false')

    window.__mockFix()
    // The click outside closes the popover that the failure opened.
    await user.click(tryAgain)
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    await waitFor(() => expect(zsh().getAttribute('aria-checked')).toBe('true'))
  })
})

describe('a banner action that removes its banner', () => {
  // One rule for all of them: the button that held focus goes with the banner, so focus goes on to Check Folder…, not to the page.
  it('hands focus to Check Folder… when Try Again gets its answer', async () => {
    const user = await open('?scenario=populated&fail=status')
    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })
    window.__mockFix()
    await user.click(tryAgain)
    await screen.findByText(/Routing is on in zsh/)
    expect(document.activeElement).toBe(document.getElementById('check-folder'))
  })

  it('hands focus to Check Folder… when Reinstall Shim fixes the shim', async () => {
    const user = await open('?scenario=populated&shim=stale')
    await user.click(await screen.findByRole('button', { name: 'Reinstall Shim' }))
    await screen.findByText(/Routing is on in zsh/)
    expect(document.activeElement).toBe(document.getElementById('check-folder'))
  })
})

describe('an unreadable config.json', () => {
  it('offers Open config.json as the accent and Reveal beside it, until opening fails and Reveal takes the accent', async () => {
    const user = await open('?scenario=broken&fail=editor')
    const openConfig = await screen.findByRole('button', { name: 'Open config.json' })
    const reveal = screen.getByRole('button', { name: 'Reveal in Finder' })
    expect(reachableAccents()).toEqual([openConfig])

    await user.click(openConfig)
    await screen.findByText(/couldn't open/)
    expect(reachableAccents()).toEqual([reveal])
  })

  it('keeps the accent on Open when only Reveal fails, and shows why', async () => {
    const user = await open('?scenario=broken&fail=reveal')
    const openConfig = await screen.findByRole('button', { name: 'Open config.json' })
    await user.click(screen.getByRole('button', { name: 'Reveal in Finder' }))
    await screen.findByText(/No file manager could show it/)
    expect(reachableAccents()).toEqual([openConfig])
  })

  it('offers to start over only when the file will not parse, not for one from a newer version', async () => {
    await open('?scenario=newer')
    await screen.findByRole('button', { name: 'Open config.json' })
    expect(screen.getByText(/is from a newer version of EnvRouter/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Back Up and Start Over…' })).toBeNull()
  })

  it('backs it up and starts over only once the user agrees, as a push button beside the one accent', async () => {
    // The mock stands the browser's confirm in for the native sheet; jsdom's only says it isn't implemented, so this is the user's answer.
    const confirm = fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=broken')
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }
    const invoked = spyOn(internals, 'invoke')
    const startOver = await screen.findByRole('button', { name: 'Back Up and Start Over…' })
    expect(reachableAccents()).toEqual([screen.getByRole('button', { name: 'Open config.json' })])

    await user.click(startOver)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Back up config.json and start over?'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(invoked.mock.calls.map(([command]) => command)).not.toContain('reset_unreadable_config')
    expect(screen.getByText("EnvRouter can't read config.json")).toBeTruthy()

    await user.click(startOver)
    await screen.findByText('The folder decides')
    expect(invoked.mock.calls.map(([command]) => command)).toContain('reset_unreadable_config')
    await waitFor(() => expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Your old config.json is at ~/.envrouter/config.json.bak.')))
  })
})

describe('a reveal from the menu bar that failed', () => {
  it('shows under the unreadable-config banner, where an action error would be hidden, and leaves no Try Again behind', async () => {
    await open('?scenario=broken&fail=reveal')
    await screen.findByRole('button', { name: 'Open config.json' })
    await window.__mockMenuReveal({ kind: 'config' })
    await screen.findByText(/No file manager could show it/)
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull()
  })

  it('brings up the reason in the banner, and Try Again asks for the same place again', async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockMenuReveal({ kind: 'root' })
    await screen.findByText(/No file manager could show it/)
    // Its own title, naming what it was after, and the path as a value.
    expect(screen.getByText("Couldn't open ~/.envrouter")).toBeTruthy()
    expect(screen.getByText('~/.envrouter').tagName).toBe('CODE')

    window.__mockFix()
    const invoked = spyOnInvoke()
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    await waitFor(() => expect(invoked).toHaveBeenCalledWith('reveal_place', { place: { kind: 'root' } }, undefined))
    await waitFor(() => expect(screen.queryByText(/No file manager/)).toBeNull())
  })

  it('keeps focus on Try Again while it fails again, and shows the repeat as a new line for the status region to announce', async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockMenuReveal({ kind: 'config' })
    const first = await screen.findByText(/No file manager could show it/)
    const tryAgain = screen.getByRole('button', { name: 'Try Again' })

    await user.click(tryAgain)
    await waitFor(() => expect(screen.getByText(/No file manager could show it/)).not.toBe(first))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try Again' }))
    expect(document.activeElement).toBe(tryAgain)
  })

  it('is told natively when the banner has no room for it: behind the inspector, or beside an unreadable config.json for another place', async () => {
    const confirm = fn().mockReturnValue(true)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=mcp&fail=reveal')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    await window.__mockMenuReveal({ kind: 'root' })
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Couldn't open ~/.envrouter")))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('No file manager could show it'))
    await user.click(inspector().getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull()

    cleanup()
    confirm.mockClear()
    await open('?scenario=broken&fail=reveal')
    await screen.findByRole('button', { name: 'Open config.json' })
    await window.__mockMenuReveal({ kind: 'root' })
    await waitFor(() => expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Couldn't open ~/.envrouter")))
    expect(screen.queryByText(/No file manager could show it/)).toBeNull()
  })

  it('leaves a banner that something else replaced while its Try Again was asking', async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockMenuReveal({ kind: 'root' })
    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })

    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    let answer = () => {}
    spyOn(internals, 'invoke').mockImplementation((command, ...rest) =>
      command === 'reveal_place' ? new Promise((resolve) => (answer = () => resolve(null))) : real.call(internals, command, ...rest),
    )
    await user.click(tryAgain)
    await window.__mockMenuReveal({ kind: 'config' })
    await screen.findByText("Couldn't show config.json")

    answer()
    await new Promise((resolve) => setTimeout(resolve))
    expect(screen.getByText("Couldn't show config.json")).toBeTruthy()
  })

  it('moves focus to Check Folder… when Try Again succeeds, since the button that held it is gone', async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockMenuReveal({ kind: 'root' })
    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })

    window.__mockFix()
    await user.click(tryAgain)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Try Again' })).toBeNull())
    expect(document.activeElement).toBe(document.getElementById('check-folder'))
  })

  it("sets the path in the Shells panel's note as a value too, as every other reveal failure does", async () => {
    const user = await open('?scenario=populated&fail=reveal')
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    await user.click(screen.getByRole('button', { name: 'Reveal config.json in Finder' }))
    expect((await screen.findByText('~/.envrouter/config.json')).tagName).toBe('CODE')
  })
})

describe('unsaved edits', () => {
  /** Opens a profile's inspector from its card and adds to its name. */
  const renameProfile = async (user: User, name: string) => {
    await user.click(await screen.findByRole('button', { name: `Edit ${name}` }))
    await user.type(inspector().getByLabelText('Name'), ' 2')
  }

  it('are reported while a profile holds them, and cleared by saving', async () => {
    const user = await open('?scenario=populated')
    await renameProfile(user, 'Personal')
    expect(hasUnsaved()).toBe(true)

    await user.click(inspector().getByRole('button', { name: 'Save' }))
    await screen.findByRole('button', { name: 'Edit Personal 2' })
    // The card shows the saved name a render before the inspector closes, and the inspector reports
    // its edits gone as it closes, so wait for that rather than the card.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(hasUnsaved()).toBe(false)
  })

  it('make closing the inspector ask first, and are dropped only once the user agrees', async () => {
    // The mock stands the browser's confirm in for the native sheet; jsdom's only says it isn't implemented, so this is the user's answer.
    const confirm = fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await renameProfile(user, 'Personal')

    await user.click(inspector().getByRole('button', { name: 'Cancel' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard changes to “Personal”?'))
    expect(hasUnsaved()).toBe(true)

    await user.click(inspector().getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(hasUnsaved()).toBe(false)
  })

  it('are reported while a server holds them, and cleared by Revert', async () => {
    const user = await open('?scenario=mcp')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: /^playwright/ }))
    const editor = within(screen.getByRole('form', { name: 'Edit playwright' }))
    expect(hasUnsaved()).toBe(false)

    await user.type(editor.getByLabelText('Command'), 'x')
    expect(hasUnsaved()).toBe(true)

    await user.click(editor.getByRole('button', { name: 'Revert' }))
    expect(hasUnsaved()).toBe(false)
  })
})

describe('focus', () => {
  const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  it('returns to the pencil that opened the inspector when Cancel closes it', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.click(inspector().getByRole('button', { name: 'Cancel' }))
    await closed()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Work' }))
  })

  it('goes to New Profile when the inspector deletes its profile', async () => {
    stubGlobal('confirm', () => true)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.click(inspector().getByRole('button', { name: /^Delete/ }))
    await closed()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /New Profile/ }))
  })

  it("goes to the new profile's pencil after the first save from Welcome", async () => {
    const user = await open('?scenario=first-run')
    await user.click(await screen.findByRole('button', { name: 'New Profile' }))
    await user.type(inspector().getByLabelText('Name'), 'Mine')
    await user.click(inspector().getByRole('button', { name: 'Save' }))
    await closed()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit Mine' }))
  })

  it('goes to the + button when the inspector sends the user to MCP Servers for a first server', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await user.click(inspector().getByRole('button', { name: 'MCP Servers' }))
    await closed()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add by Hand' })))
  })

  it('goes to the next server when one is deleted', async () => {
    stubGlobal('confirm', () => true)
    const user = await open('?scenario=mcp')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: /^playwright/ }))
    await user.click(within(screen.getByRole('form', { name: 'Edit playwright' })).getByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^postgres/ })))
  })

  it('wraps Tab inside the profile editor, since the page behind it is out of reach', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    const save = inspector().getByRole('button', { name: 'Save' })
    const close = inspector().getByRole('button', { name: 'Close' })
    // Something after Save that Tab never lands on (taken out of the order) is no end of the dialog.
    const skipped = document.createElement('button')
    skipped.tabIndex = -1
    screen.getByRole('dialog').append(skipped)
    save.focus()
    await user.tab()
    expect(document.activeElement).toBe(close)
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(save)
  })

  it('stays on a switch while it turns a shell on or off', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    const toggle = screen.getByRole('switch', { name: 'EnvRouter in bash' })
    await user.click(toggle)
    // A browser moves focus off a button that turns `disabled`; jsdom doesn't, so this reads the cause.
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(false)
    await waitFor(() => expect(toggle.hasAttribute('aria-disabled')).toBe(false))
  })
})

describe('the setup status', () => {
  it('is the latest one asked for, though an older read resolves after it', async () => {
    const user = await open('?scenario=populated')
    await screen.findByText(/Routing is on in zsh/)
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> }
    }
    const original = internals.invoke.bind(internals)
    const invoked = spyOnInvoke()
    let release = () => {}
    const slow = new Promise<void>((resolve) => {
      release = resolve
    })
    let reads = 0
    invoked.mockImplementation(async (command: string, args?: unknown) => {
      const answer = await original(command, args)
      if (command !== 'get_setup_status') return answer
      // The first read is slow and stale (Copilot missing); the second is current (nothing missing).
      if (++reads === 1) {
        await slow
        return { ...(answer as object), missingAgents: ['copilot'] }
      }
      return { ...(answer as object), missingAgents: [] }
    })

    window.dispatchEvent(new Event('focus'))
    await emit('setup-changed')
    await waitFor(() => expect(reads).toBe(2))
    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    expect(inspector().queryByText('Not installed')).toBeNull()
  })
})

describe('the last view', () => {
  it('is the one the window opens on next time', async () => {
    const user = await open('?scenario=mcp')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    const pressed = (view: string) => screen.getByRole('button', { name: view }).getAttribute('aria-pressed')
    expect(pressed('MCP Servers')).toBe('true')

    cleanup()
    await open('?scenario=mcp')
    await screen.findByRole('button', { name: 'Add by Hand' })
    expect(pressed('MCP Servers')).toBe('true')
  })
})

describe("the menu bar's Check Last Folder", () => {
  it('checks the folder it names, as a dropped folder is, and leaves it to Profiles', async () => {
    await open('?scenario=mcp&view=servers')
    await screen.findByRole('button', { name: 'Add by Hand' })
    await window.__mockMenuRequest({ kind: 'checkLastFolder', folder: '/Users/sam/dev/work' })
    await screen.findByText('Routed to Work', undefined, { timeout: 3000 })
    expect(screen.getByRole('button', { name: 'Profiles' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe("the menu bar's requests", () => {
  it('reach a window that was not listening yet, when it starts', async () => {
    resetModules()
    history.replaceState(null, '', '?scenario=populated')
    await import('./dev/mockTauri')
    // Left before the window exists, as on the first show after a launch with it hidden: the event goes nowhere.
    await window.__mockMenuRequest({ kind: 'checkLastFolder', folder: '/Users/sam/dev/work' })
    render(<App />)
    await screen.findByText('Routed to Work', undefined, { timeout: 3000 })
  })

  it('are taken once, so a later start does not act on one already carried out', async () => {
    await open('?scenario=populated')
    await screen.findByText(/Routing is on in zsh/)
    const invoked = spyOnInvoke()
    await window.__mockMenuRequest({ kind: 'checkLastFolder', folder: '/Users/sam/dev/work' })
    await screen.findByText('Routed to Work', undefined, { timeout: 3000 })
    cleanup()
    // Another window start (a reload) finds nothing waiting.
    render(<App />)
    await screen.findByText(/Routing is on in zsh/)
    expect(invoked.mock.calls.filter(([command]) => command === 'check_folder')).toHaveLength(1)
  })
})

describe("the menu bar's Check Last Folder, when the window can't do it", () => {
  it('says why instead of doing nothing, since the menu bar has brought the window forward', async () => {
    const confirm = fn().mockReturnValue(true)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    await window.__mockMenuRequest({ kind: 'checkLastFolder', folder: '/Users/sam/dev/work' })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toMatch(/Close the profile editor/)
    expect(screen.queryByText('Routed to Work')).toBeNull()
  })
})

describe('error text', () => {
  it('can be selected, in the banner and in an editor’s footer, since it is what gets pasted into a report', async () => {
    const user = await open('?scenario=mcp&fail=status')
    const detail = (await screen.findByText(/No such file or directory/)).closest('p')
    expect(detail?.classList.contains('select-text')).toBe(true)

    await user.click(screen.getByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: 'Add by Hand' }))
    await user.click(within(screen.getByRole('form', { name: 'New MCP server' })).getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('alert')).classList.contains('select-text')).toBe(true)
  })
})

describe('Check Folder… when the window cannot do it', () => {
  it('says why for ⌘O and the menu bar while the profile editor is open, as Check Last Folder does', async () => {
    const confirm = fn().mockReturnValue(true)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await window.__mockMenuRequest({ kind: 'checkFolder' })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    for (const [message] of confirm.mock.calls) expect(message).toMatch(/Close the profile editor/)
  })

  it('says why when config.json cannot be read, since there is nothing to check a folder against', async () => {
    const confirm = fn().mockReturnValue(true)
    stubGlobal('confirm', confirm)
    await open('?scenario=broken')
    await screen.findByRole('button', { name: 'Open config.json' })
    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toMatch(/config\.json can't be read/)
  })
})

describe('⌘N', () => {
  it('is a new profile on Profiles and a new server on Servers, without leaving the view', async () => {
    const user = await open('?scenario=mcp')
    await screen.findByText(/Routing is on in zsh/)
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(await screen.findByRole('dialog', { name: 'New profile' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    await user.click(screen.getByRole('button', { name: 'MCP Servers' }))
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(await screen.findByRole('form', { name: 'New MCP server' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'MCP Servers' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('and Add by Hand leave a blank server that is already open as it is, with its draft, and focus its name', async () => {
    const confirm = fn().mockReturnValue(false)
    stubGlobal('confirm', confirm)
    const user = await open('?scenario=mcp&view=servers')
    await user.click(await screen.findByRole('button', { name: 'Add by Hand' }))
    const name = within(screen.getByRole('form', { name: 'New MCP server' })).getByLabelText('Name') as HTMLInputElement
    await user.type(name, 'draft')

    for (const ask of [
      () => user.click(screen.getByRole('button', { name: 'Add by Hand' })),
      async () => fireEvent.keyDown(window, { key: 'n', metaKey: true }),
    ]) {
      name.blur()
      await ask()
      expect(document.activeElement).toBe(name)
      expect(name.value).toBe('draft')
    }
    expect(confirm).not.toHaveBeenCalled()
  })
})
