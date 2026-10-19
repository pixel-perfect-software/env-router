import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

async function boot() {
  // In the real macOS window the ground is translucent over the system's vibrancy
  // (tauri.conf.json windowEffects). Linux windows are opaque (tauri.linux.conf.json), and the
  // browser mock keeps the solid ground too.
  if ('__TAURI_INTERNALS__' in window && /Mac/.test(navigator.userAgent)) document.documentElement.setAttribute('data-vibrant', '')
  // In a plain browser during development, answer Tauri commands from a mock so the UI can
  // be reviewed. `import.meta.env.DEV` is false in builds, so this import is dropped there.
  if (import.meta.env.DEV && !('__TAURI_INTERNALS__' in window)) {
    await import('./dev/mockTauri')
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

boot()
