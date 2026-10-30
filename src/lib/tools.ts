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
//   `remote-control` refuses because the flag wouldn't reach the sessions it starts. Of its
//   aliases (2.1.310), `rc` refuses the same way and the hidden `remote`, `sync` and `bridge`
//   read as a prompt. `plugin` (and its alias `plugins`) parses but `plugin test` refuses any
//   option ahead of it (2.1.306). The rest (`agents`, `auth`, `auto-mode`, `doctor`, `gateway`,
//   `import`, `install`, `mcp`, `purge`, `setup-token`, `ultrareview`, `update`/`upgrade`, and
//   the hidden `design-login`, `project` and `sandbox`) run with one. `skipIfPresent`: Claude Code
//   exits at startup when given servers on a machine with an enterprise managed-mcp.json.
//   `optionsBeforeSubcommand` is null: Claude takes these as subcommands only as its first
//   argument; with an option ahead they read as a prompt or refuse the user's own option, so the
//   shim looks at the first argument alone.
//   User and local scopes live in .claude.json in the config folder; project scope in .mcp.json.
//   The editor hook was verified on the VS Code extension 2.1.301: it runs `<wrapper> <its
//   bundled claude> <args>` in the workspace folder. The setting is machine-wide, which is fine,
//   since the shim routes by folder. The hook's `note` is the Editors… popover's line for the agent, and
//   the window's alone (`withAgents` and `ideHooks` leave it out): anthropics/claude-code#99263, open
//   on 2.1.288, where the extension picks "default" for any tab it starts without a permission mode
//   whenever `claudeCode.claudeProcessWrapper` is set, whatever the wrapper does.
// - copilot: verified on 1.0.98: `@` takes a file and the flag adds to the user's own servers; a
//   tool is turned off with `--deny-tool=server(tool)`, one per argument. `mcpFiles`, from the
//   docs ("Adding MCP servers for GitHub Copilot CLI") and the changelog (1.0.103, not checked
//   against the binary): a trusted folder's `.mcp.json` and `.github/mcp.json` (added in 1.0.61),
//   each with a top-level `mcpServers` or as a bare table of named servers (0.0.401). Not
//   `servers`, and not `.vscode/mcp.json` (removed in 1.0.22). Import reads trigger folders only,
//   with no walk up to the repository root and no trust check, as for Claude.
//   `optionsBeforeSubcommand` is null; it skips no subcommand.
// - codex: `CODEX_HOME` holds config.toml and its trust list, auth.json (or the keyring entry
//   `Codex Auth`, keyed by a hash of the folder), sessions, history, logs and the SQLite state
//   (0.164.0, run with a scratch home). Not MCP OAuth tokens, which the OS keyring keeps by server
//   name and URL for every home, nor `~/.agents/skills`, read from HOME; and install.sh puts a
//   standalone install under CODEX_HOME, so an update run in a profile's folder lands in that
//   profile. Codex exits when the folder is missing, so the shim makes it again. `mcpFiles`, checked
//   against the 0.164.0 source (#162): servers are `[mcp_servers.<name>]` tables in TOML, in
//   `CODEX_HOME/config.toml` and, in a trusted project, in each `<folder>/.codex/config.toml` from
//   the project root (the nearest ancestor with a `.git`) down to the working folder. Import reads
//   the user's file in each home and the trigger folders' `.codex/config.toml` only, with no walk up
//   and no trust check, as for Claude and Copilot (`codex_entry` in `mcp_import.rs` says what comes
//   over: a server's fields, and its variables passed by name as `${NAME}`). No editor
//   hook: the VS Code extension (`openai.chatgpt`) runs its bundled binary as one app-server per
//   window, with no wrapper setting. No `mark`: Simple Icons has no OpenAI logo. The MCP
//   descriptor, checked against the 0.164.0 source: `--config=` is global and appends one value
//   per flag, so it can't swallow the user's next argument; the value is `mcp_servers.<name>=`
//   and an inline TOML table, one per server, which Codex deep-merges into a server of the same
//   name in its own config, and a transport that differs from that server's (a `url` beside a
//   `command`) fails its config load. `denyArg` is null: disabled tools go inside the table, as
//   `disabled_tools`. `skipAnyArgs` is empty, since no Codex flag means "only my own servers".
//   `skipSubcommands`: any override but a feature toggle makes Codex run embedded rather than on
//   its shared background server, which `queue` refuses ("remove configuration overrides or use
//   --remote"), `archive`, `unarchive` and `delete` would write session state through a second
//   server for, and `remote-control` answers by running in the foreground instead of the daemon;
//   none has an alias. Re-sweep on a new release. `optionsBeforeSubcommand`: Codex's top-level
//   parser (clap's `MultitoolCli`, with no `subcommand_precedence_over_arg`) reads a subcommand
//   after its own options, so `codex -C ~/proj queue` runs `queue`. These are 0.164.0's options
//   that take a value there (`CliConfigOverrides`, `FeatureToggles`, `InteractiveRemoteOptions`,
//   `TuiCli` and its `SharedCliOptions`), in definition order: one value each, except
//   `-i`/`--image` (`num_args = 1..`), which takes words up to the next one starting with `-`,
//   so `codex -i a.png queue` attaches `queue` as an image and gets servers. Booleans need no
//   entry, and an attached value (`--cd=dir`, `-Cdir`) is one word. `--` or a prompt ahead means
//   no subcommand. `skipIfPresent` is empty: an admin's requirements.toml `[mcp_servers]`
//   allowlist turns unlisted servers off without exiting. Codex has no SSE transport, so an SSE
//   server isn't handed to it.
// - `install` is each vendor's own one-line installer (claude: claude.ai/install.sh, the native
//   installer in the Claude Code docs; copilot: gh.io/copilot-install, the install script in the
//   Copilot CLI docs; both checked 2026-10-24; codex: chatgpt.com/codex/install.sh, in its README,
//   checked 2026-10-26). It's shown as text to copy, never run by the
//   window, and `withAgents` doesn't copy it, since Rust never needs it.
// - `mark` names the logo `AgentMark` draws (Claude's starburst, not the Claude Code mascot, which blurs
//   into a blob at 14px); the window's alone, like `label`.

import registry from './agents.json'
import type { AgentDef, ConfigState, IdeHook, McpFiles, McpInjection } from './types'

export interface KnownTool {
  /** The command the shim stands in for, and the key in `Profile.tools`. */
  command: string
  label: string
  /** Which logo `AgentMark` draws (a slug in `icons.tsx`); one it has no logo for, or none, gets the generic bot. */
  mark?: string
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
  ide?: IdeHook & {
    /** What routing the extension does that the user wouldn't expect, as one sentence for the Editors… popover. The window's alone. */
    note?: string
  }
}

// JSON infers `dialect` as a plain string; Rust's tests reject one that isn't a dialect.
export const KNOWN_TOOLS: KnownTool[] = registry as KnownTool[]

/** The editor hooks to offer, keyed by command. */
export const ideHooks = (): Record<string, IdeHook> =>
  Object.fromEntries(KNOWN_TOOLS.flatMap((t) => (t.ide ? [[t.command, hookOf(t.ide)] as const] : [])))

/** The hook as Rust knows it: without the window's own `note`. */
const hookOf = ({ setting, extension }: IdeHook): IdeHook => ({ setting, extension })

/** The line the Editors… popover shows for an agent's extension, if it has one. */
export const editorNote = (command: string) => toolByCommand(command)?.ide?.note

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
  for (const tool of KNOWN_TOOLS)
    agents[tool.command] = { mcp: tool.mcp ?? null, mcpFiles: tool.mcpFiles ?? null, ide: tool.ide ? hookOf(tool.ide) : null }
  return { ...config, agents }
}
