// A trip's start/end dates stretch to cover every visit on it — adding LA a
// week before a past trip's start moves the start back
// (docs/superpowers/specs/2026-10-12-edit-past-trips-design.md). Pure; applied
// by @/domain/tripRepo whenever a visit gets a date. Dates only ever widen —
// removing a visit never shrinks the trip.

import type { Trip } from '@/db/types'

/**
 * The patch that makes `trip` cover `date`, or null when it already does.
 * An open trip (no end date — live, or a backfill not yet ended) stays open.
 */
export function stretchTripDates(trip: Pick<Trip, 'startDate' | 'endDate'>, date: string): Partial<Pick<Trip, 'startDate' | 'endDate'>> | null {
  const patch: Partial<Pick<Trip, 'startDate' | 'endDate'>> = {}
  if (trip.startDate === null || date < trip.startDate) patch.startDate = date
  if (trip.endDate !== null && date > trip.endDate) patch.endDate = date
  return Object.keys(patch).length > 0 ? patch : null
}
