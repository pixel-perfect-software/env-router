import { describe, expect, it } from 'vitest'
import { profileColors } from './ui'

// An id's preferred colour is its hash mod 8. `a` and `i` hash to the same one, and so do `aa`, `bb`, `cc` and the other doubled letters.
describe('profileColors', () => {
  it('keeps a profile its colour while profiles that do not share its preference come and go', () => {
    const alone = profileColors(['a']).get('a')
    expect(profileColors(['b', 'a', 'c']).get('a')).toBe(alone)
    expect(profileColors(['a', 'c']).get('a')).toBe(alone)
  })

  it('moves a profile off its preferred colour only when an earlier one holds it', () => {
    const preferred = profileColors(['a']).get('a')
    const both = profileColors(['a', 'i'])
    expect(both.get('a')).toBe(preferred)
    expect(both.get('i')).not.toBe(preferred)
    expect(profileColors(['i', 'a']).get('i')).toBe(preferred)
  })

  it('gives eight profiles eight colours even when all prefer one, and a ninth still gets one', () => {
    const ids = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii']
    const colors = profileColors(ids)
    const eight = new Set(ids.slice(0, 8).map((id) => colors.get(id)))
    expect(eight.size).toBe(8)
    expect(eight.has(colors.get('ii'))).toBe(true)
  })
})
