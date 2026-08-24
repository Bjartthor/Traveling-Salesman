// The persistent "a trip is running" banner (05-trips.md task 2) — pinned
// above the bottom nav on every screen while a trip is active, so a trip can
// never be silently forgotten. One line, mono, in --visited; tapping it opens
// the trip detail overlay directly (no tab navigation needed, same pattern as
// @/components/places/CountryDetail's global overlay).

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { getActiveTrip } from '@/domain/tripRepo'
import { tripDurationDays } from '@/domain/tripStats'
import { useActiveTripBannerStore } from '@/domain/activeTripBannerStore'
import { useTripDetailStore } from '@/domain/tripDetailStore'
import { countedQuery } from '@/debug/census'
import './ActiveTripBanner.css'

// Module-scope: stable across renders, matching this query's `deps: []`.
const queryActiveTrip = countedQuery('lqActiveTrip', () => getActiveTrip())

export function ActiveTripBanner() {
  const trip = useLiveQuery(queryActiveTrip)
  const dismissedTripId = useActiveTripBannerStore((s) => s.dismissedTripId)
  const dismiss = useActiveTripBannerStore((s) => s.dismiss)
  const openTrip = useTripDetailStore((s) => s.open)

  // Re-wrapped per trip change (deps: [trip?.id]) — countedQuery's count is
  // keyed by name, not by closure, so it stays cumulative across those re-wraps.
  const placeCount = useLiveQuery(
    countedQuery('lqTripPlaces', () =>
      trip ? db.tripEntries.filter((te) => te.tripId === trip.id && te.deletedAt === null).count() : Promise.resolve(0),
    ),
    [trip?.id],
  )

  if (!trip || dismissedTripId === trip.id) return null

  const days = tripDurationDays(trip) ?? 1
  const places = placeCount ?? 0

  return (
    <div className="active-trip-banner">
      <button type="button" className="active-trip-banner__tap" onClick={() => openTrip(trip.id)}>
        <span className="active-trip-banner__text mono">
          {trip.name} · Day {days} · {places} {places === 1 ? 'place' : 'places'}
        </span>
      </button>
      <button
        type="button"
        className="active-trip-banner__dismiss"
        onClick={() => dismiss(trip.id)}
        aria-label="Dismiss for this session"
      >
        ✕
      </button>
    </div>
  )
}
