// The profile inspector, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, fn, it, spyOn } from 'provino'
import { inspector, open, spyOnInvoke } from '../dev/windowTest'

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
    const revealed = fn()
    spyOn(internals, 'invoke').mockImplementation((command, ...rest) => {
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

describe('a Save that fails on a field', () => {
  const describedByAlert = (field: HTMLElement) => {
    const alert = screen.getAllByRole('alert').find((a) => a.textContent)
    expect(alert?.id).toBeTruthy()
    expect(field.getAttribute('aria-describedby')?.split(' ')).toContain(alert?.id)
  }

  it('marks the server editor field it is about, ties the message to it and moves focus there, one field after another', async () => {
    const user = await open('?scenario=mcp&view=servers')
    await user.click(await screen.findByRole('button', { name: 'Add by Hand' }))
    const form = within(screen.getByRole('form', { name: 'New MCP server' }))
    const save = () => user.click(form.getByRole('button', { name: 'Save' }))

    // No name: the name field. Its own note keeps describing it too.
    const name = form.getByLabelText('Name')
    await save()
    expect(name.getAttribute('aria-invalid')).toBe('true')
    describedByAlert(name)
    expect(name.getAttribute('aria-describedby')).toContain('server-name-note')
    expect(document.activeElement).toBe(name)

    // A name, no command: the command field, and the name is fine again.
    await user.type(name, 'mine')
    await save()
    const command = form.getByLabelText('Command')
    expect(command.getAttribute('aria-invalid')).toBe('true')
    describedByAlert(command)
    expect(name.getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(command)

    // A variable with a value and no name: that row's name field, not the list.
    await user.type(command, 'npx')
    await user.click(form.getByRole('button', { name: 'Add Variable' }))
    await user.type(form.getByLabelText('Environment name 1'), 'A')
    await user.click(form.getByRole('button', { name: 'Add Variable' }))
    await user.type(form.getByLabelText('environment 2 value'), 'x')
    await save()
    const key = form.getByLabelText('Environment name 2')
    expect(key.getAttribute('aria-invalid')).toBe('true')
    describedByAlert(key)
    expect(form.getByLabelText('Environment name 1').getAttribute('aria-invalid')).toBeNull()
    expect(document.activeElement).toBe(key)
  })

  it("marks the profile inspector's name field, and leaves it unmarked once the save goes on", async () => {
    const user = await open('?scenario=populated')
    await user.click(await screen.findByRole('button', { name: /New Profile/ }))
    const name = inspector().getByLabelText('Name')
    await user.click(inspector().getByRole('button', { name: 'Save' }))
    expect(name.getAttribute('aria-invalid')).toBe('true')
    describedByAlert(name)
    expect(document.activeElement).toBe(name)

    await user.type(name, 'Mine')
    await user.click(inspector().getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
