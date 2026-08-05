// Manual backup (07-sync-and-deploy.md task 6): a single .zip, independent of
// Drive, so a sync system you cannot inspect is never the only copy of your
// data. Reuses the sync layer's already-tested pieces rather than re-deriving
// them — a backup is just a snapshot exchanged with a file instead of Drive:
//   - export:  the same buildLocalSnapshot() the Drive push uses
//   - merge:   the same mergeSnapshots()/applyMergedSnapshot() the Drive pull uses
//   - replace: a full wipe-and-restore, the one genuinely new operation here

import { strFromU8, strToU8, unzip, zip, type AsyncZippable, type Unzipped } from 'fflate'
import { db } from '@/db/schema'
import { photoBlobsRepo, settingsRepo } from '@/db/repo'
import { rebuildDerivedEntries } from '@/domain/cascadeRepo'
import { processImage } from '@/photos/processImage'
import { applyMergedSnapshot, buildLocalSnapshot } from '@/sync/snapshot'
import { mergeSnapshots } from '@/sync/merge'
import type { SyncSnapshot } from '@/sync/types'
import { BACKUP_JSON_ENTRY, BACKUP_SCHEMA_VERSION, photoZipEntryName, type BackupDoc } from '@/backup/types'

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BackupFormatError'
  }
}

function zipAsync(data: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

function unzipAsync(data: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

export interface BackupSummary {
  places: number
  trips: number
  photos: number
}

function summarize(data: SyncSnapshot): BackupSummary {
  return {
    places: data.entries.filter((e) => e.deletedAt === null).length,
    trips: data.trips.filter((t) => t.deletedAt === null).length,
    photos: data.photos.filter((p) => p.deletedAt === null).length,
  }
}

/**
 * Build the backup zip: the JSON document plus one JPEG per photo that has a
 * local blob. A photo without one (e.g. never downloaded from Drive on this
 * device) is skipped — there is nothing on this device to back up for it.
 */
export async function exportBackup(): Promise<{ blob: Blob; summary: BackupSummary }> {
  const data = await buildLocalSnapshot()
  const doc: BackupDoc = { schema: BACKUP_SCHEMA_VERSION, exportedAt: Date.now(), data }

  const files: AsyncZippable = {
    [BACKUP_JSON_ENTRY]: strToU8(JSON.stringify(doc)),
  }
  for (const photo of data.photos) {
    if (photo.deletedAt !== null) continue
    const blob = await photoBlobsRepo.get(photo.id)
    if (!blob) continue
    const bytes = new Uint8Array(await blob.full.arrayBuffer())
    // Store, don't deflate — JPEGs are already compressed; re-deflating spends
    // CPU for close to zero size gain.
    files[photoZipEntryName(photo.id)] = [bytes, { level: 0 }]
  }

  const zipped = await zipAsync(files)
  return { blob: new Blob([zipped], { type: 'application/zip' }), summary: summarize(data) }
}

async function readBackupDoc(zipFile: Unzipped): Promise<BackupDoc> {
  const entry = zipFile[BACKUP_JSON_ENTRY]
  if (!entry) throw new BackupFormatError('This file doesn’t look like an Atlas backup — no atlas-backup.json inside.')
  let doc: BackupDoc
  try {
    doc = JSON.parse(strFromU8(entry)) as BackupDoc
  } catch {
    throw new BackupFormatError('This backup’s data file is corrupted and can’t be read.')
  }
  if (typeof doc.schema !== 'number' || doc.schema > BACKUP_SCHEMA_VERSION) {
    throw new BackupFormatError('This backup was made by a newer version of Atlas. Update the app, then import it.')
  }
  return doc
}

async function readZip(file: Blob): Promise<Unzipped> {
  try {
    return await unzipAsync(new Uint8Array(await file.arrayBuffer()))
  } catch {
    throw new BackupFormatError('Couldn’t read this file — is it an Atlas backup .zip?')
  }
}

/** Parse and validate a backup file without writing anything — for the import UI's preview/confirm step. */
export async function readBackupFile(file: Blob): Promise<{ doc: BackupDoc; summary: BackupSummary }> {
  const doc = await readBackupDoc(await readZip(file))
  return { doc, summary: summarize(doc.data) }
}

/**
 * Write photo blobs found in the zip into photoBlobs. `overwrite: false` only
 * fills gaps (used by merge — a photo already on this device needs no work);
 * `true` always writes from the zip (used by replace, which trusts the backup
 * fully). Mirrors @/sync/photos ensurePhotoBlob: keep the zip's bytes as-is for
 * `full` (already resized/EXIF-stripped when first attached) and only re-run
 * the image pipeline to regenerate the thumbnail, avoiding a second lossy
 * re-encode of the full image.
 */
async function writePhotoBlobsFromZip(zipFile: Unzipped, photos: readonly Pick<SyncSnapshot['photos'][number], 'id' | 'deletedAt'>[], overwrite: boolean): Promise<void> {
  for (const photo of photos) {
    if (photo.deletedAt !== null) continue
    const entry = zipFile[photoZipEntryName(photo.id)]
    if (!entry) continue
    if (!overwrite && (await photoBlobsRepo.get(photo.id))) continue

    const bytes = entry.slice()
    const full = new Blob([bytes], { type: 'image/jpeg' })
    const asFile = new File([bytes], photoZipEntryName(photo.id), { type: 'image/jpeg' })
    const processed = await processImage(asFile)
    await photoBlobsRepo.put(photo.id, full, processed.thumb)
  }
}

export interface ImportResult {
  summary: BackupSummary
}

/**
 * Merge a backup into the current local data — the same last-write-wins rule
 * as Drive sync (@/sync/merge), so nothing already on this device that is
 * newer than the backup is lost. Settings have no shared baseline against a
 * one-off file (unlike two synced devices), so the backup's settings win,
 * exactly as a brand-new device adopts Drive's settings on its first sync.
 */
export async function importBackupMerge(file: Blob): Promise<ImportResult> {
  const zipFile = await readZip(file)
  const doc = await readBackupDoc(zipFile)

  const local = await buildLocalSnapshot()
  const merged = mergeSnapshots({ local, remote: doc.data, settingsBase: null })
  await applyMergedSnapshot(merged)
  await writePhotoBlobsFromZip(zipFile, merged.photos, false)

  return { summary: summarize(merged) }
}

/**
 * Replace every local place, trip and photo with the backup's contents.
 * Anything on this device that isn't in the backup is gone — the caller is
 * responsible for making that unambiguous before calling this.
 */
export async function importBackupReplace(file: Blob): Promise<ImportResult> {
  const zipFile = await readZip(file)
  const { data } = await readBackupDoc(zipFile)

  await db.transaction(
    'rw',
    [db.entries, db.trips, db.tripEntries, db.photos, db.photoBlobs, db.settings, db.cities, db.syncState],
    async () => {
      await db.entries.clear()
      await db.entries.bulkAdd(data.entries)
      await db.trips.clear()
      await db.trips.bulkAdd(data.trips)
      await db.tripEntries.clear()
      await db.tripEntries.bulkAdd(data.tripEntries)
      await db.photos.clear()
      await db.photos.bulkAdd(data.photos)
      await db.photoBlobs.clear()

      // Only the synced fields — device-local settings are untouched, same
      // boundary applyMergedSnapshot draws.
      await settingsRepo.update({
        statMode: data.settings.statMode,
        countryDenominator: data.settings.countryDenominator,
        theme: data.settings.theme,
      })

      await rebuildDerivedEntries()
    },
  )
  await writePhotoBlobsFromZip(zipFile, data.photos, true)

  return { summary: summarize(data) }
}
