// The direct "Add photos" entry point (06-photos.md task 2) — a system
// picker (`accept="image/*" multiple`), processed off the main thread via
// @/photos/processImage, written straight to the given place/trip through
// @/domain/photoRepo. This is the simple path (a place/trip is already
// known); @/components/photos/PhotoImportFlow is the bigger "figure out
// where these were taken" flow for the You tab.

import { useRef, useState } from 'react'
import type { Photo } from '@/db/types'
import { processBatch } from '@/photos/processImage'
import { attachPhoto } from '@/domain/photoRepo'
import './AddPhotosButton.css'

export function AddPhotosButton({
  entryId,
  tripId,
  label = 'Add photos',
  onAdded,
}: {
  entryId: string | null
  tripId: string | null
  label?: string
  onAdded?: (photos: Photo[]) => void
}) {
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cancelRef = useRef(false)

  async function handleFiles(files: FileList) {
    const list = Array.from(files)
    if (list.length === 0) return
    setError(null)
    cancelRef.current = false
    setProgress({ processed: 0, total: list.length })

    const results = await processBatch(
      list,
      (p) => setProgress(p),
      () => cancelRef.current,
    )

    const added: Photo[] = []
    const failures: string[] = []
    for (const r of results) {
      if (!r.result) {
        failures.push(r.error ?? 'unknown error')
        continue
      }
      try {
        added.push(await attachPhoto({ entryId, tripId, image: r.result }))
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e))
      }
    }

    setProgress(null)
    if (failures.length > 0) setError(`${failures.length} photo${failures.length === 1 ? '' : 's'} failed to import`)
    if (added.length > 0) onAdded?.(added)
  }

  const busy = progress !== null

  return (
    <div className="add-photos">
      <label className={`add-photos__trigger${busy ? ' add-photos__trigger--busy' : ''}`}>
        {busy ? `Processing ${progress.processed}/${progress.total}…` : label}
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={busy}
          onChange={(e) => {
            const files = e.target.files
            e.target.value = ''
            if (files) void handleFiles(files)
          }}
        />
      </label>
      {busy && (
        <button type="button" className="add-photos__cancel" onClick={() => (cancelRef.current = true)}>
          Cancel
        </button>
      )}
      {error && (
        <p className="add-photos__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
