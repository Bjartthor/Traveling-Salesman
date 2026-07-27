// Shared shell for the app's full-screen overlays (manual place entry,
// country detail, bulk add) — z-index below the place-status sheet
// (@/components/places/PlaceStatusSheet.css), so the sheet can still stack on
// top of any of these.

import { useEffect, type ReactNode } from 'react'
import './FullScreenOverlay.css'

interface FullScreenOverlayProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function FullScreenOverlay({ title, onClose, children }: FullScreenOverlayProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="full-screen-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <header className="full-screen-overlay__header">
        <h2 className="full-screen-overlay__title">{title}</h2>
        <button type="button" className="full-screen-overlay__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>
      <div className="full-screen-overlay__body">{children}</div>
    </div>
  )
}
