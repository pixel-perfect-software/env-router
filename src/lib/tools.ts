// The coding agents EnvRouter knows how to route. The data model takes any command name, but
// the window offers these. Adding an agent is a new entry here, not a new code path: only add
// one whose variable really separates accounts (logins included), and say so in its note.

import type { AgentDef, ConfigState, McpInjection } from './types'

export interface KnownTool {
  /** The command the shim stands in for, and the key in `Profile.tools`. */
  command: string
  label: string
  envVar: string
  /** Where the agent keeps its config when the variable isn't set, as shown to the user. */
  defaultPath: string
  /** One short line when the variable behaves unlike a plain config folder. */
  note?: string
  /** How the shim hands the agent a profile's MCP servers. Without one, the agent gets none. */
  mcp?: McpInjection
}

export const KNOWN_TOOLS: KnownTool[] = [
  {
    command: 'claude',
    label: 'Claude Code',
    envVar: 'CLAUDE_CONFIG_DIR',
    defaultPath: '~/.claude',
    // --strict-mcp-config means the user wants only the servers they pass themselves.
    mcp: { dialect: 'claude', configArg: '--mcp-config=', denyArg: '--disallowedTools=', skipAnyArgs: ['--strict-mcp-config'] },
  },
  // Codex refuses a CODEX_HOME that doesn't exist; saving creates it.
  { command: 'codex', label: 'Codex', envVar: 'CODEX_HOME', defaultPath: '~/.codex' },
  { command: 'copilot', label: 'Copilot CLI', envVar: 'COPILOT_HOME', defaultPath: '~/.copilot' },
  {
    command: 'gemini',
    label: 'Gemini CLI',
    envVar: 'GEMINI_CLI_HOME',
    defaultPath: '~/.gemini',
    note: 'Gemini keeps its .gemini folder inside this one.',
  },
]

export const toolByCommand = (command: string) => KNOWN_TOOLS.find((t) => t.command === command)

/** Display name for a command, falling back to the command itself for agents added by hand. */
export const toolLabel = (command: string) => toolByCommand(command)?.label ?? command

/**
 * The config to save: `agents` rewritten from this registry, so Rust learns each agent's MCP
 * descriptor without knowing its name. Agents added by hand keep what they have.
 */
export const withAgents = (config: ConfigState): ConfigState => {
  const agents: Record<string, AgentDef> = { ...config.agents }
  for (const tool of KNOWN_TOOLS) agents[tool.command] = { mcp: tool.mcp ?? null }
  return { ...config, agents }
}
