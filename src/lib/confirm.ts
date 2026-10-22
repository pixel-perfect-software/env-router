import { ask } from '@tauri-apps/plugin-dialog'
import { listOf } from './merge'
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

/** The native confirmation before the server editor closes with unsaved edits. */
export const confirmDiscardServer = (serverName: string | null) =>
  ask("Your changes haven't been saved.", {
    title: serverName ? `Discard changes to “${serverName}”?` : 'Discard this new server?',
    kind: 'warning',
    okLabel: 'Discard',
    cancelLabel: 'Keep Editing',
  })

/** The native confirmation before a library server is deleted. */
export const confirmDeleteServer = (serverName: string, usedBy: string[]) =>
  ask(
    usedBy.length > 0 ? `${usedBy.join(', ')} will stop loading it in new terminals.` : 'No profile uses it, so nothing changes in your terminals.',
    {
      title: `Delete the MCP server “${serverName}”?`,
      kind: 'warning',
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
    },
  )

/**
 * The native confirmation before a save replaces changes made outside the window (by the
 * envrouter CLI or in config.json) to the same profiles or servers. `conflicts` as `mergeConfig` words them.
 */
export const confirmReplace = (conflicts: string[]) =>
  ask('config.json changed after you started editing. Changes to anything else are kept either way.', {
    title: `Replace the other ${conflicts.length === 1 ? 'change' : 'changes'} to ${listOf(conflicts)}?`,
    kind: 'warning',
    okLabel: 'Replace',
    cancelLabel: 'Cancel',
  })
