// The Dexie-facing half of trip lifecycle (05-trips.md task 1). Trip/
// tripEntries writes go through @/db/repo like everything else, but the
// lifecycle rules (only one active trip, auto-attach on a touched entry,
// soft-delete never touching places) live here, one level up.
//
// `cascadeRepo.ts` calls `autoAttachToActiveTrip` from inside its own
// transaction after every `setPlaceStatus`, so "a place touched while a trip
// is running attaches to it" is never a step a caller can forget.

import { db } from '@/db/schema'
import { tripEntriesRepo, tripsRepo } from '@/db/repo'
import type { Trip } from '@/db/types'

export type ActiveTripConflictResolution = 'close' | 'leaveOpen'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The one trip currently capturing, or null. "Only one trip active" is an
 * app-level rule, not a DB constraint — enforced by always routing through
 * `createTrip`/`reopenTrip` below.
 *
 * Reads the (small) table directly rather than `where('isActive')`: IndexedDB
 * keys can't be booleans, so an index on a boolean column silently never
 * matches anything through Dexie's `where()` — harmless here since `trips`
 * stays small, but worth knowing before reaching for that index elsewhere.
 */
export async function getActiveTrip(): Promise<Trip | null> {
  const active = await db.trips.filter((t) => t.deletedAt === null && t.isActive).toArray()
  return active[0] ?? null
}

async function resolveConflict(active: Trip, resolution: ActiveTripConflictResolution): Promise<void> {
  if (resolution === 'close') {
    await tripsRepo.update(active.id, { isActive: false, endDate: active.endDate ?? today() })
  } else {
    // "Leave the old one open" — still no end date, just no longer the one capturing.
    await tripsRepo.update(active.id, { isActive: false })
  }
}

export interface CreateTripInput {
  name: string
  startDate: string
  endDate: string | null
  notes?: string
}

/**
 * `endDate` present at creation means a retroactive, already-closed trip —
 * `isActive` is false immediately and no conflict is possible. `endDate` null
 * means "starting now": if another trip is already active, `resolution` is
 * required (the caller must ask the user first — see TripForm/TripConflictDialog).
 */
export async function createTrip(input: CreateTripInput, resolution?: ActiveTripConflictResolution): Promise<Trip> {
  const isActive = input.endDate === null
  if (isActive) {
    const active = await getActiveTrip()
    if (active) {
      if (!resolution) throw new Error('Another trip is active — resolve the conflict first')
      await resolveConflict(active, resolution)
    }
  }
  return tripsRepo.create({
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    isActive,
    notes: input.notes ?? '',
    coverPhotoId: null,
  })
}

/** One-tap action, same immediacy as the place-status sheet's status buttons. */
export async function closeTrip(tripId: string, endDate?: string): Promise<void> {
  await tripsRepo.update(tripId, { isActive: false, endDate: endDate ?? today() })
}

/** Reversible close (05-trips.md task 1). Clears `endDate` — resuming capture means open-ended again until closed a second time. */
export async function reopenTrip(tripId: string, resolution?: ActiveTripConflictResolution): Promise<void> {
  const active = await getActiveTrip()
  if (active && active.id !== tripId) {
    if (!resolution) throw new Error('Another trip is active — resolve the conflict first')
    await resolveConflict(active, resolution)
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
 * whatever it implies upward does not. No-ops when no trip is active, or when
 * the place is already attached (re-touching an existing entry, e.g. a second
 * visit to a city already on this trip, is exactly the "existing entries
 * touched" case the brief calls out — attaching again is a harmless no-op).
 */
export async function autoAttachToActiveTrip(entryId: string): Promise<void> {
  const active = await getActiveTrip()
  if (active) await attachEntryToTrip(active.id, entryId)
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
