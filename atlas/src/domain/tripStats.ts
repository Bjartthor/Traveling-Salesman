// Pure trip statistics (05-trips.md task 5, plus the trip-detail "duration"/
// "new countries" figures from task 4). No Dexie, no React — same contract as
// coverage.ts/placesList.ts/tripPlaces.ts. Screens resolve a trip's country
// codes via @/domain/tripPlaces first, then hand the plain data in here.
//
// A currently active trip counts in every stat here, using today as a
// stand-in end date (confirmed with the user rather than assumed) — so
// "longest trip"/"average trip length" reflect an in-progress trip
// immediately instead of waiting for it to close.

import type { Trip } from '@/db/types'

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Calendar days inclusive of both ends — a same-day trip is 1 day, not 0. */
function daysBetweenInclusive(startISO: string, endISO: string): number {
  const start = Date.parse(`${startISO}T00:00:00Z`)
  const end = Date.parse(`${endISO}T00:00:00Z`)
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1)
}

/**
 * A trip's duration, in whole days — null only when it has no start date at
 * all (shouldn't happen from the UI, which defaults to today, but the schema
 * allows it). An open trip (no `endDate`) uses `today` as a stand-in, which is
 * what makes this the single function both the active-trip banner's "day
 * count" and every duration-based stat below share.
 */
export function tripDurationDays(trip: Pick<Trip, 'startDate' | 'endDate'>, today: string = todayISO()): number | null {
  if (!trip.startDate) return null
  return daysBetweenInclusive(trip.startDate, trip.endDate ?? today)
}

export interface TripStatsInput {
  trips: readonly Trip[] // active (non-deleted) trips, any order
  /** tripId -> the country codes attached to it (@/domain/tripPlaces.tripCountryCodes). */
  countriesByTrip: ReadonlyMap<string, readonly string[]>
}

export interface TripStats {
  totalTrips: number
  longestTripDays: number | null
  longestTripName: string | null
  mostCountriesInOneTrip: number
  mostCountriesTripName: string | null
  averageTripLengthDays: number | null
}

export function computeTripStats(input: TripStatsInput, today: string = todayISO()): TripStats {
  const { trips, countriesByTrip } = input

  let longestTripDays: number | null = null
  let longestTripName: string | null = null
  let mostCountriesInOneTrip = 0
  let mostCountriesTripName: string | null = null
  const durations: number[] = []

  for (const trip of trips) {
    const duration = tripDurationDays(trip, today)
    if (duration !== null) {
      durations.push(duration)
      if (longestTripDays === null || duration > longestTripDays) {
        longestTripDays = duration
        longestTripName = trip.name
      }
    }

    const countryCount = countriesByTrip.get(trip.id)?.length ?? 0
    if (countryCount > mostCountriesInOneTrip) {
      mostCountriesInOneTrip = countryCount
      mostCountriesTripName = trip.name
    }
  }

  const averageTripLengthDays = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null

  return { totalTrips: trips.length, longestTripDays, longestTripName, mostCountriesInOneTrip, mostCountriesTripName, averageTripLengthDays }
}

export interface NewCountriesInput {
  trips: readonly Trip[]
  countriesByTrip: ReadonlyMap<string, readonly string[]>
  /**
   * A country's earliest recorded visit date *outside* any trip context —
   * typically the country's own (or one of its places') `firstVisited`. If
   * this predates the trip that would otherwise "own" a country as new, that
   * trip is disqualified — the country was already visited before the app's
   * trip records begin.
   */
  priorFirstVisited?: ReadonlyMap<string, string>
}

/**
 * Which countries were newly first-visited on each trip — "the number people
 * actually care about" (05-trips.md task 4). A country belongs to the
 * chronologically earliest trip (by `startDate`, ties broken by `createdAt`)
 * that includes it, unless `priorFirstVisited` shows an even earlier visit
 * with no trip attached at all.
 */
export function newCountriesByTrip(input: NewCountriesInput): Map<string, string[]> {
  const { trips, countriesByTrip, priorFirstVisited } = input
  const sorted = [...trips].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.createdAt - b.createdAt)

  const firstTripForCountry = new Map<string, string>() // countryCode -> tripId
  for (const trip of sorted) {
    for (const code of countriesByTrip.get(trip.id) ?? []) {
      if (!firstTripForCountry.has(code)) firstTripForCountry.set(code, trip.id)
    }
  }

  const result = new Map<string, string[]>()
  for (const trip of trips) result.set(trip.id, [])

  const tripById = new Map(trips.map((t) => [t.id, t]))
  for (const [code, tripId] of firstTripForCountry) {
    const trip = tripById.get(tripId)
    if (!trip) continue
    const prior = priorFirstVisited?.get(code)
    if (prior && trip.startDate && prior < trip.startDate) continue // already visited before this trip, off the record
    result.get(tripId)?.push(code)
  }
  for (const codes of result.values()) codes.sort()
  return result
}
