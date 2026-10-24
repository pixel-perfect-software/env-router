// Small helpers for words in the window's copy.

/** `1 tool`, `2 tools`: a count with its noun. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** `a`, `a and b`, `a, b and c`. */
export const listOf = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
