// Typed wrappers for the Tauri commands in `src-tauri/src/lib.rs`. Each command rejects with a
// plain string that's written to be shown to the user as is.

import { invoke } from '@tauri-apps/api/core'
import type {
  ConfigState,
  Editor,
  EditorStatus,
  FolderCheck,
  IdeHook,
  ImportCandidate,
  McpServer,
  Pasted,
  Preview,
  SaveOutcome,
  ServerCheck,
  SetupStatus,
  Shell,
  ShellStatus,
  ToolInfo,
} from './types'

/** Reads `~/.envrouter/config.json`, creating an empty one on first run. */
export const getConfig = () => invoke<ConfigState>('get_config')

/**
 * Validates and saves, then updates the shims. Takes effect on the next run of each tool.
 * `secrets`: values typed since the last save, keyed by the ids `payload` refers to them by;
 * they go to the Keychain and never come back to the window. `base`: the config the edit
 * started from; if config.json has changed since, or is gone, nothing is saved and the answer
 * says so. `null` saves over whatever is there.
 */
export const saveConfig = (payload: ConfigState, secrets: Record<string, string>, base: ConfigState | null) =>
  invoke<SaveOutcome>('save_config', { payload, secrets, base })

export const getSetupStatus = () => invoke<SetupStatus>('get_setup_status')

/** Adds or removes EnvRouter's block in the shell's startup files. */
export const setShellIntegration = (shell: Shell, enabled: boolean) => invoke<ShellStatus>('set_shell_integration', { shell, enabled })

/** Each editor's state for each agent's extension. `hooks` is keyed by command, from `tools.ts`. */
export const getEditorStatus = (hooks: Record<string, IdeHook>) => invoke<EditorStatus[]>('get_editor_status', { hooks })

/** Points an agent's editor extension at the shim, or stops it, in the editor's user settings. Never replaces someone else's wrapper. */
export const setEditorIntegration = (editor: Editor, command: string, hook: IdeHook, enabled: boolean) =>
  invoke<EditorStatus>('set_editor_integration', { editor, command, hook, enabled })

/** Starts `shell` as a new terminal window would, in `folder`. Takes up to ~15s with slow startup files. */
export const checkFolder = (shell: Shell, folder: string, tool: string) => invoke<FolderCheck>('check_folder', { shell, folder, tool })

/** Instant: which profile the given, possibly unsaved, config picks for `folder`. */
export const previewFolder = (payload: ConfigState, folder: string, tool: string) => invoke<Preview>('preview_folder', { payload, folder, tool })

/**
 * Starts `server` (or connects to it) with the login shell's PATH and lists its tools; up to
 * ~45s for a first `npx` download. `secrets`: values typed but not yet saved, keyed by id.
 */
export const checkMcpServer = (name: string, server: McpServer, secrets: Record<string, string>) =>
  invoke<ServerCheck>('check_mcp_server', { name, server, secrets })

/** The dist-tags (`latest` and the like) of the npm package an `npx` server runs, from the user's own npm. */
export const npmDistTags = (command: string, packageName: string) =>
  invoke<Record<string, string>>('npm_dist_tags', { command, package: packageName })

/** Each library server's tools, from its last check that worked, if its definition hasn't changed since. */
export const getMcpTools = () => invoke<Record<string, ToolInfo[]>>('get_mcp_tools')

/** MCP servers the agents already define in their own files (as `payload` describes the agents and profiles). Read only. */
export const importCandidates = (payload: ConfigState) => invoke<ImportCandidate[]>('import_candidates', { payload })
/** The servers in pasted JSON. Rejects with a message to show as is. */
export const parseMcpJson = (text: string) => invoke<Pasted>('parse_mcp_json', { text })

/** Opens a file inside the home folder in the default text editor. */
export const openInEditor = (path: string) => invoke<void>('open_in_editor', { path })

/** Normalizes a rejection, which is a string from our commands but may be an Error from Tauri itself. */
export const errorMessage = (err: unknown) => (typeof err === 'string' ? err : err instanceof Error ? err.message : String(err))
