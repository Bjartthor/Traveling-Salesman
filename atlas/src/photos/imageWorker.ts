// The image-processing worker (06-photos.md task 1). Runs off the main thread
// so importing a batch of phone photos (4-8 MB originals) never freezes the
// UI. One job per message: read EXIF, decode+resize twice (full + thumb),
// re-encode as JPEG. Falls back to a main-thread <canvas> pipeline in
// @/photos/processImage when OffscreenCanvas/createImageBitmap aren't usable
// here (older Safari).
//
// EXIF stripping is automatic, not a separate step: re-encoding through
// OffscreenCanvas.convertToBlob produces a fresh JPEG with no embedded
// metadata at all, regardless of what the source carried. Orientation is
// honoured by createImageBitmap's own `imageOrientation: 'from-image'` option,
// which rotates/flips the decoded bitmap per the EXIF Orientation tag before
// we ever draw it — no manual rotation math needed.

import { parse as parseExif } from 'exifr'
import {
  FULL_MAX_EDGE,
  FULL_QUALITY,
  THUMB_MAX_EDGE,
  THUMB_QUALITY,
  type ImageJobRequest,
  type ImageJobResponse,
} from '@/photos/imageJob'

function fitDimensions(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

async function resizeToJpeg(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitDimensions(bitmap.width, bitmap.height, maxEdge)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable on OffscreenCanvas')
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
  return { blob, width, height }
}

async function readExif(file: File): Promise<{ lat: number | null; lon: number | null; takenAt: number | null }> {
  try {
    const tags = await parseExif(file, { gps: true, pick: ['DateTimeOriginal'] })
    const lat = typeof tags?.latitude === 'number' ? tags.latitude : null
    const lon = typeof tags?.longitude === 'number' ? tags.longitude : null
    const taken = tags?.DateTimeOriginal
    const takenAt = taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.getTime() : null
    return { lat, lon, takenAt }
  } catch {
    // A photo with no/corrupt EXIF is handled without error (acceptance
    // criterion) — just resolves to "no location, no date" for manual review.
    return { lat: null, lon: null, takenAt: null }
  }
}

async function processOne({ jobId, file }: ImageJobRequest): Promise<ImageJobResponse> {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      throw new Error('OffscreenCanvas/createImageBitmap unavailable in this worker')
    }
    const [bitmap, exif] = await Promise.all([
      createImageBitmap(file, { imageOrientation: 'from-image' }),
      readExif(file),
    ])
    try {
      const [full, thumb] = await Promise.all([
        resizeToJpeg(bitmap, FULL_MAX_EDGE, FULL_QUALITY),
        resizeToJpeg(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY),
      ])
      return {
        jobId,
        ok: true,
        full: full.blob,
        thumb: thumb.blob,
        width: full.width,
        height: full.height,
        ...exif,
      }
    } finally {
      bitmap.close()
    }
  } catch (e) {
    return { jobId, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// Not in the DOM lib this project compiles against; only defined inside workers.
declare const WorkerGlobalScope: (abstract new () => unknown) | undefined

// Only ever answer jobs from inside an actual worker. If this module is
// evaluated on the page instead (any main-thread import from this file does
// that — see @/photos/imageJob), `self` is the window: this handler would
// answer every message the page receives by posting one back to the page
// itself, forever — the runaway-heap "Aw snap" loop.
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (event: MessageEvent<ImageJobRequest>) => {
    void processOne(event.data).then((response) => {
      ;(self as unknown as Worker).postMessage(response)
    })
  }
}
