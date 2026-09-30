// Trip create/edit form (05-trips.md task 1 "start a trip"/"retroactive
// trips" + task 4 "edit name, dates, cover photo"). Full-screen overlay,
// reusing the same shell as ManualPlaceForm/CountryDetail/BulkAddScreen.
//
// Two variants, one component: `showEndDate=false` is "starting a capture
// session now" — no end-date field at all, always produces an open-ended
// trip (`endDate: null`). Which lifecycle flag that trip gets (`isActive` vs
// `isBackfilling`) is entirely the caller's business (TripsScreen), decided
// via `createTrip`'s `mode` — this form only renders a different hint line
// depending on `mode`, purely cosmetic. `showEndDate=true` is plain editing
// of an existing trip's name/dates (TripDetail's "Edit"), which never
// touches `isActive`/`isBackfilling` at all (only the dedicated
// close/reopen/end-backfill actions do that) — the cover photo slot lives in
// TripDetail itself, wired but empty per 00-PLAN.md's Phase 6 hold-off.
//
// The only-one-trip-capturing conflict is resolved by the caller *before*
// opening this form (see TripsScreen/TripDetail) — that keeps this component
// a plain, un-nested form rather than one that has to pause mid-submit for a
// second dialog.

import { useState, type FormEvent } from 'react'
import { todayISO } from '@/domain/dateFormat'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { DateField } from '@/components/shared/DateField'
import './TripForm.css'

export interface TripFormValues {
  name: string
  startDate: string
  endDate: string | null
}

interface TripFormProps {
  title: string
  submitLabel: string
  showEndDate: boolean
  /** Only meaningful when `showEndDate` is false — selects which hint line renders under the date field. */
  mode?: 'live' | 'backfill'
  initial?: Partial<TripFormValues>
  onClose: () => void
  onSubmit: (values: TripFormValues) => Promise<void>
}

const HINT: Record<'live' | 'backfill', string> = {
  live: 'This starts the trip now — every place you add from here on attaches to it automatically.',
  backfill:
    'Every place you add from here on (search it in Places, same as always) attaches to this trip, with the date suggested from the last one — until you end it.',
}

export function TripForm({ title, submitLabel, showEndDate, mode, initial, onClose, onSubmit }: TripFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState<string | null>(initial?.endDate ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await onSubmit({
        name: name.trim() || `Trip from ${startDate}`,
        startDate,
        endDate: showEndDate ? endDate : null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPending(false)
    }
  }

  return (
    <FullScreenOverlay title={title} onClose={onClose}>
      <form className="trip-form" onSubmit={(e) => void submit(e)}>
        <label className="trip-form__field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Trip from ${startDate}`}
            autoFocus
          />
        </label>

        <div className={showEndDate ? 'trip-form__dates' : undefined}>
          <div className="trip-form__field">
            <span>Start date</span>
            <DateField value={startDate} ariaLabel="Start date" onChange={(v) => v && setStartDate(v)} />
          </div>
          {showEndDate && (
            <div className="trip-form__field">
              <span>End date (optional)</span>
              <DateField value={endDate} ariaLabel="End date" min={startDate} onChange={setEndDate} />
            </div>
          )}
        </div>
        {!showEndDate && <p className="trip-form__hint">{HINT[mode ?? 'live']}</p>}

        {error && (
          <p className="trip-form__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="trip-form__submit" disabled={pending}>
          {submitLabel}
        </button>
      </form>
    </FullScreenOverlay>
  )
}
