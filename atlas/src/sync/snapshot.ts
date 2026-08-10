// Bridge between Dexie and the pure merge: read the local synced state out, and
// write a merged state back. The write is deliberately NOT routed through repo.ts
// — repo stamps `updatedAt = now`, which would destroy the last-write-wins
// timestamps the merge depends on. Sync is a second sanctioned system-level
// writer to the user tables (alongside the cascade), writing rows verbatim.

import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { rebuildDerivedEntries } from '@/domain/cascadeRepo'
import type { SyncSnapshot } from '@/sync/types'

/**
 * The local snapshot to merge/push. Entries are limited to those the user has
 * *touched*: explicit entries and tombstones. Purely-derived entries are left
 * out and recomputed after every merge (plan §7.3). See the note in
 * `applyMergedSnapshot` on the one edge this trades away.
 */
export async function buildLocalSnapshot(): Promise<SyncSnapshot> {
  const [entries, trips, tripEntries, photos, settings] = await Promise.all([
    db.entries.filter((e) => e.explicit || e.deletedAt !== null).toArray(),
    db.trips.toArray(),
    db.tripEntries.toArray(),
    db.photos.toArray(),
    settingsRepo.get(),
  ])
  return {
    entries,
    trips,
    tripEntries,
    photos,
    settings: {
      statMode: settings?.statMode ?? 'countries',
      countryDenominator: settings?.countryDenominator ?? 'all',
      theme: settings?.theme ?? 'dark',
    },
  }
}

/**
 * Replace the local synced state with the merged one, in a single transaction,
 * then recompute derived entries.
 *
 * `entries` and `tripEntries` are cleared and re-added rather than upserted:
 *   - entries carry a unique [kind+refId] index, so a merged explicit row could
 *     collide with a differently-id'd local derived row for the same place;
 *     clearing frees every slot, and rebuildAllDerived recreates the derived rows.
 *   - tripEntries can be de-duplicated by the merge (two ids collapsing to one),
 *     so a stale local id must not linger.
 * trips and photos never lose an id in the merge (pure union by id), so a plain
 * upsert is complete for them and keeps their rows (and photo blobs) untouched.
 */
export async function applyMergedSnapshot(merged: SyncSnapshot): Promise<void> {
  await db.transaction(
    'rw',
    [db.entries, db.trips, db.tripEntries, db.photos, db.settings, db.cities, db.syncState],
    async () => {
      await db.entries.clear()
      await db.entries.bulkAdd(merged.entries)

      await db.trips.bulkPut(merged.trips)

      await db.tripEntries.clear()
      await db.tripEntries.bulkAdd(merged.tripEntries)

      await db.photos.bulkPut(merged.photos)

      // Only the synced fields; device-local settings (deviceId, geoDataVersion,
      // autoSync, driveConnected, photoUploadOnCellular, mapView, lastSyncAt) are untouched.
      await settingsRepo.update({
        statMode: merged.settings.statMode,
        countryDenominator: merged.settings.countryDenominator,
        theme: merged.settings.theme,
      })

      // Recompute derived entries from the merged explicit set (plan §7.3). Its
      // own transaction joins this one (subset scope, same mode).
      await rebuildDerivedEntries()
    },
  )
}
