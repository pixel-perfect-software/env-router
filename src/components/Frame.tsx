// The profiles: one card per profile, holding the folders it owns. A folder handed to a deeper
// profile shows as a carve-out inside its parent, marked with the owning profile's colour, so
// "the most specific folder wins" is something you can see, not something you're told.

import { type MouseEvent, useLayoutEffect, useRef } from 'react'
import { isInside, splitLeaf, tildify, triggerBase } from '../lib/paths'
import { KNOWN_TOOLS, toolLabel } from '../lib/tools'
import type { Profile } from '../lib/types'
import { BranchIcon, FolderIcon, IconButton, Mark, type MarkKind, PencilIcon, PlusIcon, ProfileDot, profileColors } from './ui'

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

const CARD = 'flex min-h-[176px] flex-col rounded-card bg-card shadow-card transition-[opacity,box-shadow,background-color] duration-150'
// Outlines, not shadows: they can't be overridden by the card's own shadow utility.
const TARGETED = 'bg-tint outline-2 outline-offset-2 outline-accent'
const SELECTED = 'outline-2 outline-offset-2 outline-accent'

export function Frame({
  profiles,
  home,
  editing,
  slip,
  dropTarget,
  onEdit,
  onContextMenu,
}: {
  profiles: Profile[]
  home: string
  /** The profile open in the inspector, which highlights its card. */
  editing: string | 'new' | null
  slip: Slip | null
  dropTarget: DropTarget
  onEdit: (id: string | 'new') => void
  onContextMenu: (profile: Profile, folder: string | null, event: MouseEvent) => void
}) {
  const colors = profileColors(profiles.map((p) => p.id))
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 px-4 pt-3 pb-4">
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

  return (
    <section
      aria-label={`Profile ${profile.name}`}
      onContextMenu={(event) => {
        event.preventDefault()
        const row = (event.target as HTMLElement).closest<HTMLElement>('[data-folder]')
        onContextMenu(row?.dataset.folder ?? null, event)
      }}
      className={`${CARD} ${targeted ? TARGETED : ''} ${selected ? SELECTED : ''}`}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the name button and pencil are the keyboard routes */}
      <header onDoubleClick={onEdit} className="flex items-center gap-2 py-2.5 pr-2 pl-3.5">
        <ProfileDot color={color} />
        <h2 className="min-w-0 flex-1 truncate text-title font-semibold">
          <button type="button" onClick={onEdit} className="max-w-full truncate text-left">
            {profile.name}
          </button>
        </h2>
        {selected ? (
          <span className="pr-1.5 text-small font-medium text-accent">Editing</span>
        ) : (
          <IconButton label={`Edit ${profile.name}`} onClick={onEdit}>
            <PencilIcon />
          </IconButton>
        )}
      </header>

      <ul className="flex-1 space-y-0.5 px-2 pb-2">
        {slip && !profile.triggerPaths.some((raw) => triggerBase(raw, home) === slip.trigger) && <SlipRow slip={slip} home={home} />}
        {profile.triggerPaths.length === 0 && !slip && <li className="px-1.5 py-1 text-small text-ink-2">No folders yet.</li>}
        {profile.triggerPaths.map((raw) => (
          <li key={raw} data-folder={triggerBase(raw, home)}>
            <FolderRow display={tildify(triggerBase(raw, home), home)} />
            {slip && slip.trigger === triggerBase(raw, home) && (
              <ul className="my-0.5 ml-[13px] pl-2 hair-l">
                <SlipRow slip={slip} home={home} />
              </ul>
            )}
            {carveOuts(raw).map((c) => (
              <div key={c.base} data-folder={c.base} className="ml-[13px] flex items-center gap-1.5 py-0.5 pl-2.5 text-small text-ink-2 hair-l">
                <BranchIcon />
                <span className="min-w-0 truncate font-mono">{c.rel}</span>
                <span className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">
                  <ProfileDot color={c.color} className="size-2" />
                  {c.profile.name}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>

      <footer className="flex flex-col gap-0.5 px-3.5 py-2 hair-t">
        {routedTools(profile).length === 0 ? (
          <p className="text-small text-ink-2 italic">Every agent uses its default config</p>
        ) : (
          routedTools(profile).map(([command, path]) => (
            <p key={command} className="flex min-w-0 items-baseline gap-2 text-small">
              <span className="shrink-0 text-ink-2">{toolLabel(command)}</span>
              <code className="min-w-0 truncate font-mono text-ink select-text">{tildify(path, home)}</code>
            </p>
          ))
        )}
      </footer>
    </section>
  )
}

function NewProfileCard({ first, selected, onNew }: { first: boolean; selected: boolean; onNew: () => void }) {
  return (
    <button
      type="button"
      disabled={selected}
      onClick={onNew}
      className={`group flex min-h-[176px] flex-col items-center justify-center gap-2 rounded-card text-ink-2 shadow-[inset_0_0_0_1.5px_var(--er-rule)] transition-[opacity,background-color,color] duration-150 hover:bg-card hover:text-accent disabled:pointer-events-none ${
        selected ? 'bg-tint text-accent shadow-[inset_0_0_0_2px_var(--er-accent)]' : ''
      }`}
    >
      <span className="grid size-9 place-items-center rounded-full bg-card shadow-card group-hover:text-accent">
        <PlusIcon />
      </span>
      <span className="font-medium">{first ? 'Create your first profile' : 'New Profile'}</span>
      <kbd className="font-sans text-caption text-ink-2">⌘N</kbd>
    </button>
  )
}

function EverywhereElse({ slip, home, targeted }: { slip: Slip | null; home: string; targeted: boolean }) {
  return (
    <section aria-label="Everywhere else" className={`${CARD} bg-card-muted shadow-[inset_0_0_0_1px_var(--er-rule)] ${targeted ? TARGETED : ''}`}>
      <header className="flex items-center gap-2 py-2.5 pr-2 pl-3.5">
        <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full shadow-[inset_0_0_0_1.5px_var(--er-ink-3)]" />
        <h2 className="min-h-[26px] flex-1 content-center text-title font-semibold text-ink-2">Everywhere else</h2>
      </header>
      <ul className="flex-1 space-y-0.5 px-2 pb-2">
        {slip ? <SlipRow slip={slip} home={home} /> : <li className="px-1.5 py-1 text-small text-ink-2">Folders no profile owns.</li>}
      </ul>
      <footer className="px-3.5 py-2 hair-t">
        <p className="text-small text-ink-2 italic">Every agent uses its default config</p>
      </footer>
    </section>
  )
}

function FolderRow({ display }: { display: string }) {
  const { parent, leaf } = splitLeaf(display)
  return (
    <p className="flex items-center gap-2 rounded-[6px] px-1.5 py-1 text-ink-2" title={display}>
      <FolderIcon />
      <span className="min-w-0 truncate font-mono text-small select-text">
        <span>{parent}</span>
        <span className="text-ink">{leaf}</span>
      </span>
    </p>
  )
}

/** The checked folder, travelling from where it was dropped into its card. */
function SlipRow({ slip, home }: { slip: Slip; home: string }) {
  const ref = useRef<HTMLLIElement>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: replay only for a new slip
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    if (!slip.origin || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
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
      className="relative z-10 flex items-center gap-2 rounded-[6px] bg-tint px-1.5 py-1 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--er-accent)_40%,transparent)]"
    >
      <Mark
        key={slip.mark}
        kind={slip.mark}
        className={`${slip.mark === 'on' ? 'text-accent' : 'text-ink-2'} animate-[er-stamp_180ms_var(--ease-settle)]`}
      />
      <span className="min-w-0 truncate font-mono text-small select-text" title={display}>
        <span className="text-ink-2">{parent}</span>
        {leaf}
      </span>
    </li>
  )
}
