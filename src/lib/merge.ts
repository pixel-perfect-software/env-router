// Folding the window's edit into a config.json that changed after the window read it (the CLI
// saved, or someone edited the file by hand). Each profile and each library server is one unit:
// a unit only one side changed takes that side's version, and a unit both sides changed
// differently is a conflict, kept as the window has it until the user says otherwise.

import type { ConfigState, McpServer, Profile } from './types'

export interface Merged {
  /** Everyone's changes, with the window's version of each conflict. */
  config: ConfigState
  /** The units both sides changed, worded to go in a sentence: `“Work”`, `the server “github”`. */
  conflicts: string[]
}

/** Structural equality, as Rust's `PartialEq` compares configs: key order doesn't count. */
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => k in b && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * Three-way merge of one kind of unit, keyed. The result keeps `theirs`' order, then the units
 * only `mine` has, in its order. An absent unit is a deleted one.
 */
function mergeUnits<T>(
  base: Map<string, T>,
  mine: Map<string, T>,
  theirs: Map<string, T>,
  onConflict: (key: string, unit: T) => void,
): [string, T][] {
  const keys = [...theirs.keys(), ...[...mine.keys()].filter((key) => !theirs.has(key))]
  // A unit deleted on both sides isn't in either.
  return keys.flatMap((key): [string, T][] => {
    const [b, m, t] = [base.get(key), mine.get(key), theirs.get(key)]
    let pick: T | undefined
    if (same(m, b)) pick = t
    else if (same(t, b) || same(m, t)) pick = m
    else {
      onConflict(key, (m ?? t ?? b) as T)
      pick = m
    }
    return pick === undefined ? [] : [[key, pick]]
  })
}

const byId = (profiles: Profile[]) => new Map(profiles.map((p) => [p.id, p]))
const byName = (servers: Record<string, McpServer>) => new Map(Object.entries(servers))

/**
 * `mine` (the window's edit of `base`) folded into `theirs` (config.json now). Agents come from
 * `theirs`: the window writes its own over them on every save anyway (`withAgents`).
 */
export function mergeConfig(base: ConfigState, mine: ConfigState, theirs: ConfigState): Merged {
  const conflicts: string[] = []
  const profiles = mergeUnits(byId(base.profiles), byId(mine.profiles), byId(theirs.profiles), (_, p) => conflicts.push(`“${p.name}”`))
  const servers = mergeUnits(byName(base.mcpServers), byName(mine.mcpServers), byName(theirs.mcpServers), (name) =>
    conflicts.push(`the server “${name}”`),
  )
  return {
    config: { ...theirs, profiles: profiles.map(([, p]) => p), mcpServers: Object.fromEntries(servers) },
    conflicts,
  }
}

/** `a`, `a and b`, `a, b and c`. */
export const listOf = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
