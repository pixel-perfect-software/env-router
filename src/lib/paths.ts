// Display and comparison helpers for the paths in a config. Rust is the authority on
// matching (it canonicalizes); these only shape what the window shows.

/** `/Users/me/dev` → `~/dev`. */
export const tildify = (path: string, home: string) => {
  if (!home) return path
  if (path === home) return '~'
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** `~/dev/*` → `/Users/me/dev`: the folder a trigger covers, for structural comparisons. */
export const triggerBase = (raw: string, home: string) => {
  let path = raw.trim().replace(/\/\*\*?$/, '')
  if (path === '~' || path.startsWith('~/')) path = home + path.slice(1)
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

/** Whether `child` is strictly inside `parent` (both already normalized). */
export const isInside = (child: string, parent: string) => child !== parent && child.startsWith(parent === '/' ? '/' : `${parent}/`)

/** Splits a display path into its parent (rendered quietly) and its last component. */
export const splitLeaf = (display: string) => {
  const cut = display.replace(/\/\*\*?$/, '').lastIndexOf('/')
  return cut < 0 ? { parent: '', leaf: display } : { parent: display.slice(0, cut + 1), leaf: display.slice(cut + 1) }
}

/**
 * The deepest trigger containing `folder`, mirroring the Rust resolver for display: which
 * path won. Rust compares canonical paths, so callers keep this only when the profile agrees
 * with Rust's preview.
 */
export const owningTrigger = (profiles: { id: string; triggerPaths: string[] }[], folder: string, home: string) => {
  let best: { profileId: string; base: string } | null = null
  for (const profile of profiles) {
    for (const raw of profile.triggerPaths) {
      const base = triggerBase(raw, home)
      if ((folder === base || isInside(folder, base)) && (!best || base.length > best.base.length)) best = { profileId: profile.id, base }
    }
  }
  return best
}
