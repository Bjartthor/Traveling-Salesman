// "Tokyo set to Visited · UNDO" — shown for a few seconds after a one-tap edit
// (@/domain/undo). Floats above the tab bar and every overlay, since the edit
// that offers it usually happens inside the place sheet or a detail screen.

import { useEffect, useState } from 'react'
import { undo, useUndoStore } from '@/domain/undo'
import './UndoToast.css'

const VISIBLE_MS = 6000

export function UndoToast() {
  const offer = useUndoStore((s) => s.offer)
  const clear = useUndoStore((s) => s.set)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!offer) return
    setError(null)
    const timer = setTimeout(() => {
      // Only clear the offer this timer was started for, never a newer one.
      if (useUndoStore.getState().offer?.id === offer.id) clear(null)
    }, VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [offer, clear])

  useEffect(() => {
    if (!error) return
    const timer = setTimeout(() => setError(null), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [error])

  if (!offer && !error) return null

  return (
    <div className="undo-toast" role="status" aria-live="polite">
      <span className="undo-toast__text">{error ?? offer?.label}</span>
      {offer && (
        <button
          type="button"
          className="undo-toast__action"
          onClick={() => {
            undo(offer).catch((e: unknown) => setError(`Couldn’t undo: ${e instanceof Error ? e.message : String(e)}`))
          }}
        >
          Undo
        </button>
      )}
    </div>
  )
}
