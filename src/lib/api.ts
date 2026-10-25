// Typed wrappers for the Tauri commands in `src-tauri/src/lib.rs`. Each command rejects with a
// plain string that's written to be shown to the user as is.

import { invoke } from '@tauri-apps/api/core'
import type {
  ConfigFault,
  ConfigState,
  Editor,
  EditorStatus,
  FolderCheck,
  IdeHook,
  ImportCandidate,
  McpServer,
  Pasted,
  Place,
  Preview,
  SaveOutcome,
  ServerCheck,
  SetupStatus,
  Shell,
  ShellStatus,
  ToolInfo,
  UninstallReport,
} from './types'

/**
 * Reads `~/.envrouter/config.json`, creating an empty one on first run. Unlike the other commands it rejects with a `ConfigFault`, the
 * message and the kind of trouble, since only a file that won't parse can be started over.
 */
export const getConfig = () =>
  invoke<ConfigState>('get_config').catch((err) => {
    throw faultOf(err)
  })

/**
 * Validates and saves, then updates the shims. Takes effect on the next run of each tool.
 * `secrets`: values typed since the last save, keyed by the ids `payload` refers to them by;
 * they go to the Keychain and never come back to the window. `base`: the config the edit
 * started from; if config.json has changed since, or is gone, nothing is saved and the answer
 * says so. `null` saves over whatever is there.
 */
export const saveConfig = (payload: ConfigState, secrets: Record<string, string>, base: ConfigState | null) =>
  invoke<SaveOutcome>('save_config', { payload, secrets, base })

/**
 * Starts over from a config.json that isn't valid JSON: copies it to the first free `config.json.bak`, `.bak-2`, … beside it, writes an
 * empty config, and answers the backup's path. Rejects, changing nothing, for any other trouble with the file.
 */
export const resetUnreadableConfig = () => invoke<string>('reset_unreadable_config')

export const getSetupStatus = () => invoke<SetupStatus>('get_setup_status')

/** Tells the app whether the window holds unsaved edits, so quitting asks first. Also the answer "keep editing" to a quit. */
export const setUnsavedEdits = (unsaved: boolean) => invoke<void>('set_unsaved_edits', { unsaved })

/** Quits without saving, once the user has said so. */
export const quitApp = () => invoke<void>('quit_app')

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

/**
 * Turns routing off in every shell and editor, deletes the stored MCP secrets and `~/.envrouter`, and names the commands that
 * remove the app and the CLI. A stop is a resolved report with `problems` (nothing irreversible happened; asking again finishes the
 * job), not a rejection. After a finished run every other command rejects until the app quits. `dryRun` reports and changes nothing.
 */
export const uninstall = (dryRun: boolean) => invoke<UninstallReport>('uninstall', { dryRun })

/** Opens a file inside the home folder in the default text editor. */
export const openInEditor = (path: string) => invoke<void>('open_in_editor', { path })

/**
 * Shows one of EnvRouter's own places in the file manager: config.json is revealed (selected in its folder), the others are opened.
 * Rejects with a sentence when the place isn't there yet, or the file manager can't show it.
 */
export const revealPlace = (place: Place) => invoke<void>('reveal_place', { place })

/** Normalizes a rejection, which is a string from our commands but may be an Error from Tauri itself. */
export const errorMessage = (err: unknown) => (typeof err === 'string' ? err : err instanceof Error ? err.message : String(err))

/** A failed config read as a `ConfigFault`: the backend's own, or (for a rejection that isn't one) a message of the `other` kind. */
export const faultOf = (err: unknown): ConfigFault =>
  typeof err === 'object' &&
  err !== null &&
  'kind' in err &&
  'message' in err &&
  typeof err.message === 'string' &&
  (err.kind === 'parse' || err.kind === 'other')
    ? { kind: err.kind, message: err.message, path: 'path' in err && typeof err.path === 'string' ? err.path : null }
    : { kind: 'other', message: errorMessage(err), path: null }
