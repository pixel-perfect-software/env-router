// Wire types for the Tauri commands. Each one mirrors a Rust type, named in its comment;
// change both sides together. Rust `Option` arrives as `null`.

/** `envrouter_core::config::ToolConfig`. An empty `path` means the profile leaves the tool alone. */
export interface ToolConfig {
  envVar: string
  path: string
}

/** `envrouter_core::config::Profile` */
export interface Profile {
  id: string
  name: string
  /** Absolute or `~/` paths. Each covers its whole subtree; a trailing `/*` is optional. */
  triggerPaths: string[]
  /** Keyed by the command the shim stands in for, e.g. `claude`. */
  tools: Record<string, ToolConfig>
  /** Library servers this profile's folders get, keyed by server name. Every agent with an MCP descriptor gets them. */
  mcpServers: Record<string, McpUse>
}

/** `envrouter_core::config::McpUse` */
export interface McpUse {
  /** Tools the agent is told not to use. A deny list, so tools a server adds later are on. */
  disabledTools: string[]
}

/** `envrouter_core::config::McpValue`: a plain string, or the id of a secret kept in the Keychain. */
export type McpValue = string | { secret: string }

/** `envrouter_core::config::McpServer`: one server in the library, in no particular agent's format. */
export type McpServer =
  | { transport: 'stdio'; command: string; args: McpValue[]; env: Record<string, McpValue> }
  /** Streamable HTTP. */
  | { transport: 'http'; url: string; headers: Record<string, McpValue> }
  | { transport: 'sse'; url: string; headers: Record<string, McpValue> }

/** `envrouter_core::config::McpDialect`: an MCP config file format, named after the agent that defined it. */
export type McpDialect = 'claude' | 'copilot'

/** `envrouter_core::config::McpInjection`: how the shim hands an agent its servers at launch. */
export interface McpInjection {
  dialect: McpDialect
  /** Followed by a rendered file's path, as one argument: `--mcp-config=`. Never two arguments, since Claude's flags take several values. */
  configArg: string
  /** Followed by the comma-separated tools to turn off, e.g. `--disallowedTools=`. */
  denyArg: string | null
  /** Any of these among the user's arguments turns injection off for that run. */
  skipAnyArgs: string[]
}

/** `envrouter_core::config::AgentDef`. The window writes these from `tools.ts` on every save. */
export interface AgentDef {
  mcp: McpInjection | null
}

/** `envrouter_core::config::ConfigState`. Rust writes the current `version` on every save. */
export interface ConfigState {
  version: number
  profiles: Profile[]
  /** The server library, keyed by the name agents see. */
  mcpServers: Record<string, McpServer>
  /** Keyed by command, like `Profile.tools`. */
  agents: Record<string, AgentDef>
}

/** `shell::Shell` */
export type Shell = 'zsh' | 'bash' | 'fish'

/** `shell::ShellStatus` */
export interface ShellStatus {
  shell: Shell
  /** The shell is installed on this Mac. */
  available: boolean
  /** It's the user's login shell (`$SHELL`). */
  isDefault: boolean
  /** Every one of `startupFiles` has EnvRouter's block. */
  installed: boolean
  startupFiles: string[]
}

/** `SetupStatus` in `lib.rs` */
export interface SetupStatus {
  /** The installed shim matches the one bundled with this version of the app. */
  shimInstalled: boolean
  shimsDir: string
  shells: ShellStatus[]
}

/** `shell::FolderCheck`: what running a tool in a folder does in a new terminal window. */
export type FolderCheck =
  /** The shim runs. `profile` is null when no profile owns the folder. `mcp`: the servers it adds, if every secret they need is readable. */
  | { status: 'routed'; profile: string | null; envVar: string | null; value: string | null; mcp: string[]; real: string }
  /** An alias or function with the tool's name runs before PATH is searched. `origin`: the file defining it, when the shell can say. */
  | { status: 'shadowedByShell'; kind: string; origin: string | null }
  /**
   * Another copy of the tool is found before the shim: it's earlier on PATH, or the shims directory isn't on PATH at all (shell setup is off).
   * `byPromptHook`: the startup files left the shim first, and a prompt hook (mise, direnv) moved this ahead of it.
   */
  | { status: 'shadowedOnPath'; path: string; byPromptHook: boolean }
  /** Nothing named after the tool is on PATH: no shim and no real tool. */
  | { status: 'notFound' }
  /** The shim is first on PATH, but there's no real tool after it to run. */
  | { status: 'notInstalled' }
  /** The shim is first on PATH but couldn't report a route. */
  | { status: 'shimFailed'; message: string }

/** `shell::Preview`: the route from the config alone, without consulting a shell. */
export interface Preview {
  profileId: string | null
  profile: string | null
  envVar: string | null
  value: string | null
  /** The MCP servers the profile hands the tool. */
  mcp: string[]
}

/** `mcp_probe::ToolInfo`: one tool a server offers. `description` is its first line. */
export interface ToolInfo {
  name: string
  description: string | null
}

/** `mcp_probe::ServerCheck`: what starting a server and asking for its tools found. */
export interface ServerCheck {
  /** needsLogin: the server answered 401, so the agent has to sign in with /mcp. unsupported: an SSE server, which can't be checked here. */
  status: 'ok' | 'needsLogin' | 'failed' | 'timedOut' | 'unsupported'
  tools: ToolInfo[]
  message: string | null
  /** The last lines a stdio server wrote to stderr, when it failed. */
  log: string | null
}
