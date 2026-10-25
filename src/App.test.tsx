// @vitest-environment happy-dom

// The whole window against the dev mock, which answers every command as the real backend does. Each test boots
// the mock for one URL, renders App and drives it as a user would. happy-dom loads no CSS, so what a rule means
// on screen is read from the DOM: `inert` and the accent fill's `bg-accent` class.

import { emit } from '@tauri-apps/api/event'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { hasUnsaved } from './lib/unsaved'

type User = ReturnType<typeof userEvent.setup>

const open = async (search: string) => {
  vi.resetModules()
  history.replaceState(null, '', search)
  await import('./dev/mockTauri')
  render(<App />)
  return userEvent.setup()
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const inspector = () => within(screen.getByRole('dialog'))

const isAccent = (button: HTMLElement) => button.classList.contains('bg-accent')

/** The accent-filled buttons a user can reach: not inside an `inert` subtree. */
const reachableAccents = () => screen.getAllByRole('button').filter((b) => isAccent(b) && !b.closest('[inert]'))

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
    // The mock stands the browser's confirm in for the native sheet; happy-dom has none, so this is the user's answer.
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', confirm)
    const user = await open('?scenario=broken')
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }
    const invoked = vi.spyOn(internals, 'invoke')
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
    await vi.waitFor(() =>
      expect(confirm).toHaveBeenLastCalledWith(expect.stringContaining('Your old config.json is at ~/.envrouter/config.json.bak.')),
    )
  })
})

/** The calls the window makes to the backend, from here on. */
const spyOnInvoke = () => {
  const { __TAURI_INTERNALS__: internals } = window as unknown as {
    __TAURI_INTERNALS__: { invoke: (command: string, args?: unknown) => Promise<unknown> }
  }
  return vi.spyOn(internals, 'invoke')
}

describe("a folder row's actions button", () => {
  it('opens the folder menu from the keyboard, checks the folder from it, and leaves focus on the button', async () => {
    const user = await open('?scenario=populated')
    const actions = await screen.findByRole('button', { name: 'Actions for ~/dev/work' })
    actions.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Check This Folder', 'Reveal in Finder'])

    await user.keyboard('{Enter}')
    await screen.findByText('Routed to Work', undefined, { timeout: 3000 })
    expect(document.activeElement).toBe(actions)
  })
})

describe("a folder row's menu as a native menu", () => {
  const popups = (invoked: ReturnType<typeof spyOnInvoke>) =>
    invoked.mock.calls.filter(([command]) => command === 'plugin:menu|popup').map(([, args]) => args)

  it('hangs from the button on macOS, and opens at the pointer on Linux, where a position would count from the title bar', async () => {
    for (const [search, expected] of [
      ['?scenario=populated', { Logical: { x: 0, y: 0 } }],
      ['?scenario=populated&platform=linux', null],
    ] as const) {
      const user = await open(search)
      const invoked = spyOnInvoke()
      await user.click(await screen.findByRole('button', { name: 'Actions for ~/dev/work' }))
      await screen.findByRole('menu')
      const [popup] = popups(invoked) as { at: unknown }[]
      // As IPC serializes it; happy-dom lays nothing out, so the button sits at the origin.
      expect(JSON.parse(JSON.stringify(popup.at ?? null))).toEqual(expected)
      cleanup()
    }
  })

  it('keeps its button pressed, so in view, while its menu is open', async () => {
    const user = await open('?scenario=populated')
    const actions = await screen.findByRole('button', { name: 'Actions for ~/dev/work' })
    expect(actions.getAttribute('aria-expanded')).toBe('false')
    await user.click(actions)
    await screen.findByRole('menu')
    expect(actions.getAttribute('aria-expanded')).toBe('true')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(actions.getAttribute('aria-expanded')).toBe('false'))
  })

  it('closes the menu it showed before when the next one is built', async () => {
    const user = await open('?scenario=populated')
    const invoked = spyOnInvoke()
    const actions = await screen.findByRole('button', { name: 'Actions for ~/dev/work' })
    await user.click(actions)
    await screen.findByRole('menu')
    const [{ rid: first }] = popups(invoked) as { rid: number }[]
    expect(invoked).not.toHaveBeenCalledWith('plugin:resources|close', { rid: first }, undefined)

    await user.keyboard('{Escape}')
    await user.click(actions)
    await screen.findByRole('menu')
    expect(invoked).toHaveBeenCalledWith('plugin:resources|close', { rid: first }, undefined)
  })
})

describe('native menus asked for in quick succession', () => {
  it('close the one that was overtaken while it was being built, and the last when the window goes', async () => {
    await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    // The first menu is slow to build: the second is asked for, and shown, before it exists.
    let built = (): void => {}
    let slow = true
    let building = (): void => {}
    const started = new Promise<void>((resolve) => (building = resolve))
    const invoked = vi.spyOn(internals, 'invoke').mockImplementation(async (command, ...rest) => {
      if (command === 'plugin:menu|new' && slow) {
        slow = false
        building()
        await new Promise<void>((resolve) => (built = resolve))
      }
      return real.call(internals, command, ...rest)
    })
    const actions = await screen.findByRole('button', { name: 'Actions for ~/dev/work' })
    fireEvent.click(actions)
    await started
    fireEvent.contextMenu(actions)
    await screen.findByRole('menu')
    built()
    const closed = () => invoked.mock.calls.filter(([command]) => command === 'plugin:resources|close').map(([, args]) => args)
    await waitFor(() => expect(closed()).toHaveLength(1))

    cleanup()
    await waitFor(() => expect(closed()).toHaveLength(2))
    expect(new Set(closed().map((args) => JSON.stringify(args))).size).toBe(2)
  })
})

describe('MCP folder', () => {
  it("is offered in the inspector only for a saved profile with servers, and asks for that profile's folder", async () => {
    const user = await open('?scenario=mcp')
    const invoked = spyOnInvoke()
    await user.click(await screen.findByRole('button', { name: 'Edit Northwind' }))
    expect(inspector().queryByRole('button', { name: 'Reveal MCP Folder in Finder' })).toBeNull()
    await user.click(inspector().getByRole('button', { name: 'Cancel' }))

    await user.click(screen.getByRole('button', { name: 'Edit Personal' }))
    await user.click(inspector().getByRole('button', { name: 'Reveal MCP Folder in Finder' }))
    expect(invoked).toHaveBeenCalledWith('reveal_place', { place: { kind: 'mcpFiles', profileId: 'p1' } }, undefined)
  })

  it('is busy while it asks, so a second press does not start another reveal', async () => {
    const user = await open('?scenario=mcp')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    const revealed = vi.fn()
    vi.spyOn(internals, 'invoke').mockImplementation((command, ...rest) => {
      if (command !== 'reveal_place') return real.call(internals, command, ...rest)
      revealed()
      return new Promise(() => {})
    })
    const reveal = inspector().getByRole('button', { name: 'Reveal MCP Folder in Finder' })
    await user.click(reveal)
    await user.click(reveal)
    expect(revealed).toHaveBeenCalledTimes(1)
  })

  it('says why it failed under its button, not in the footer that would grow over the focused button, with the path as a mono value', async () => {
    const user = await open('?scenario=mcp&fail=reveal')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    const reveal = inspector().getByRole('button', { name: 'Reveal MCP Folder in Finder' })
    await user.click(reveal)
    const why = await inspector().findByText(/No file manager could show it/)
    expect(why.closest('footer')).toBeNull()
    expect(inspector().getByText('~/.envrouter/mcp/p1').tagName).toBe('CODE')
    expect(document.activeElement).toBe(reveal)
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
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
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
    vi.spyOn(internals, 'invoke').mockImplementation((command, ...rest) =>
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

describe('a verdict that has somewhere to go', () => {
  it('makes a profile for the folder from New Profile…, which only describes the folder, so Check Folder… keeps the accent', async () => {
    const user = await open('?scenario=populated&check=unowned')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockDrop('/Users/sam/elsewhere', 400, 300)
    const newProfile = await screen.findByRole('button', { name: 'New Profile…' }, { timeout: 3000 })
    await screen.findByText('No profile owns this folder')
    expect(reachableAccents()).toEqual([screen.getByRole('button', { name: 'Check Folder…' })])

    await user.click(newProfile)
    expect(await inspector().findByTitle('~/elsewhere')).toBeTruthy()
  })

  it('sets the checked agent in the new profile when no profile sets it, so saving gives it a shim', async () => {
    const user = await open('?scenario=unrouted')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockDrop('/Users/sam/elsewhere', 400, 300)
    await screen.findByText('No profile sets claude yet', undefined, { timeout: 3000 })
    await user.click(screen.getByRole('button', { name: 'New Profile…' }))
    expect(inspector().getByLabelText(/Claude Code/)).toHaveProperty('value', '~/.claude')
    expect(inspector().getByLabelText(/Copilot CLI/)).toHaveProperty('value', '')
  })

  it('takes the accent for Edit on a tool no profile sets, and opens the profile that owns the folder', async () => {
    const user = await open('?scenario=unrouted')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockDrop('/Users/sam/dev/api', 400, 300)
    const edit = await screen.findByRole('button', { name: 'Edit Personal…' }, { timeout: 3000 })
    await screen.findByText('No profile sets claude yet')
    expect(reachableAccents()).toEqual([edit])

    await user.click(edit)
    expect(inspector().getByLabelText('Name')).toHaveProperty('value', 'Personal')
  })
})

describe('a folder dropped on the window', () => {
  it('becomes a trigger folder of the profile open in the inspector', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await window.__mockDrop('/Users/sam/dev/work/api', 400, 300)
    expect(await inspector().findByTitle('~/dev/work/api')).toBeTruthy()
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
    expect(hasUnsaved()).toBe(false)
  })

  it('make closing the inspector ask first, and are dropped only once the user agrees', async () => {
    // The mock stands the browser's confirm in for the native sheet; happy-dom has none, so this is the user's answer.
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', confirm)
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
    vi.stubGlobal('confirm', () => true)
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
    vi.stubGlobal('confirm', () => true)
    const user = await open('?scenario=mcp')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: /^playwright/ }))
    await user.click(within(screen.getByRole('form', { name: 'Edit playwright' })).getByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /^postgres/ })))
  })

  it('stays on a switch while it turns a shell on or off', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    const toggle = screen.getByRole('switch', { name: 'EnvRouter in bash' })
    await user.click(toggle)
    // A browser moves focus off a button that turns `disabled`; happy-dom doesn't, so this reads the cause.
    expect(toggle.getAttribute('aria-disabled')).toBe('true')
    expect(toggle.hasAttribute('disabled')).toBe(false)
    await waitFor(() => expect(toggle.hasAttribute('aria-disabled')).toBe(false))
  })
})

describe('the secret store', () => {
  it("keeps a value plain, with its lock off and the store's reason shown, when there is no store", async () => {
    const user = await open('?scenario=mcp&store=off&platform=linux')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: 'Add by Hand' }))
    const editor = within(screen.getByRole('form', { name: 'New MCP server' }))
    await user.click(editor.getByRole('button', { name: 'Add Variable' }))
    await user.type(editor.getByLabelText('Environment name 1'), 'API_KEY')

    const value = editor.getByLabelText('API_KEY value')
    expect(value.getAttribute('type')).toBe('text')
    const lock = editor.getByRole('button', { name: 'Store API_KEY value in the keyring on save' })
    expect(lock.hasAttribute('disabled')).toBe(true)
    expect(editor.getByText(/The lock is off\..*there's no Secret Service to keep secrets in/)).toBeTruthy()

    await user.type(value, 'abc')
    expect(editor.getByText(/API_KEY looks like a credential.*the keyring can't keep it, so it goes in config\.json/)).toBeTruthy()
  })

  it('saves a server that drops a stored secret when there is no store, and says what is left, instead of failing', async () => {
    const user = await open('?scenario=mcp&store=off&platform=linux')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: /^github/ }))
    const editor = within(screen.getByRole('form', { name: 'Edit github' }))
    await user.click(editor.getByRole('button', { name: 'Replace GITHUB_PERSONAL_ACCESS_TOKEN value' }))
    await user.type(editor.getByLabelText('GITHUB_PERSONAL_ACCESS_TOKEN value'), 'ghp_new')
    await user.click(editor.getByRole('button', { name: 'Save' }))

    await screen.findByText('Saved, with a loose end')
    expect(screen.getByText(/Couldn't remove a secret no server uses any more/)).toBeTruthy()
    expect(screen.queryByText('Something went wrong')).toBeNull()
    await waitFor(() => expect(hasUnsaved()).toBe(false))
  })

  it('replaces a locked value with a plain one when there is no store', async () => {
    const user = await open('?scenario=mcp&store=off&platform=linux')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: /^github/ }))
    const editor = within(screen.getByRole('form', { name: 'Edit github' }))
    await user.click(editor.getByRole('button', { name: 'Replace GITHUB_PERSONAL_ACCESS_TOKEN value' }))
    expect(editor.getByLabelText('GITHUB_PERSONAL_ACCESS_TOKEN value').getAttribute('type')).toBe('text')
  })
})

describe('Uninstall EnvRouter…', () => {
  const uninstallFromShells = async (user: User) => {
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    await user.click(screen.getByRole('button', { name: 'Uninstall EnvRouter…' }))
  }

  it('is a push button, and nothing changes unless the user agrees', async () => {
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: /Shells/ }))
    const button = screen.getByRole('button', { name: 'Uninstall EnvRouter…' })
    expect(isAccent(button)).toBe(false)
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }
    const invoked = vi.spyOn(internals, 'invoke')

    await user.click(button)
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Uninstall EnvRouter?'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('any MCP secrets EnvRouter kept in the Keychain are deleted'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(invoked.mock.calls.map(([command]) => command)).not.toContain('uninstall')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Shells/ }))
  })

  it('names what is left to remove, then quits', async () => {
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string) => Promise<unknown> } }
    const invoked = vi.spyOn(internals, 'invoke')
    await uninstallFromShells(user)

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('quit'))
    // The note giving focus back to the window must not read the folder that was just deleted.
    invoked.mockClear()
    window.dispatchEvent(new Event('focus'))
    await new Promise((resolve) => setTimeout(resolve))
    expect(invoked).not.toHaveBeenCalled()
    const note = confirm.mock.calls.map(([text]) => String(text)).find((text) => text.includes('EnvRouter is uninstalled'))
    expect(note).toContain('To remove the app: brew uninstall --zap --cask envrouter')
    expect(note).toContain('To remove the envrouter CLI: brew uninstall envrouter-cli')
    expect(note).toContain('EnvRouter quits now.')
  })

  it('stays open when it stops, with the reason and Try Again, and finishes when asked again', async () => {
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated&fail=uninstall')
    await uninstallFromShells(user)

    await screen.findByText('Uninstall stopped')
    expect(log).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /Shells/ }))
    expect(screen.getByRole('switch', { name: 'EnvRouter in zsh' }).getAttribute('aria-checked')).toBe('false')

    window.__mockFix()
    await user.click(screen.getByRole('button', { name: 'Try Again' }))
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('quit'))
  })

  it('titles the stop as the uninstall, with a line and mono values for each problem', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
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
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const log = vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    let stuck = true
    const invoked = vi
      .spyOn(internals, 'invoke')
      .mockImplementation((command, ...rest) =>
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
    await vi.waitFor(() => expect(log).toHaveBeenCalledWith('quit'))
    expect(invoked.mock.calls.map(([command]) => command)).toEqual(['quit_app'])
  })

  it('keeps its banner when a reveal from the menu bar fails meanwhile, with the uninstall as its reason', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const user = await open('?scenario=populated')
    const { __TAURI_INTERNALS__: internals } = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, ...rest: unknown[]) => Promise<unknown> }
    }
    const real = internals.invoke
    vi.spyOn(internals, 'invoke').mockImplementation((command, ...rest) =>
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
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const user = await open('?scenario=populated&fail=uninstall')
    await uninstallFromShells(user)

    const tryAgain = await screen.findByRole('button', { name: 'Try Again' })
    await waitFor(() => expect(document.activeElement).toBe(tryAgain))
  })

  it('holds one state while it runs, with no accent and no way to turn a shell on, and keeps the stop up while it runs again', async () => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    const user = await open('?scenario=populated&fail=uninstall')
    await uninstallFromShells(user)

    await screen.findByText('Uninstalling EnvRouter…')
    expect(reachableAccents()).toEqual([])
    expect(screen.getByRole('button', { name: /Shells/ }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('button', { name: 'Check Folder…' }).hasAttribute('disabled')).toBe(true)

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
