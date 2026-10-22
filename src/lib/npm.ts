// The npm package an `npx` server runs, and pinning it to one version. With no version, a tag
// such as `@latest`, or a range, npx decides at launch which release runs, so a new one (good or
// bad) reaches every session the day it's published, with the server's secrets in its
// environment. Pinned, the release changes only when the user updates it here.

import type { DraftValue } from './mcp'

export interface NpxPackage {
  /** Which argument names the package. */
  index: number
  /** What comes before the package in that argument: `--package=`, or nothing. */
  prefix: string
  name: string
  /** What follows the name's `@`: a version, a tag or a range. Null when there's none. */
  requested: string | null
}

/** npx options that take their value as the next argument, so it isn't the package. */
const VALUE_OPTIONS = new Set([
  '--cache',
  '--globalconfig',
  '--location',
  '--loglevel',
  '--node-options',
  '--prefix',
  '--registry',
  '--script-shell',
  '--userconfig',
  '--workspace',
  '-w',
])

/** A registry package name, scoped or not. Anything else (a path, a git URL, an alias) has no version to pin. */
const NAME = /^(@[A-Za-z0-9~][\w.~-]*\/)?[A-Za-z0-9~][\w.~-]*$/

function parse(index: number, prefix: string, arg: DraftValue | undefined): NpxPackage | null {
  if (typeof arg !== 'string') return null
  const spec = arg.slice(prefix.length)
  const at = spec.indexOf('@', 1)
  const name = at === -1 ? spec : spec.slice(0, at)
  const requested = at === -1 ? null : spec.slice(at + 1)
  if (!NAME.test(name) || requested === '' || /[:/]/.test(requested ?? '')) return null
  return { index, prefix, name, requested }
}

/**
 * The package an `npx` command runs: `--package`'s, or the first word that isn't an option.
 * Null for anything else, including `--call`, which runs a script rather than a package.
 */
export function npxPackage(command: string, args: DraftValue[]): NpxPackage | null {
  if (!/(^|\/)npx$/.test(command.trim())) return null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    // A secret, where the package might be: nothing to read.
    if (typeof arg !== 'string') return null
    if (arg === '-c' || arg === '--call' || arg.startsWith('--call=')) return null
    if (arg === '-p' || arg === '--package') return parse(i + 1, '', args[i + 1])
    if (arg.startsWith('--package=')) return parse(i, '--package=', arg)
    if (arg === '--') return parse(i + 1, '', args[i + 1])
    if (!arg.startsWith('-')) return parse(i, '', arg)
    if (VALUE_OPTIONS.has(arg)) i++
  }
  return null
}

const SEMVER = /^=?v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** The one version the package is pinned to, or null when npx picks at launch. */
export const pinnedVersion = (pkg: NpxPackage) => (pkg.requested !== null && SEMVER.test(pkg.requested) ? pkg.requested.replace(/^=?v?/, '') : null)

/** Semver order: negative when `a` is older than `b`. A prerelease comes before its release. */
export function compareVersions(a: string, b: string): number {
  const [pa, pb] = [SEMVER.exec(a), SEMVER.exec(b)]
  if (!pa || !pb) return 0
  for (const i of [1, 2, 3]) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d !== 0) return d
  }
  const [ra, rb] = [pa[4], pb[4]]
  if (ra === undefined || rb === undefined) return ra === rb ? 0 : ra === undefined ? 1 : -1
  const [ia, ib] = [ra.split('.'), rb.split('.')]
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    const [x, y] = [ia[i], ib[i]]
    if (x === y) continue
    const [nx, ny] = [/^\d+$/.test(x), /^\d+$/.test(y)]
    if (nx && ny) return Number(x) - Number(y)
    // Numeric identifiers sort before alphanumeric ones.
    if (nx !== ny) return nx ? -1 : 1
    return x < y ? -1 : 1
  }
  return ia.length - ib.length
}

/**
 * The version pinning would pick: what a tag (`@next`) points at, else the `latest` release,
 * which is also what a missing version or a range gets.
 */
export const pinTarget = (pkg: NpxPackage, tags: Record<string, string>): string | undefined =>
  (pkg.requested !== null && Object.keys(tags).includes(pkg.requested) ? tags[pkg.requested] : undefined) ?? tags.latest

/** The `latest` release, when it's newer than the pinned one. */
export const newerRelease = (pinned: string, tags: Record<string, string>): string | null =>
  tags.latest !== undefined && compareVersions(tags.latest, pinned) > 0 ? tags.latest : null

/** The argument that runs `pkg` at `version`. */
export const pinnedArg = (pkg: NpxPackage, version: string) => `${pkg.prefix}${pkg.name}@${version}`
