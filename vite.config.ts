// @ts-expect-error type error without @types/node package
import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import * as simpleIcons from 'simple-icons'
import { defineConfig, type Plugin } from 'vite'

/**
 * Serves `simple-icons` as plain `{ title, path, hex }` objects, the fields the window reads.
 * Each of its icons also carries a slug, a source URL, an `svg` getter and guidelines, which
 * tree-shaking can't drop from an object it keeps: about 180 bytes an icon. Every icon is still
 * its own export, so only the ones imported are bundled.
 */
function leanSimpleIcons(): Plugin {
  const id = '\0simple-icons-lean'
  return {
    name: 'lean-simple-icons',
    enforce: 'pre',
    resolveId: (source) => (source === 'simple-icons' ? id : undefined),
    load(loading) {
      if (loading !== id) return undefined
      return Object.entries(simpleIcons)
        .filter(([name]) => name.startsWith('si'))
        .map(([name, icon]) => `export const ${name} = ${JSON.stringify({ title: icon.title, path: icon.path, hex: icon.hex })}`)
        .join('\n')
    },
  }
}

const host = process.env.TAURI_DEV_HOST

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [leanSimpleIcons(), react(), tailwindcss()],

  // The window only ever runs in the system's WebKit (WKWebView on macOS, WebKitGTK on Linux), and
  // Tailwind 4's CSS (`color-mix()`, cascade layers, `@property`) needs Safari 16.4's, so that's
  // the target, as README's requirements say, rather than Vite's general browser list.
  build: {
    target: 'safari16.4',
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ['**/src-tauri/**'],
    },
  },
}))
