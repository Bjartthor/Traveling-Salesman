// The order a trip was traveled in, for the route arrows on the trip detail
// map (docs/superpowers/specs/2026-10-07-trip-route-arrows-design.md, extended
// by 2026-10-12-repeat-visits-on-a-trip-design.md). Pure — same contract as
// @/domain/tripPlaces.
//
// A stop is a *visit*, not a place: a place visited twice on one trip (out to
// San Diego and back to LA) is a stop twice. Only dated visits of cities with
// coordinates are stops: an undated visit is never connected, because there's
// no honest way to know where in the route it belongs. Same-day stops follow
// the order they were added to the trip, which is the order they were logged
// while traveling.

import type { TripPlaceRow } from '@/domain/tripPlaces'

export interface RouteStop {
  name: string
  lat: number
  lon: number
}

interface DatedStop extends RouteStop {
  visitedDate: string
  addedAt: number
}

export function tripRoute(rows: readonly TripPlaceRow[]): RouteStop[] {
  const stops: DatedStop[] = []
  for (const r of rows) {
    if (r.lat === null || r.lon === null) continue
    for (const v of r.visits) {
      if (v.visitedDate !== null) stops.push({ name: r.name, lat: r.lat, lon: r.lon, visitedDate: v.visitedDate, addedAt: v.addedAt })
    }
  }
  return stops
    .sort((a, b) => (a.visitedDate < b.visitedDate ? -1 : a.visitedDate > b.visitedDate ? 1 : a.addedAt - b.addedAt))
    .map(({ name, lat, lon }) => ({ name, lat, lon }))
}
