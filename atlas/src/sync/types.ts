// Shapes for the Google Drive sync layer (07-sync-and-deploy.md, plan §7).
//
// The synced document is a single JSON file (`atlas-data.json`) in Drive's
// appDataFolder holding every *user* table. (Older docs also carry a `photos`
// array, and the folder may still hold `photo-<id>.jpg` files, from before
// photos were removed — both are simply ignored now.)

import type {
  City,
  CountryDenominator,
  Entry,
  StatMode,
  Theme,
  Trip,
  TripEntry,
} from '@/db/types'

// Bump if the document layout changes in a way older clients can't read. v2
// added `cities` (the non-bundled reference rows an entry can point at). It is
// a hard bump on purpose: a v1 client can't produce that field, so letting it
// keep pushing would rewrite the Drive doc *without* those rows and silently
// unsync every online/manual place. The `schema > SYNC_SCHEMA_VERSION` guard in
// sync.ts makes a v1 client refuse a v2 doc instead — safe until it updates.
// v3 dropped `photos`: a v2 client reads that array unguarded and would fail
// every sync on a doc without it, so it's told to update instead. A v3 client
// reading a v2 doc just ignores the field.
export const SYNC_SCHEMA_VERSION = 3 as const

/**
 * The subset of `settings` that syncs. Everything else on the Settings row is
 * deliberately device-local and must never be overwritten from a remote:
 * `deviceId` and `geoDataVersion` (per-device, see @/db/types), `autoSync`
 * (this device's own policy), and `lastSyncAt` (this device's own bookkeeping).
 */
export interface SyncableSettings {
  statMode: StatMode
  countryDenominator: CountryDenominator
  theme: Theme
}

export const SYNCABLE_SETTING_KEYS: readonly (keyof SyncableSettings)[] = [
  'statMode',
  'countryDenominator',
  'theme',
]

/**
 * Everything the merge operates on. `entries` carries **explicit entries only** —
 * derived ones are excluded from the document and recomputed locally with
 * `rebuildAllDerived()` after every merge (plan §7.3), so two devices never
 * fight over rows neither user ever touched.
 */
export interface SyncSnapshot {
  entries: Entry[]
  trips: Trip[]
  tripEntries: TripEntry[]
  // Non-bundled reference rows only — the 'online' (Photon) and 'manual' cities
  // an entry may point at by negative geonameId. They must travel with the doc:
  // a city entry synced without its `cities` row lands on the other device as a
  // dangling reference, and the cascade throws UnknownCityError on it, failing
  // the whole sync. Bundled cities are never included (all 170k are seeded from
  // committed data on every device — see @/geo/loader).
  cities: City[]
  settings: SyncableSettings
}

/** The on-Drive document. `revision` bumps only when a push carries changed content. */
export interface AtlasDoc {
  schema: typeof SYNC_SCHEMA_VERSION
  revision: number
  updatedAt: number
  data: SyncSnapshot
}
