import { describe, expect, it } from 'vitest'
import { draftOf, plainCredentials, SECRET_NAME } from './mcp'
import { accessOf, catalog, filterCatalog, isLocal } from './mcpCatalog'
import { serverLogo } from './serverLogo'

const all = catalog('/home/me')
const names = (filter: Partial<Parameters<typeof filterCatalog>[1]>) =>
  filterCatalog(all, { query: '', where: 'all', access: 'all', ...filter }).map((e) => e.name)

describe('the catalog', () => {
  it('names every server once, keeps secrets out of args and URLs, and runs containers under --init', () => {
    expect(new Set(all.map((e) => e.name)).size).toBe(all.length)
    for (const entry of all) {
      const server = entry.server
      if (server.transport === 'stdio') {
        for (const key of Object.keys(entry.secrets ?? {})) expect(server.env).toHaveProperty(key)
        if (server.command === 'docker') expect(server.args).toContain('--init')
      } else {
        for (const key of Object.keys(entry.secrets ?? {})) expect(server.headers).toHaveProperty(key)
      }
      expect(plainCredentials(draftOf(entry.name, server)), entry.name).toEqual([])
      // A secret entry has its own label; a sign-in entry doesn't also take one.
      expect(Boolean(entry.secrets && entry.signIn)).toBe(false)
      // A pasted or imported copy of the same server must lock the same value, so its name has to read as a credential.
      for (const key of Object.keys(entry.secrets ?? {})) expect(SECRET_NAME.test(key), `${entry.name}: ${key}`).toBe(true)
    }
  })

  it('sorts by label and finds entries by any word of their label, name or description', () => {
    const labels = filterCatalog([...all].reverse(), { query: '', where: 'all', access: 'all' }).map((e) => e.label)
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b)))
    expect(names({ query: 'postgres' })).toEqual(expect.arrayContaining(['postgres', 'neon', 'prisma']))
    expect(names({ query: 'GIT repos' })).toContain('git')
    expect(names({ query: 'no-such-thing' })).toEqual([])
  })

  it("gives every entry its own brand's logo, or none", () => {
    // A brand word that's also a plain word (next, fly, square, render) mustn't claim another vendor's server.
    const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '')
    for (const entry of all) {
      const logo = serverLogo(entry.name, entry.server)
      if (!logo || logo.title === 'Model Context Protocol') continue
      const [label, title] = [squash(entry.label), squash(logo.title)]
      expect(label.includes(title.slice(0, 4)) || title.includes(label.slice(0, 4)), `${entry.name} wears ${logo.title}`).toBe(true)
    }
  })

  it('tells remote from local, a loopback URL included, and filters by what a server needs', () => {
    expect(isLocal({ transport: 'http', url: 'http://127.0.0.1:3845/mcp', headers: {} })).toBe(true)
    expect(isLocal({ transport: 'http', url: 'https://localhost.example.com/mcp', headers: {} })).toBe(false)
    expect(names({ where: 'local' })).toEqual(expect.arrayContaining(['figma-desktop', 'postgres', 'time']))
    expect(names({ where: 'remote' })).not.toContain('figma-desktop')
    expect(names({ access: 'secret' })).toEqual(expect.arrayContaining(['github', 'postgres']))
    expect(names({ access: 'none' })).toContain('deepwiki')
    expect(names({ access: 'sign-in' })).toEqual(expect.arrayContaining(['linear', 'azure']))
    expect(accessOf(all.find((e) => e.name === 'linear') ?? all[0])).toBe('mcp')
  })
})
