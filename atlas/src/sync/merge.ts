// The sync merge (plan §7.2, 07-sync-and-deploy.md task 3). A pure function over
// two snapshots — no Dexie, no network — so it can be exhausted by unit tests.
//
// Rules, straight from the plan:
//   - Last-write-wins per record.
//   - A tombstone wins if its `deletedAt` is later than the other side's
//     `updatedAt`. Because every soft-delete also bumps `updatedAt` to the same
//     instant, comparing `max(updatedAt, deletedAt)` implements *both* the LWW
//     rule and the tombstone rule at once (see `stamp` below).
//   - Records present on only one side are kept.
//   - Derived entries are excluded entirely (the caller only ever puts explicit
//     entries into a snapshot) and recomputed afterwards with rebuildAllDerived.
//   - Settings merge field-by-field, not wholesale.
//
// The one place this departs from the plan's "key records by id": `entries` are
// keyed by their natural key `[kind+refId]`, because the table's unique
// `&[kind+refId]` index forbids two rows sharing it — even a tombstone plus an
// active row. Two devices adding the same place offline mint two ids for one
// key; merging by id would keep both and the local write would then throw. So
// entries collapse by natural key, the surviving id wins deterministically, and
// any tripEntries/photos that referenced a dropped duplicate id are re-pointed
// to the survivor. All of that is pure and convergent, so it's testable here.

import type { Entry, Photo, TripEntry } from '@/db/types'
import type { SyncableSettings, SyncSnapshot } from '@/sync/types'
import { SYNCABLE_SETTING_KEYS } from '@/sync/types'

interface Tombstoneable {
  id: string
  updatedAt: number
  deletedAt: number | null
}

/**
 * The single instant a record was last meaningfully changed. A soft-delete sets
 * `deletedAt` (and `updatedAt`) to the delete time, so `max` of the two gives a
 * tombstone the strict edge the plan asks for: "a tombstone wins if its
 * `deletedAt` is later than the other side's `updatedAt`."
 */
function stamp(r: Tombstoneable): number {
  return Math.max(r.updatedAt, r.deletedAt ?? 0)
}

/**
 * Pick the winning version of one record. Higher stamp wins. On an exact tie a
 * deletion wins (deletes are sticky), then the larger id — an arbitrary but
 * *total, deterministic* order so every device converges on the same choice.
 */
function pickWinner<T extends Tombstoneable>(a: T, b: T): T {
  const sa = stamp(a)
  const sb = stamp(b)
  if (sa !== sb) return sa > sb ? a : b
  const aDel = a.deletedAt !== null
  const bDel = b.deletedAt !== null
  if (aDel !== bDel) return aDel ? a : b
  return a.id >= b.id ? a : b
}

/** Last-write-wins union keyed by `id`. Used for trips, tripEntries, photos. */
function mergeById<T extends Tombstoneable>(local: readonly T[], remote: readonly T[]): T[] {
  const winners = new Map<string, T>()
  for (const record of [...local, ...remote]) {
    const existing = winners.get(record.id)
    winners.set(record.id, existing ? pickWinner(existing, record) : record)
  }
  return [...winners.values()]
}

const entryKey = (kind: Entry['kind'], refId: string): string => `${kind}:${refId}`

interface EntryMergeResult {
  entries: Entry[]
  /** old id → surviving id, for every id that lost its natural-key slot. */
  idRemap: Map<string, string>
}

/**
 * Merge entries by their natural key `[kind+refId]`. Every version of a key
 * (from either side) collapses to one winner; every non-winning id for that key
 * is recorded in `idRemap` so references can follow the survivor.
 */
function mergeEntriesByKey(local: readonly Entry[], remote: readonly Entry[]): EntryMergeResult {
  const byKey = new Map<string, Entry[]>()
  for (const entry of [...local, ...remote]) {
    const key = entryKey(entry.kind, entry.refId)
    const bucket = byKey.get(key)
    if (bucket) bucket.push(entry)
    else byKey.set(key, [entry])
  }

  const entries: Entry[] = []
  const idRemap = new Map<string, string>()
  for (const bucket of byKey.values()) {
    // Collapse all versions (possibly several ids) of this one place to a winner.
    const winner = bucket.reduce((best, next) => pickWinner(best, next))
    entries.push(winner)
    for (const entry of bucket) {
      if (entry.id !== winner.id) idRemap.set(entry.id, winner.id)
    }
  }
  return { entries, idRemap }
}

/** Follow the id remap, if this id lost its slot to a duplicate that won. */
function survivingId(id: string, remap: Map<string, string>): string {
  return remap.get(id) ?? id
}

/**
 * After entry ids may have been remapped, collapse tripEntries that now point at
 * the same [tripId, entryId] into one (LWW). Without this, two devices each
 * linking their own duplicate entry to the same trip would leave two rows.
 */
function dedupeTripEntries(rows: readonly TripEntry[]): TripEntry[] {
  const byPair = new Map<string, TripEntry>()
  for (const row of rows) {
    const pair = `${row.tripId}:${row.entryId}`
    const existing = byPair.get(pair)
    if (!existing) {
      byPair.set(pair, row)
      continue
    }
    // Keep the winner as the canonical row, but never resurrect a pair the
    // winner had tombstoned: if either says deleted-latest, that wins.
    byPair.set(pair, pickWinner(existing, row))
  }
  return [...byPair.values()]
}

/**
 * Field-by-field three-way merge for the synced settings. `base` is the settings
 * as of the last successful sync (persisted in syncState); it lets two devices
 * each change a *different* field and keep both, instead of one whole object
 * clobbering the other.
 *
 *   - no base yet (this device's first sync against an existing doc): the shared
 *     Drive value wins — a newly-connected device adopts the account's prefs.
 *   - a field only one side changed: that side wins.
 *   - a field both sides changed differently: remote wins (deterministic).
 */
function chooseField<K extends keyof SyncableSettings>(
  base: SyncableSettings | null,
  local: SyncableSettings,
  remote: SyncableSettings,
  key: K,
): SyncableSettings[K] {
  if (base === null) return remote[key] // new device adopts the shared Drive value
  if (local[key] === base[key]) return remote[key] // only remote (maybe) changed it
  if (remote[key] === base[key]) return local[key] // only local changed it
  return remote[key] // both changed differently → remote wins, deterministically
}

export function mergeSettings(
  base: SyncableSettings | null,
  local: SyncableSettings,
  remote: SyncableSettings,
): SyncableSettings {
  return {
    statMode: chooseField(base, local, remote, 'statMode'),
    countryDenominator: chooseField(base, local, remote, 'countryDenominator'),
    theme: chooseField(base, local, remote, 'theme'),
  }
}

export interface MergeInput {
  local: SyncSnapshot
  remote: SyncSnapshot
  /** Synced-settings baseline from the last sync, for the field-by-field merge. */
  settingsBase: SyncableSettings | null
}

/**
 * Merge two snapshots into one. Pure and idempotent: merging a payload that is
 * already the union changes nothing, and re-merging the result is stable.
 */
export function mergeSnapshots({ local, remote, settingsBase }: MergeInput): SyncSnapshot {
  const { entries, idRemap } = mergeEntriesByKey(local.entries, remote.entries)

  const trips = mergeById(local.trips, remote.trips)

  const mergedTripEntries = mergeById(local.tripEntries, remote.tripEntries).map((row) =>
    idRemap.has(row.entryId) ? { ...row, entryId: survivingId(row.entryId, idRemap) } : row,
  )
  const tripEntries = dedupeTripEntries(mergedTripEntries)

  const photos = mergeById(local.photos, remote.photos).map((row) =>
    row.entryId !== null && idRemap.has(row.entryId)
      ? { ...row, entryId: survivingId(row.entryId, idRemap) }
      : row,
  ) as Photo[]

  const settings = mergeSettings(settingsBase, local.settings, remote.settings)

  return { entries, trips, tripEntries, photos, settings }
}

// Exposed for the orchestrator's "did anything actually change?" check and for
// tests. A stable, order-independent serialisation of a snapshot: sort every
// table by id and the settings keys, so two snapshots with the same content
// always stringify identically regardless of row order.
export function canonicalize(snapshot: SyncSnapshot): string {
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const sortRecords = <T extends { id: string }>(rows: readonly T[]): T[] => [...rows].sort(byId)
  const settings: Record<string, unknown> = {}
  for (const key of [...SYNCABLE_SETTING_KEYS].sort()) settings[key] = snapshot.settings[key]
  return JSON.stringify({
    entries: sortRecords(snapshot.entries),
    trips: sortRecords(snapshot.trips),
    tripEntries: sortRecords(snapshot.tripEntries),
    photos: sortRecords(snapshot.photos),
    settings,
  })
}

export function snapshotsEqual(a: SyncSnapshot, b: SyncSnapshot): boolean {
  return canonicalize(a) === canonicalize(b)
}
