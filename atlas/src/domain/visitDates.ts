// A place's visit dates *as shown*: its own `firstVisited`/`lastVisited` (only
// ever what the user set on the place itself) widened by the date each trip
// it's on recorded for it (`TripEntry.visitedDate`). Computed on read rather
// than stored, so deleting a trip — or detaching a place from one — takes that
// trip's date with it; nothing has to remember which part of a stored span
// came from where. See @/domain/cascade.captureRequest for the write side.
// Pure: callers load the three tables (`loadEntriesWithTripDates` below).

import { db } from '@/db/schema'
import type { Entry, Trip, TripEntry } from '@/db/types'

/**
 * `entries` with each one's dates widened by its live trip attachments.
 * Attachments that are detached, undated, or on a deleted trip don't count.
 * An entry no trip widens comes back as the same object.
 */
export function withTripVisitDates(entries: readonly Entry[], tripEntries: readonly TripEntry[], trips: readonly Trip[]): Entry[] {
  const liveTrips = new Set(trips.filter((t) => t.deletedAt === null).map((t) => t.id))
  const span = new Map<string, { first: string; last: string }>()
  for (const te of tripEntries) {
    if (te.deletedAt !== null || te.visitedDate === null || !liveTrips.has(te.tripId)) continue
    const s = span.get(te.entryId)
    if (!s) span.set(te.entryId, { first: te.visitedDate, last: te.visitedDate })
    else {
      if (te.visitedDate < s.first) s.first = te.visitedDate
      if (te.visitedDate > s.last) s.last = te.visitedDate
    }
  }

  return entries.map((e) => {
    const s = span.get(e.id)
    if (!s) return e
    const firstVisited = e.firstVisited !== null && e.firstVisited < s.first ? e.firstVisited : s.first
    const lastVisited = e.lastVisited !== null && e.lastVisited > s.last ? e.lastVisited : s.last
    return firstVisited === e.firstVisited && lastVisited === e.lastVisited ? e : { ...e, firstVisited, lastVisited }
  })
}

/** Active entries with trip dates folded in — for use inside a `useLiveQuery`, which then also re-runs when a trip is deleted. */
export async function loadEntriesWithTripDates(): Promise<Entry[]> {
  const [entries, tripEntries, trips] = await Promise.all([
    db.entries.filter((e) => e.deletedAt === null).toArray(),
    db.tripEntries.toArray(),
    db.trips.toArray(),
  ])
  return withTripVisitDates(entries, tripEntries, trips)
}
