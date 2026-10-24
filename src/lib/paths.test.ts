import { describe, expect, it } from 'vitest'
import { isInside, owningTrigger, splitLeaf, tildify, triggerBase } from './paths'

const HOME = '/Users/sam'

describe('tildify', () => {
  it('shortens the home folder and what is inside it', () => {
    expect(tildify(HOME, HOME)).toBe('~')
    expect(tildify(`${HOME}/dev/work`, HOME)).toBe('~/dev/work')
  })

  it('leaves a folder beside home that starts with the same letters, and every path while home is unknown', () => {
    expect(tildify('/Users/samuel/dev', HOME)).toBe('/Users/samuel/dev')
    expect(tildify(`${HOME}/dev`, '')).toBe(`${HOME}/dev`)
  })
})

describe('triggerBase', () => {
  it('is the folder a trigger covers: ~ expanded, a trailing /* or /** dropped', () => {
    expect(triggerBase('~/dev/work', HOME)).toBe(`${HOME}/dev/work`)
    expect(triggerBase('~/dev/work/*', HOME)).toBe(`${HOME}/dev/work`)
    expect(triggerBase('~/dev/work/**', HOME)).toBe(`${HOME}/dev/work`)
    expect(triggerBase('~', HOME)).toBe(HOME)
  })

  it('ignores the spaces and trailing slashes a hand edit leaves, but keeps the root', () => {
    expect(triggerBase('  /srv/clients//  ', HOME)).toBe('/srv/clients')
    expect(triggerBase('/', HOME)).toBe('/')
  })
})

describe('isInside', () => {
  it('is true only for a folder strictly below the parent', () => {
    expect(isInside('/dev/work', '/dev')).toBe(true)
    expect(isInside('/dev', '/dev')).toBe(false)
    expect(isInside('/dev', '/dev/work')).toBe(false)
  })

  it('does not take a folder whose name only starts like the parent', () => {
    expect(isInside('/dev-old/work', '/dev')).toBe(false)
  })

  it('takes everything below the root', () => {
    expect(isInside('/dev', '/')).toBe(true)
    expect(isInside('/', '/')).toBe(false)
  })
})

describe('splitLeaf', () => {
  it('splits the last component off, for the parent to be drawn quietly', () => {
    expect(splitLeaf('~/dev/work')).toEqual({ parent: '~/dev/', leaf: 'work' })
    expect(splitLeaf('work')).toEqual({ parent: '', leaf: 'work' })
  })

  it('splits before the folder a trailing glob belongs to, and keeps the glob with it', () => {
    expect(splitLeaf('~/dev/work/*')).toEqual({ parent: '~/dev/', leaf: 'work/*' })
  })
})

describe('owningTrigger', () => {
  const profiles = [
    { id: 'personal', triggerPaths: ['~/dev', '~/notes'] },
    { id: 'work', triggerPaths: ['~/dev/work/*'] },
  ]

  it('picks the deepest trigger that contains the folder, across profiles', () => {
    expect(owningTrigger(profiles, `${HOME}/dev/work/api`, HOME)).toEqual({ profileId: 'work', base: `${HOME}/dev/work` })
    expect(owningTrigger(profiles, `${HOME}/dev/side`, HOME)).toEqual({ profileId: 'personal', base: `${HOME}/dev` })
  })

  it('counts the trigger folder itself', () => {
    expect(owningTrigger(profiles, `${HOME}/dev/work`, HOME)?.profileId).toBe('work')
  })

  it('is null for a folder no trigger contains, including one that only starts like a trigger', () => {
    expect(owningTrigger(profiles, `${HOME}/other`, HOME)).toBeNull()
    expect(owningTrigger(profiles, `${HOME}/dev-old`, HOME)).toBeNull()
  })
})
