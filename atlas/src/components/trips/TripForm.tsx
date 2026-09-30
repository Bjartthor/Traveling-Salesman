// Trip create/edit form (05-trips.md task 1 "start a trip"/"retroactive
// trips" + task 4 "edit name, dates, cover photo"). Full-screen overlay,
// reusing the same shell as ManualPlaceForm/CountryDetail/BulkAddScreen.
//
// Three variants, one component: `showEndDate=false` is "start a trip now" —
// no end-date field at all, always produces a live (`isActive`) trip.
// `showEndDate=true, requireEndDate=true` is "log a past trip" — both dates
// up front, always produces an already-closed trip; no conflict with
// whatever's currently active is possible, since it never sets `isActive`.
// This is also the only variant with the "Countries visited" picker below,
// and the only one where the end date mirrors the start date until touched
// (both exist to make backfilling an old trip fast — see
// docs/superpowers/specs/2026-09-30-log-past-trip-countries-design.md).
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
import type { TripCountryRow } from '@/domain/tripCountryDefaults'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { DateField } from '@/components/shared/DateField'
import { TripCountryPicker } from '@/components/trips/TripCountryPicker'
import './TripForm.css'

export interface TripFormValues {
  name: string
  startDate: string
  endDate: string | null
  countries?: TripCountryRow[]
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
  const isLogPast = showEndDate && Boolean(requireEndDate)

  const [name, setName] = useState(initial?.name ?? '')
  const initialStartDate = initial?.startDate ?? todayISO()
  const [startDate, setStartDate] = useState(initialStartDate)
  const [endDate, setEndDate] = useState<string | null>(initial?.endDate ?? (isLogPast ? initialStartDate : null))
  const [endDateTouched, setEndDateTouched] = useState(false)
  const [countries, setCountries] = useState<TripCountryRow[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleStartDateChange(v: string) {
    setStartDate(v)
    if (isLogPast && !endDateTouched) setEndDate(v)
  }

  function handleEndDateChange(v: string | null) {
    setEndDateTouched(true)
    setEndDate(v)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (isLogPast && !endDate) {
      setError('Pick an end date.')
      return
    }
    setPending(true)
    try {
      await onSubmit({
        name: name.trim() || `Trip from ${startDate}`,
        startDate,
        endDate: showEndDate ? endDate : null,
        countries: isLogPast ? countries : undefined,
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
            <DateField value={startDate} ariaLabel="Start date" onChange={(v) => v && handleStartDateChange(v)} />
          </div>
          {showEndDate && (
            <div className="trip-form__field">
              <span>End date{requireEndDate ? '' : ' (optional)'}</span>
              <DateField value={endDate} ariaLabel="End date" min={startDate} onChange={handleEndDateChange} />
            </div>
          )}
        </div>
        {!showEndDate && (
          <p className="trip-form__hint">
            This starts the trip now — every place you add from here on attaches to it automatically.
          </p>
        )}

        {isLogPast && <TripCountryPicker rows={countries} onChange={setCountries} startDate={startDate} />}

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
