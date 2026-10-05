import { ask } from '@tauri-apps/plugin-dialog'
import type { Profile } from './types'

/** The native confirmation before a profile is deleted, from the editor or a context menu. */
export const confirmDelete = (profile: Profile) =>
  ask("New terminals in its folders will use the next profile up, or each agent's default config.", {
    title: `Delete “${profile.name}”?`,
    kind: 'warning',
    okLabel: 'Delete',
    cancelLabel: 'Cancel',
  })
