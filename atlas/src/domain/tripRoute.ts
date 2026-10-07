// The order a trip was traveled in, for the route arrows on the trip detail
// map (docs/superpowers/specs/2026-10-07-trip-route-arrows-design.md). Pure —
// same contract as @/domain/tripPlaces.
//
// Only cities with both coordinates and a visit date *on this trip* are
// stops: an undated city keeps its dot on the map but is never connected,
// because there's no honest way to know where in the route it belongs.
// Same-day stops follow the order they were attached to the trip, which is
// the order they were logged while traveling.

import type { TripPlaceRow } from '@/domain/tripPlaces'

export interface RouteStop {
  name: string
  lat: number
  lon: number
}

type Routable = TripPlaceRow & { visitedDate: string; lat: number; lon: number }

export function tripRoute(rows: readonly TripPlaceRow[]): RouteStop[] {
  return rows
    .filter((r): r is Routable => r.visitedDate !== null && r.lat !== null && r.lon !== null)
    .sort((a, b) => (a.visitedDate < b.visitedDate ? -1 : a.visitedDate > b.visitedDate ? 1 : a.addedAt - b.addedAt))
    .map((r) => ({ name: r.name, lat: r.lat, lon: r.lon }))
}
