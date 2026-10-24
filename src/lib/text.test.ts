import { describe, expect, it } from 'vitest'
import { listOf, plural } from './text'

describe('plural', () => {
  it('keeps the noun singular only for one', () => {
    expect(plural(0, 'tool', 'tools')).toBe('0 tools')
    expect(plural(1, 'tool', 'tools')).toBe('1 tool')
    expect(plural(2, 'tool', 'tools')).toBe('2 tools')
  })

  it('takes a noun of more than one word', () => {
    expect(plural(1, 'MCP server', 'MCP servers')).toBe('1 MCP server')
    expect(plural(6, 'MCP server', 'MCP servers')).toBe('6 MCP servers')
  })
})

describe('listOf', () => {
  it('lists for a sentence', () => {
    expect(listOf(['a'])).toBe('a')
    expect(listOf(['a', 'b'])).toBe('a and b')
    expect(listOf(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('is empty for nothing', () => {
    expect(listOf([])).toBe('')
  })
})
