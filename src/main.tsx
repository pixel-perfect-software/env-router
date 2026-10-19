import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

async function boot() {
  // In the real window the ground is translucent over macOS's vibrancy (tauri.conf.json
  // windowEffects); the browser mock keeps the solid ground.
  if ('__TAURI_INTERNALS__' in window) document.documentElement.setAttribute('data-vibrant', '')
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
