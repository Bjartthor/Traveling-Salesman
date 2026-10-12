// The Dexie-facing half of trip lifecycle (05-trips.md task 1, extended for
// backfill mode — see docs/superpowers/specs/2026-09-30-backfill-trip-mode-design.md).
// Trip/tripEntries writes go through @/db/repo like everything else, but the
// lifecycle rules (only one capturing trip, auto-attach on a touched entry,
// soft-delete never touching places) live here, one level up.
//
// `cascadeRepo.ts` calls `autoAttachToCapturingTrip` from inside its own
// transaction after every `setPlaceStatus`, so "a place touched while a trip
// is capturing attaches to it" is never a step a caller can forget — true for
// a live trip and a backfilling one alike.

import { db } from '@/db/schema'
import { tripEntriesRepo, tripsRepo } from '@/db/repo'
import type { Trip, TripEntry } from '@/db/types'
import { logInfo } from '@/debug/log'

export type ActiveTripConflictResolution = 'close' | 'leaveOpen'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The one trip currently capturing (live or backfilling), or null. "Only one
 * trip capturing at a time" is an app-level rule, not a DB constraint —
 * enforced by always routing through `createTrip`/`reopenTrip` below.
 *
 * Reads the (small) table directly rather than `where('isActive')`: IndexedDB
 * keys can't be booleans, so an index on a boolean column silently never
 * matches anything through Dexie's `where()` — harmless here since `trips`
 * stays small, but worth knowing before reaching for that index elsewhere.
 */
export async function getCapturingTrip(): Promise<Trip | null> {
  const capturing = await db.trips.filter((t) => t.deletedAt === null && (t.isActive || t.isBackfilling)).toArray()
  return capturing[0] ?? null
}

async function resolveConflict(capturing: Trip, resolution: ActiveTripConflictResolution): Promise<void> {
  if (resolution === 'close') {
    await tripsRepo.update(capturing.id, { isActive: false, isBackfilling: false, endDate: capturing.endDate ?? today() })
  } else {
    // "Leave the old one open" — still no end date, just no longer the one capturing.
    await tripsRepo.update(capturing.id, { isActive: false, isBackfilling: false })
  }
}

export type CaptureMode = 'live' | 'backfill'

export interface CreateTripInput {
  name: string
  startDate: string
  mode: CaptureMode
  notes?: string
}

/**
 * Every new trip starts open-ended (`endDate: null`) regardless of mode — a
 * trip only gets an end date by being closed (`closeTrip`), ended
 * (`endBackfill`), or edited by hand. `mode: 'live'` sets `isActive`;
 * `mode: 'backfill'` sets `isBackfilling`. Either way, if another trip is
 * already capturing, `resolution` is required (the caller must ask the user
 * first — see TripsScreen/TripConflictDialog).
 */
export async function createTrip(input: CreateTripInput, resolution?: ActiveTripConflictResolution): Promise<Trip> {
  void logInfo(`trip: create "${input.name}" (${input.mode})`)
  const capturing = await getCapturingTrip()
  if (capturing) {
    if (!resolution) throw new Error('Another trip is capturing — resolve the conflict first')
    await resolveConflict(capturing, resolution)
  }
  return tripsRepo.create({
    name: input.name,
    startDate: input.startDate,
    endDate: null,
    isActive: input.mode === 'live',
    isBackfilling: input.mode === 'backfill',
    notes: input.notes ?? '',
  })
}

/** One-tap action, same immediacy as the place-status sheet's status buttons. */
export async function closeTrip(tripId: string, endDate?: string): Promise<void> {
  await tripsRepo.update(tripId, { isActive: false, endDate: endDate ?? today() })
}

/** The backfill equivalent of `closeTrip` — `endDate` is required (no `today()` fallback): the caller (`EndBackfillDialog`) always supplies one, defaulted via `nextBackfillDate`. */
export async function endBackfill(tripId: string, endDate: string): Promise<void> {
  await tripsRepo.update(tripId, { isBackfilling: false, endDate })
}

/** Reversible close (05-trips.md task 1). Clears `endDate` — resuming capture means open-ended again until closed a second time. Always resumes as *live*, never back into backfill mode. */
export async function reopenTrip(tripId: string, resolution?: ActiveTripConflictResolution): Promise<void> {
  const capturing = await getCapturingTrip()
  if (capturing && capturing.id !== tripId) {
    if (!resolution) throw new Error('Another trip is capturing — resolve the conflict first')
    await resolveConflict(capturing, resolution)
  }
  await tripsRepo.update(tripId, { isActive: true, endDate: null })
}

export async function updateTrip(
  tripId: string,
  patch: Partial<Pick<Trip, 'name' | 'startDate' | 'endDate' | 'notes'>>,
): Promise<void> {
  await tripsRepo.update(tripId, patch)
}

/**
 * Soft-deletes the trip only — never the places in it (00-PLAN.md §4,
 * 05-trips.md task 4). `tripEntries` rows are left exactly as they are; every
 * reader resolves a trip's places by joining through *active* entries, so a
 * deleted trip's membership rows simply stop being reachable from anywhere,
 * without a second delete path to keep in sync.
 */
export async function softDeleteTrip(tripId: string): Promise<void> {
  await tripsRepo.softDelete(tripId)
}

/**
 * A trip holds one `tripEntries` row per *visit*: the same place can be on a
 * trip more than once (out to San Diego and back to LA), each visit with its
 * own date (docs/superpowers/specs/2026-10-12-repeat-visits-on-a-trip-design.md).
 */
async function liveVisits(tripId: string, entryId: string): Promise<TripEntry[]> {
  return db.tripEntries.filter((te) => te.tripId === tripId && te.entryId === entryId && te.deletedAt === null).toArray()
}

/**
 * Puts a place on a trip as its *first* visit, with `visitedDate`. A place
 * already on the trip is left exactly as it is — a status tap never moves an
 * existing visit's date or adds a second visit; only `addVisit` does that.
 */
export async function attachEntryToTrip(tripId: string, entryId: string, visitedDate?: string | null): Promise<void> {
  if ((await liveVisits(tripId, entryId)).length > 0) return
  await addVisit(tripId, entryId, visitedDate ?? null)
}

/** Always records a new visit — for a place visited again on the same trip. */
export async function addVisit(tripId: string, entryId: string, visitedDate: string | null): Promise<void> {
  await tripEntriesRepo.create({ tripId, entryId, addedAt: Date.now(), visitedDate })
}

/** Removes one visit (one `tripEntries` row); the place's other visits on that trip stay. */
export async function removeVisit(tripEntryId: string): Promise<void> {
  await tripEntriesRepo.softDelete(tripEntryId)
}

/** How many distinct places a trip has (a place visited twice counts once). */
export async function countTripPlaces(tripId: string): Promise<number> {
  const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
  return new Set(rows.map((te) => te.entryId)).size
}

/**
 * Called from `cascadeRepo.setPlaceStatus`, inside its own transaction, after
 * every direct status set — never for the ancestor entries the cascade
 * creates alongside it. This is what "attach at the city level; plus any
 * country added directly" (05-trips.md task 1) resolves to as one rule: the
 * *target* of a direct set attaches (city, subdivision or country alike),
 * whatever it implies upward does not. No-ops when no trip is capturing.
 * Re-touching a place already on this trip changes nothing here — a second
 * visit is only ever added deliberately (`addVisit`, from the place sheet's
 * "Add another visit" button). Covers a live trip and a backfilling one
 * identically — the only difference between the two lives in what date
 * `PlaceStatusSheet` offers as a default before calling `setPlaceStatus`,
 * not in attachment itself.
 */
export async function autoAttachToCapturingTrip(entryId: string, visitedDate?: string | null): Promise<void> {
  const capturing = await getCapturingTrip()
  if (capturing) await attachEntryToTrip(capturing.id, entryId, visitedDate)
}

/**
 * The date offered for the next place touched while backfilling: the trip's
 * start date if nothing has been attached yet, otherwise the `visitedDate`
 * of whichever visit was *most recently added* (by `addedAt`, not by
 * date value — chains off the last thing you touched, not the latest date
 * typed), falling back to the start date if that attachment has no date of
 * its own yet.
 */
export async function nextBackfillDate(tripId: string, startDate: string): Promise<string> {
  const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
  if (rows.length === 0) return startDate
  const latest = rows.reduce((a, b) => (a.addedAt > b.addedAt ? a : b))
  return latest.visitedDate ?? startDate
}

/** One visit of a place on a trip — the place sheet lists one per visit. */
export interface TripAttachment {
  tripEntryId: string
  tripId: string
  tripName: string
  visitedDate: string | null
}

/**
 * Every live visit of a given entry, across all (non-deleted) trips, each
 * with that visit's own date — for the place-status sheet's "Trips" list,
 * one line per visit with its own ✕ (`removeVisit`). Most recently dated
 * first; undated visits last.
 */
export async function tripAttachmentsForEntry(entryId: string): Promise<TripAttachment[]> {
  const rows = await db.tripEntries.filter((te) => te.entryId === entryId && te.deletedAt === null).toArray()
  if (rows.length === 0) return []
  const trips = await db.trips.bulkGet(rows.map((r) => r.tripId))
  const attachments: TripAttachment[] = []
  rows.forEach((row, i) => {
    const trip = trips[i]
    if (trip && trip.deletedAt === null) attachments.push({ tripEntryId: row.id, tripId: row.tripId, tripName: trip.name, visitedDate: row.visitedDate })
  })
  return attachments.sort((a, b) => (b.visitedDate ?? '').localeCompare(a.visitedDate ?? '') || a.tripName.localeCompare(b.tripName))
}

/** Active (non-deleted) tripEntries rows for one trip — one per visit, each carrying the entryId to resolve and that visit's date. */
export async function tripEntryRowsForTrip(tripId: string): Promise<TripEntry[]> {
  return db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
}
