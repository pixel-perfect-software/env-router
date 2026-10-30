// Wire types for the Tauri commands. Each one mirrors a Rust type, named in its comment;
// change both sides together. Rust `Option` arrives as `null`.

import type helpLinks from './helpLinks.json'

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

/** `envrouter_core::config::McpDialect`: how an agent is handed MCP servers, named after the agent that defined it. */
export type McpDialect = 'claude' | 'copilot' | 'codex'

/** `envrouter_core::config::LeadingOptions`: the options an agent reads ahead of its subcommand that take a value. An attached value (`--cd=dir`, `-Cdir`) is a word of its own and is never listed; a dashed word listed nowhere takes no value. */
export interface LeadingOptions {
  /** Each takes the next word as its value. */
  takeOne: string[]
  /** Each takes every next word up to one starting with `-`. */
  takeMany: string[]
}

/** `envrouter_core::config::McpInjection`: how the shim hands an agent its servers at launch. */
export interface McpInjection {
  dialect: McpDialect
  /** Followed by what the dialect renders for one server, as one argument: a rendered file's path (`--mcp-config=`) or, for Codex, `mcp_servers.<name>=<inline table>`. Never two arguments, since Claude's flags take several values. */
  configArg: string
  /** Followed by the tools to turn off, in the dialect's form, e.g. `--disallowedTools=`. */
  denyArg: string | null
  /** Any of these among the user's arguments turns injection off for that run. */
  skipAnyArgs: string[]
  /** A run whose subcommand is one of these gets no injection: `claude plugin test` refuses any option before `plugin`. Where the subcommand sits is `optionsBeforeSubcommand`'s to say. */
  skipSubcommands: string[]
  /** `null`: the agent reads a subcommand only as its first argument (Claude reads `claude --debug daemon` as a prompt). Set: it reads one past the options ahead of it (`codex -C ~/proj queue`), and these name the options that take a value. Added in config version 7. */
  optionsBeforeSubcommand: LeadingOptions | null
  /** While any of these files exists, no run gets injection: Claude Code exits at startup when given servers on a machine with an enterprise `managed-mcp.json`. Absolute paths. */
  skipIfPresent: string[]
}

/** `envrouter_core::config::McpFiles`: where an agent keeps MCP servers of its own, for importing them. */
export interface McpFiles {
  /** In its config folder: the one a profile sets, or `defaultDir`. */
  userFile: string
  defaultDir: string
  /** In a project folder, each relative to it and possibly in a subfolder (`.github/mcp.json`). */
  projectFiles: string[]
}

/** `envrouter_core::config::AgentDef`. The window writes these from `tools.ts` on every save. */
export interface AgentDef {
  mcp: McpInjection | null
  mcpFiles: McpFiles | null
  /** Added in config version 3, so the CLI can route an editor extension without the window. */
  ide: IdeHook | null
}

/** `mcp_import::ImportCandidate`: a server the agents already define, the same in every file listed. */
export interface ImportCandidate {
  name: string
  server: McpServer
  sources: string[]
}

/** `mcp_import::Pasted`: the servers in text the user pasted, and the names of entries EnvRouter can't use. */
export interface Pasted {
  servers: PastedServer[]
  skipped: string[]
}

/** `mcp_import::PastedServer`. `name` is null for a lone entry, which the text doesn't name. */
export interface PastedServer {
  name: string | null
  server: McpServer
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

/** `envrouter_core::platform::Platform` */
export type Platform = 'macos' | 'linux' | 'wsl' | 'windows'

/** `envrouter_ops::commands::SetupStatus` */
export interface SetupStatus {
  /** Which system this is, so the window can use its conventions (shortcuts, words). */
  platform: Platform
  /** What the store MCP secrets go to is called here: "Keychain", "keyring". */
  secretStore: string
  /** What a value kept there reads as in its field: "In Keychain", "In the keyring". */
  sealedLabel: string
  /** Why that store can't keep secrets right now, in its own words, or null when it can (Keychain and Credential Manager: always null). */
  secretStoreProblem: string | null
  /** What the file manager is called here: "Finder", "Files" (`Platform::file_manager`). */
  fileManager: string
  /** The verb for showing something in it: "Reveal" in Finder, "Show" in Files (`Platform::reveal_verb`). */
  revealVerb: string
  /** The installed shim matches the one bundled with this version of the app. */
  shimInstalled: boolean
  shimsDir: string
  /** The installed shim itself, which is named when it is missing or out of date. */
  shimPath: string
  shells: ShellStatus[]
  /**
   * The commands of the agents a new terminal has nothing to run for and no editor carries (`installed::probe`: the offered ones, and any the
   * config names), or null when that couldn't be asked or hasn't been yet: nothing is marked then, since an agent not known to be missing isn't.
   */
  missingAgents: string[] | null
  /** First-run's folder check counts as done although this window's storage doesn't say so: the storage of an older bundle identifier held that answer (`paths::checked_once`). */
  checkedBefore: boolean
}

/**
 * `editors::Editor`: VS Code and the forks that share its settings and extensions, and their remote servers (a WSL distro or an SSH
 * host that an editor connects to runs the extension there, reading the server's machine settings). The window never words them: each
 * `EditorStatus` carries its label.
 */
export type Editor =
  | 'code'
  | 'codeInsiders'
  | 'cursor'
  | 'windsurf'
  | 'codium'
  | 'remoteCode'
  | 'remoteCodeInsiders'
  | 'remoteCursor'
  | 'remoteWindsurf'

/** `envrouter_core::config::IdeHook`: how an agent's editor extension, which runs its own copy of the agent, can be told to run through the shim. */
export interface IdeHook {
  /** The extension's process-wrapper setting: the editor runs `<wrapper> <its binary> <args>`. */
  setting: string
  /** The extension's id, e.g. `anthropic.claude-code`. */
  extension: string
}

/** `editors::EditorStatus`: one editor's state for one agent's extension. */
export interface EditorStatus {
  editor: Editor
  /** What to call it: "VS Code", "Cursor Server". */
  label: string
  /** The agent the extension runs. */
  command: string
  /** The editor has been run on this machine (for a server, connected to it). */
  available: boolean
  extensionInstalled: boolean
  settingsFile: string
  /** The wrapper the setting names now, if any. */
  wrapper: string | null
  /** That wrapper is EnvRouter's shim. */
  installed: boolean
}

/** `uninstall::UninstallReport`: what an uninstall did, or with `dryRun` would do. */
export interface UninstallReport {
  dryRun: boolean
  /** The startup files that held EnvRouter's block. */
  shellFiles: string[]
  /** The settings that named the shim. */
  editorFiles: { editor: Editor; settingsFile: string; setting: string }[]
  /** `unreachable`: the store can't be used from here, so any secrets EnvRouter kept in it are still there. `notReached`: an earlier step stopped the run. */
  secrets: { status: 'deleted' | 'wouldDelete' | 'notReached' } | { status: 'unreachable'; reason: string }
  folder: 'deleted' | 'wouldDelete' | 'absent' | 'notReached'
  /** The webview's own folders (macOS: under ~/Library; Linux: ~/.local/share/<identifier>) that it deleted, or would. None from the window's own run: its webview holds them, so the app deletes them as it exits. */
  appData: string[]
  /** Webview folders it couldn't delete or wouldn't touch (one outside the home folder), one sentence each, worded like `problems`. They don't stop the run: the setup is gone either way. */
  appDataLeft: string[]
  /** Links it deleted whose targets it left alone, such as where a linked `~/.envrouter` pointed. */
  left: { link: string; target: string }[]
  /** Why it stopped, one sentence each, worded to show as it is, with paths and setting names in backticks. Empty when it went through. */
  problems: string[]
  /** The commands that remove what EnvRouter can't remove from itself, once it has finished. */
  removeNext: { what: 'app' | 'cli'; command: string }[]
}

/** `shell::FolderCheck`: what running a tool in a folder does in a new terminal window. */
export type FolderCheck =
  /** The shim runs. `profile` is null when no profile owns the folder. `mcp`: the servers it adds, if every secret they need is readable. */
  | {
      status: 'routed'
      profile: string | null
      /** The profile's id: names aren't unique. Null when no profile owns the folder, or from a shim that predates it. */
      profileId: string | null
      envVar: string | null
      value: string | null
      mcp: string[]
      /** A file that turns the profile's MCP servers off on this machine, such as Claude Code's `managed-mcp.json`. `mcp` is empty then. */
      mcpManagedBy: string | null
      /** Servers the shim adds that one of the agent's own files defines with the other transport (a command, a URL), which the agent won't start with. `file`: that file; `openable`: whether Open will open it (only files in the home folder). */
      mcpClashes: { server: string; file: string; openable: boolean }[]
      /** The run goes through an alias with the tool's name that runs the tool itself (`alias claude='claude --model opus'`): what it expands to. */
      viaAlias: string | null
      real: string
    }
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

/**
 * `commands::SaveOutcome`. `saved`: `config` is what the file holds now, and `warning` is something to know after the save wrote it
 * (the secret store wouldn't drop a secret no server uses any more; Codex won't start in some folders because its own file defines a
 * server the profile hands it with the other transport), worded to show as it is. `changed`: nothing was
 * saved, because config.json no longer holds the `base` the save named (the CLI or a hand edit changed it); `config` is what the
 * file holds now. `missing`: nothing was saved, because config.json is gone since the edit started; saving again without a base
 * writes the window's version.
 */
export type SaveOutcome =
  | { status: 'saved'; config: ConfigState; warning: string | null }
  | { status: 'changed'; config: ConfigState }
  | { status: 'missing' }

/** `error::ErrorKind`. `parse`: a file that isn't valid JSON for its type. */
export type ErrorKind = 'parse' | 'other'

/** `commands::ConfigFault`: why config.json couldn't be read. The only command that rejects with more than a message. */
export interface ConfigFault {
  kind: ErrorKind
  message: string
  /** The file that couldn't be read, to open it; null when no home folder could be named. */
  path: string | null
}

/** `commands::Place`: one of EnvRouter's own places to show in the file manager. `mcpFiles`: the folder a profile's MCP files are rendered into. `trigger`: a trigger folder of a saved profile, or one inside it (an absolute path the backend holds to the config's triggers). */
export type Place = { kind: 'config' } | { kind: 'root' } | { kind: 'mcpFiles'; profileId: string } | { kind: 'trigger'; folder: string }

/**
 * `help::Link`: a page of the project's repository on GitHub, named by its key in `helpLinks.json`. The window names it; the backend
 * holds the address, so the window can't open any other.
 */
export type HelpLink = keyof typeof helpLinks

/** `tray::Failed`: what the menu bar tried to show. */
export type Failed = Place | { kind: 'help'; link: HelpLink }

/** `tray::RevealFailed`, the payload of the `reveal-failed` event: the menu bar's reveal, or its Help item, couldn't show `what`. */
export interface RevealFailed {
  what: Failed
  message: string
}

/** `tray::MenuRequest`: what the menu bar's Check Folder… and Check Last Folder ask of the window, which takes it when it hears `menu-request` and when it starts. */
export type MenuRequest = { kind: 'checkFolder' } | { kind: 'checkLastFolder'; folder: string }

/** `mcp_probe::ServerCheck`: what starting a server and asking for its tools found. */
export interface ServerCheck {
  /** needsLogin: the server answered 401, so the agent has to sign in with /mcp. unsupported: an SSE server, which can't be checked here. */
  status: 'ok' | 'needsLogin' | 'failed' | 'timedOut' | 'unsupported'
  tools: ToolInfo[]
  message: string | null
  /** The last lines a stdio server wrote to stderr, when it failed. */
  log: string | null
}
