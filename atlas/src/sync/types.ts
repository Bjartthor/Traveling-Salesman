// Shapes for the Google Drive sync layer (07-sync-and-deploy.md, plan §7).
//
// The synced document is a single JSON file (`atlas-data.json`) in Drive's
// appDataFolder holding every *user* table except photo binaries. Photos ride
// along as one Drive file each (`photo-<id>.jpg`); their `photos` row (metadata)
// is synced here, their blob is not.

import type {
  CountryDenominator,
  Entry,
  Photo,
  StatMode,
  Theme,
  Trip,
  TripEntry,
} from '@/db/types'

/** Bump if the document layout changes in a way older clients can't read. */
export const SYNC_SCHEMA_VERSION = 1 as const

/**
 * The subset of `settings` that syncs. Everything else on the Settings row is
 * deliberately device-local and must never be overwritten from a remote:
 * `deviceId` and `geoDataVersion` (per-device, see @/db/types), `autoSync` and
 * the photo-cellular preference (this device's network policy), and
 * `lastSyncAt` (this device's own bookkeeping).
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
  photos: Photo[]
  settings: SyncableSettings
}

/** The on-Drive document. `revision` bumps only when a push carries changed content. */
export interface AtlasDoc {
  schema: typeof SYNC_SCHEMA_VERSION
  revision: number
  updatedAt: number
  data: SyncSnapshot
}
