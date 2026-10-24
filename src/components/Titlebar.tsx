// The titlebar: traffic lights, app icon and name, the view switch, shell status, Shells…, Editors… and Check Folder….

// The small cut: it's drawn for 64 px and under, and the titlebar shows it at 22.
import appIcon from '../../src-tauri/icons/app-icon-small.svg'
import { shortcutLabel, usePlatform } from '../lib/platform'
import type { SetupStatus, Shell } from '../lib/types'
import { DisclosureIcon, EditorIcon, FolderCheckIcon, PlugIcon } from './icons'
import { Button, FolderIcon, Segmented } from './ui'

export function TitleBand({
  setup,
  blockedShell,
  primary,
  canCheck,
  shellsOpen,
  onToggleShells,
  editorsShown,
  editorsOpen,
  onToggleEditors,
  view,
  onView,
  onCheckFolder,
}: {
  setup: SetupStatus | null
  /** A shell the last check found blocked: its dot turns into a red cross. */
  blockedShell: Shell | null
  /** Check Folder… is the window's accent button only when nothing more urgent is. */
  primary: boolean
  /** Off while there's no config to check against (config.json unreadable, or still loading). */
  canCheck: boolean
  shellsOpen: boolean
  onToggleShells: () => void
  /** An editor on this Mac runs an agent extension EnvRouter can route. */
  editorsShown: boolean
  editorsOpen: boolean
  onToggleEditors: () => void
  /** The window's two places: the profile map and the MCP server workbench. */
  view: 'profiles' | 'servers'
  onView: (view: 'profiles' | 'servers') => void
  onCheckFolder: () => void
}) {
  const platform = usePlatform()
  const shells = setup?.shells.filter((s) => s.available) ?? []
  return (
    <div
      data-tauri-drag-region
      data-titlebar
      className={`flex h-[52px] shrink-0 items-center gap-3 pr-4 max-[760px]:gap-2 ${platform.isMac ? 'pl-[86px]' : 'pl-4'}`}
    >
      {/* On macOS the band is the title bar, beside the traffic lights. Elsewhere the system's own title bar already names the app, so
          the band is just the toolbar; the name stays for screen readers. */}
      {platform.isMac ? (
        <div data-tauri-drag-region className="flex items-center gap-2">
          <img data-tauri-drag-region src={appIcon} alt="" width={22} height={22} draggable={false} className="shrink-0" />
          {/* A narrow window keeps the icon; the name stays for screen readers. */}
          <h1 data-tauri-drag-region className="text-body font-bold max-[900px]:sr-only">
            EnvRouter
          </h1>
        </div>
      ) : (
        <h1 className="sr-only">EnvRouter</h1>
      )}
      <Segmented
        label="View"
        size="toolbar"
        options={[
          ['profiles', 'Profiles', <FolderIcon key="p" />],
          ['servers', 'MCP Servers', <PlugIcon key="s" />],
        ]}
        value={view}
        onChange={onView}
      />
      <div data-tauri-drag-region className="ml-auto flex min-w-0 items-center gap-2">
        {/* Each shell's state lives in the control that changes it: the dots open the Shells popover. */}
        {shells.length > 0 && (
          <Button
            size="toolbar"
            aria-expanded={shellsOpen}
            aria-haspopup="dialog"
            aria-controls="shells-panel"
            onClick={onToggleShells}
            title="Shells…"
            className="min-w-0 gap-2 pr-2.5 text-small !shrink"
          >
            {shells.map((s) => (
              <span key={s.shell} className="flex min-w-0 items-center gap-1.5">
                {s.shell === blockedShell ? (
                  <svg aria-hidden="true" width="9" height="9" viewBox="0 0 10 10" className="shrink-0 text-problem">
                    <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                ) : (
                  <span
                    aria-hidden="true"
                    className={`size-[7px] shrink-0 rounded-full ${
                      s.installed
                        ? 'bg-ok forced-colors:bg-[CanvasText] forced-colors:forced-color-adjust-none'
                        : 'shadow-[inset_0_0_0_1.2px_var(--er-ink-2)] forced-colors:border forced-colors:border-[CanvasText]'
                    }`}
                  />
                )}
                {/* Three shells in a narrow window keep their dots; the names stay for screen readers and in the popover. */}
                <span className={`truncate ${shells.length > 2 ? 'max-[760px]:sr-only' : ''} ${s.installed ? 'text-ink' : 'text-ink-2'}`}>
                  {s.shell}
                </span>
              </span>
            ))}
            <span className="-ml-0.5 shrink-0 text-ink-2">
              <DisclosureIcon />
            </span>
            {/* After the visible names, so the accessible name starts with what's on screen (WCAG 2.5.3). */}
            <span className="sr-only">
              , Shells: {shells.map((s) => `${s.shell} ${s.shell === blockedShell ? 'blocked' : s.installed ? 'on' : 'off'}`).join(', ')}
            </span>
          </Button>
        )}
        {editorsShown && (
          <Button
            size="toolbar"
            aria-expanded={editorsOpen}
            aria-haspopup="dialog"
            aria-controls="editors-panel"
            aria-label="Editors…"
            onClick={onToggleEditors}
            title="Editors…"
            className="w-[34px] justify-center !px-0"
          >
            <EditorIcon />
          </Button>
        )}
        <Button
          id="check-folder"
          size="toolbar"
          kind={primary ? 'primary' : 'push'}
          disabled={!canCheck}
          onClick={onCheckFolder}
          title={`Check Folder… (${shortcutLabel('o', platform)})`}
          className="pl-2.5"
        >
          <FolderCheckIcon />
          {/* Accent or not, the label keeps the accent's width, so the toolbar doesn't shift when it stands down. */}
          <span className="grid">
            <span className="col-start-1 row-start-1">Check Folder…</span>
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 font-medium">
              Check Folder…
            </span>
          </span>
        </Button>
      </div>
    </div>
  )
}
