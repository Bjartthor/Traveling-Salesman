// Photo binaries over Drive (07-sync-and-deploy.md task 5). The `photos` metadata
// row rides in atlas-data.json; the JPEG itself is a separate Drive file,
// `photo-<id>.jpg`, and the local blob lives only in photoBlobs.

import { db } from '@/db/schema'
import { photoBlobsRepo, settingsRepo } from '@/db/repo'
import type { PhotoBlob } from '@/db/types'
import { deleteFile, downloadBlob, DriveError, uploadBlob } from '@/sync/drive'
import { useSyncStore } from '@/sync/syncStore'
import { processImage } from '@/photos/processImage'

const driveName = (photoId: string): string => `photo-${photoId}.jpg`

interface NetworkInformation {
  type?: string
  effectiveType?: string
}

/**
 * Positively-detected cellular connection. Only Chromium exposes
 * `navigator.connection.type`; when the platform can't tell us (desktop,
 * Safari), we do NOT treat the link as metered — blocking every upload we can't
 * classify would break sync on the machines that most want it. So this gates
 * *only* the case we can be sure about: a known cellular radio.
 */
function isMeteredConnection(): boolean {
  const conn = (navigator as Navigator & { connection?: NetworkInformation }).connection
  return conn?.type === 'cellular'
}

export interface PhotoWorkCounts {
  uploads: number
  cleanups: number
}

/** How much photo work is outstanding — for the "skip if nothing to do" check. */
export async function pendingPhotoCounts(): Promise<PhotoWorkCounts> {
  const [pending, cleanups] = await Promise.all([
    db.photos.where('uploadState').equals('pending').toArray(),
    db.photos.filter((p) => p.deletedAt !== null && p.driveFileId !== null).count(),
  ])
  return { uploads: pending.filter((p) => p.deletedAt === null).length, cleanups }
}

/**
 * One photo pass: delete the Drive copies of removed photos, then upload the
 * pending ones. Runs before the JSON push so freshly-assigned driveFileIds (and
 * cleared ones) travel in the same document — no extra round trip.
 *
 * A transient Drive failure propagates (the orchestrator queues a retry); a
 * terminal one for a single photo marks that row `error` and moves on, so one
 * bad photo can't wedge the whole backlog.
 */
export async function syncPhotos(): Promise<void> {
  await cleanupDeletedPhotos()
  await uploadPendingPhotos()
}

async function cleanupDeletedPhotos(): Promise<void> {
  const toClean = await db.photos.filter((p) => p.deletedAt !== null && p.driveFileId !== null).toArray()
  for (const photo of toClean) {
    // deleteFile is idempotent (a 404 resolves), so a half-done cleanup reruns safely.
    await deleteFile(photo.driveFileId!)
    await db.photos.update(photo.id, { driveFileId: null })
    await photoBlobsRepo.delete(photo.id)
  }
}

async function uploadPendingPhotos(): Promise<void> {
  const settings = await settingsRepo.get()
  if (!settings?.photoUploadOnCellular && isMeteredConnection()) return // Wi-Fi only, and we're on cellular

  const pending = (await db.photos.where('uploadState').equals('pending').toArray()).filter((p) => p.deletedAt === null)
  const store = useSyncStore.getState()
  let remaining = pending.length
  store.setPendingUploads(remaining)

  for (const photo of pending) {
    const blob = await photoBlobsRepo.get(photo.id)
    if (!blob) {
      // Pending but no local blob to send (e.g. its blob was cleared): can't
      // upload it, so stop it looping as pending.
      await db.photos.update(photo.id, { uploadState: 'error' })
      store.setPendingUploads(--remaining)
      continue
    }
    try {
      const file = await uploadBlob(driveName(photo.id), blob.full)
      await db.photos.update(photo.id, { driveFileId: file.id, uploadState: 'uploaded' })
      store.setPendingUploads(--remaining)
    } catch (e) {
      if (e instanceof DriveError) {
        await db.photos.update(photo.id, { uploadState: 'error' }) // terminal for this photo; keep going
        store.setPendingUploads(--remaining)
        continue
      }
      throw e // transient (DriveUnavailableError / AuthError): abort, photo stays pending, retried next sync
    }
  }
  store.setPendingUploads(0)
}

// --- lazy download (task 5) ---

const inFlightDownloads = new Map<string, Promise<PhotoBlob | undefined>>()

/**
 * Return a photo's blobs, downloading from Drive on first view if the local copy
 * is missing (a photo taken on another device). The thumbnail is regenerated
 * from the downloaded full and both are cached, so it only ever downloads once.
 * Concurrent callers for the same photo share one download.
 */
export function ensurePhotoBlob(photoId: string): Promise<PhotoBlob | undefined> {
  const existing = inFlightDownloads.get(photoId)
  if (existing) return existing
  const job = doEnsurePhotoBlob(photoId).finally(() => inFlightDownloads.delete(photoId))
  inFlightDownloads.set(photoId, job)
  return job
}

async function doEnsurePhotoBlob(photoId: string): Promise<PhotoBlob | undefined> {
  const local = await photoBlobsRepo.get(photoId)
  if (local) return local

  const photo = await db.photos.get(photoId)
  if (!photo || photo.driveFileId === null) return undefined

  const full = await downloadBlob(photo.driveFileId)
  // Re-run the processing pipeline purely to regenerate the thumbnail; keep the
  // downloaded full as-is (it was already resized + EXIF-stripped on upload).
  const asFile = new File([full], driveName(photoId), { type: full.type || 'image/jpeg' })
  const processed = await processImage(asFile)
  await photoBlobsRepo.put(photoId, full, processed.thumb)
  return { photoId, full, thumb: processed.thumb }
}
