// The only sanctioned writer to `photos`/`photoBlobs` — same convention
// @/domain/cascadeRepo and @/domain/tripRepo already set for entries/trips.
// Going around this module means going around the storage-accounting and
// soft-delete rules below.

import { db } from '@/db/schema'
import { photoBlobsRepo, photosRepo } from '@/db/repo'
import type { Photo } from '@/db/types'
import type { ProcessedImage } from '@/photos/processImage'

export interface AttachPhotoInput {
  entryId: string | null
  tripId: string | null
  caption?: string
  image: ProcessedImage
}

/** Writes the photos row and its blobs together — a photo is never left with one but not the other. */
export async function attachPhoto(input: AttachPhotoInput): Promise<Photo> {
  const { image } = input
  return db.transaction('rw', db.photos, db.photoBlobs, db.syncState, async () => {
    const photo = await photosRepo.create({
      entryId: input.entryId,
      tripId: input.tripId,
      caption: input.caption ?? '',
      takenAt: image.takenAt,
      lat: image.lat,
      lon: image.lon,
      width: image.width,
      height: image.height,
      bytes: image.full.size + image.thumb.size,
      driveFileId: null,
      uploadState: 'pending',
    })
    await photoBlobsRepo.put(photo.id, image.full, image.thumb)
    return photo
  })
}

export function updateCaption(photoId: string, caption: string): Promise<void> {
  return photosRepo.update(photoId, { caption })
}

export interface ReassignPatch {
  entryId?: string | null
  tripId?: string | null
}

/** Move a photo to a different place/trip, or clear one side of its tagging — an omitted key leaves that dimension alone, an explicit `null` clears it. */
export function reassignPhoto(photoId: string, patch: ReassignPatch): Promise<void> {
  return photosRepo.update(photoId, patch)
}

/** Soft-delete only (06-photos.md task 2). The blob stays — it's still needed for a future Drive upload (Phase 7) — until `clearUploadedBlobs` explicitly reclaims it. */
export function softDeletePhoto(photoId: string): Promise<void> {
  return photosRepo.softDelete(photoId)
}

function byTakenThenCreated(a: Photo, b: Photo): number {
  return (a.takenAt ?? a.createdAt) - (b.takenAt ?? b.createdAt)
}

export async function listPhotosForEntry(entryId: string): Promise<Photo[]> {
  return listPhotosForEntries([entryId])
}

/** Every active photo tagged to any of the given entries (e.g. a country plus every subdivision/city under it), oldest first. */
export async function listPhotosForEntries(entryIds: readonly string[]): Promise<Photo[]> {
  if (entryIds.length === 0) return []
  const rows = await db.photos.where('entryId').anyOf(entryIds as string[]).toArray()
  return rows.filter((p) => p.deletedAt === null).sort(byTakenThenCreated)
}

export interface TripPhotosFilter {
  /** Only photos tagged to this specific place within the trip (e.g. one city); `null` means trip-general (no place tag). Omit the whole filter for every photo on the trip. */
  entryId?: string | null
}

export async function listPhotosForTrip(tripId: string, filter?: TripPhotosFilter): Promise<Photo[]> {
  const rows = await db.photos.where('tripId').equals(tripId).toArray()
  const active = rows.filter((p) => p.deletedAt === null)
  const scoped = filter && 'entryId' in filter ? active.filter((p) => p.entryId === filter.entryId) : active
  return scoped.sort(byTakenThenCreated)
}

// --- storage management (06-photos.md task 4) ---

export interface PhotoStorageStats {
  count: number
  bytes: number
}

export async function photoStorageStats(): Promise<PhotoStorageStats> {
  const rows = await photosRepo.listActive()
  return { count: rows.length, bytes: rows.reduce((sum, p) => sum + p.bytes, 0) }
}

/**
 * Frees local blob storage for photos already backed up to Drive. Inert for
 * now — `uploadState` never reaches 'uploaded' before Phase 7 exists, by
 * design (06-photos.md "leave uploadState... populated but unused") — but the
 * action is real and ready for when it does.
 */
export async function clearUploadedBlobs(): Promise<number> {
  const rows = await db.photos.where('uploadState').equals('uploaded').toArray()
  const active = rows.filter((p) => p.deletedAt === null)
  await db.photoBlobs.bulkDelete(active.map((p) => p.id))
  return active.length
}
