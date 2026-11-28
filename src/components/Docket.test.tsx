// The docket, where a check lands, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { screen, waitFor } from '@testing-library/react'
import { describe, expect, it, stubGlobal } from 'provino'
import { inspector, open, reachableAccents } from '../dev/windowTest'

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
    stubGlobal('confirm', () => true)
    const user = await open('?scenario=unrouted')
    await screen.findByText(/Routing is on in zsh/)
    await window.__mockDrop('/Users/sam/dev/api', 400, 300)
    await user.click(await screen.findByRole('button', { name: 'Edit Personal…' }, { timeout: 3000 }))
    await user.click(inspector().getByRole('button', { name: /^Delete/ }))
    // Nothing owns the folder now: the new check files it under Everywhere else, where the old one had filed it in Personal.
    await waitFor(() => expect(screen.getByRole('region', { name: 'Everywhere else' }).textContent).toContain('~/dev/api'), { timeout: 4000 })
  })
})
