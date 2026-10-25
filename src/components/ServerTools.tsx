// The Tools section of the server editor: Check Server, its status, and the tool list.

import { useEffect, useRef, useState } from 'react'
import { checkMcpServer, errorMessage } from '../lib/api'
import { type ProfileChip, type ServerDraft, serverOf } from '../lib/mcp'
import { usePlatform } from '../lib/platform'
import { plural } from '../lib/text'
import type { ServerCheck, ToolInfo } from '../lib/types'
import { CheckIcon } from './icons'
import { Button, ChevronIcon, ProfileDot, StatusTile, type Tone } from './ui'

const CHECK_TONE: Record<ServerCheck['status'], Tone> = {
  ok: 'ok',
  needsLogin: 'warn',
  failed: 'problem',
  timedOut: 'problem',
  unsupported: 'neutral',
}

/** A click on a server list row's Check Server, handed to that server's editor. Each click is a new object, taken once (`CheckSection`). */
export interface CheckRequest {
  readonly name: string
}

/**
 * Check Server: starts the server as the form describes it, unsaved edits and typed secrets
 * included, and shows what it offers or why it didn't answer. Editing the form clears the result.
 */
export function CheckSection({
  name,
  draft,
  cached,
  toolsOff,
  request,
  onRequestTaken,
}: {
  name: string
  draft: ServerDraft
  /** The tools from the last check that worked, kept between sessions; absent until one has. */
  cached: ToolInfo[] | undefined
  /** Per tool, the profiles that turn it off, so the list says where each one is off. */
  toolsOff: Record<string, ProfileChip[]>
  /** The server list's Check Server, for this server: starts a check as the form stands, unless one is already running. */
  request: CheckRequest | null
  /** Called as the request is taken, so it is asked for once and a remounted editor can't replay it: a check runs only on a click. */
  onRequestTaken: () => void
}) {
  const { canLock } = usePlatform()
  const [state, setState] = useState<{ key: string; result: ServerCheck | 'running' | { error: string } } | null>(null)
  const key = JSON.stringify(draft)
  const current = state?.key === key ? state.result : null
  const section = useRef<HTMLElement>(null)
  // An answer can land below the editor's fold; bring it into view once it has rendered.
  const reveal = () => requestAnimationFrame(() => section.current?.scrollIntoView({ block: 'nearest' }))

  const run = async () => {
    const built = serverOf(draft, canLock)
    if ('error' in built) {
      setState({ key, result: { error: built.error } })
      reveal()
      return
    }
    setState({ key, result: 'running' })
    try {
      const result = await checkMcpServer(name, built.server, built.secrets)
      setState((s) => (s?.key === key ? { key, result } : s))
    } catch (err) {
      setState((s) => (s?.key === key ? { key, result: { error: errorMessage(err) } } : s))
    }
    reveal()
  }

  const running = current === 'running'
  const taken = useRef<CheckRequest | null>(null)
  useEffect(() => {
    if (!request || request === taken.current) return
    taken.current = request
    onRequestTaken()
    if (!running) void run()
  })
  const result = current && current !== 'running' && 'status' in current ? current : null
  const problem = current && current !== 'running' && 'error' in current ? current.error : null
  // A fresh answer wins; otherwise the last good check's list, said to be from then.
  const fromCache = !current && cached !== undefined
  const tools = result?.status === 'ok' ? result.tools : fromCache ? cached : null
  const tone: Tone = running ? 'pending' : result ? CHECK_TONE[result.status] : problem ? 'problem' : fromCache ? 'ok' : 'neutral'
  // A short list starts open; a long one folds away until asked for. The user's choice holds.
  const [open, setOpen] = useState<boolean | null>(null)
  const listOpen = open ?? (tools?.length ?? 0) <= 8
  const headline = running
    ? 'Starting the server…'
    : result?.status === 'ok'
      ? plural(result.tools.length, 'tool', 'tools')
      : result?.status === 'needsLogin'
        ? 'Needs a sign-in'
        : result?.status === 'unsupported'
          ? 'Not checked'
          : result
            ? "Didn't answer"
            : problem
              ? "Can't check yet"
              : fromCache
                ? plural(cached.length, 'tool', 'tools')
                : null

  return (
    <section ref={section} aria-label="Tools">
      <h3 className="mb-1.5 text-small font-medium text-ink-2">Tools</h3>
      <div className="flex items-center gap-2.5">
        {/* When a check answers, the headline ("9 tools", "Didn't answer") and the reason under it are announced; the list is there to be
            explored, not read out again at every check. Both regions exist before their text changes, so the change is what's spoken. */}
        <div role="status" className="flex min-w-0 flex-1 items-center gap-2.5">
          {headline ? (
            <>
              <StatusTile tone={tone} size={28} />
              <p className="min-w-0 flex-1 truncate">
                <span className="font-medium">{headline}</span>
                {fromCache && <span className="ml-2 text-small text-ink-2">from the last check</span>}
              </p>
            </>
          ) : (
            <p className="min-w-0 flex-1 text-small text-ink-2 italic">Not checked yet</p>
          )}
        </div>
        <Button onClick={run} busy={running}>
          <CheckIcon />
          {result || problem || fromCache ? 'Check Again' : 'Check Server'}
        </Button>
      </div>
      <p role="status" className="mt-1.5 text-small text-ink-2 select-text empty:hidden">
        {result?.message ?? problem}
      </p>
      {result?.log && (
        <pre className="mt-2 max-h-[120px] overflow-auto rounded-control bg-well px-2 py-1.5 font-mono text-caption whitespace-pre-wrap text-ink-2 select-text">
          {result.log}
        </pre>
      )}
      {tools && tools.length > 0 && (
        <button
          type="button"
          aria-expanded={listOpen}
          aria-controls="server-tools"
          onClick={() => setOpen(!listOpen)}
          className="mt-2 -ml-1 flex min-h-[26px] items-center gap-1 rounded-control px-1 text-small text-ink-2 hover:text-ink"
        >
          <span className={`transition-transform duration-150 ease-settle ${listOpen ? 'rotate-90' : ''}`}>
            <ChevronIcon />
          </span>
          {listOpen ? 'Hide tools' : `Show ${tools.length === 1 ? 'the tool' : `all ${tools.length} tools`}`}
        </button>
      )}
      {tools && tools.length > 0 && listOpen && (
        <ul id="server-tools" className="mt-1 rounded-[8px] bg-well">
          {tools.map((tool) => {
            const off = toolsOff[tool.name] ?? []
            return (
              <li key={tool.name} className="flex min-h-[32px] items-center gap-3 px-3 py-1.5 [&+&]:hair-t">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-small text-ink select-text">{tool.name}</span>
                  {tool.description && (
                    <span className="block truncate text-caption text-ink-2" title={tool.description}>
                      {tool.description}
                    </span>
                  )}
                </span>
                {off.length > 0 && (
                  <span className="flex shrink-0 items-center gap-1 text-caption text-ink-2" title={`Off in ${off.map((p) => p.name).join(', ')}`}>
                    off in
                    {off.map((p) => (
                      <ProfileDot key={p.id} color={p.color} size={2} />
                    ))}
                    <span className="sr-only">{off.map((p) => p.name).join(', ')}</span>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
