// The coding agents EnvRouter knows how to route. The data model takes any command name, but
// the window offers these. Adding an agent is a new entry in agents.json, not a new code path:
// only add one whose variable really separates accounts (logins included), and say so in its
// note. The CLI reads the same file (`envrouter_core::agents`), so it can fill `config.agents`
// on a machine where the window never saved.
//
// Why each entry says what it says, since JSON holds no comments:
// - claude: `--strict-mcp-config` means the user wants only the servers they pass themselves.
//   `skipSubcommands`: with an option ahead of them, these don't run (swept on 2.1.309 by
//   comparing `claude <sub> --help` with `claude --mcp-config=<file> <sub> --help`): the
//   background-session commands (`attach`, `daemon`, `logs`, `respawn`, `rm`, `stop`/`kill`,
//   `self-hosted-runner`) fall back to the top-level parser and read as a prompt, and
//   `remote-control` refuses because the flag wouldn't reach the sessions it starts. `plugin`
//   (and its alias `plugins`) parses but `plugin test` refuses any option ahead of it (2.1.306).
//   The rest (`agents`, `auth`, `auto-mode`, `doctor`, `gateway`, `import`, `install`, `mcp`,
//   `purge`, `setup-token`, `ultrareview`, `update`) run with one. `skipIfPresent`: Claude Code
//   exits at startup when given servers on a machine with an enterprise managed-mcp.json.
//   User and local scopes live in .claude.json in the config folder; project scope in .mcp.json.
//   The editor hook was verified on the VS Code extension 2.1.301: it runs `<wrapper> <its
//   bundled claude> <args>` in the workspace folder. The setting is machine-wide, which is fine,
//   since the shim routes by folder.
// - copilot: verified on 1.0.98: `@` takes a file and the flag adds to the user's own servers; a
//   tool is turned off with `--deny-tool=server(tool)`, one per argument.
// - `install` is each vendor's own one-line installer (claude: claude.ai/install.sh, the native
//   installer in the Claude Code docs; copilot: gh.io/copilot-install, the install script in the
//   Copilot CLI docs; both checked 2026-10-24). It's shown as text to copy, never run by the
//   window, and `withAgents` doesn't copy it, since Rust never needs it.

import registry from './agents.json'
import type { AgentDef, ConfigState, IdeHook, McpFiles, McpInjection } from './types'

export interface KnownTool {
  /** The command the shim stands in for, and the key in `Profile.tools`. */
  command: string
  label: string
  envVar: string
  /** Where the agent keeps its config when the variable isn't set, as shown to the user. */
  defaultPath: string
  /** The vendor's one-line install command, shown when the agent isn't on PATH. */
  install?: string
  /** One short line when the variable behaves unlike a plain config folder. */
  note?: string
  /** How the shim hands the agent a profile's MCP servers. Without one, the agent gets none. */
  mcp?: McpInjection
  /** Where the agent keeps MCP servers of its own, for importing them into the library. */
  mcpFiles?: McpFiles
  /** Its editor extension runs a bundled copy of the agent, so the shims never see it; this setting routes it anyway. */
  ide?: IdeHook
}

// JSON infers `dialect` as a plain string; Rust's tests reject one that isn't a dialect.
export const KNOWN_TOOLS: KnownTool[] = registry as KnownTool[]

/** The editor hooks to offer, keyed by command. */
export const ideHooks = (): Record<string, IdeHook> => Object.fromEntries(KNOWN_TOOLS.flatMap((t) => (t.ide ? [[t.command, t.ide] as const] : [])))

export const toolByCommand = (command: string) => KNOWN_TOOLS.find((t) => t.command === command)

/** Display name for a command, falling back to the command itself for agents added by hand. */
export const toolLabel = (command: string) => toolByCommand(command)?.label ?? command

/**
 * The config to save: `agents` rewritten from this registry, so Rust learns each agent's MCP
 * descriptor without knowing its name. Agents added by hand keep what they have.
 * `envrouter_core::agents::with_agents` does the same for the CLI.
 */
export const withAgents = (config: ConfigState): ConfigState => {
  const agents: Record<string, AgentDef> = { ...config.agents }
  for (const tool of KNOWN_TOOLS) agents[tool.command] = { mcp: tool.mcp ?? null, mcpFiles: tool.mcpFiles ?? null, ide: tool.ide ?? null }
  return { ...config, agents }
}
