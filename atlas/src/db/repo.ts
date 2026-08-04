// The only module allowed to touch Dexie's user-data tables directly.
// Every write here stamps updatedAt, bumps syncState.revision, and never
// hard-deletes a synced row — that invariant is what makes sync (phase 7)
// possible without a server.
import type { EntityTable, IDType } from 'dexie'
import { db } from '@/db/schema'
import type { Entry, Photo, PhotoBlob, Settings, SyncedRecord, SyncState, Trip, TripEntry } from '@/db/types'

async function bumpRevision(): Promise<void> {
  // Touch only `revision` — a whole-row put here would wipe the sync bookkeeping
  // fields (remoteRevision, pushedRevision, lastSyncedSettings, timestamps) that
  // the sync layer owns. The singleton is guaranteed to exist (seedDatabase runs
  // before render), so a field-scoped update is safe and minimal.
  const current = await db.syncState.get(1)
  await db.syncState.update(1, { revision: (current?.revision ?? 0) + 1 })
}

type Draft<T extends SyncedRecord> = Omit<T, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>
type Patch<T extends SyncedRecord> = Partial<Omit<T, 'id' | 'createdAt' | 'deletedAt'>>

function makeRepo<T extends SyncedRecord>(table: EntityTable<T, 'id'>) {
  return {
    async create(draft: Draft<T>): Promise<T> {
      const now = Date.now()
      const record = { ...draft, id: crypto.randomUUID(), createdAt: now, updatedAt: now, deletedAt: null } as T
      await db.transaction('rw', table, db.syncState, async () => {
        await table.add(record)
        await bumpRevision()
      })
      return record
    },

    async update(id: string, patch: Patch<T>): Promise<void> {
      // Dexie's generic `update()` overloads don't simplify for a type
      // parameter constrained only by `extends SyncedRecord`; the external
      // signature above keeps this call site type-safe for callers.
      const changes = { ...patch, updatedAt: Date.now() }
      await db.transaction('rw', table, db.syncState, async () => {
        await table.update(id as IDType<T, 'id'>, changes as never)
        await bumpRevision()
      })
    },

    /**
     * Bring a soft-deleted row back, optionally with new field values. Deletes
     * are soft, and `entries` has a unique [kind+refId] index — so re-adding a
     * place the user removed has to revive that row rather than insert a second
     * one, which would fail with a ConstraintError. See @/domain/cascade.
     */
    async restore(id: string, patch: Patch<T>): Promise<void> {
      const changes = { ...patch, deletedAt: null, updatedAt: Date.now() }
      await db.transaction('rw', table, db.syncState, async () => {
        await table.update(id as IDType<T, 'id'>, changes as never)
        await bumpRevision()
      })
    },

    async softDelete(id: string): Promise<void> {
      const changes = { deletedAt: Date.now(), updatedAt: Date.now() }
      await db.transaction('rw', table, db.syncState, async () => {
        await table.update(id as IDType<T, 'id'>, changes as never)
        await bumpRevision()
      })
    },

    get(id: string): Promise<T | undefined> {
      return table.get(id as IDType<T, 'id'>)
    },

    listActive(): Promise<T[]> {
      return table.filter((row) => row.deletedAt === null).toArray()
    },
  }
}

export const entriesRepo = makeRepo<Entry>(db.entries)
export const tripsRepo = makeRepo<Trip>(db.trips)
export const tripEntriesRepo = makeRepo<TripEntry>(db.tripEntries)
export const photosRepo = makeRepo<Photo>(db.photos)

// Device-only binary cache. Not part of the synced JSON document — deleting
// a blob is fine even though `deletedAt` fields never get hard-deleted.
export const photoBlobsRepo = {
  put(photoId: string, full: Blob, thumb: Blob): Promise<string> {
    return db.photoBlobs.put({ photoId, full, thumb })
  },
  get(photoId: string): Promise<PhotoBlob | undefined> {
    return db.photoBlobs.get(photoId)
  },
  delete(photoId: string): Promise<void> {
    return db.photoBlobs.delete(photoId)
  },
}

// Singletons — no id generation, no soft delete.
export const settingsRepo = {
  get(): Promise<Settings | undefined> {
    return db.settings.get(1)
  },
  async update(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
    await db.settings.update(1, patch)
  },
}

export const syncStateRepo = {
  get(): Promise<SyncState | undefined> {
    return db.syncState.get(1)
  },
}
