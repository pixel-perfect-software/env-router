// A server's fields, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'provino'
import { open } from '../dev/windowTest'
import { hasUnsaved } from '../lib/unsaved'

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
