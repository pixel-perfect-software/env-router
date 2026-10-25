// @ts-expect-error type error without @types/node package, as in vite.config.ts; this file runs in node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROFILE_FILL, profileColors } from './ui'

// An id's preferred colour is its hash mod 8. `a` and `i` hash to the same one, and so do `aa`, `bb`, `cc` and the other doubled letters.
describe('profileColors', () => {
  it('keeps a profile its colour while profiles that do not share its preference come and go', () => {
    const alone = profileColors(['a']).get('a')
    expect(profileColors(['b', 'a', 'c']).get('a')).toBe(alone)
    expect(profileColors(['a', 'c']).get('a')).toBe(alone)
  })

  it('moves a profile off its preferred colour only when an earlier one holds it', () => {
    const preferred = profileColors(['a']).get('a')
    const both = profileColors(['a', 'i'])
    expect(both.get('a')).toBe(preferred)
    expect(both.get('i')).not.toBe(preferred)
    expect(profileColors(['i', 'a']).get('i')).toBe(preferred)
  })

  it('gives eight profiles eight colours even when all prefer one, and a ninth still gets one', () => {
    const ids = ['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh', 'ii']
    const colors = profileColors(ids)
    const eight = new Set(ids.slice(0, 8).map((id) => colors.get(id)))
    expect(eight.size).toBe(8)
    expect(eight.has(colors.get('ii'))).toBe(true)
  })
})

type Rgb = [number, number, number]
const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as Rgb
/** `amount` of `over` on `under`, as `color-mix(in srgb, …)` mixes. */
const mixed = (over: Rgb, under: Rgb, amount: number): Rgb => over.map((v, i) => v * amount + under[i] * (1 - amount)) as Rgb
/** WCAG's contrast ratio of two colours. */
const contrast = (a: Rgb, b: Rgb) => {
  const luminance = ([r, g, bl]: Rgb) => {
    const [lr, lg, lb] = [r, g, bl].map((c) => c / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
  }
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** `src/index.css`, read as text: vitest loads no CSS (`?raw` comes back empty), but this runs in node, so the file can be read. */
const css: string = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const [lightCss, ...darkParts] = css.split('@media (prefers-color-scheme: dark)')

/**
 * The surfaces a profile colour sits on, read from the tokens in `src/index.css` (the `:root` block for light, the first dark media block
 * for dark), so a changed token is measured: the card, muted card, raised surface and well; the selected server row (`--er-tint`, the
 * fallback accent over the card); the wash behind its dot in a card's header (`--er-wash`, a share of the colour); and a Used by chip's
 * fill, which its ring and dot sit against.
 */
const surfacesOf = (theme: 'light' | 'dark') => {
  const block = theme === 'light' ? lightCss : darkParts.join('')
  const find = (pattern: RegExp, what: string) => {
    const found = block.match(pattern)?.[1]
    if (found === undefined) throw new Error(`${what} isn't in the ${theme} tokens of src/index.css (looked for ${pattern})`)
    return found
  }
  const colour = (name: string) => rgbOf(find(new RegExp(`--er-${name}: (#[0-9a-f]{6});`), `--er-${name}`))
  const card = colour('card')
  return {
    card,
    'muted card': colour('card-muted'),
    raised: colour('raised'),
    well: colour('well'),
    'selected row': mixed(
      colour('accent'),
      card,
      Number(find(/--er-tint: color-mix\(in srgb, var\(--er-accent\) (\d+)%, var\(--er-card\)\);/, '--er-tint')) / 100,
    ),
    'header wash': (color: Rgb) => mixed(color, card, Number(find(/--er-wash: (\d+)%;/, '--er-wash')) / 100),
    'chip fill': (color: Rgb) => mixed(color, card, PROFILE_FILL / 100),
  }
}

describe('the profile colours', () => {
  it('hold 3:1 on every surface they sit on, in light and in dark, since a dot or a ring says which profile (WCAG 1.4.11)', () => {
    const colors = [...profileColors(['aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg', 'hh']).values()]
    expect(new Set(colors).size).toBe(8)
    for (const theme of ['light', 'dark'] as const) {
      for (const [surface, under] of Object.entries(surfacesOf(theme))) {
        for (const color of colors) {
          const behind = typeof under === 'function' ? under(rgbOf(color)) : under
          expect(contrast(rgbOf(color), behind), `${color} on the ${theme} ${surface}`).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })
})

describe('the selected states', () => {
  /** A `#rrggbb` token's value in one theme's tokens. */
  const hexToken = (theme: 'light' | 'dark', name: string) => {
    const found = (theme === 'light' ? lightCss : darkParts.join('')).match(new RegExp(`--er-${name}: (#[0-9a-f]{6});`))?.[1]
    if (found === undefined) throw new Error(`--er-${name} isn't in the ${theme} tokens of src/index.css`)
    return rgbOf(found)
  }
  /** The segmented track, `rgb(r g b / a)` over a surface: what a chosen segment's ring sits against. */
  const trackOn = (theme: 'light' | 'dark', surface: Rgb) => {
    const found = (theme === 'light' ? lightCss : darkParts.join('')).match(/--er-track: rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\);/)
    if (!found) throw new Error(`--er-track isn't in the ${theme} tokens of src/index.css`)
    return mixed([Number(found[1]), Number(found[2]), Number(found[3])], surface, Number(found[4]))
  }

  it("rings a chosen segment at 3:1 against its track on every surface a segmented control sits on, and against the segment's own fill (WCAG 1.4.11)", () => {
    for (const theme of ['light', 'dark'] as const) {
      const edge = hexToken(theme, 'select-edge')
      expect(contrast(edge, hexToken(theme, 'button')), `the ${theme} ring on the segment`).toBeGreaterThanOrEqual(3)
      // The titlebar's ground, the editor and catalog's card, and the docket's raised result.
      for (const surface of ['window', 'card', 'raised']) {
        expect(contrast(edge, trackOn(theme, hexToken(theme, surface))), `the ${theme} ring on the track over the ${surface}`).toBeGreaterThanOrEqual(
          3,
        )
      }
    }
  })

  it('marks the chosen server row with a bar of accent ink at 3:1 against the row and the card around it', () => {
    for (const theme of ['light', 'dark'] as const) {
      const { card, 'selected row': row } = surfacesOf(theme)
      const ink = hexToken(theme, 'accent-ink')
      expect(contrast(ink, card), `the ${theme} bar on the card`).toBeGreaterThanOrEqual(3)
      expect(contrast(ink, row as Rgb), `the ${theme} bar on the selected row`).toBeGreaterThanOrEqual(3)
    }
  })
})
