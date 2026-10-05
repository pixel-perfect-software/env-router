// Typed wrappers for the Tauri commands in `src-tauri/src/lib.rs`. Each command rejects with a
// plain string that's written to be shown to the user as is.

import { invoke } from '@tauri-apps/api/core'
import type { ConfigState, FolderCheck, Preview, SetupStatus, Shell, ShellStatus } from './types'

/** Reads `~/.envrouter/config.json`, creating an empty one on first run. */
export const getConfig = () => invoke<ConfigState>('get_config')

/** Validates and saves, then updates the shims. Takes effect on the next run of each tool. */
export const saveConfig = (payload: ConfigState) => invoke<void>('save_config', { payload })

export const getSetupStatus = () => invoke<SetupStatus>('get_setup_status')

/** Adds or removes EnvRouter's block in the shell's startup files. */
export const setShellIntegration = (shell: Shell, enabled: boolean) => invoke<ShellStatus>('set_shell_integration', { shell, enabled })

/** Starts `shell` as a new terminal window would, in `folder`. Takes up to ~15s with slow startup files. */
export const checkFolder = (shell: Shell, folder: string, tool: string) => invoke<FolderCheck>('check_folder', { shell, folder, tool })

/** Instant: which profile the given, possibly unsaved, config picks for `folder`. */
export const previewFolder = (payload: ConfigState, folder: string, tool: string) => invoke<Preview>('preview_folder', { payload, folder, tool })

/** Normalizes a rejection, which is a string from our commands but may be an Error from Tauri itself. */
export const errorMessage = (err: unknown) => (typeof err === 'string' ? err : err instanceof Error ? err.message : String(err))
