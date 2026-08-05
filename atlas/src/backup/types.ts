// The manual-backup document (07-sync-and-deploy.md task 6). Independent of
// Drive — export/import must both work with no Google account at all. Reuses
// SyncSnapshot's shape (explicit entries + tombstones, synced-settings subset)
// because that is already the correct "what counts as user data" boundary the
// sync layer established: derived entries are recomputed, never stored.

import type { SyncSnapshot } from '@/sync/types'

/** Bump if the document layout changes in a way older clients can't read. */
export const BACKUP_SCHEMA_VERSION = 1 as const

export interface BackupDoc {
  schema: typeof BACKUP_SCHEMA_VERSION
  exportedAt: number
  data: SyncSnapshot
}

export const BACKUP_JSON_ENTRY = 'atlas-backup.json'

/** Same naming convention as Drive's own photo files (@/sync/photos) — not shared code, just a shared, obvious scheme. */
export function photoZipEntryName(photoId: string): string {
  return `photo-${photoId}.jpg`
}
