// One-step undo for the app's quick, one-tap edits — a status change, a
// removal, a Quick-add batch, a trip deletion. Generic on purpose: rather than
// teach every action its own inverse (a status tap can create, revive and
// re-rank a whole chain of ancestor entries and attach to a trip), the action
// runs between two snapshots of the user tables, and undo puts back exactly
// the rows it changed (repo `revert`) and tombstones the ones it created.
// Derived entries are then recomputed, so a revert that raced another write
// still leaves the cascade consistent.

import { create } from 'zustand'
import { db } from '@/db/schema'
import { entriesRepo, tripEntriesRepo, tripsRepo } from '@/db/repo'
import type { Entry, SyncedRecord, Trip, TripEntry } from '@/db/types'
import { rebuildDerivedEntries } from '@/domain/cascadeRepo'
import { logError, logInfo } from '@/debug/log'

export interface TableChanges<T extends SyncedRecord> {
  /** Rows the action modified, as they were before it. */
  restore: T[]
  /** Ids of rows the action created. */
  created: string[]
}

export interface UndoChanges {
  entries: TableChanges<Entry>
  trips: TableChanges<Trip>
  tripEntries: TableChanges<TripEntry>
}

interface Snapshot {
  entries: Entry[]
  trips: Trip[]
  tripEntries: TripEntry[]
}

/** What changed between two snapshots of one table. Pure. */
export function diffRows<T extends SyncedRecord>(before: readonly T[], after: readonly T[]): TableChanges<T> {
  const old = new Map(before.map((r) => [r.id, r]))
  const restore: T[] = []
  const created: string[] = []
  for (const row of after) {
    const prev = old.get(row.id)
    if (!prev) created.push(row.id)
    else if (prev.updatedAt !== row.updatedAt || prev.deletedAt !== row.deletedAt || JSON.stringify(prev) !== JSON.stringify(row)) restore.push(prev)
  }
  return { restore, created }
}

export function isEmpty(c: UndoChanges): boolean {
  return [c.entries, c.trips, c.tripEntries].every((t) => t.restore.length === 0 && t.created.length === 0)
}

async function snapshot(): Promise<Snapshot> {
  const [entries, trips, tripEntries] = await Promise.all([db.entries.toArray(), db.trips.toArray(), db.tripEntries.toArray()])
  return { entries, trips, tripEntries }
}

// --- the offer shown by UndoToast ---

export interface UndoOffer {
  id: number
  label: string
  changes: UndoChanges
}

interface UndoState {
  offer: UndoOffer | null
  set: (offer: UndoOffer | null) => void
}

export const useUndoStore = create<UndoState>((set) => ({
  offer: null,
  set: (offer) => set({ offer }),
}))

let nextOfferId = 1

/**
 * Run `action`, then offer to undo whatever it changed under `label` (e.g.
 * "Tokyo set to Visited"; a function is called after the action, for labels
 * that depend on its result). Errors from `action` propagate unchanged and
 * offer nothing. Only the latest action is undoable — a new one replaces it.
 */
export async function withUndo<R>(label: string | ((result: R) => string), action: () => Promise<R>): Promise<R> {
  const before = await snapshot()
  const result = await action()
  const after = await snapshot()
  const changes: UndoChanges = {
    entries: diffRows(before.entries, after.entries),
    trips: diffRows(before.trips, after.trips),
    tripEntries: diffRows(before.tripEntries, after.tripEntries),
  }
  if (!isEmpty(changes)) {
    useUndoStore.getState().set({ id: nextOfferId++, label: typeof label === 'function' ? label(result) : label, changes })
  }
  return result
}

async function revertTable<T extends SyncedRecord>(
  repo: { revert: (rows: readonly T[]) => Promise<void>; softDelete: (id: string) => Promise<void> },
  changes: TableChanges<T>,
): Promise<void> {
  await repo.revert(changes.restore)
  for (const id of changes.created) await repo.softDelete(id)
}

/** Undo the offered change, in one transaction. */
export async function undo(offer: UndoOffer): Promise<void> {
  useUndoStore.getState().set(null)
  void logInfo(`undo: ${offer.label}`)
  try {
    await db.transaction('rw', [db.entries, db.trips, db.tripEntries, db.cities, db.syncState], async () => {
      await revertTable(entriesRepo, offer.changes.entries)
      await revertTable(tripsRepo, offer.changes.trips)
      await revertTable(tripEntriesRepo, offer.changes.tripEntries)
      await rebuildDerivedEntries()
    })
  } catch (e) {
    void logError('undo: failed', e instanceof Error ? e.message : String(e))
    throw e
  }
}
