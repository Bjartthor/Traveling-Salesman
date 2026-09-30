// The Trips tab (05-trips.md task 3, extended for backfill mode): a
// Capturing section (whichever trip — live or backfilling — is currently
// capturing, plus the two ways to start one) and a Past section of stamps in
// reverse chronological order, stacked with slight overlap like a passport
// page.

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Status, Trip } from '@/db/types'
import { buildStatusIndex } from '@/stats/coverage'
import { createTrip, getCapturingTrip, type ActiveTripConflictResolution, type CaptureMode } from '@/domain/tripRepo'
import { loadTripPlaces } from '@/domain/tripPlacesRepo'
import { tripCityRows, tripCountryCodes } from '@/domain/tripPlaces'
import { tripDurationDays } from '@/domain/tripStats'
import { useTripDetailStore } from '@/domain/tripDetailStore'
import { formatLongDate } from '@/domain/dateFormat'
import { TripForm, type TripFormValues } from '@/components/trips/TripForm'
import { TripConflictDialog } from '@/components/trips/TripConflictDialog'
import { TripStamp } from '@/components/trips/TripStamp'
import './TripsScreen.css'

type FormMode = CaptureMode | null

export function TripsScreen() {
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [conflictTripName, setConflictTripName] = useState<string | null>(null)
  const [pendingResolution, setPendingResolution] = useState<ActiveTripConflictResolution | undefined>(undefined)
  const openTrip = useTripDetailStore((s) => s.open)

  const trips = useLiveQuery(() => db.trips.filter((t) => t.deletedAt === null).toArray())
  const capturing = trips?.find((t) => t.isActive || t.isBackfilling) ?? null
  const past = (trips ?? [])
    .filter((t) => t.endDate !== null)
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.createdAt - a.createdAt)

  // Shared across every stamp's mini route map, computed once rather than per stamp.
  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const countryStatus = useMemo(() => buildStatusIndex(entries ?? [], 'country'), [entries])

  const capturingPlaceCount = useLiveQuery(
    () => (capturing ? db.tripEntries.filter((te) => te.tripId === capturing.id && te.deletedAt === null).count() : Promise.resolve(0)),
    [capturing?.id],
  )

  // `formMode` is set here regardless of whether there's a conflict — a
  // conflict just means TripConflictDialog renders on top and the form
  // itself stays hidden (see the render gate below) until the user resolves
  // it, so `submitForm` still knows which mode to pass to `createTrip`
  // afterward. Canceling the conflict dialog clears `formMode` back to null
  // (see its `onCancel` below) so nothing opens.
  async function requestFormMode(mode: CaptureMode) {
    const conflictTrip = await getCapturingTrip()
    if (conflictTrip) setConflictTripName(conflictTrip.name)
    setFormMode(mode)
  }

  async function submitForm(values: TripFormValues) {
    if (!formMode) return
    await createTrip({ name: values.name, startDate: values.startDate, mode: formMode }, pendingResolution)
    setFormMode(null)
    setPendingResolution(undefined)
  }

  return (
    <div className="trips-screen">
      <h1 className="trips-screen__title">Trips</h1>

      <section className="trips-screen__section">
        <h2 className="trips-screen__section-title mono">Capturing</h2>
        {capturing ? (
          <button type="button" className="trips-screen__active-card" onClick={() => openTrip(capturing.id)}>
            <span className="trips-screen__active-name">{capturing.name}</span>
            <span className="trips-screen__active-meta mono">
              {capturing.isActive
                ? `Day ${tripDurationDays(capturing)} · started ${capturing.startDate ? formatLongDate(capturing.startDate) : '—'}`
                : `Backfilling since ${capturing.startDate ? formatLongDate(capturing.startDate) : '—'} · ${capturingPlaceCount ?? 0} ${capturingPlaceCount === 1 ? 'place' : 'places'}`}
            </span>
          </button>
        ) : (
          <p className="trips-screen__hint">
            No trip running. Start one and everything you add from here on attaches to it automatically.
          </p>
        )}
      </section>

      <div className="trips-screen__actions">
        <button type="button" className="trips-screen__action" onClick={() => void requestFormMode('live')}>
          Start a trip
        </button>
        <button type="button" className="trips-screen__action trips-screen__action--secondary" onClick={() => void requestFormMode('backfill')}>
          Log a past trip
        </button>
      </div>

      <section className="trips-screen__section">
        <h2 className="trips-screen__section-title mono">Past</h2>
        {past.length > 0 ? (
          <div className="trips-screen__stamps">
            {past.map((trip) => (
              <TripPastStamp key={trip.id} trip={trip} countryStatus={countryStatus} onOpen={() => openTrip(trip.id)} />
            ))}
          </div>
        ) : (
          <p className="trips-screen__hint">Trips you close (or finish backfilling) show up here as a stamp.</p>
        )}
      </section>

      {formMode && !conflictTripName && (
        <TripForm
          title={formMode === 'live' ? 'Start a trip' : 'Log a past trip'}
          submitLabel={formMode === 'live' ? 'Start trip' : 'Start backfilling'}
          showEndDate={false}
          mode={formMode}
          onClose={() => {
            setFormMode(null)
            setPendingResolution(undefined)
          }}
          onSubmit={submitForm}
        />
      )}

      {conflictTripName && (
        <TripConflictDialog
          activeTripName={conflictTripName}
          onResolve={(resolution) => {
            setPendingResolution(resolution)
            setConflictTripName(null)
          }}
          onCancel={() => {
            setConflictTripName(null)
            setFormMode(null)
          }}
        />
      )}
    </div>
  )
}

function TripPastStamp({
  trip,
  countryStatus,
  onOpen,
}: {
  trip: Trip
  countryStatus: ReadonlyMap<string, Status>
  onOpen: () => void
}) {
  const groups = useLiveQuery(() => loadTripPlaces(trip.id), [trip.id])
  const countryCodes = useMemo(() => (groups ? tripCountryCodes(groups) : []), [groups])
  const cities = useMemo(
    () =>
      groups
        ? tripCityRows(groups).filter((r): r is typeof r & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
        : [],
    [groups],
  )
  return (
    <TripStamp
      tripId={trip.id}
      name={trip.name}
      startDate={trip.startDate}
      endDate={trip.endDate}
      countryCodes={countryCodes}
      countryStatus={countryStatus}
      cities={cities}
      onClick={onOpen}
    />
  )
}
