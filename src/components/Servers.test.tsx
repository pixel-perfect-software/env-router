// The server list, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, fn, it, stubGlobal } from 'provino'
import { open, spyOnInvoke, type User } from '../dev/windowTest'
import { hasUnsaved } from '../lib/unsaved'

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
    const user = await openServers('?scenario=mcp&pace=real')
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
    // jsdom lays nothing out, so the row sits at the origin.
    expect(popped()).toEqual([{ Logical: { x: 0, y: 0 } }, null])
  })

  it('asks before it deletes, saying who stops loading the server, and deletes only once the user agrees', async () => {
    const confirm = fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
    stubGlobal('confirm', confirm)
    const user = await openServers()
    await user.click((await menuOf(user, 'playwright')).getByRole('menuitem', { name: 'Delete…' }))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Delete the MCP server “playwright”?'))
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Personal, Scratch will stop loading it'))
    expect(listed()).toContain('playwright')

    await user.click((await menuOf(user, 'playwright')).getByRole('menuitem', { name: 'Delete…' }))
    await waitFor(() => expect(listed()).not.toContain('playwright'))
  })

  it("goes to the neighbour the filter shows when the open server is one it hides, not to the filter's first row", async () => {
    stubGlobal('confirm', () => true)
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
    stubGlobal('confirm', () => false)
    const user = await openServers()
    await user.click(row('sentry'))
    const del = within(screen.getByRole('form', { name: 'Edit sentry' })).getByRole('button', { name: /^Delete/ })
    await user.click(del)
    await waitFor(() => expect(del.hasAttribute('aria-disabled') || del.hasAttribute('disabled')).toBe(false))
    expect(listed()).toContain('sentry')
  })

  it('forgets the edits of a server deleted from the list, so the next one opens clean', async () => {
    const confirm = fn(() => true)
    stubGlobal('confirm', confirm)
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
      const confirm = fn().mockReturnValueOnce(false).mockReturnValueOnce(true)
      stubGlobal('confirm', confirm)
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
      const confirm = fn().mockReturnValue(false)
      stubGlobal('confirm', confirm)
      const user = await openServers()
      await editPlaywright(user)
      const invoked = spyOnInvoke()

      await user.click((await menuOf(user, 'sentry')).getByRole('menuitem', { name: 'Check Server' }))
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Discard changes to “playwright”?'))
      expect(screen.getByRole('form', { name: 'Edit playwright' })).toBeTruthy()
      expect(invoked).not.toHaveBeenCalledWith('check_mcp_server', expect.anything(), undefined)
    })

    it('are kept when another server is deleted', async () => {
      stubGlobal('confirm', () => true)
      const user = await openServers()
      await editPlaywright(user)

      await user.click((await menuOf(user, 'sentry')).getByRole('menuitem', { name: 'Delete…' }))
      await waitFor(() => expect(listed()).not.toContain('sentry'))
      expect(screen.getByRole('form', { name: 'Edit playwright' })).toBeTruthy()
      expect(hasUnsaved()).toBe(true)
    })
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
