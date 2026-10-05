import { getCurrentWebview } from '@tauri-apps/api/webview'
import { useEffect, useRef, useState } from 'react'

export interface Drop {
  path: string
  /** Where the pointer released, in CSS pixels, so the slip can travel from there. */
  origin: { x: number; y: number }
}

/** Finder drags onto the window. Returns the path being dragged while it's over the window. */
export function useFolderDrop(onDrop: (drop: Drop) => void) {
  const [hovering, setHovering] = useState<string | null>(null)
  const handler = useRef(onDrop)
  handler.current = onDrop

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === 'enter') {
          setHovering(payload.paths[0] ?? null)
        } else if (payload.type === 'drop') {
          setHovering(null)
          const [path] = payload.paths
          if (path) {
            const scale = window.devicePixelRatio || 1
            handler.current({ path, origin: { x: payload.position.x / scale, y: payload.position.y / scale } })
          }
        } else if (payload.type === 'leave') {
          setHovering(null)
        }
      })
      .then((stop) => {
        if (cancelled) stop()
        else unlisten = stop
      })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [])

  return hovering
}
