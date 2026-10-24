// Under an `npx` server's arguments: which release it runs, with a way to pin it or look for a newer one.

import { useEffect, useRef, useState } from 'react'
import { errorMessage, npmDistTags } from '../lib/api'
import type { DraftValue } from '../lib/mcp'
import { newerRelease, npxPackage, pinnedArg, pinnedVersion, pinTarget } from '../lib/npm'
import { Caution } from './ServerFields'
import { Button } from './ui'

/**
 * Under the arguments of an `npx` server: which release it runs. Unpinned, a caution with Pin
 * Version; pinned, the version and a way to look for a newer one. Both ask the user's own npm
 * (`npm view`), and only when clicked, or on opening a server picked from the catalog.
 */
export function VersionRow({
  command,
  args,
  pinOnOpen,
  onPin,
}: {
  command: string
  args: DraftValue[]
  pinOnOpen: boolean
  onPin: (index: number, from: string, to: string) => void
}) {
  const pkg = npxPackage(command, args)
  // The last lookup, for the package it was about.
  const [lookup, setLookup] = useState<{ name: string; result: 'looking' | { tags: Record<string, string> } | { error: string } } | null>(null)
  const current = pkg && lookup?.name === pkg.name ? lookup.result : null
  const tags = current && current !== 'looking' && 'tags' in current ? current.tags : null
  const problem = current && current !== 'looking' && 'error' in current ? current.error : null

  const look = async (pin: boolean) => {
    if (!pkg) return
    const { name } = pkg
    setLookup({ name, result: 'looking' })
    try {
      const found = await npmDistTags(command.trim(), name)
      setLookup((l) => (l?.name === name ? { name, result: { tags: found } } : l))
      const target = pinTarget(pkg, found)
      if (pin && target) onPin(pkg.index, args[pkg.index] as string, pinnedArg(pkg, target))
    } catch (err) {
      setLookup((l) => (l?.name === name ? { name, result: { error: errorMessage(err) } } : l))
    }
  }

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    if (pinOnOpen && pkg && pinnedVersion(pkg) === null) look(true)
  })

  if (!pkg) return null
  const pinned = pinnedVersion(pkg)
  const looking = current === 'looking'
  if (pinned === null) {
    return (
      <Caution
        action={
          <Button onClick={() => look(true)} busy={looking}>
            {looking ? 'Looking Up…' : 'Pin Version'}
          </Button>
        }
      >
        {problem ?? (
          <>
            Not pinned: a new release of <span className="font-mono">{pkg.name}</span> runs in every session the day it's out.
          </>
        )}
      </Caution>
    )
  }
  const update = tags ? newerRelease(pinned, tags) : null
  return (
    <div className="-mt-3 flex min-h-[26px] items-center gap-2" aria-live="polite">
      <p className="min-w-0 flex-1 text-small text-ink-2">
        Pinned to <span className="font-mono text-ink">{pinned}</span>
        {problem ? (
          `. ${problem}`
        ) : update ? (
          <>
            . <span className="font-mono text-ink">{update}</span> is out.
          </>
        ) : tags ? (
          ', the newest release.'
        ) : (
          '.'
        )}
      </p>
      {update ? (
        <Button onClick={() => onPin(pkg.index, args[pkg.index] as string, pinnedArg(pkg, update))}>Update to {update}</Button>
      ) : (
        !tags && (
          <Button kind="plain" onClick={() => look(false)} busy={looking}>
            {looking ? 'Looking Up…' : 'Check for Update'}
          </Button>
        )
      )}
    </div>
  )
}
