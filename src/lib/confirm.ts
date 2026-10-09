import { ask } from '@tauri-apps/plugin-dialog'
import type { Profile } from './types'

/** The native confirmation before the inspector closes with edits that haven't been saved. */
export const confirmDiscard = (profileName: string | undefined) =>
  ask("Your changes haven't been saved.", {
    title: profileName ? `Discard changes to “${profileName}”?` : 'Discard this new profile?',
    kind: 'warning',
    okLabel: 'Discard',
    cancelLabel: 'Keep Editing',
  })

/** The native confirmation before a profile is deleted, from the editor or a context menu. */
export const confirmDelete = (profile: Profile) =>
  ask("New terminals in its folders will use the next profile up, or each agent's default config.", {
    title: `Delete “${profile.name}”?`,
    kind: 'warning',
    okLabel: 'Delete',
    cancelLabel: 'Cancel',
  })
