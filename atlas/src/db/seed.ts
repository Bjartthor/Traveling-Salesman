import { db } from '@/db/schema'

// Idempotent — safe to call on every app start. Only writes the singletons
// if they don't exist yet, so it never clobbers user settings.
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
    })
  }

  const existingSyncState = await db.syncState.get(1)
  if (!existingSyncState) {
    await db.syncState.put({
      id: 1,
      revision: 0,
      remoteRevision: 0,
      lastPulledAt: null,
      lastPushedAt: null,
    })
  }
}
