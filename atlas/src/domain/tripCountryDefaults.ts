// Pure helpers backing the "Countries visited" section of the past-trip form
// (TripCountryPicker.tsx / TripForm.tsx) — kept separate from those
// components so the date-chaining rule is unit-testable without React. See
// docs/superpowers/specs/2026-09-30-log-past-trip-countries-design.md.

import type { Status } from '@/db/types'

export interface TripCountryRow {
  code: string
  status: Status
  date: string | null
}

/**
 * The date offered to a newly-added row: the trip's start date if this is
 * the first country added, otherwise whatever date currently sits on the
 * row added just before it (falling back to the start date if that row's
 * date was cleared to null). Purely a default — the caller still stores
 * whatever the user ends up leaving in the field, and nothing here ever
 * re-derives an already-added row's date.
 */
export function nextCountryRowDate(rows: readonly TripCountryRow[], startDate: string): string {
  const last = rows[rows.length - 1]
  return last?.date ?? startDate
}
