// The Trips tab (05-trips.md task 3): an Active section (the currently
// capturing trip, plus the two ways to start one) and a Past section of
// stamps in reverse chronological order, stacked with slight overlap like a
// passport page.

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Status, Trip } from '@/db/types'
import { buildStatusIndex } from '@/stats/coverage'
import { createTrip, getActiveTrip, type ActiveTripConflictResolution } from '@/domain/tripRepo'
import { loadTripPlaces } from '@/domain/tripPlacesRepo'
import { tripCityRows, tripCountryCodes } from '@/domain/tripPlaces'
import { tripDurationDays } from '@/domain/tripStats'
import { useTripDetailStore } from '@/domain/tripDetailStore'
import { TripForm, type TripFormValues } from '@/components/trips/TripForm'
import { TripConflictDialog } from '@/components/trips/TripConflictDialog'
import { TripStamp } from '@/components/trips/TripStamp'
import './TripsScreen.css'

type FormMode = 'start' | 'logPast' | null

export function TripsScreen() {
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [conflictTripName, setConflictTripName] = useState<string | null>(null)
  const [pendingResolution, setPendingResolution] = useState<ActiveTripConflictResolution | undefined>(undefined)
  const openTrip = useTripDetailStore((s) => s.open)

  const trips = useLiveQuery(() => db.trips.filter((t) => t.deletedAt === null).toArray())
  const active = trips?.find((t) => t.isActive) ?? null
  const past = (trips ?? [])
    .filter((t) => !t.isActive)
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.createdAt - a.createdAt)

  // Shared across every stamp's mini route map, computed once rather than per stamp.
  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const countryStatus = useMemo(() => buildStatusIndex(entries ?? [], 'country'), [entries])

  async function handleStartTapped() {
    const conflictTrip = await getActiveTrip()
    if (conflictTrip) setConflictTripName(conflictTrip.name)
    else setFormMode('start')
  }

  async function submitStart(values: TripFormValues) {
    await createTrip({ name: values.name, startDate: values.startDate, endDate: null }, pendingResolution)
    setFormMode(null)
    setPendingResolution(undefined)
  }

  async function submitLogPast(values: TripFormValues) {
    await createTrip({ name: values.name, startDate: values.startDate, endDate: values.endDate })
    setFormMode(null)
  }

  return (
    <div className="trips-screen">
      <h1 className="trips-screen__title">Trips</h1>

      <section className="trips-screen__section">
        <h2 className="trips-screen__section-title mono">Active</h2>
        {active ? (
          <button type="button" className="trips-screen__active-card" onClick={() => openTrip(active.id)}>
            <span className="trips-screen__active-name">{active.name}</span>
            <span className="trips-screen__active-meta mono">
              Day {tripDurationDays(active)} · started {active.startDate ?? '—'}
            </span>
          </button>
        ) : (
          <p className="trips-screen__hint">
            No trip running. Start one and everything you add from here on attaches to it automatically.
          </p>
        )}
      </section>

      <div className="trips-screen__actions">
        <button type="button" className="trips-screen__action" onClick={() => void handleStartTapped()}>
          Start a trip
        </button>
        <button type="button" className="trips-screen__action trips-screen__action--secondary" onClick={() => setFormMode('logPast')}>
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
          <p className="trips-screen__hint">Trips you close (or log from the past) show up here as a stamp.</p>
        )}
      </section>

      {formMode === 'start' && (
        <TripForm
          title="Start a trip"
          submitLabel="Start trip"
          showEndDate={false}
          onClose={() => {
            setFormMode(null)
            setPendingResolution(undefined)
          }}
          onSubmit={submitStart}
        />
      )}

      {formMode === 'logPast' && (
        <TripForm
          title="Log a past trip"
          submitLabel="Save trip"
          showEndDate
          requireEndDate
          onClose={() => setFormMode(null)}
          onSubmit={submitLogPast}
        />
      )}

      {conflictTripName && (
        <TripConflictDialog
          activeTripName={conflictTripName}
          onResolve={(resolution) => {
            setPendingResolution(resolution)
            setConflictTripName(null)
            setFormMode('start')
          }}
          onCancel={() => setConflictTripName(null)}
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
