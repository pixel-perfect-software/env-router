// The coding agents EnvRouter knows how to route. The data model takes any command name, but
// the window offers these. Adding an agent is a new entry here, not a new code path: only add
// one whose variable really separates accounts (logins included), and say so in its note.

import type { AgentDef, ConfigState, IdeHook, McpFiles, McpInjection } from './types'

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
  /** Where the agent keeps MCP servers of its own, for importing them into the library. */
  mcpFiles?: McpFiles
  /** Its editor extension runs a bundled copy of the agent, so the shims never see it; this setting routes it anyway. */
  ide?: IdeHook
}

export const KNOWN_TOOLS: KnownTool[] = [
  {
    command: 'claude',
    label: 'Claude Code',
    envVar: 'CLAUDE_CONFIG_DIR',
    defaultPath: '~/.claude',
    // --strict-mcp-config means the user wants only the servers they pass themselves.
    mcp: { dialect: 'claude', configArg: '--mcp-config=', denyArg: '--disallowedTools=', skipAnyArgs: ['--strict-mcp-config'] },
    // User and local scopes live in .claude.json in the config folder; project scope in .mcp.json.
    mcpFiles: { userFile: '.claude.json', defaultDir: '~', projectFile: '.mcp.json' },
    // Verified on the VS Code extension 2.1.301: it runs `<wrapper> <its bundled claude> <args>` in the
    // workspace folder. The setting is machine-wide, which is fine, since the shim routes by folder.
    ide: { setting: 'claudeCode.claudeProcessWrapper', extension: 'anthropic.claude-code' },
  },
  {
    command: 'copilot',
    label: 'Copilot CLI',
    envVar: 'COPILOT_HOME',
    defaultPath: '~/.copilot',
    // Verified on 1.0.98: `@` takes a file and the flag adds to the user's own servers; a tool is
    // turned off with `--deny-tool=server(tool)`, one per argument.
    mcp: { dialect: 'copilot', configArg: '--additional-mcp-config=@', denyArg: '--deny-tool=', skipAnyArgs: [] },
    mcpFiles: { userFile: 'mcp-config.json', defaultDir: '~/.copilot', projectFile: '.mcp.json' },
  },
]

/** The editor hooks to offer, keyed by command. */
export const ideHooks = (): Record<string, IdeHook> => Object.fromEntries(KNOWN_TOOLS.flatMap((t) => (t.ide ? [[t.command, t.ide] as const] : [])))

export const toolByCommand = (command: string) => KNOWN_TOOLS.find((t) => t.command === command)

/** Display name for a command, falling back to the command itself for agents added by hand. */
export const toolLabel = (command: string) => toolByCommand(command)?.label ?? command

/**
 * The config to save: `agents` rewritten from this registry, so Rust learns each agent's MCP
 * descriptor without knowing its name. Agents added by hand keep what they have.
 */
export const withAgents = (config: ConfigState): ConfigState => {
  const agents: Record<string, AgentDef> = { ...config.agents }
  for (const tool of KNOWN_TOOLS) agents[tool.command] = { mcp: tool.mcp ?? null, mcpFiles: tool.mcpFiles ?? null }
  return { ...config, agents }
}
