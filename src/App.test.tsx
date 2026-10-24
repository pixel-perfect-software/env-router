// @vitest-environment happy-dom

// The whole window against the dev mock, which answers every command as the real backend does. Each test boots
// the mock for one URL, renders App and drives it as a user would. happy-dom loads no CSS, so what a rule means
// on screen is read from the DOM: `inert` and the accent fill's `bg-accent` class.

import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
    await screen.findByText('No file manager could show the file.')
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
