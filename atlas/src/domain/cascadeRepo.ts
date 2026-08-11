// The Dexie-facing half of the cascade: read a snapshot, hand it to the pure
// engine in cascade.ts, apply the mutations it returns through repo.ts. All of
// it inside one read-write transaction, so a status change is atomic — a city
// and the country it implies are never half-written.
//
// Nothing else in the app should write to `entries` directly. Going around this
// module means going around the cascade.

import { db } from '@/db/schema'
import { entriesRepo } from '@/db/repo'
import { logInfo } from '@/debug/log'
import { heapSummary } from '@/debug/memory'
import {
  rebuildAllDerived,
  removeEntry,
  setStatus,
  type CascadeState,
  type CityPlace,
  type Mutation,
  type SetStatusRequest,
} from '@/domain/cascade'
import { autoAttachToActiveTrip } from '@/domain/tripRepo'

/**
 * A city entry points at a `cities` row that is not there. Loud on purpose: the
 * engine reasons about a country's existence from the cities under it, so
 * quietly dropping such an entry would let `rebuildAllDerived` delete a country
 * the user really has visited.
 *
 * The known way to provoke this is a reference-data reseed — `ensureReferenceData`
 * in @/geo/loader does `db.cities.clear()` on a `geoDataVersion` bump, which
 * takes any `source: 'online'` city with it. Phase 4b has to preserve
 * non-bundled cities across that reseed.
 */
export class UnknownCityError extends Error {
  readonly refIds: string[]

  constructor(refIds: string[]) {
    super(`cascade: ${refIds.length} city entr${refIds.length === 1 ? 'y has' : 'ies have'} no cities row: ${refIds.join(', ')}`)
    this.name = 'UnknownCityError'
    this.refIds = refIds
  }
}

/**
 * Snapshot everything the engine needs. Entries come back *including* soft-deleted
 * rows (they still own their unique [kind+refId] slot); city reference rows are
 * fetched only for the cities actually referenced, plus `extraCityRefIds` for a
 * city about to be added for the first time.
 */
export async function loadCascadeState(extraCityRefIds: readonly string[] = []): Promise<CascadeState> {
  const entries = await db.entries.toArray()

  const refIds = new Set(extraCityRefIds)
  for (const entry of entries) {
    if (entry.kind === 'city' && entry.deletedAt === null) refIds.add(entry.refId)
  }

  const wanted = [...refIds]
  const rows = await db.cities.bulkGet(wanted.map(Number))

  const cities = new Map<string, CityPlace>()
  const missing: string[] = []
  wanted.forEach((refId, i) => {
    const row = rows[i]
    if (!row) {
      missing.push(refId)
      return
    }
    cities.set(refId, { refId, countryCode: row.countryCode, subdivisionId: row.subdivisionId })
  })
  if (missing.length > 0) throw new UnknownCityError(missing)

  return { entries, places: { cities } }
}

/**
 * Apply in order. Each repo call opens its own transaction, which Dexie joins to
 * the surrounding one (same mode, subset of tables) rather than starting a new
 * one — so this stays a single atomic unit. `revision` therefore ticks once per
 * mutation rather than once per cascade; it only has to be monotonic (plan §7).
 */
async function applyMutations(mutations: readonly Mutation[]): Promise<void> {
  for (const mutation of mutations) {
    switch (mutation.op) {
      case 'create':
        // `notes` is the one entry field the cascade does not manage.
        await entriesRepo.create({ kind: mutation.kind, refId: mutation.refId, notes: '', ...mutation.fields })
        break
      case 'restore':
        await entriesRepo.restore(mutation.id, mutation.fields)
        break
      case 'update':
        await entriesRepo.update(mutation.id, mutation.changes)
        break
      case 'remove':
        await entriesRepo.softDelete(mutation.id)
        break
    }
  }
}

/**
 * Set a place's status, creating and recomputing whatever it implies above
 * it. If a trip is currently active, also attaches the *target* entry (never
 * the ancestors this implies) to it — see @/domain/tripRepo.autoAttachToActiveTrip.
 */
export async function setPlaceStatus(request: SetStatusRequest): Promise<void> {
  void logInfo(`place: set ${request.kind}/${request.refId} → ${request.status}`, heapSummary() || undefined)
  await db.transaction('rw', db.entries, db.cities, db.syncState, db.trips, db.tripEntries, async () => {
    const state = await loadCascadeState(request.kind === 'city' ? [request.refId] : [])
    await applyMutations(setStatus(state, request))
    const target = await db.entries.where('[kind+refId]').equals([request.kind, request.refId]).first()
    if (target) await autoAttachToActiveTrip(target.id)
  })
}

/** Remove one entry and settle its ancestors (§5.5). */
export async function removePlaceEntry(entryId: string): Promise<void> {
  void logInfo(`place: remove ${entryId}`, heapSummary() || undefined)
  await db.transaction('rw', db.entries, db.cities, db.syncState, async () => {
    const state = await loadCascadeState()
    await applyMutations(removeEntry(state, entryId))
  })
}

/** Recompute every derived entry. Run after a sync merge (plan §7.3); safe any time. */
export async function rebuildDerivedEntries(): Promise<number> {
  return db.transaction('rw', db.entries, db.cities, db.syncState, async () => {
    const state = await loadCascadeState()
    const mutations = rebuildAllDerived(state)
    await applyMutations(mutations)
    return mutations.length
  })
}
