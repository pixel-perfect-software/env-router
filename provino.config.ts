import { defineConfig } from 'provino/config'

// Vite fills import.meta.env in when it builds; a native run has none, so this is what Vitest supplied.
const define = { 'import.meta.env': { MODE: 'test', DEV: true, PROD: false, SSR: false, BASE_URL: '/' } }

export default defineConfig({
  projects: [
    // Logic and the browser mock's own answers: no window.
    { name: 'node', include: ['src/**/*.test.ts'], define },
    // The window rendered against the mock.
    { name: 'window', include: ['src/**/*.test.tsx'], environment: 'jsdom', define },
  ],
})
