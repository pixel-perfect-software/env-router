// The profile cards, their folder rows and menus, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { emit } from '@tauri-apps/api/event'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, spyOn } from 'provino'
import { inspector, open, spyOnInvoke } from '../dev/windowTest'

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
      // As IPC serializes it; jsdom lays nothing out, so the button sits at the origin.
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

  // The browser mock's stand-in for the native menu mirrors how one behaves, so a review of the mock isn't misled.
  it('moves to its first and last items with Home and End, and closes on Tab with focus back on its button', async () => {
    const user = await open('?scenario=populated')
    const actions = await screen.findByRole('button', { name: 'Actions for ~/dev/work' })
    await user.click(actions)
    const items = within(await screen.findByRole('menu')).getAllByRole('menuitem')

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(items[items.length - 1])
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(items[0])

    await user.keyboard('{Tab}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(actions)
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
    const invoked = spyOn(internals, 'invoke').mockImplementation(async (command, ...rest) => {
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

describe('a folder dropped on the window', () => {
  it('becomes a trigger folder of the profile open in the inspector', async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }))
    await window.__mockDrop('/Users/sam/dev/work/api', 400, 300)
    expect(await inspector().findByTitle('~/dev/work/api')).toBeTruthy()
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

    // jsdom lays nothing out: three columns, as a 900px window has, with each card's name 40px below its card's top (the header) and
    // New Profile, which is its own card, at the top. Measuring the names' tops would take Down from Personal to New Profile, which is
    // nearer the top of the second row than Scratch's name is.
    const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-card]'))
    const place = spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
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
    // jsdom lays nothing out, so the control sits at the origin.
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
    expect(welcome.parentElement?.textContent).toMatch(/claude, copilot \(not installed\) and codex \(not installed\) use/)
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
