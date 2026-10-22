import { describe, expect, it } from 'vitest'
import { compareVersions, newerRelease, npxPackage, pinnedArg, pinnedVersion, pinTarget } from './npm'

describe('npxPackage', () => {
  it('finds the package after npx options', () => {
    expect(npxPackage('npx', ['-y', '@upstash/context7-mcp@latest'])).toEqual({
      index: 1,
      prefix: '',
      name: '@upstash/context7-mcp',
      requested: 'latest',
    })
    expect(npxPackage('/opt/homebrew/bin/npx', ['--registry', 'https://npm.acme.dev', 'chrome-devtools-mcp'])).toMatchObject({
      index: 2,
      name: 'chrome-devtools-mcp',
      requested: null,
    })
    expect(npxPackage('npx', ['-y', '@toolbox-sdk/server', '--prebuilt=postgres', '--stdio'])).toMatchObject({
      index: 1,
      name: '@toolbox-sdk/server',
    })
  })

  it('reads --package in either form', () => {
    expect(npxPackage('npx', ['-p', 'snyk@1.1300.0', 'snyk', 'mcp'])).toMatchObject({ index: 1, prefix: '', name: 'snyk', requested: '1.1300.0' })
    expect(npxPackage('npx', ['--package=snyk', 'snyk', 'mcp'])).toMatchObject({ index: 0, prefix: '--package=', name: 'snyk', requested: null })
  })

  it('has nothing to pin for other commands, scripts, paths, git and aliases', () => {
    expect(npxPackage('uvx', ['mcp-server-git'])).toBeNull()
    expect(npxPackage('npx', ['-c', 'echo hi'])).toBeNull()
    expect(npxPackage('npx', ['./server.js'])).toBeNull()
    expect(npxPackage('npx', ['github:acme/mcp'])).toBeNull()
    expect(npxPackage('npx', ['mcp@npm:other@1.0.0'])).toBeNull()
    expect(npxPackage('npx', [{ secret: 'AB12' }])).toBeNull()
    expect(npxPackage('npx', ['-y'])).toBeNull()
  })
})

describe('pinning', () => {
  const tags = { latest: '1.4.0', next: '2.0.0-beta.2' }
  const pkg = (requested: string | null) => ({ index: 1, prefix: '', name: '@acme/mcp', requested })

  it('counts only one exact version as pinned', () => {
    expect(pinnedVersion(pkg('1.2.3'))).toBe('1.2.3')
    expect(pinnedVersion(pkg('v1.2.3-rc.1'))).toBe('1.2.3-rc.1')
    for (const loose of [null, 'latest', '^1.2.0', '1', '1.x']) expect(pinnedVersion(pkg(loose))).toBeNull()
  })

  it('pins a tag to what it points at, and anything else to latest', () => {
    expect(pinTarget(pkg('next'), tags)).toBe('2.0.0-beta.2')
    expect(pinTarget(pkg(null), tags)).toBe('1.4.0')
    expect(pinTarget(pkg('^1.0.0'), tags)).toBe('1.4.0')
    expect(pinTarget(pkg('constructor'), tags)).toBe('1.4.0')
    expect(pinnedArg(pkg(null), '1.4.0')).toBe('@acme/mcp@1.4.0')
    expect(pinnedArg({ ...pkg(null), prefix: '--package=' }, '1.4.0')).toBe('--package=@acme/mcp@1.4.0')
  })

  it('offers only a newer latest as an update', () => {
    expect(newerRelease('1.2.3', tags)).toBe('1.4.0')
    expect(newerRelease('1.4.0', tags)).toBeNull()
    expect(newerRelease('2.0.0-beta.2', tags)).toBeNull()
  })

  it('orders versions as semver does', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
      '1.2.0',
      '1.10.0',
    ]
    for (let i = 1; i < ordered.length; i++) expect(compareVersions(ordered[i - 1], ordered[i]), `${ordered[i - 1]} < ${ordered[i]}`).toBeLessThan(0)
    expect(compareVersions('1.0.0+build.5', '1.0.0')).toBe(0)
  })
})
