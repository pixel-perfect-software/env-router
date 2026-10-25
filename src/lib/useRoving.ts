// Arrow keys through lists of controls. A list of real one-stop lists (the server list, the catalog) uses a roving tab stop: one item is in
// the Tab order, the arrows move it, and Tab leaves the list instead of walking every row. Each item is a real button that takes real focus,
// so its ring, Enter and Space, and the context-menu key work on it as they do alone. The card grid is different: its cards hold controls of
// their own, so every card's name stays in the natural Tab order and the arrows are one more way to move between cards (`onGridKeyDown`).

import { type FocusEvent, type KeyboardEvent, type MouseEvent, useState } from 'react'

/** Where an item sits, as `getBoundingClientRect` says: all a grid needs to find the item above or below. */
interface Spot {
  left: number
  top: number
}

/**
 * The item a key moves to from item `from` of `count`, or null when the key moves nothing. Home and End go to the ends and the arrows stop
 * there, not wrap. A list moves with Up and Down. A grid (`spots` says where each item is, asked only when Up or Down needs it) also moves
 * with Left and Right through the items in order, and with Up and Down to the nearest item in the row above or below.
 */
export function moveFocus(key: string, from: number, count: number, spots?: () => Spot[]): number | null {
  const last = count - 1
  if (key === 'Home') return 0
  if (key === 'End') return last
  if (key === 'ArrowRight' || key === 'ArrowLeft') {
    if (!spots) return null
    return Math.min(last, Math.max(0, from + (key === 'ArrowRight' ? 1 : -1)))
  }
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null
  const down = key === 'ArrowDown'
  if (!spots) return Math.min(last, Math.max(0, from + (down ? 1 : -1)))
  const all = spots()
  const here = all[from]
  // The next row over is the one whose top is nearest, beyond a pixel of difference; in it, the item nearest across.
  const beyond = all.flatMap((spot, index) => ((down ? spot.top > here.top + 1 : spot.top < here.top - 1) ? [{ spot, index }] : []))
  if (beyond.length === 0) return null
  const row = beyond.reduce((best, c) => (Math.abs(c.spot.top - here.top) < Math.abs(best.spot.top - here.top) ? c : best)).spot.top
  return beyond
    .filter((c) => c.spot.top === row)
    .reduce((best, c) => (Math.abs(c.spot.left - here.left) < Math.abs(best.spot.left - here.left) ? c : best)).index
}

/** Whether a key press carries a modifier, which leaves it to the system or a shortcut. */
const modified = (event: KeyboardEvent) => event.altKey || event.ctrlKey || event.metaKey || event.shiftKey

/**
 * The roving tab stop of a list. Mark each item's group `data-rove-id={id}` (anything inside it that takes focus counts as being on that
 * item) and the one control that is the item's `data-rove` with `tabIndex={rove.tabIndex(id)}`; spread `rove.container` on the list.
 *
 * `ids` are the items in document order; `preferred` is the item the tab stop falls back to when nothing in the list has been used (the
 * selected row). The stop is the item last focused or clicked, so Tab and Shift+Tab move on from where the user was, until that item goes
 * away (a filter hides it, it's deleted), when the stop is `preferred`, else the first.
 */
export function useRoving(ids: readonly string[], preferred: string | null = null) {
  const [last, setLast] = useState<string | null>(null)
  const stop = [last, preferred].find((id) => id !== null && ids.includes(id)) ?? ids[0] ?? null
  const use = (target: EventTarget) => {
    const id = (target as HTMLElement).closest<HTMLElement>('[data-rove-id]')?.dataset.roveId
    // Not for the one it's on already: that would draw the whole list again at every focus and click.
    if (id !== undefined && id !== last) setLast(id)
  }
  return {
    tabIndex: (id: string) => (id === stop ? 0 : -1),
    container: {
      onFocus: (event: FocusEvent<HTMLElement>) => use(event.target),
      // A click that leaves no focus behind (WebKit doesn't focus a clicked button) still moves the stop.
      onClick: (event: MouseEvent<HTMLElement>) => use(event.target),
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
        if (modified(event) || !(event.target as HTMLElement).matches('[data-rove]')) return
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-rove]')).filter((item) => !item.matches(':disabled'))
        const from = items.indexOf(event.target as HTMLElement)
        const to = from < 0 ? null : moveFocus(event.key, from, items.length)
        if (to === null) return
        event.preventDefault()
        items[to].focus()
      },
    },
  }
}

/**
 * Arrow keys between the cards of a grid, for the grid's `onKeyDown`. A card is a `data-card` (its whole box is what Up and Down measure,
 * not the control inside it, which sits lower in a card with a header); its `data-card-target` is what takes focus, the card itself when
 * that is a button. The keys act only from a card's target, and leave every control's Tab order alone.
 */
export function onGridKeyDown(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement
  if (modified(event) || !target.matches('[data-card-target]')) return
  const cards = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[data-card]'))
  const from = cards.indexOf(target.closest<HTMLElement>('[data-card]') as HTMLElement)
  const to = from < 0 ? null : moveFocus(event.key, from, cards.length, () => cards.map((card) => card.getBoundingClientRect()))
  if (to === null) return
  event.preventDefault()
  const card = cards[to]
  ;(card.matches('[data-card-target]') ? card : card.querySelector<HTMLElement>('[data-card-target]'))?.focus()
}
