// Development only: the TOML a README's Codex snippet uses, for the browser mock's Paste (`parse_mcp_json` reads TOML in the real backend,
// with the `toml` crate). Tables, dotted and quoted keys, strings, numbers, booleans, arrays and inline tables, comments. Not here: dates,
// multi-line strings and arrays of tables, which fail with a message. The real crate words its errors its own way; only the line matches.

type Table = Record<string, unknown>

export class TomlError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(message)
  }
}

const BARE_KEY = /^[A-Za-z0-9_-]+/
const NUMBER = /^[+-]?\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', b: '\b', f: '\f' }

export function parseToml(text: string): Table {
  const root: Table = {}
  let at = 0
  let line = 1
  const fail = (message: string): never => {
    throw new TomlError(message, line)
  }
  const rest = () => text.slice(at)
  const space = () => {
    while (text[at] === ' ' || text[at] === '\t') at++
  }
  /** Spaces and comments and, inside brackets or between entries, newlines. */
  const trivia = (newlines: boolean) => {
    for (;;) {
      space()
      if (text[at] === '#') while (at < text.length && text[at] !== '\n') at++
      if (newlines && (text[at] === '\n' || text[at] === '\r')) {
        if (text[at] === '\n') line++
        at++
      } else return
    }
  }
  const quoted = (): string => {
    const quote = text[at]
    if (rest().startsWith(quote.repeat(3))) return fail('multi-line strings are not supported here')
    at++
    let out = ''
    while (at < text.length && text[at] !== quote) {
      if (text[at] === '\n') fail('strings end on their own line')
      if (quote === '"' && text[at] === '\\') {
        const escaped = ESCAPES[text[at + 1] ?? '']
        if (escaped === undefined) fail('invalid escape')
        out += escaped
        at += 2
      } else out += text[at++]
    }
    if (text[at] !== quote) fail('unterminated string')
    at++
    return out
  }
  const key = (): string[] => {
    const parts: string[] = []
    for (;;) {
      space()
      if (text[at] === '"' || text[at] === "'") parts.push(quoted())
      else {
        const bare = BARE_KEY.exec(rest())?.[0]
        if (!bare) return fail('expected a key')
        parts.push(bare)
        at += bare.length
      }
      space()
      if (text[at] !== '.') return parts
      at++
    }
  }
  const descend = (from: Table, path: string[]): Table => {
    let table = from
    for (const part of path) {
      const next = table[part] ?? {}
      if (typeof next !== 'object' || next === null || Array.isArray(next)) return fail('key is not a table')
      table[part] = next
      table = next as Table
    }
    return table
  }
  /** `key = value` into `table`, creating the tables a dotted key names. */
  const assign = (table: Table, path: string[]) => {
    space()
    if (text[at] !== '=') fail('expected `=`')
    at++
    space()
    const into = descend(table, path.slice(0, -1))
    const last = path[path.length - 1]
    if (last in into) fail('duplicate key')
    into[last] = value()
    space()
  }
  const value = (): unknown => {
    const c = text[at]
    if (c === '"' || c === "'") return quoted()
    if (c === '[') {
      at++
      const items: unknown[] = []
      for (;;) {
        trivia(true)
        if (text[at] === ']') break
        items.push(value())
        trivia(true)
        if (text[at] === ',') at++
        else if (text[at] !== ']') fail('missing comma between array elements')
      }
      at++
      return items
    }
    if (c === '{') {
      at++
      const table: Table = {}
      for (;;) {
        space()
        if (text[at] === '}') break
        assign(table, key())
        if (text[at] === ',') at++
        else if (text[at] !== '}') fail('missing comma between inline table entries')
      }
      at++
      return table
    }
    for (const word of ['true', 'false']) {
      if (rest().startsWith(word)) {
        at += word.length
        return word === 'true'
      }
    }
    const number = NUMBER.exec(rest())?.[0]
    if (!number) return fail('invalid value')
    at += number.length
    return Number(number.replace(/_/g, ''))
  }

  let current = root
  for (;;) {
    trivia(true)
    if (at >= text.length) return root
    if (text[at] === '[') {
      if (text[at + 1] === '[') fail('arrays of tables are not supported here')
      at++
      const path = key()
      if (text[at] !== ']') fail('unclosed table, expected `]`')
      at++
      current = descend(root, path)
    } else assign(current, key())
    trivia(false)
    if (at < text.length && text[at] !== '\n' && text[at] !== '\r') fail('expected a newline')
  }
}
