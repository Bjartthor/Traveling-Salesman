// Trip create/edit form (05-trips.md task 1 "start a trip"/"retroactive
// trips" + task 4 "edit name, dates, cover photo"). Full-screen overlay,
// reusing the same shell as ManualPlaceForm/CountryDetail/BulkAddScreen.
//
// Three variants, one component: `showEndDate=false` is "start a trip now" —
// no end-date field at all, always produces a live (`isActive`) trip.
// `showEndDate=true, requireEndDate=true` is "log a past trip" — both dates
// up front, always produces an already-closed trip; no conflict with
// whatever's currently active is possible, since it never sets `isActive`.
// `showEndDate=true, requireEndDate=false` is plain editing of an existing
// trip's name/dates, which never touches `isActive` at all (only the
// dedicated close/reopen actions in TripDetail do that) — the cover photo
// slot lives in TripDetail itself, wired but empty per 00-PLAN.md's Phase 6
// hold-off.
//
// The only-one-trip-active conflict is resolved by the caller *before*
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
  requireEndDate?: boolean
  initial?: Partial<TripFormValues>
  onClose: () => void
  onSubmit: (values: TripFormValues) => Promise<void>
}

export function TripForm({ title, submitLabel, showEndDate, requireEndDate, initial, onClose, onSubmit }: TripFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState<string | null>(initial?.endDate ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (showEndDate && requireEndDate && !endDate) {
      setError('Pick an end date.')
      return
    }
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
              <span>End date{requireEndDate ? '' : ' (optional)'}</span>
              <DateField value={endDate} ariaLabel="End date" min={startDate} onChange={setEndDate} />
            </div>
          )}
        </div>
        {!showEndDate && (
          <p className="trip-form__hint">
            This starts the trip now — every place you add from here on attaches to it automatically.
          </p>
        )}

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
