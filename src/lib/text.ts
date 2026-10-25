// Small helpers for words in the window's copy.

/** `1 tool`, `2 tools`: a count with its noun. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** The words of a search query, lower-cased: split once per render, then matched against each candidate with `matchesWords`. */
export const queryWords = (query: string) => query.toLowerCase().split(/\s+/).filter(Boolean)

/** Whether `text` holds every one of `words` (from `queryWords`), whatever the case. No words match everything. */
export const matchesWords = (text: string, words: string[]) => {
  const lower = text.toLowerCase()
  return words.every((word) => lower.includes(word))
}

/** `a`, `a and b`, `a, b and c`. */
export const listOf = (items: string[]) => (items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`)
