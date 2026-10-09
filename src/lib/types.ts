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
}

/** `envrouter_core::config::ConfigState`. Rust writes the current `version` on every save. */
export interface ConfigState {
  version: number
  profiles: Profile[]
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
  /** The shim runs. `profile` is null when no profile owns the folder. */
  | { status: 'routed'; profile: string | null; envVar: string | null; value: string | null; real: string }
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
}
