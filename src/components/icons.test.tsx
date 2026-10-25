import { renderToStaticMarkup } from 'react-dom/server'
import { siClaude } from 'simple-icons'
import { describe, expect, it, vi } from 'vitest'
import { AgentMark } from './icons'

// `toString` is the kind of name a lookup in a plain object would find on its own prototype.
vi.mock('../lib/tools', () => ({
  toolByCommand: (command: string) =>
    ({ claude: { mark: 'claude' }, odd: { mark: 'nobody-drew-this' }, proto: { mark: 'toString' }, bare: {} })[command],
}))

describe('AgentMark', () => {
  it("draws the logo the agent's mark names, and a generic bot when there is none to draw", () => {
    expect(renderToStaticMarkup(<AgentMark command="claude" />)).toContain(siClaude.path)
    for (const command of ['odd', 'proto', 'bare', 'added-by-hand'])
      expect(renderToStaticMarkup(<AgentMark command={command} />)).toContain('lucide-bot')
  })
})
