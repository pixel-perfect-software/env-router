// A server's face: its brand logo on a tile tinted with the brand's colour, or a monogram when
// it has none. Logos tell servers apart at a glance; the tint is the only colour they bring.

import { isNeutralBrand, serverLogo } from '../lib/serverLogo'
import type { McpServer } from '../lib/types'

export function ServerMark({ name, server, size = 28 }: { name: string; server: McpServer; size?: number }) {
  const logo = serverLogo(name, server)
  const glyph = Math.round(size * 0.56)
  const style = { width: size, height: size, borderRadius: Math.max(5, Math.round(size * 0.25)) }
  if (!logo) {
    return (
      <span
        aria-hidden="true"
        className="grid shrink-0 place-items-center bg-track font-semibold text-ink-2"
        style={{ ...style, fontSize: Math.round(size * 0.46) }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    )
  }
  // A black or white brand mark takes the ink colour, so it reads in both themes.
  const color = isNeutralBrand(logo.hex) ? 'var(--er-ink)' : `#${logo.hex}`
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center"
      style={{ ...style, color, background: `color-mix(in srgb, ${color} 13%, var(--er-card))` }}
    >
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="currentColor">
        <path d={logo.path} />
      </svg>
    </span>
  )
}
