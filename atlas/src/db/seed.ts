import { db } from '@/db/schema'
import type { Settings, SyncState } from '@/db/types'

// Device-local defaults for fields added after Phase 1. Backfilled onto existing
// singletons on startup (below) so the rest of the app can assume they're set,
// without needing a Dexie version bump (none of them are indexed).
const SETTINGS_ADDED_DEFAULTS = {
  driveConnected: false,
  photoUploadOnCellular: false,
  mapView: 'flat',
  defaultDateToToday: true,
  regionBackfillDone: false,
} as const satisfies Partial<Settings>

const SYNCSTATE_ADDED_DEFAULTS = {
  pushedRevision: 0,
  lastSyncedSettings: null,
} as const satisfies Partial<SyncState>

// Idempotent — safe to call on every app start. Writes the singletons if they
// don't exist yet (never clobbering user settings), and backfills any field
// added in a later phase onto an already-existing singleton.
export async function seedDatabase(): Promise<void> {
  const existingSettings = await db.settings.get(1)
  if (!existingSettings) {
    await db.settings.put({
      id: 1,
      statMode: 'countries',
      countryDenominator: 'all',
      theme: 'dark',
      autoSync: true,
      lastSyncAt: null,
      deviceId: crypto.randomUUID(),
      geoDataVersion: 0, // reference data not seeded yet — see src/geo/loader.ts
      ...SETTINGS_ADDED_DEFAULTS,
    })
  } else {
    const patch = missingFields(existingSettings, SETTINGS_ADDED_DEFAULTS)
    if (patch) await db.settings.update(1, patch)
  }

  const existingSyncState = await db.syncState.get(1)
  if (!existingSyncState) {
    await db.syncState.put({
      id: 1,
      revision: 0,
      remoteRevision: 0,
      lastPulledAt: null,
      lastPushedAt: null,
      ...SYNCSTATE_ADDED_DEFAULTS,
    })
  } else {
    const patch = missingFields(existingSyncState, SYNCSTATE_ADDED_DEFAULTS)
    if (patch) await db.syncState.update(1, patch)
  }
}

/** Return only the defaults whose key is absent on the row, or null if none are. */
function missingFields<T extends object>(row: T, defaults: Partial<T>): Partial<T> | null {
  const patch: Partial<T> = {}
  let any = false
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    if (!(key in row) || row[key] === undefined) {
      patch[key] = defaults[key]
      any = true
    }
  }
  return any ? patch : null
}
