// The tools EnvRouter knows how to route. The data model takes any command name, but the UI
// only offers these. Adding a tool should be a new entry here, not a new code path.

export interface KnownTool {
  /** The command the shim stands in for, and the key in `Profile.tools`. */
  command: string
  label: string
  envVar: string
  /** What the user picks with the folder picker. */
  pathLabel: string
  /** Shown under the picker. */
  hint: string
}

export const KNOWN_TOOLS: KnownTool[] = [
  {
    command: 'claude',
    label: 'Claude Code',
    envVar: 'CLAUDE_CONFIG_DIR',
    pathLabel: 'Config folder',
    hint: 'Each folder keeps its own login, settings and history. A new one starts logged out, so run claude once inside a trigger folder and use /login.',
  },
]
