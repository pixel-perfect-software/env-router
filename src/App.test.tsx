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
  // The window remembers its view there; a test mustn't open on the last one's.
  localStorage.clear()
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

describe('the server list', () => {
  const openServers = async (search = '?scenario=mcp') => {
    const user = await open(search)
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    return user
  }
  /** The servers the list shows, in order. */
  const listed = () => Array.from(document.querySelectorAll('[data-server]'), (row) => row.getAttribute('data-server'))
  const filter = () => screen.getByRole('searchbox', { name: 'Filter servers' })
  const row = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name}`) })
  const menuOf = async (user: User, name: string) => {
    await user.pointer({ keys: '[MouseRight]', target: row(name) })
    return within(await screen.findByRole('menu'))
  }

  it.each([
    ['name, whatever the case', 'LINEAR', ['linear']],
    ['command', 'docker', ['slow']],
    ['package, which is in the arguments', '@modelcontextprotocol', ['github', 'postgres']],
  ])('filters by %s', async (_rule, query, expected) => {
    const user = await openServers()
    expect(listed()).toHaveLength(6)
    await user.type(filter(), query)
    expect(listed()).toEqual(expected)
  })

  it('says so when nothing matches, and Clear Filter brings every server back to the field', async () => {
    const user = await openServers()
    await user.type(filter(), 'zzz')
    expect(screen.getByText('No servers match')).toBeTruthy()
    expect(listed()).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Clear Filter' }))
    expect(listed()).toHaveLength(6)
    expect(document.activeElement).toBe(filter())
  })

  it('is cleared by Escape in the field', async () => {
    const user = await openServers()
    await user.type(filter(), 'docker')
    await user.keyboard('{Escape}')
    expect(listed()).toHaveLength(6)
    expect((filter() as HTMLInputElement).value).toBe('')
  })

  it('keeps the open server in its editor when the filter hides its row', async () => {
    const user = await openServers()
    await user.click(row('playwright'))
    await user.type(filter(), 'docker')
    expect(listed()).toEqual(['slow'])
    expect(screen.getByRole('form', { name: 'Edit playwright' })).toBeTruthy()
  })

  it('stays out of the way of a small library', async () => {
    await openServers('?scenario=populated')
    expect(screen.queryByRole('searchbox', { name: 'Filter servers' })).toBeNull()
  })

  it('offers Duplicate, Check Server and Delete on a right-click, and the same from the row’s … button', async () => {
    const user = await openServers()
    const items = (menu: HTMLElement[]) => menu.map((item) => item.textContent)
    expect(items((await menuOf(user, 'github')).getAllByRole('menuitem'))).toEqual(['Duplicate…', 'Check Server', 'Delete…'])
    await user.keyboard('{Escape}')

    const actions = screen.getByRole('button', { name: 'Actions for github' })
    await user.click(actions)
    expect(items(within(await screen.findByRole('menu')).getAllByRole('menuitem'))).toEqual(['Duplicate…', 'Check Server', 'Delete…'])
    expect(actions.getAttribute('aria-expanded')).toBe('true')
  })

  it('names a server in full and who loads it on the whole row, since the name truncates and the dots under the … can’t be hovered', async () => {
    await openServers()
    expect(row('playwright').getAttribute('title')).toBe('playwright · Used by Personal, Scratch')
    expect(row('slow').getAttribute('title')).toBe('slow')
    // Assistive tech gets who uses it as the description, not the name again, which the tooltip repeats for sighted users.
    expect(document.getElementById(row('playwright').getAttribute('aria-describedby') ?? '')?.textContent).toBe('Used by Personal, Scratch')
    expect(row('slow').hasAttribute('aria-describedby')).toBe(false)
  })

  it('presses the … only when it opened the menu, not for a right-click', async () => {
    const user = await openServers()
    const actions = screen.getByRole('button', { name: 'Actions for github' })
    await menuOf(user, 'github')
    expect(actions.getAttribute('aria-expanded')).toBe('false')
    await user.keyboard('{Escape}')

    await user.click(actions)
    await screen.findByRole('menu')
    expect(actions.getAttribute('aria-expanded')).toBe('true')
  })

  it('says how many servers match once typing pauses, not at each keystroke', async () => {
    const user = await openServers()
    const status = within(screen.getByRole('complementary', { name: 'MCP servers' })).getByRole('status')
    await user.type(filter(), 'docker')
    expect(status.textContent).toBe('')
    await waitFor(() => expect(status.textContent).toBe('1 server shown'))
  })

  it('reads the count as "of", not as a slash, to a screen reader', async () => {
    const user = await openServers()
    await user.type(filter(), 'docker')
    expect(screen.getByText('1 of 6')).toBeTruthy()
  })

  it('duplicates the server it was opened on into a new one', async () => {
    const user = await openServers()
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Duplicate…' }))
    const form = within(await screen.findByRole('form', { name: 'New MCP server' }))
    expect((form.getByLabelText('Name') as HTMLInputElement).value).toBe('github-2')
  })

  it('checks the server it was opened on, in the editor that shows the result', async () => {
    const user = await openServers()
    const invoked = spyOnInvoke()
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Check Server' }))
    const form = within(await screen.findByRole('form', { name: 'Edit github' }))
    expect(form.getByText('Starting the server…')).toBeTruthy()
    expect(invoked).toHaveBeenCalledWith('check_mcp_server', expect.objectContaining({ name: 'github' }), undefined)
  })

  it('checks the open server again each time, with the edits its form holds', async () => {
    const user = await openServers()
    await user.click(row('github'))
    const invoked = spyOnInvoke()
    const checks = () => invoked.mock.calls.filter(([command]) => command === 'check_mcp_server').length
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Check Server' }))
    await waitFor(() => expect(checks()).toBe(1))
    await waitFor(() => expect(screen.queryByText('Starting the server…')).toBeNull(), { timeout: 3000 })

    // Picking the row again in between must not make the next request look like the last one.
    await user.click(row('github'))
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Check Server' }))
    await waitFor(() => expect(checks()).toBe(2))
  })

  it('checks once for one click, however many times the editor is shown again', async () => {
    const user = await openServers()
    const invoked = spyOnInvoke()
    const checks = () => invoked.mock.calls.filter(([command]) => command === 'check_mcp_server').length
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Check Server' }))
    await waitFor(() => expect(checks()).toBe(1))
    await waitFor(() => expect(screen.queryByText('Starting the server…')).toBeNull(), { timeout: 3000 })

    // config.json changes under the open editor and the window reads it on focus: the editor opens again from the new definition.
    window.__mockEditConfig((c) => ({
      ...c,
      mcpServers: { ...c.mcpServers, github: { transport: 'stdio', command: 'npx', args: ['-y', 'changed'], env: {} } },
    }))
    window.dispatchEvent(new Event('focus'))
    await screen.findByDisplayValue('changed')
    expect(checks()).toBe(1)
  })

  it('does not start a second check while one is running', async () => {
    const user = await openServers()
    const invoked = spyOnInvoke()
    const checks = () => invoked.mock.calls.filter(([command]) => command === 'check_mcp_server').length
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Check Server' }))
    await screen.findByText('Starting the server…')
    await user.click((await menuOf(user, 'github')).getByRole('menuitem', { name: 'Check Server' }))
    await waitFor(() => expect(screen.queryByText('Starting the server…')).toBeNull(), { timeout: 3000 })
    expect(checks()).toBe(1)
  })

  it('opens the menu under the row when the key asked for it, and at the pointer when a right-click did', async () => {
    const user = await openServers()
    const invoked = spyOnInvoke()
    const popped = () =>
      invoked.mock.calls
        .filter(([command]) => command === 'plugin:menu|popup')
        .map(([, args]) => JSON.parse(JSON.stringify((args as { at?: unknown }).at ?? null)))

    // The context-menu key sends a `contextmenu` with no right button, from the focused row.
    fireEvent.contextMenu(row('github'), { button: 0 })
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    await user.pointer({ keys: '[MouseRight]', target: row('github') })
    await screen.findByRole('menu')
    // happy-dom lays nothing out, so the row sits at the origin.
    expect(popped()).toEqual([{ Logical: { x: 0, y: 0 } }, null])
  })

  it('asks before it deletes, saying who stops loading the server, and deletes only once the user agrees', async () => {
    const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    vi.stubGlobal('confirm', confirm)
    const user = await openServers()
    await user.click((await menuOf(user, 'playwright')).getByRole('menuitem', { name: 'Delete…' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete the MCP server “playwright”?'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Personal, Scratch will stop loading it'))
    expect(listed()).toContain('playwright')

    await user.click((await menuOf(user, 'playwright')).getByRole('menuitem', { name: 'Delete…' }))
    await waitFor(() => expect(listed()).not.toContain('playwright'))
  })

  it("goes to the neighbour the filter shows when the open server is one it hides, not to the filter's first row", async () => {
    vi.stubGlobal('confirm', () => true)
    const user = await openServers()
    await user.click(row('playwright'))
    await user.type(filter(), '@modelcontext')
    expect(listed()).toEqual(['github', 'postgres'])
    await user.click(within(screen.getByRole('form', { name: 'Edit playwright' })).getByRole('button', { name: /^Delete/ }))
    await waitFor(() => expect(document.activeElement).toBe(row('postgres')))
  })

  it('clears the filter when a save leaves the server outside it, so its row is there to take focus', async () => {
    const user = await openServers()
    await user.type(filter(), 'slow')
    await user.click(row('slow'))
    const name = within(screen.getByRole('form', { name: 'Edit slow' })).getByLabelText('Name')
    await user.clear(name)
    await user.type(name, 'fast')
    await user.click(within(screen.getByRole('form', { name: 'Edit slow' })).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect((filter() as HTMLInputElement).value).toBe(''))
    expect(listed()).toHaveLength(6)
    await waitFor(() => expect(document.activeElement).toBe(row('fast')))
  })

  it('leaves Delete… usable when the user declines it in the editor', async () => {
    vi.stubGlobal('confirm', () => false)
    const user = await openServers()
    await user.click(row('sentry'))
    const del = within(screen.getByRole('form', { name: 'Edit sentry' })).getByRole('button', { name: /^Delete/ })
    await user.click(del)
    await waitFor(() => expect(del.hasAttribute('aria-disabled') || del.hasAttribute('disabled')).toBe(false))
    expect(listed()).toContain('sentry')
  })

  it('forgets the edits of a server deleted from the list, so the next one opens clean', async () => {
    const confirm = vi.fn(() => true)
    vi.stubGlobal('confirm', confirm)
    const user = await openServers()
    await user.click(row('playwright'))
    await user.type(within(screen.getByRole('form', { name: 'Edit playwright' })).getByLabelText('Command'), 'x')
    await user.click((await menuOf(user, 'playwright')).getByRole('menuitem', { name: 'Delete…' }))
    await waitFor(() => expect(listed()).not.toContain('playwright'))
    confirm.mockClear()

    await user.click(row('github'))
    expect(confirm).not.toHaveBeenCalled()
    expect(screen.getByRole('form', { name: 'Edit github' })).toBeTruthy()
    expect(screen.queryByText(/config.json changed this server/)).toBeNull()
    expect(hasUnsaved()).toBe(false)
  })

  describe('with unsaved edits in the editor', () => {
    const editPlaywright = async (user: User) => {
      await user.click(row('playwright'))
      await user.type(within(screen.getByRole('form', { name: 'Edit playwright' })).getByLabelText('Command'), 'x')
    }

    it('asks before Duplicate leaves them, and keeps them unless the user agrees', async () => {
      const confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
      vi.stubGlobal('confirm', confirm)
      const user = await openServers()
      await editPlaywright(user)

      await user.click((await menuOf(user, 'sentry')).getByRole('menuitem', { name: 'Duplicate…' }))
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard changes to “playwright”?'))
      expect(screen.getByRole('form', { name: 'Edit playwright' })).toBeTruthy()
      expect(hasUnsaved()).toBe(true)

      await user.click((await menuOf(user, 'sentry')).getByRole('menuitem', { name: 'Duplicate…' }))
      await screen.findByRole('form', { name: 'New MCP server' })
    })

    it('asks before Check Server on another server leaves them', async () => {
      const confirm = vi.fn().mockReturnValue(false)
      vi.stubGlobal('confirm', confirm)
      const user = await openServers()
      await editPlaywright(user)
      const invoked = spyOnInvoke()

      await user.click((await menuOf(user, 'sentry')).getByRole('menuitem', { name: 'Check Server' }))
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard changes to “playwright”?'))
      expect(screen.getByRole('form', { name: 'Edit playwright' })).toBeTruthy()
      expect(invoked).not.toHaveBeenCalledWith('check_mcp_server', expect.anything(), undefined)
    })

    it('are kept when another server is deleted', async () => {
      vi.stubGlobal('confirm', () => true)
      const user = await openServers()
      await editPlaywright(user)

      await user.click((await menuOf(user, 'sentry')).getByRole('menuitem', { name: 'Delete…' }))
      await waitFor(() => expect(listed()).not.toContain('sentry'))
      expect(screen.getByRole('form', { name: 'Edit playwright' })).toBeTruthy()
      expect(hasUnsaved()).toBe(true)
    })
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
    expect(note).toContain('EnvRouter quits now, and deletes its own saved data as it goes.')
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

describe('agents a new terminal does not find', () => {
  it('are still offered in the inspector, marked, with the vendor install line, and the one that is there is not', async () => {
    const user = await open('?scenario=populated&agents=claude')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    const agent = (name: string) => inspector().getByLabelText(new RegExp(name)).closest('li') as HTMLElement

    expect(within(agent('Copilot CLI')).getByText('Not installed')).toBeTruthy()
    expect(within(agent('Copilot CLI')).getByText('curl -fsSL https://gh.io/copilot-install | bash')).toBeTruthy()
    expect(within(agent('Copilot CLI')).getByRole('textbox')).toBeTruthy()
    expect(within(agent('Claude Code')).queryByText('Not installed')).toBeNull()
  })

  it('are marked on a profile card that sets them and in the welcome sentence', async () => {
    await open('?scenario=mcp&agents=none')
    const card = await screen.findByRole('region', { name: 'Profile Work' })
    expect(within(card).getAllByText('Not installed').length).toBeGreaterThan(0)

    cleanup()
    await open('?scenario=first-run&agents=claude')
    const welcome = await screen.findByRole('heading', { name: 'The folder decides' })
    expect(welcome.parentElement?.textContent).toMatch(/claude and copilot \(not installed\) use/)
  })

  it('are not marked while the terminal has not said what it has', async () => {
    const user = await open('?scenario=populated&agents=unknown')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    expect(inspector().queryByText('Not installed')).toBeNull()
  })

  it('are not marked when an editor carries them: Claude Code for VS Code has no claude on PATH', async () => {
    const user = await open('?scenario=populated&agents=none')
    await screen.findByRole('button', { name: /Editors/ })
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    const agent = (name: string) => inspector().getByLabelText(new RegExp(name)).closest('li') as HTMLElement
    expect(within(agent('Copilot CLI')).getByText('Not installed')).toBeTruthy()
    expect(within(agent('Claude Code')).queryByText('Not installed')).toBeNull()
  })

  it('are asked about again when the backend says it learned late, not at the next focus', async () => {
    await open('?scenario=populated')
    await screen.findByText(/Routing is on in zsh/)
    const invoked = spyOnInvoke()
    await emit('setup-changed')
    await waitFor(() => expect(invoked.mock.calls.some(([command]) => command === 'get_setup_status')).toBe(true))
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
    vi.resetModules()
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
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    await window.__mockMenuRequest({ kind: 'checkLastFolder', folder: '/Users/sam/dev/work' })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toMatch(/Close the profile editor/)
    expect(screen.queryByText('Routed to Work')).toBeNull()
  })
})

describe('arrow keys in a list', () => {
  const openServers = async () => {
    const user = await open('?scenario=mcp')
    await user.click(await screen.findByRole('button', { name: 'MCP Servers' }))
    return user
  }
  /** The controls a list's arrow keys move between, and the ones in the Tab order. */
  const stops = (items: HTMLElement[]) => items.filter((item) => item.tabIndex === 0)

  it('move through the server list, Home and End too, which is one Tab stop that Tab leaves', async () => {
    const user = await openServers()
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-server]'))
    expect(rows).toHaveLength(6)
    expect(stops(rows)).toEqual([rows[0]])

    rows[0].focus()
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(rows[2])
    await user.keyboard('{End}{ArrowDown}')
    expect(document.activeElement).toBe(rows[5])
    await user.keyboard('{Home}{ArrowUp}')
    expect(document.activeElement).toBe(rows[0])

    // With a server open the stop returns to its row when focus is elsewhere, but while focus is in the list the stop is where it is, so Tab
    // goes on to that row's menu button and then out, not to the open server's row.
    await user.click(rows[1])
    await user.keyboard('{End}')
    expect(stops(rows)).toEqual([rows[5]])
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Actions for ${rows[5].dataset.server}` }))
    await user.tab()
    expect(screen.getByRole('complementary', { name: 'MCP servers' }).contains(document.activeElement)).toBe(false)

    // Back in, Tab lands where the user last was, not on the open server. A click that leaves no focus (WebKit's) moves it too.
    expect(stops(rows)).toEqual([rows[5]])
    fireEvent.click(rows[1])
    expect(stops(rows)).toEqual([rows[1]])
  })

  it('move between the profile cards and New Profile, down a row to the card that sits under it, with every one still in the Tab order', async () => {
    await open('?scenario=populated')
    const personal = await screen.findByRole('button', { name: 'Personal' })
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-card-target]'))
    expect(targets).toHaveLength(5)
    expect(targets.map((target) => target.tabIndex)).toEqual([0, 0, 0, 0, 0])

    personal.focus()
    fireEvent.keyDown(personal, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Work' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /New Profile/ }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
    expect(document.activeElement).toBe(personal)

    // happy-dom lays nothing out: three columns, as a 900px window has, with each card's name 40px below its card's top (the header) and
    // New Profile, which is its own card, at the top. Measuring the names' tops would take Down from Personal to New Profile, which is
    // nearer the top of the second row than Scratch's name is.
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card]'))
    const place = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const card = this.closest<HTMLElement>('[data-card]')
      const at = card ? cards.indexOf(card) : -1
      return { left: (at % 3) * 300, top: Math.floor(at / 3) * 200 + (card && card !== this ? 40 : 0) } as DOMRect
    })
    try {
      const press = (key: string) => fireEvent.keyDown(document.activeElement as Element, { key })
      press('ArrowDown')
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Scratch' }))
      press('ArrowUp')
      expect(document.activeElement).toBe(personal)
      fireEvent.keyDown(screen.getByRole('button', { name: 'Work' }), { key: 'ArrowDown' })
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /New Profile/ }))
    } finally {
      place.mockRestore()
    }
  })

  it('move through the catalog', async () => {
    const user = await openServers()
    await user.click(screen.getByRole('button', { name: 'Add from Catalog' }))
    const entries = Array.from(within(await screen.findByRole('region', { name: 'Server catalog' })).getAllByRole('button')).filter((b) =>
      b.hasAttribute('data-rove'),
    )
    expect(entries.length).toBeGreaterThan(5)
    expect(stops(entries)).toEqual([entries[0]])

    entries[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(entries[1])
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(entries[entries.length - 1])
  })
})

describe('⌘S', () => {
  const press = () => fireEvent.keyDown(window, { key: 's', metaKey: true })
  const saves = (invoked: ReturnType<typeof spyOnInvoke>) => invoked.mock.calls.filter(([command]) => command === 'save_config').length

  it('saves the open editor, from a checkbox or a chip as well as a text field', async () => {
    const user = await open('?scenario=mcp')
    const invoked = spyOnInvoke()
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    await user.click(inspector().getByRole('checkbox', { name: /github/ }))
    press()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(saves(invoked)).toBe(1)

    await user.click(screen.getByRole('button', { name: 'MCP Servers' }))
    await user.click(screen.getByRole('button', { name: /^linear/ }))
    await user.click(within(screen.getByRole('form', { name: 'Edit linear' })).getByRole('button', { name: 'Personal' }))
    press()
    await waitFor(() => expect(saves(invoked)).toBe(2))
  })

  it('does nothing without an editor to save: none open, a server nobody changed, or one hidden behind Profiles', async () => {
    const user = await open('?scenario=mcp')
    await screen.findByText(/Routing is on in zsh/)
    const invoked = spyOnInvoke()
    press()

    await user.click(screen.getByRole('button', { name: 'MCP Servers' }))
    press()
    await user.click(screen.getByRole('button', { name: /^linear/ }))
    press()

    await user.click(within(screen.getByRole('form', { name: 'Edit linear' })).getByRole('button', { name: 'Personal' }))
    await user.click(screen.getByRole('button', { name: 'Profiles' }))
    press()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(saves(invoked)).toBe(0)
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
    const confirm = vi.fn().mockReturnValue(false)
    vi.stubGlobal('confirm', confirm)
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

describe("a server's tools", () => {
  it('announce only their headline when a check answers, not the whole list again', async () => {
    const user = await open('?scenario=mcp&view=servers')
    await user.click(await screen.findByRole('button', { name: /^github/ }))
    await user.click(await screen.findByRole('button', { name: 'Show all 9 tools' }))
    const live = '[aria-live], [role="status"], [role="alert"], [role="log"]'
    expect(screen.getByText('9 tools').closest(live)).not.toBeNull()
    expect(document.getElementById('server-tools')?.closest(live)).toBeNull()

    // A check that can't run says why in the same way: the reason is announced with the headline.
    await user.click(screen.getByRole('button', { name: 'Add by Hand' }))
    await user.click(within(screen.getByRole('form', { name: 'New MCP server' })).getByRole('button', { name: 'Check Server' }))
    expect((await screen.findByText("Can't check yet")).closest(live)).not.toBeNull()
    const reason = document.querySelector('[role="status"].select-text')
    expect(reason?.textContent).toBeTruthy()
  })
})

describe("a server's Used by dots", () => {
  it('count the profiles they have no room for, since colour alone says neither who nor how many', async () => {
    await open('?scenario=mcp&view=servers')
    const linear = await screen.findByRole('button', { name: /^linear/ })
    expect(within(linear).queryByText(/^\+/)).toBeNull()

    // Five profiles load it: three dots, then "+2".
    window.__mockEditConfig((c) => ({
      ...c,
      profiles: [...c.profiles, { id: 'p5', name: 'Extra', triggerPaths: [], tools: {}, mcpServers: {} }].map((p) => ({
        ...p,
        mcpServers: { ...p.mcpServers, linear: { disabledTools: [] } },
      })),
    }))
    window.dispatchEvent(new Event('focus'))
    expect(await within(linear).findByText('+2')).toBeTruthy()
  })
})

describe('Check Folder… when the window cannot do it', () => {
  it('says why for ⌘O and the menu bar while the profile editor is open, as Check Last Folder does', async () => {
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Personal' }))
    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    await window.__mockMenuRequest({ kind: 'checkFolder' })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
    for (const [message] of confirm.mock.calls) expect(message).toMatch(/Close the profile editor/)
  })

  it('says why when config.json cannot be read, since there is nothing to check a folder against', async () => {
    const confirm = vi.fn().mockReturnValue(true)
    vi.stubGlobal('confirm', confirm)
    await open('?scenario=broken')
    await screen.findByRole('button', { name: 'Open config.json' })
    fireEvent.keyDown(window, { key: 'o', metaKey: true })
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
    expect(confirm.mock.calls[0][0]).toMatch(/config\.json can't be read/)
  })
})

describe('a profile card’s context menu', () => {
  it('hangs under the focused control for the context-menu key, and opens at the pointer for a right-click', async () => {
    const user = await open('?scenario=populated')
    const invoked = spyOnInvoke()
    const pencil = await screen.findByRole('button', { name: 'Edit Work' })
    // The context-menu key sends a `contextmenu` with no right button, from the focused control: WebKit says button 0, Chromium -1 (and
    // coordinates at the control's centre, which a pointer's menu would open at, covering it).
    fireEvent.contextMenu(pencil, { button: -1, detail: 0, clientX: 40, clientY: 12 })
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    await user.pointer({ keys: '[MouseRight]', target: pencil })
    await screen.findByRole('menu')
    const popped = invoked.mock.calls
      .filter(([command]) => command === 'plugin:menu|popup')
      .map(([, args]) => JSON.parse(JSON.stringify((args as { at?: unknown }).at ?? null)))
    // happy-dom lays nothing out, so the control sits at the origin.
    expect(popped).toEqual([{ Logical: { x: 0, y: 0 } }, null])
  })

  it('opens at the pointer for a long-press, whatever button it reports, since a pointer was just down on that control', async () => {
    const user = await open('?scenario=populated')
    const invoked = spyOnInvoke()
    const pencil = await screen.findByRole('button', { name: 'Edit Work' })
    fireEvent.pointerDown(pencil, { pointerType: 'touch' })
    fireEvent.contextMenu(pencil, { button: 0 })
    await screen.findByRole('menu')
    await user.keyboard('{Escape}')
    const popped = invoked.mock.calls.filter(([command]) => command === 'plugin:menu|popup').map(([, args]) => (args as { at?: unknown }).at ?? null)
    expect(popped).toEqual([null])
  })
})

describe('revealing a trigger folder', () => {
  const reveal = async (search: string) => {
    const user = await open(search)
    const invoked = spyOnInvoke()
    await user.click(await screen.findByRole('button', { name: 'Actions for ~/notes' }))
    await user.click(within(await screen.findByRole('menu')).getByRole('menuitem', { name: 'Reveal in Finder' }))
    return invoked
  }

  it('asks the backend, which holds it to the trigger folders, not the opener plugin', async () => {
    const invoked = await reveal('?scenario=populated')
    await waitFor(() => expect(invoked).toHaveBeenCalledWith('reveal_place', { place: { kind: 'trigger', folder: '/Users/sam/notes' } }, undefined))
    expect(invoked.mock.calls.map(([command]) => command)).not.toContain('plugin:opener|reveal_item_in_dir')
  })

  it('says in a sentence, with the folder in the title and set as a value, when it is gone', async () => {
    await reveal('?scenario=populated&gone=~/notes')
    // The path is a value in the title as it is in the detail.
    const title = await screen.findByText(/^Couldn't show/)
    expect(title.textContent).toBe("Couldn't show ~/notes")
    expect(title.querySelector('code')?.textContent).toBe('~/notes')
    expect(title.parentElement?.textContent).toContain("There's no ~/notes any more. It may have been moved or deleted.")
  })
})

describe('a trigger the backend does not accept', () => {
  it('has no Reveal in its folder menu, since there is nothing of it to show', async () => {
    const user = await open('?scenario=populated')
    await screen.findByRole('button', { name: 'Actions for ~/notes' })
    window.__mockEditConfig((c) => ({
      ...c,
      profiles: c.profiles.map((p) => (p.id === 'p1' ? { ...p, triggerPaths: [...p.triggerPaths, '~/a*b'] } : p)),
    }))
    window.dispatchEvent(new Event('focus'))
    await user.click(await screen.findByRole('button', { name: 'Actions for ~/a*b' }))
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Check This Folder'])
  })
})

describe('a profile saved from a verdict', () => {
  it('asks about the folder that led there again, so the docket shows the new verdict', async () => {
    const user = await open('?scenario=unrouted')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockDrop('/Users/sam/dev/api', 400, 300)
    await user.click(await screen.findByRole('button', { name: 'Edit Personal…' }, { timeout: 3000 }))
    await user.type(inspector().getByLabelText(/Claude Code/), '~/.claude-personal')
    await user.click(inspector().getByRole('button', { name: 'Save' }))
    await screen.findByText('Routed to Personal', undefined, { timeout: 4000 })
  })

  it('asks again after the profile it opened is deleted, too', async () => {
    vi.stubGlobal('confirm', () => true)
    const user = await open('?scenario=unrouted')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockDrop('/Users/sam/dev/api', 400, 300)
    await user.click(await screen.findByRole('button', { name: 'Edit Personal…' }, { timeout: 3000 }))
    await user.click(inspector().getByRole('button', { name: /^Delete/ }))
    // Nothing owns the folder now: the new check files it under Everywhere else, where the old one had filed it in Personal.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Everywhere else' }).textContent).toContain('~/dev/api'), { timeout: 4000 })
  })
})
