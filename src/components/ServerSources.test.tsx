// The catalog and import, driven through the whole window against the dev mock (see `../dev/windowTest`).

import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'provino'
import { open } from '../dev/windowTest'

describe('the import review', () => {
  it('shows a server saved under the name EnvRouter gave it as already in the library, not as a second copy', async () => {
    const user = await open('?scenario=mcp&view=servers')
    const review = async () => {
      await user.click(await screen.findByRole('button', { name: 'Import from Your Agents' }))
      return within(await screen.findByRole('region', { name: 'Import servers' }))
    }
    // Codex's `docs.search` isn't a name EnvRouter can use, so it comes in as `docs-search`.
    const first = await review()
    const row = async (view: typeof first) => (await view.findByText('docs-search', undefined, { timeout: 3000 })).closest('li') as HTMLElement
    expect(within(await row(first)).getByText(/isn't a name EnvRouter can use/)).toBeTruthy()
    await user.click(first.getByRole('button', { name: /^Import \d+ Servers$/ }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Import servers' })).toBeNull())

    const again = await review()
    expect(within(await row(again)).getByText('In the library')).toBeTruthy()
    expect(again.queryByText('docs-search-2')).toBeNull()
  })
})
