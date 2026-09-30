// The "End past trip" prompt — same small-dialog family as
// TripConflictDialog (backdrop + centered panel, not a full-screen
// overlay), shown from TripDetail when a backfilling trip is finished. The
// end date defaults via nextBackfillDate (the same chaining rule that
// offered a date for the last place added) but stays freely editable before
// confirming — the "smart default, adjustable" behavior chosen over closing
// silently. See docs/superpowers/specs/2026-09-30-backfill-trip-mode-design.md.

import { useEffect, useState } from 'react'
import { endBackfill, nextBackfillDate } from '@/domain/tripRepo'
import { DateField } from '@/components/shared/DateField'
import './EndBackfillDialog.css'

interface EndBackfillDialogProps {
  tripId: string
  startDate: string
  onDone: () => void
  onCancel: () => void
}

export function EndBackfillDialog({ tripId, startDate, onDone, onCancel }: EndBackfillDialogProps) {
  const [date, setDate] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void nextBackfillDate(tripId, startDate).then((d) => {
      if (!cancelled) setDate(d)
    })
    return () => {
      cancelled = true
    }
  }, [tripId, startDate])

  async function confirm() {
    if (!date) {
      setError('Pick an end date.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await endBackfill(tripId, date)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  return (
    <div className="end-backfill-backdrop" onClick={onCancel}>
      <div className="end-backfill" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="end-backfill__title">End this past trip</h2>
        <p className="end-backfill__body">Suggested from the last place you added — change it if it's not quite right.</p>
        <DateField value={date} ariaLabel="End date" min={startDate} onChange={setDate} />
        {error && (
          <p className="end-backfill__error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="end-backfill__confirm" disabled={pending || !date} onClick={() => void confirm()}>
          End trip
        </button>
        <button type="button" className="end-backfill__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
