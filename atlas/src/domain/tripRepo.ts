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
import type { Trip } from '@/db/types'
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
    coverPhotoId: null,
  })
}

export interface CreateClosedTripInput {
  name: string
  startDate: string
  endDate: string
  notes?: string
}

/**
 * A trip whose full date range is already known at creation — used by the
 * photo-import flow (`PhotoImportFlow.tsx`), which infers a trip's start and
 * end dates directly from photo EXIF timestamps, so there's nothing to
 * "capture" or backfill: never sets `isActive`/`isBackfilling`, so no
 * conflict with whatever else is capturing is possible. This is the one
 * remaining piece of the old (pre-backfill-mode) `createTrip`'s "`endDate`
 * present at creation" branch — split out on its own now that `createTrip`
 * itself is exclusively about starting a capturing session.
 */
export async function createClosedTrip(input: CreateClosedTripInput): Promise<Trip> {
  void logInfo(`trip: create closed "${input.name}"`)
  return tripsRepo.create({
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    isActive: false,
    isBackfilling: false,
    notes: input.notes ?? '',
    coverPhotoId: null,
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
  patch: Partial<Pick<Trip, 'name' | 'startDate' | 'endDate' | 'notes' | 'coverPhotoId'>>,
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

async function findTripEntryRow(tripId: string, entryId: string) {
  return db.tripEntries.filter((te) => te.tripId === tripId && te.entryId === entryId).first()
}

/** Idempotent — attaching an already-attached entry is a no-op; re-attaching a detached one revives its row rather than duplicating it. */
export async function attachEntryToTrip(tripId: string, entryId: string): Promise<void> {
  const existing = await findTripEntryRow(tripId, entryId)
  if (existing && existing.deletedAt === null) return
  if (existing) {
    await tripEntriesRepo.restore(existing.id, { tripId, entryId, addedAt: existing.addedAt })
    return
  }
  await tripEntriesRepo.create({ tripId, entryId, addedAt: Date.now() })
}

export async function detachEntryFromTrip(tripId: string, entryId: string): Promise<void> {
  const existing = await findTripEntryRow(tripId, entryId)
  if (existing && existing.deletedAt === null) await tripEntriesRepo.softDelete(existing.id)
}

/**
 * Called from `cascadeRepo.setPlaceStatus`, inside its own transaction, after
 * every direct status set — never for the ancestor entries the cascade
 * creates alongside it. This is what "attach at the city level; plus any
 * country added directly" (05-trips.md task 1) resolves to as one rule: the
 * *target* of a direct set attaches (city, subdivision or country alike),
 * whatever it implies upward does not. No-ops when no trip is capturing, or
 * when the place is already attached (re-touching an existing entry, e.g. a
 * second visit to a city already on this trip, is exactly the "existing
 * entries touched" case the brief calls out — attaching again is a harmless
 * no-op). Covers a live trip and a backfilling one identically — the only
 * difference between the two lives in what date `PlaceStatusSheet` offers as
 * a default before calling `setPlaceStatus`, not in attachment itself.
 */
export async function autoAttachToCapturingTrip(entryId: string): Promise<void> {
  const capturing = await getCapturingTrip()
  if (capturing) await attachEntryToTrip(capturing.id, entryId)
}

/**
 * The date offered for the next place touched while backfilling: the trip's
 * start date if nothing has been attached yet, otherwise the `firstVisited`
 * of whichever entry was *most recently attached* (by `tripEntries.addedAt`,
 * not by date value — chains off the last thing you touched, not the latest
 * date typed), falling back to the start date if that entry has no date.
 */
export async function nextBackfillDate(tripId: string, startDate: string): Promise<string> {
  const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
  if (rows.length === 0) return startDate
  const latest = rows.reduce((a, b) => (a.addedAt > b.addedAt ? a : b))
  const entry = await db.entries.get(latest.entryId)
  return entry?.firstVisited ?? startDate
}

/** Trip ids (active membership only) a given entry currently belongs to — for the place-status sheet's trip toggle. */
export async function tripIdsForEntry(entryId: string): Promise<Set<string>> {
  const rows = await db.tripEntries.filter((te) => te.entryId === entryId && te.deletedAt === null).toArray()
  return new Set(rows.map((r) => r.tripId))
}

export function listTrips(): Promise<Trip[]> {
  return tripsRepo.listActive()
}

/** Active (non-deleted) tripEntries rows for one trip, each carrying the entryId to resolve. */
export async function entryIdsForTrip(tripId: string): Promise<string[]> {
  const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
  return rows.map((r) => r.entryId)
}
