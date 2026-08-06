// Sync orchestration (07-sync-and-deploy.md task 4). Pull, merge, write, push,
// photos — always safe to run twice, and never reports success for a run that
// didn't finish.

import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { logError, logInfo } from '@/debug/log'
import { AuthError, describeAuthError, getAccessToken, isConfigured } from '@/sync/auth'
import { DriveError, DriveUnavailableError, findFile, uploadJson, downloadJson } from '@/sync/drive'
import { applyMergedSnapshot, buildLocalSnapshot } from '@/sync/snapshot'
import { mergeSnapshots, snapshotsEqual } from '@/sync/merge'
import { pendingPhotoCounts, syncPhotos } from '@/sync/photos'
import { SYNC_SCHEMA_VERSION, type AtlasDoc, type SyncSnapshot } from '@/sync/types'
import { useSyncStore } from '@/sync/syncStore'

const DATA_FILE = 'atlas-data.json'

export type SyncOutcome = 'ok' | 'not-connected' | 'not-configured' | 'offline' | 'auth' | 'error'

export interface SyncResult {
  outcome: SyncOutcome
  pushed: boolean
  pulled: boolean
  message?: string
}

let inFlight: Promise<SyncResult> | null = null
let queued = false

/**
 * Run a sync. A second call while one is running returns the first promise
 * (the in-memory lock, task 4 step 1) — never two concurrent syncs.
 */
export function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight
  inFlight = runSync().finally(() => {
    inFlight = null
  })
  return inFlight
}

/** True if a sync was skipped because we were offline and should retry on reconnect. */
export const hasQueuedSync = (): boolean => queued

async function readSyncState() {
  const s = await db.syncState.get(1)
  return {
    revision: s?.revision ?? 0,
    remoteRevision: s?.remoteRevision ?? 0,
    pushedRevision: s?.pushedRevision ?? 0,
    lastPushedAt: s?.lastPushedAt ?? null,
    lastSyncedSettings: s?.lastSyncedSettings ?? null,
  }
}

async function runSync(): Promise<SyncResult> {
  const store = useSyncStore.getState()

  if (!isConfigured()) return { outcome: 'not-configured', pushed: false, pulled: false }

  const settings = await settingsRepo.get()
  if (!settings?.driveConnected) return { outcome: 'not-connected', pushed: false, pulled: false }

  if (!navigator.onLine) {
    queued = true
    store.setOffline('Offline — changes will sync when you’re back online.')
    return { outcome: 'offline', pushed: false, pulled: false }
  }

  store.setSyncing()
  void logInfo('sync: started')
  try {
    await getAccessToken() // may prompt/refresh; throws AuthError on failure

    // 1. Pull.
    const remoteFile = await findFile(DATA_FILE)
    const remoteDoc = remoteFile ? await downloadJson<AtlasDoc>(remoteFile.id) : null
    if (remoteDoc && remoteDoc.schema > SYNC_SCHEMA_VERSION) {
      store.setError('This copy of Atlas is older than the data in your Drive. Update the app, then sync again.')
      return { outcome: 'error', pushed: false, pulled: false, message: 'remote schema newer' }
    }
    const remoteSnapshot: SyncSnapshot | null = remoteDoc?.data ?? null

    const bookkeeping = await readSyncState()
    const photoWork = await pendingPhotoCounts()

    // 2. Skip the merge/push if nothing changed on either side and no photo work
    //    is outstanding (task 4 step 2). Still records the sync time.
    const remoteUnchanged = remoteDoc !== null && remoteDoc.revision === bookkeeping.remoteRevision
    const noLocalChanges = bookkeeping.revision === bookkeeping.pushedRevision
    if (remoteUnchanged && noLocalChanges && photoWork.uploads === 0 && photoWork.cleanups === 0) {
      await settingsRepo.update({ lastSyncAt: Date.now() })
      queued = false
      store.setIdle()
      return { outcome: 'ok', pushed: false, pulled: false }
    }

    // 3. Photo pass first, so new/cleared driveFileIds ride along in the doc.
    await syncPhotos()

    // 4. Merge (photo metadata is now current in the local snapshot).
    const local = await buildLocalSnapshot()
    const merged: SyncSnapshot = remoteSnapshot
      ? mergeSnapshots({ local, remote: remoteSnapshot, settingsBase: bookkeeping.lastSyncedSettings })
      : local

    // 5. Write locally only if the merge actually changed local state.
    if (!snapshotsEqual(merged, local)) await applyMergedSnapshot(merged)

    // 6. Push only if the remote is missing or differs — keeps re-syncing an
    //    unchanged payload from bumping the revision forever (idempotence).
    const remoteChanged = remoteSnapshot === null || !snapshotsEqual(merged, remoteSnapshot)
    let pushed = false
    let newRemoteRevision = remoteDoc?.revision ?? 0
    if (remoteChanged) {
      newRemoteRevision = (remoteDoc?.revision ?? 0) + 1
      const doc: AtlasDoc = {
        schema: SYNC_SCHEMA_VERSION,
        revision: newRemoteRevision,
        updatedAt: Date.now(),
        data: merged,
      }
      await uploadJson(DATA_FILE, doc, remoteFile?.id)
      pushed = true
    }

    // 7. Bookkeeping. finalRevision includes bumps from applyMergedSnapshot's
    //    derived rebuild — those are local-only, so treating them as "pushed"
    //    is correct and stops a phantom re-push next time.
    const finalRevision = (await db.syncState.get(1))?.revision ?? bookkeeping.revision
    const now = Date.now()
    await db.syncState.update(1, {
      remoteRevision: newRemoteRevision,
      pushedRevision: finalRevision,
      lastPulledAt: now,
      lastPushedAt: pushed ? now : bookkeeping.lastPushedAt,
      lastSyncedSettings: merged.settings,
    })
    await settingsRepo.update({ lastSyncAt: now })

    queued = false
    store.setIdle()
    return { outcome: 'ok', pushed, pulled: remoteSnapshot !== null }
  } catch (e) {
    if (e instanceof AuthError) {
      store.setError(describeAuthError(e.kind))
      if (e.kind !== 'gesture_required') void logError(`sync: auth error (${e.kind})`, e.message)
      return { outcome: 'auth', pushed: false, pulled: false, message: e.message }
    }
    if (e instanceof DriveUnavailableError || !navigator.onLine) {
      queued = true
      store.setOffline('Couldn’t reach Google Drive. Your changes are safe and will sync when the connection is back.')
      return { outcome: 'offline', pushed: false, pulled: false, message: e instanceof Error ? e.message : String(e) }
    }
    const message = e instanceof DriveError ? e.message : e instanceof Error ? e.message : String(e)
    store.setError(`Sync failed: ${message}`)
    void logError('sync: failed', message)
    return { outcome: 'error', pushed: false, pulled: false, message }
  }
}
