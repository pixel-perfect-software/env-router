// The profiles: one card per profile, holding the folders it owns. A folder handed to a deeper
// profile shows as a carve-out inside its parent, marked with the owning profile's colour, so
// "the most specific folder wins" is something you can see, not something you're told.

import { type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { isInside, splitLeaf, tildify, triggerBase } from '../lib/paths'
import { shortcutLabel, usePlatform } from '../lib/platform'
import { KNOWN_TOOLS, toolLabel } from '../lib/tools'
import type { Profile } from '../lib/types'
import { onGridKeyDown } from '../lib/useRoving'
import { AgentMark } from './icons'
import { BranchIcon, FolderIcon, IconButton, Mark, type MarkKind, MoreIcon, PencilIcon, PlugIcon, PlusIcon, ProfileDot, profileColors } from './ui'

/** A folder that was just checked, filed in the card that owns it. */
export interface Slip {
  key: number
  folder: string
  /** null: no profile owns it, so it files in "Everywhere else". */
  profileId: string | null
  /** The trigger that won, so the slip files under it. */
  trigger: string | null
  mark: MarkKind
  origin: { x: number; y: number } | null
}

/** The card a folder being dragged over the window would file into (null id: Everywhere else). */
export type DropTarget = { profileId: string | null } | null

/** The agents this profile sets, in registry order, then any added by hand. */
function routedTools(profile: Profile): [string, string][] {
  const known = KNOWN_TOOLS.map((t) => t.command)
  return Object.entries(profile.tools)
    .filter(([, t]) => t.path.trim())
    .sort(([a], [b]) => (known.indexOf(a) + 1 || 99) - (known.indexOf(b) + 1 || 99))
    .map(([command, t]) => [command, t.path.trim()])
}

const FRAME = 'flex min-h-[176px] flex-col rounded-card transition-[opacity,box-shadow,background-color] duration-150'
const CARD = `${FRAME} bg-card shadow-card`
// Outlines, not shadows: they can't be overridden by the card's own shadow utility.
const TARGETED = 'bg-tint outline-2 outline-offset-2 outline-accent-ink'
const SELECTED = 'outline-2 outline-offset-2 outline-accent-ink'

export function Frame({
  profiles,
  home,
  editing,
  slip,
  dropTarget,
  onEdit,
  onContextMenu,
  onFolderMenu,
  menuFolder,
  missingAgents,
  onOpenServer,
}: {
  profiles: Profile[]
  home: string
  /** The profile open in the inspector, which highlights its card. */
  editing: string | 'new' | null
  slip: Slip | null
  dropTarget: DropTarget
  onEdit: (id: string | 'new') => void
  onContextMenu: (profile: Profile, folder: string | null, event: MouseEvent) => void
  /** A folder row's "…" button: the folder (absolute) and the button, which the menu hangs from. */
  onFolderMenu: (folder: string, anchor: HTMLElement) => void
  /** The folder whose menu is open, if any: its button stays in view while it is. */
  menuFolder: string | null
  /** The offered agents a new terminal doesn't find on its PATH; a card's line for one says so. */
  missingAgents: string[]
  /** A server name in a card's footer opens that server in the Servers view. */
  onOpenServer: (name: string) => void
}) {
  const colors = profileColors(profiles.map((p) => p.id))
  return (
    // Side padding plus the scroller's gutter on each side (App.tsx) makes the 16px window gutter, so the grid lines up with the banner.
    // The arrow keys also move between the cards (each card's name, then New Profile); every one of them stays in the Tab order.
    // biome-ignore lint/a11y/noStaticElementInteractions: an extra route between buttons that Tab reaches anyway
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 px-[5px] pt-3 pb-4" onKeyDown={onGridKeyDown}>
      {profiles.map((profile) => (
        <ProfileCard
          key={profile.id}
          profile={profile}
          color={colors.get(profile.id) ?? ''}
          colors={colors}
          profiles={profiles}
          home={home}
          slip={slip?.profileId === profile.id ? slip : null}
          selected={editing === profile.id}
          targeted={dropTarget?.profileId === profile.id}
          onEdit={() => onEdit(profile.id)}
          onContextMenu={(folder, event) => onContextMenu(profile, folder, event)}
          onFolderMenu={onFolderMenu}
          menuFolder={menuFolder}
          missingAgents={missingAgents}
          onOpenServer={onOpenServer}
        />
      ))}
      <NewProfileCard first={profiles.length === 0} selected={editing === 'new'} onNew={() => onEdit('new')} />
      <EverywhereElse slip={slip && slip.profileId === null ? slip : null} home={home} targeted={dropTarget?.profileId === null} />
    </div>
  )
}

function ProfileCard({
  profile,
  color,
  colors,
  profiles,
  home,
  slip,
  selected,
  targeted,
  onEdit,
  onContextMenu,
  onFolderMenu,
  menuFolder,
  missingAgents,
  onOpenServer,
}: {
  profile: Profile
  color: string
  colors: Map<string, string>
  profiles: Profile[]
  home: string
  slip: Slip | null
  selected: boolean
  targeted: boolean
  onEdit: () => void
  onContextMenu: (folder: string | null, event: MouseEvent) => void
  onFolderMenu: (folder: string, anchor: HTMLElement) => void
  menuFolder: string | null
  missingAgents: string[]
  onOpenServer: (name: string) => void
}) {
  // Other profiles' triggers inside each of this profile's triggers.
  const carveOuts = (raw: string) => {
    const base = triggerBase(raw, home)
    return profiles.flatMap((other) =>
      other.id === profile.id
        ? []
        : other.triggerPaths
            .map((t) => triggerBase(t, home))
            .filter((b) => isInside(b, base))
            .map((b) => ({
              profile: other,
              color: colors.get(other.id) ?? '',
              base: b,
              rel: base === '/' ? b.slice(1) : b.slice(base.length + 1),
            })),
    )
  }

  const servers = Object.keys(profile.mcpServers).sort((a, b) => a.localeCompare(b))
  const [showAllServers, setShowAllServers] = useState(false)
  // Expanding "+N" moves focus to the first server it revealed, so the keyboard lands on the new links.
  const firstRevealed = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (showAllServers) firstRevealed.current?.focus()
  }, [showAllServers])

  return (
    <section
      aria-label={`Profile ${profile.name}`}
      data-profile={profile.id}
      data-card
      onContextMenu={(event) => {
        event.preventDefault()
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-folder]')
        onContextMenu(row?.dataset.folder ?? null, event)
      }}
      className={`${CARD} ${targeted ? TARGETED : ''} ${selected ? SELECTED : ''}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the name button and pencil are the keyboard routes */}
      <header
        onDoubleClick={onEdit}
        className="flex items-center gap-2 rounded-t-card py-2.5 pr-2 pl-3.5"
        style={{ background: `color-mix(in srgb, ${color} var(--er-wash), transparent)` }}
      >
        <ProfileDot color={color} />
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">
          <button type="button" data-card-target onClick={onEdit} className="max-w-full truncate text-left">
            {profile.name}
          </button>
        </h2>
        {selected ? (
          <span className="inline-flex h-[26px] items-center pr-1.5 text-small font-medium text-accent-ink">Editing</span>
        ) : (
          <IconButton label={`Edit ${profile.name}`} onClick={onEdit}>
            <PencilIcon />
          </IconButton>
        )}
      </header>

      <ul className="flex-1 space-y-0.5 px-2 pb-2">
        {slip && !profile.triggerPaths.some((raw) => triggerBase(raw, home) === slip.trigger) && <SlipRow slip={slip} home={home} />}
        {profile.triggerPaths.length === 0 && !slip && <li className="px-1.5 py-1 text-small text-ink-2 italic">No folders yet.</li>}
        {profile.triggerPaths.map((raw) => (
          <li key={raw} data-folder={triggerBase(raw, home)}>
            <FolderRow
              display={tildify(triggerBase(raw, home), home)}
              menuOpen={menuFolder === triggerBase(raw, home)}
              onMenu={(anchor) => onFolderMenu(triggerBase(raw, home), anchor)}
            />
            {slip && slip.trigger === triggerBase(raw, home) && (
              <ul className="my-0.5 ml-[13px] pl-2 hair-l">
                <SlipRow slip={slip} home={home} />
              </ul>
            )}
            {carveOuts(raw).map((c) => (
              <div key={c.base} data-folder={c.base} className="ml-[13px] flex items-center gap-1.5 py-0.5 pl-2.5 text-small text-ink-2 hair-l">
                <BranchIcon />
                <span className="min-w-0 truncate font-mono">{c.rel}</span>
                <span className="ml-auto flex max-w-[50%] shrink-0 items-center gap-1 pr-1.5" title={c.profile.name}>
                  <ProfileDot color={c.color} size={2} />
                  <span className="min-w-0 truncate">{c.profile.name}</span>
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <footer className="px-3.5 py-2 hair-t">
        {/* Above the servers' line it takes the value column, so the two lines start together. */}
        {routedTools(profile).length === 0 && (
          <p className={`text-small text-ink-2 italic ${servers.length > 0 ? 'mb-1 pl-[22px]' : ''}`}>Every agent uses its default config</p>
        )}
        {/* One line per thing the profile hands out: an agent's mark and its config folder, then the plug and its MCP servers. */}
        <dl className="grid grid-cols-[14px_minmax(0,1fr)] items-center gap-x-2 gap-y-1 text-small">
          {routedTools(profile).map(([command, path]) => {
            const missing = missingAgents.includes(command)
            return (
              <div key={command} className="contents" title={`${toolLabel(command)} uses ${tildify(path, home)}${missing ? ' (not installed)' : ''}`}>
                <dt className="text-ink-2">
                  <AgentMark command={command} />
                  <span className="sr-only">{toolLabel(command)}</span>
                </dt>
                {missing ? (
                  <dd className="flex min-w-0 items-baseline gap-1.5">
                    <span className="min-w-0 truncate font-mono text-ink select-text">{tildify(path, home)}</span>
                    <span className="shrink-0 text-caption text-ink-2 italic">Not installed</span>
                  </dd>
                ) : (
                  <dd className="truncate font-mono text-ink select-text">{tildify(path, home)}</dd>
                )}
              </div>
            )
          })}
          {servers.length > 0 && (
            <div className="contents" title={`MCP servers: ${servers.join(', ')}`}>
              <dt className="text-ink-2">
                <PlugIcon />
                <span className="sr-only">MCP servers</span>
              </dt>
              {/* Each name opens its server; past three, "+N" shows the rest in place. */}
              <dd className={`font-mono text-ink ${showAllServers ? '' : 'truncate'}`}>
                {(servers.length > 3 && !showAllServers ? servers.slice(0, 2) : servers).map((name, i) => (
                  <span key={name}>
                    {i > 0 && ', '}
                    <button
                      ref={showAllServers && i === 2 ? firstRevealed : undefined}
                      type="button"
                      onClick={() => onOpenServer(name)}
                      title={`Open ${name} in Servers`}
                      className="rounded-[3px] underline decoration-[color-mix(in_srgb,var(--er-ink)_28%,transparent)] underline-offset-[3px] hover:text-accent-ink hover:decoration-current"
                    >
                      {name}
                    </button>
                  </span>
                ))}
                {servers.length > 3 && !showAllServers && (
                  <>
                    {' '}
                    <button
                      type="button"
                      aria-expanded={false}
                      aria-label={`+${servers.length - 2} more servers`}
                      onClick={() => setShowAllServers(true)}
                      title={servers.slice(2).join(', ')}
                      className="rounded-[3px] text-ink-2 underline decoration-[color-mix(in_srgb,var(--er-ink)_28%,transparent)] underline-offset-[3px] hover:text-accent-ink hover:decoration-current"
                    >
                      +{servers.length - 2}
                    </button>
                  </>
                )}
              </dd>
            </div>
          )}
        </dl>
      </footer>
    </section>
  )
}

function NewProfileCard({ first, selected, onNew }: { first: boolean; selected: boolean; onNew: () => void }) {
  const platform = usePlatform()
  return (
    <button
      type="button"
      id="new-profile"
      data-card
      data-card-target
      disabled={selected}
      onClick={onNew}
      className={`group flex min-h-[176px] flex-col items-center justify-center gap-2 rounded-card text-ink-2 shadow-[inset_0_0_0_1.5px_var(--er-rule)] transition-[opacity,background-color,color] duration-150 hover:bg-card hover:text-accent-ink disabled:pointer-events-none ${
        selected ? 'bg-tint text-accent-ink shadow-[inset_0_0_0_2px_var(--er-accent-ink)]' : ''
      }`}
    >
      <span className="grid size-9 place-items-center rounded-full bg-card shadow-card group-hover:text-accent-ink">
        <PlusIcon />
      </span>
      <span className="font-medium">{first ? 'Create your first profile' : 'New Profile'}</span>
      <kbd className="font-sans text-caption text-ink-2">{shortcutLabel('n', platform)}</kbd>
    </button>
  )
}

function EverywhereElse({ slip, home, targeted }: { slip: Slip | null; home: string; targeted: boolean }) {
  return (
    <section aria-label="Everywhere else" className={`${FRAME} bg-card-muted shadow-[inset_0_0_0_1px_var(--er-rule)] ${targeted ? TARGETED : ''}`}>
      <header className="flex items-center gap-2 py-2.5 pr-2 pl-3.5">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--er-ink-3)]" />
        <h2 className="min-h-[26px] flex-1 content-center text-title font-semibold text-ink-2">Everywhere else</h2>
      </header>
      <ul className="flex-1 space-y-0.5 px-2 pb-2">
        {slip ? <SlipRow slip={slip} home={home} /> : <li className="px-1.5 py-1 text-small text-ink-2 italic">Folders no profile owns.</li>}
      </ul>
      <footer className="px-3.5 py-2 hair-t">
        <p className="text-small text-ink-2 italic">Every agent uses its default config</p>
      </footer>
    </section>
  )
}

function FolderRow({ display, menuOpen, onMenu }: { display: string; menuOpen: boolean; onMenu: (anchor: HTMLElement) => void }) {
  const { parent, leaf } = splitLeaf(display)
  return (
    // No padding at the right: the button's edge lines up with the header's pencil, 8px in from the card.
    <div className="group/row flex items-center gap-2 rounded-[6px] py-1 pl-1.5 text-ink-2" title={display}>
      <FolderIcon />
      <p className="min-w-0 flex-1 truncate font-mono text-small select-text">
        <span>{parent}</span>
        <span className="text-ink">{leaf}</span>
      </p>
      {/* The right-click menu for the keyboard. Quiet until the row is hovered or the button focused, and held in view, pressed, while
          its menu is open (the pointer is on the menu then, not the row); the negative margin keeps its 26px box inside the row's 16px
          of content (24 with the padding), so a row doesn't grow. */}
      <IconButton
        label={`Actions for ${display}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="-my-[5px] opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        onClick={(event) => onMenu(event.currentTarget)}
      >
        <MoreIcon />
      </IconButton>
    </div>
  )
}

/** The checked folder, travelling from where it was dropped into its card. */
function SlipRow({ slip, home }: { slip: Slip; home: string }) {
  const ref = useRef<HTMLLIElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: replay only for a new slip
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' })
    if (!slip.origin || still) return
    const box = el.getBoundingClientRect()
    el.animate(
      [
        { transform: `translate(${slip.origin.x - box.left - 24}px, ${slip.origin.y - box.top - box.height / 2}px) scale(0.94)`, opacity: 0.7 },
        { transform: 'none', opacity: 1 },
      ],
      { duration: 300, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
  }, [slip.key])

  const display = tildify(slip.folder, home)
  const { parent, leaf } = splitLeaf(display)
  return (
    <li
      ref={ref}
      data-folder={slip.folder}
      className="relative z-10 flex items-center gap-2 rounded-[6px] bg-tint px-1.5 py-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--er-accent-ink)_40%,transparent)]"
    >
      <Mark
        key={slip.mark}
        kind={slip.mark}
        className={`${slip.mark === 'on' ? 'text-accent-ink' : 'text-ink-2'} animate-[er-stamp_180ms_var(--ease-settle)]`}
      />
      {/* The parent gives way first, so a long path still shows the folder's own name. */}
      <span className="flex min-w-0 font-mono text-small select-text" title={display}>
        <span className="min-w-0 truncate text-ink-2">{parent}</span>
        <span className="shrink-0">{leaf}</span>
      </span>
    </li>
  )
}
