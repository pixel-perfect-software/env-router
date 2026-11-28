// A server's tools, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'provino'
import { open } from '../dev/windowTest'

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
