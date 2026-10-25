import { ask, message } from '@tauri-apps/plugin-dialog'
import { tildify } from './paths'
import { listOf } from './text'
import type { Profile, UninstallReport } from './types'

/** A native warning with two buttons; each confirmation below words its own. */
const warn = (message: string, title: string, okLabel: string, cancelLabel: string) => ask(message, { title, kind: 'warning', okLabel, cancelLabel })

/** The confirmation before an editor closes or the app quits with edits that haven't been saved. */
const unsaved = (title: string, okLabel: string) => warn("Your changes haven't been saved.", title, okLabel, 'Keep Editing')

/** The native confirmation before the inspector closes with edits that haven't been saved. */
export const confirmDiscard = (profileName: string | undefined) =>
  unsaved(profileName ? `Discard changes to “${profileName}”?` : 'Discard this new profile?', 'Discard')

/** The native confirmation before quitting with unsaved edits in an editor. */
export const confirmQuit = () => unsaved('Quit without saving?', 'Quit')

/** The native confirmation before a profile is deleted, from the editor or a context menu. */
export const confirmDelete = (profile: Profile) =>
  warn("New terminals in its folders will use the next profile up, or each agent's default config.", `Delete “${profile.name}”?`, 'Delete', 'Cancel')

/** The native confirmation before the server editor closes with unsaved edits. */
export const confirmDiscardServer = (serverName: string | null) =>
  unsaved(serverName ? `Discard changes to “${serverName}”?` : 'Discard this new server?', 'Discard')

/** The native confirmation before a library server is deleted. */
export const confirmDeleteServer = (serverName: string, usedBy: string[]) =>
  warn(
    usedBy.length > 0 ? `${usedBy.join(', ')} will stop loading it in new terminals.` : 'No profile uses it, so nothing changes in your terminals.',
    `Delete the MCP server “${serverName}”?`,
    'Delete',
    'Cancel',
  )

/**
 * The native confirmation before a save replaces changes made outside the window (by the
 * envrouter CLI or in config.json) to the same profiles or servers. `conflicts` as `mergeConfig` words them.
 */
export const confirmReplace = (conflicts: string[]) =>
  warn(
    'config.json changed after you started editing. Changes to anything else are kept either way.',
    `Replace the other ${conflicts.length === 1 ? 'change' : 'changes'} to ${listOf(conflicts)}?`,
    'Replace',
    'Cancel',
  )

/**
 * The native confirmation before a save writes config.json again after it was deleted outside
 * the window. Merging into the empty file would drop everything the edit didn't touch, so the
 * choice is the window's whole version or nothing.
 */
export const confirmRestore = () =>
  warn(
    'It was deleted after you started editing. Saving writes it again with every profile and server shown here.',
    'Save config.json again?',
    'Save',
    'Cancel',
  )

/** The native confirmation before an unreadable config.json is copied aside and replaced by an empty one. */
export const confirmStartOver = () =>
  warn(
    'EnvRouter copies it to a new backup beside it, then starts with no profiles and no MCP servers. Earlier backups are kept, and nothing else is touched.',
    'Back up config.json and start over?',
    'Back Up and Start Over',
    'Cancel',
  )

/** The native note after Start Over, naming the backup it made (`config.json.bak`, or `.bak-2` and on when that's taken). */
export const tellBackedUp = (backup: string) =>
  message(`Your old config.json is at ${backup}. Copy it back over config.json to return to it.`, { title: 'Started over', kind: 'info' })

/** The native note for a failed reveal that no banner can show: another error holds the banner's place, or the inspector hides it. */
export const tellRevealFailed = (title: string, reason: string) => message(reason, { title, kind: 'error' })

/**
 * The native confirmation before EnvRouter is uninstalled. `store` is what the secrets' home is called here ("Keychain",
 * "keyring"); the CLI's `uninstall` plan says the same things.
 */
export const confirmUninstall = (store: string, unsaved: boolean) =>
  warn(
    `Routing turns off in every shell and editor, any MCP secrets EnvRouter kept in the ${store} are deleted, and ~/.envrouter goes with your profiles and MCP servers. Your agents' config folders stay.${unsaved ? " Changes you haven't saved are lost." : ''}`,
    'Uninstall EnvRouter?',
    'Uninstall',
    'Cancel',
  )

/** What the store's one item is called in its own tools (`uninstall::SECRETS_ITEM`). */
const SECRETS_ITEM = 'EnvRouter MCP secrets'

/**
 * The native note after a finished uninstall: what is left for the user to remove (the app and the CLI can't remove themselves),
 * anything it couldn't do, and that the app quits now.
 */
export const tellUninstalled = (report: UninstallReport, store: string, home: string) => {
  const removals = report.removeNext.map((next) => `${next.what === 'app' ? 'To remove the app' : 'To remove the envrouter CLI'}: ${next.command}`)
  if (report.removeNext.some((next) => next.what === 'app')) removals.push('Opening the app again sets EnvRouter up again.')
  const paragraphs = removals.length > 0 ? [removals.join('\n')] : []
  if (report.secrets.status === 'unreachable')
    paragraphs.push(
      `Couldn't reach the ${store} (${report.secrets.reason}), so any MCP secrets EnvRouter kept there are still in it, as "${SECRETS_ITEM}".`,
    )
  for (const target of report.left) paragraphs.push(`Left ${tildify(target, home)} alone: ~/.envrouter pointed there.`)
  paragraphs.push('EnvRouter quits now.')
  return message(paragraphs.join('\n\n'), { title: 'EnvRouter is uninstalled', kind: 'info' })
}
