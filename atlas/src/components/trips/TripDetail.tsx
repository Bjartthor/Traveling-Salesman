// The full trip detail screen (05-trips.md task 4) — a full-screen overlay,
// same precedent as @/components/places/CountryDetail: route map, grouped
// places, duration/country/new-country stats, notes, edit, delete, reopen.
// Editing a place always happens through the global place-status sheet, the
// same as everywhere else — this screen only displays and routes taps.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { EntryKind, Status, Trip } from '@/db/types'
import { buildStatusIndex } from '@/stats/coverage'
import { tripCityRows, tripCountryCodes, type TripCountryGroup } from '@/domain/tripPlaces'
import { loadCountryFirstVisited, loadTripCountryCodesBatch, loadTripPlaces } from '@/domain/tripPlacesRepo'
import { newCountriesByTrip, tripDurationDays } from '@/domain/tripStats'
import { closeTrip, getActiveTrip, reopenTrip, softDeleteTrip, updateTrip } from '@/domain/tripRepo'
import { useTripDetailStore } from '@/domain/tripDetailStore'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { flagEmoji } from '@/geo/flags'
import { colorForStatus } from '@/components/map/statusColor'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { TripForm } from '@/components/trips/TripForm'
import { TripConflictDialog } from '@/components/trips/TripConflictDialog'
import { TripRouteMap } from '@/components/trips/TripRouteMap'
import './TripDetail.css'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export function TripDetail() {
  const openTripId = useTripDetailStore((s) => s.openTripId)
  const close = useTripDetailStore((s) => s.close)
  if (!openTripId) return null
  return <TripDetailContent key={openTripId} tripId={openTripId} onClose={close} />
}

interface TripDetailData {
  trip: Trip
  groups: TripCountryGroup[]
  countryStatus: Map<string, Status>
  subdivisionStatus: Map<string, Status>
  newCountries: Set<string>
}

async function loadDetail(tripId: string): Promise<TripDetailData | null> {
  const trip = await db.trips.get(tripId)
  if (!trip || trip.deletedAt !== null) return null

  const groups = await loadTripPlaces(tripId)

  const [allEntries, allTrips] = await Promise.all([
    db.entries.filter((e) => e.deletedAt === null).toArray(),
    db.trips.filter((t) => t.deletedAt === null).toArray(),
  ])
  const countryStatus = buildStatusIndex(allEntries, 'country')
  const subdivisionStatus = buildStatusIndex(allEntries, 'subdivision')

  const [countriesByTrip, priorFirstVisited] = await Promise.all([
    loadTripCountryCodesBatch(allTrips.map((t) => t.id)),
    loadCountryFirstVisited(),
  ])
  const newByTrip = newCountriesByTrip({ trips: allTrips, countriesByTrip, priorFirstVisited })

  return { trip, groups, countryStatus, subdivisionStatus, newCountries: new Set(newByTrip.get(tripId) ?? []) }
}

function TripDetailContent({ tripId, onClose }: { tripId: string; onClose: () => void }) {
  const openPlaceSheet = usePlaceSheetStore((s) => s.open)
  const data = useLiveQuery(() => loadDetail(tripId), [tripId])

  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [conflictTripName, setConflictTripName] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const [notes, setNotes] = useState('')
  const [notesTouched, setNotesTouched] = useState(false)
  useEffect(() => {
    if (!notesTouched && data?.trip) setNotes(data.trip.notes)
  }, [data?.trip, notesTouched])

  if (data === null) {
    return (
      <FullScreenOverlay title="Not found" onClose={onClose}>
        <p className="trip-detail__empty">This trip no longer exists.</p>
      </FullScreenOverlay>
    )
  }
  if (data === undefined) {
    return (
      <FullScreenOverlay title="Loading…" onClose={onClose}>
        <p className="trip-detail__empty">Loading…</p>
      </FullScreenOverlay>
    )
  }

  const { trip, groups, countryStatus, subdivisionStatus, newCountries } = data
  const countryCodes = tripCountryCodes(groups)
  const cityPoints = tripCityRows(groups)
    .filter((r): r is typeof r & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
    .map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }))
  const duration = tripDurationDays(trip)

  async function run(action: () => Promise<void>) {
    setActionError(null)
    try {
      await action()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleReopenTapped() {
    const active = await getActiveTrip()
    if (active && active.id !== trip.id) setConflictTripName(active.name)
    else await run(() => reopenTrip(trip.id))
  }

  function commitNotes() {
    if (notes !== trip.notes) void run(() => updateTrip(trip.id, { notes }))
  }

  return (
    <FullScreenOverlay title={trip.name} onClose={onClose}>
      <div className="trip-detail">
        <p className="trip-detail__dates mono">
          {trip.startDate ?? '—'} – {trip.endDate ?? (trip.isActive ? 'ONGOING' : '—')}
        </p>

        <TripRouteMap countryCodes={countryCodes} countryStatus={countryStatus} cities={cityPoints} />

        <dl className="trip-detail__stats">
          <div className="trip-detail__stat">
            <dt>Duration</dt>
            <dd>{duration !== null ? `${duration} ${duration === 1 ? 'day' : 'days'}` : '—'}</dd>
          </div>
          <div className="trip-detail__stat">
            <dt>Countries</dt>
            <dd>{countryCodes.length}</dd>
          </div>
          <div className="trip-detail__stat">
            <dt>New to you</dt>
            <dd>{newCountries.size}</dd>
          </div>
        </dl>

        <div className="trip-detail__lifecycle">
          {trip.isActive ? (
            <button type="button" className="trip-detail__action" onClick={() => void run(() => closeTrip(trip.id))}>
              Close trip
            </button>
          ) : (
            <button type="button" className="trip-detail__action" onClick={() => void handleReopenTapped()}>
              Reopen trip
            </button>
          )}
          <button type="button" className="trip-detail__action trip-detail__action--secondary" onClick={() => setShowEdit(true)}>
            Edit
          </button>
        </div>

        {actionError && (
          <p className="trip-detail__error" role="alert">
            {actionError}
          </p>
        )}

        <section className="trip-detail__section">
          <h2 className="trip-detail__section-title">Places</h2>
          {groups.length === 0 ? (
            <p className="trip-detail__empty">Nothing attached to this trip yet.</p>
          ) : (
            <TripPlacesTree
              groups={groups}
              countryStatus={countryStatus}
              subdivisionStatus={subdivisionStatus}
              newCountries={newCountries}
              onOpenPlace={(kind, refId) => openPlaceSheet({ kind, refId })}
            />
          )}
        </section>

        <section className="trip-detail__section">
          <h2 className="trip-detail__section-title">Notes</h2>
          <textarea
            className="trip-detail__notes"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setNotesTouched(true)
            }}
            onBlur={commitNotes}
            placeholder="Notes about this trip…"
            rows={4}
          />
        </section>

        <section className="trip-detail__section">
          <h2 className="trip-detail__section-title">Cover photo</h2>
          <p className="trip-detail__empty">Cover photos are coming in a later build.</p>
        </section>

        <button type="button" className="trip-detail__delete" onClick={() => setShowDeleteConfirm(true)}>
          Delete trip
        </button>
      </div>

      {showEdit && (
        <TripForm
          title="Edit trip"
          submitLabel="Save"
          showEndDate
          initial={{ name: trip.name, startDate: trip.startDate ?? todayISO(), endDate: trip.endDate ?? '' }}
          onClose={() => setShowEdit(false)}
          onSubmit={async (values) => {
            await updateTrip(trip.id, { name: values.name, startDate: values.startDate, endDate: values.endDate })
            setShowEdit(false)
          }}
        />
      )}

      {conflictTripName && (
        <TripConflictDialog
          activeTripName={conflictTripName}
          onResolve={(resolution) => {
            setConflictTripName(null)
            void run(() => reopenTrip(trip.id, resolution))
          }}
          onCancel={() => setConflictTripName(null)}
        />
      )}

      {showDeleteConfirm && (
        <div className="trip-detail__confirm-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="trip-detail__confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2 className="trip-detail__confirm-title">Delete "{trip.name}"?</h2>
            <p className="trip-detail__confirm-body">
              This removes the trip and its stamp. It never deletes the places in it — they stay exactly as they are in
              your Places list and on the map.
            </p>
            <button
              type="button"
              className="trip-detail__confirm-delete"
              onClick={() =>
                void run(async () => {
                  await softDeleteTrip(trip.id)
                  setShowDeleteConfirm(false)
                  onClose()
                })
              }
            >
              Delete trip
            </button>
            <button type="button" className="trip-detail__confirm-cancel" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </FullScreenOverlay>
  )
}

function TripPlacesTree({
  groups,
  countryStatus,
  subdivisionStatus,
  newCountries,
  onOpenPlace,
}: {
  groups: TripCountryGroup[]
  countryStatus: ReadonlyMap<string, Status>
  subdivisionStatus: ReadonlyMap<string, Status>
  newCountries: ReadonlySet<string>
  onOpenPlace: (kind: EntryKind, refId: string) => void
}) {
  return (
    <div className="trip-detail__places">
      {groups.map((g) => (
        <div key={g.code} className="trip-detail__country">
          <div className="trip-detail__country-header">
            <span className="trip-detail__bar" style={{ background: colorForStatus(countryStatus.get(g.code)) }} aria-hidden="true" />
            <button type="button" className="trip-detail__country-name" onClick={() => onOpenPlace('country', g.code)}>
              {flagEmoji(g.code)} {g.name}
            </button>
            {newCountries.has(g.code) && <span className="trip-detail__new-badge mono">New</span>}
          </div>

          {g.subdivisions.map((s) => (
            <div key={s.key} className="trip-detail__subdivision">
              <button type="button" className="trip-detail__row" onClick={() => onOpenPlace('subdivision', s.key)}>
                <span className="trip-detail__bar" style={{ background: colorForStatus(subdivisionStatus.get(s.key)) }} aria-hidden="true" />
                <span>{s.name}</span>
              </button>
              {s.cities.map((c) => (
                <button
                  key={c.entryId}
                  type="button"
                  className="trip-detail__row trip-detail__row--city"
                  onClick={() => onOpenPlace('city', c.refId)}
                >
                  <span className="trip-detail__bar" style={{ background: colorForStatus(c.status) }} aria-hidden="true" />
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
          ))}

          {g.looseCities.map((c) => (
            <button
              key={c.entryId}
              type="button"
              className="trip-detail__row trip-detail__row--city"
              onClick={() => onOpenPlace('city', c.refId)}
            >
              <span className="trip-detail__bar" style={{ background: colorForStatus(c.status) }} aria-hidden="true" />
              <span>{c.name}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
