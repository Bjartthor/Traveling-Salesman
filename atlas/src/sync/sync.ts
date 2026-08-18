// Sync orchestration (07-sync-and-deploy.md task 4). Pull, merge, write, push,
// photos — always safe to run twice, and never reports success for a run that
// didn't finish.

import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { logError, logInfo } from '@/debug/log'
import { AuthError, describeAuthError, getAccessToken, isConfigured } from '@/sync/auth'
import { DriveError, DriveUnavailableError, findFile, uploadJson, downloadJson } from '@/sync/drive'
import { applyMergedSnapshot, buildLocalSnapshot } from '@/sync/snapshot'
import { canonicalize, mergeSnapshots } from '@/sync/merge'
import { pendingPhotoCounts, syncPhotos } from '@/sync/photos'
import { SYNC_SCHEMA_VERSION, type AtlasDoc, type SyncSnapshot } from '@/sync/types'
import { useSyncStore } from '@/sync/syncStore'
import { heapSummary } from '@/debug/memory'

const DATA_FILE = 'atlas-data.json'

// Every sync breadcrumb carries the current heap summary (and, where useful, the
// payload size that phase just handled). A sync is a periodic main-thread memory
// spike — download + parse the remote doc, snapshot the local tables, merge,
// serialise — so if the intermittent "Aw snap!" is a renderer OOM, this is the
// trail that shows the heap climbing across the phases right before the log
// stops. See @/debug/memoryWatch for the between-syncs watchdog.
function withHeap(detail?: string): string | undefined {
  const parts = [detail, heapSummary()].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/** Compact per-table counts for a snapshot, for a breadcrumb's detail. */
function snapshotSizes(s: SyncSnapshot): string {
  return `entries=${s.entries.length} trips=${s.trips.length} tripEntries=${s.tripEntries.length} photos=${s.photos.length}`
}

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
  void logInfo('sync: started', withHeap())
  try {
    await getAccessToken() // may prompt/refresh; throws AuthError on failure

    // 1. Pull.
    const remoteFile = await findFile(DATA_FILE)
    const remoteDoc = remoteFile ? await downloadJson<AtlasDoc>(remoteFile.id) : null
    // `remoteFile.size` is the Drive file's byte size, already fetched by
    // findFile's metadata query — a free, allocation-free measure of exactly the
    // payload downloadJson just parsed (the pull's single largest allocation).
    void logInfo(
      'sync: pulled',
      withHeap(
        remoteDoc
          ? `${remoteFile?.size ?? '?'}B · rev=${remoteDoc.revision} · ${snapshotSizes(remoteDoc.data)}`
          : 'no remote file',
      ),
    )
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

    void logInfo('sync: state read', withHeap())

    // 3. Photo pass first, so new/cleared driveFileIds ride along in the doc.
    await syncPhotos()
    void logInfo('sync: photos done', withHeap())

    // 4. Merge (photo metadata is now current in the local snapshot).
    // These breadcrumbs split the heaviest window of a sync — the ~1.3 GB heap
    // runaway in a captured OOM (2026-08-18) all happened between `sync: pulled`
    // and `sync: merged`, which used to be one un-instrumented gap spanning the
    // snapshot read (a full ~170k-row cities scan in buildLocalSnapshot), the
    // merge, and canonicalisation. Stamping each step tells the next capture
    // exactly which one the heap explodes in. See PROGRESS.md.
    const local = await buildLocalSnapshot()
    void logInfo('sync: snapshot built', withHeap(snapshotSizes(local)))
    const merged: SyncSnapshot = remoteSnapshot
      ? mergeSnapshots({ local, remote: remoteSnapshot, settingsBase: bookkeeping.lastSyncedSettings })
      : local
    void logInfo('sync: merged', withHeap(snapshotSizes(merged)))

    // canonicalize(merged) is the largest string a sync builds; compute it once
    // and compare strings for both the "did local change?" and "did remote
    // change?" checks below, instead of snapshotsEqual re-serialising `merged`
    // twice (two full stringifies of the same, possibly large, object) — trims
    // the pull's peak main-thread allocation.
    const mergedCanon = canonicalize(merged)
    void logInfo('sync: canonicalized', withHeap())

    // 5. Write locally only if the merge actually changed local state.
    if (mergedCanon !== canonicalize(local)) {
      await applyMergedSnapshot(merged)
      void logInfo('sync: applied merge locally', withHeap())
    }

    // 6. Push only if the remote is missing or differs — keeps re-syncing an
    //    unchanged payload from bumping the revision forever (idempotence).
    const remoteChanged = remoteSnapshot === null || mergedCanon !== canonicalize(remoteSnapshot)
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
      void logInfo('sync: pushed', withHeap(`rev=${newRemoteRevision}`))
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
    void logInfo('sync: ok', withHeap())
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
