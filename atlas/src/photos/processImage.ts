// Main-thread client for @/photos/imageWorker.ts (06-photos.md task 1). One
// worker, reused across a whole import batch, jobs run one at a time — a
// realistic batch (dozens, not thousands, of phone photos) doesn't benefit
// from parallelism enough to justify a pool, and keeping it sequential keeps
// peak memory (one decoded bitmap at a time) predictable.
//
// Falls back to an equivalent main-thread <canvas> pipeline when the worker
// can't do the job (construction throws, or it reports OffscreenCanvas/
// createImageBitmap unavailable) — older Safari, mainly.

import {
  FULL_MAX_EDGE,
  FULL_QUALITY,
  THUMB_MAX_EDGE,
  THUMB_QUALITY,
  type ImageJobRequest,
  type ImageJobResponse,
} from '@/photos/imageWorker'

export interface ProcessedImage {
  full: Blob
  thumb: Blob
  width: number
  height: number
  lat: number | null
  lon: number | null
  takenAt: number | null
}

// A malformed/adversarial EXIF structure can send exifr's TIFF-dependency
// traversal into a loop that never returns (real-device evidence: Chrome's
// pre-OOM debugger caught it live, mid-parse, heap climbing with zero other
// activity). Nothing ever called `worker.terminate()`, so a stuck job didn't
// just fail to resolve — the worker kept running in the background,
// indefinitely, invisible to every other kind of instrumentation, until the
// tab OOM-crashed. `WORKER_JOB_TIMEOUT_MS` bounds a single job; past it we
// kill the worker outright (the one guaranteed way to stop it, even mid
// infinite loop) and surface a real error instead of hanging forever.
const WORKER_JOB_TIMEOUT_MS = 20_000

let worker: Worker | null = null
let workerBroken = false
let nextJobId = 1
const pending = new Map<number, { resolve: (r: ProcessedImage) => void; reject: (e: Error) => void }>()

/** Kill the current worker and fail whatever was in flight on it. Does NOT set `workerBroken` — the next job gets a fresh worker, since the failure is most likely specific to one file, not the worker mechanism itself. */
function terminateWorker(reason: string): void {
  worker?.terminate()
  worker = null
  for (const job of pending.values()) job.reject(new Error(reason))
  pending.clear()
}

function getWorker(): Worker | null {
  if (workerBroken) return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('./imageWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<ImageJobResponse>) => {
      const response = event.data
      const job = pending.get(response.jobId)
      if (!job) return
      pending.delete(response.jobId)
      if (response.ok) {
        const { full, thumb, width, height, lat, lon, takenAt } = response
        job.resolve({ full, thumb, width, height, lat, lon, takenAt })
      } else {
        job.reject(new Error(response.error))
      }
    }
    worker.onerror = (event) => {
      workerBroken = true
      for (const job of pending.values()) job.reject(new Error(event.message || 'image worker crashed'))
      pending.clear()
    }
    return worker
  } catch {
    workerBroken = true
    return null
  }
}

function processViaWorker(file: File): Promise<ProcessedImage> {
  const w = getWorker()
  if (!w) return Promise.reject(new Error('worker unavailable'))
  const jobId = nextJobId++
  return new Promise<ProcessedImage>((resolve, reject) => {
    const timer = setTimeout(() => {
      terminateWorker(`image processing timed out after ${WORKER_JOB_TIMEOUT_MS / 1000}s (a photo's data may be malformed) — try a different photo`)
    }, WORKER_JOB_TIMEOUT_MS)
    pending.set(jobId, {
      resolve: (r) => {
        clearTimeout(timer)
        resolve(r)
      },
      reject: (e) => {
        clearTimeout(timer)
        reject(e)
      },
    })
    const request: ImageJobRequest = { jobId, file }
    w.postMessage(request)
  })
}

function fitDimensions(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob failed'))), 'image/jpeg', quality)
  })
}

async function resizeOnMainThread(
  bitmap: ImageBitmap,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const { width, height } = fitDimensions(bitmap.width, bitmap.height, maxEdge)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.drawImage(bitmap, 0, 0, width, height)
  const blob = await canvasToBlob(canvas, quality)
  return { blob, width, height }
}

/**
 * No EXIF extraction here, deliberately — see `processImage()`'s comment.
 * `exifr` has no way to be interrupted once started outside a Worker (nothing
 * plays the role `worker.terminate()` plays for the worker path), so it isn't
 * safe to run it synchronously on the main thread even once. Resize-only; a
 * photo processed via this fallback just won't get GPS/date metadata.
 */
async function processOnMainThread(file: File): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    const [full, thumb] = await Promise.all([
      resizeOnMainThread(bitmap, FULL_MAX_EDGE, FULL_QUALITY),
      resizeOnMainThread(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY),
    ])
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height, lat: null, lon: null, takenAt: null }
  } finally {
    bitmap.close()
  }
}

/**
 * Resize + strip EXIF (keeping GPS/date out-of-band) for one photo. Worker
 * first, main-thread fallback — except when the worker timed out (see
 * `WORKER_JOB_TIMEOUT_MS` above): that means this exact file's EXIF data is
 * what hung it, and `processOnMainThread` runs the same `exifr` parse with no
 * timeout and no way to interrupt it (unlike a Worker, the main thread can't
 * be force-terminated out of a synchronous infinite loop), so retrying there
 * would reproduce the same hang with the one safety net removed. Only the
 * genuine "worker unavailable" case (construction failed, or the environment
 * lacks OffscreenCanvas/createImageBitmap — old Safari) falls back.
 */
export async function processImage(file: File): Promise<ProcessedImage> {
  try {
    return await processViaWorker(file)
  } catch (e) {
    if (e instanceof Error && e.message.includes('timed out')) throw e
    return processOnMainThread(file)
  }
}

export interface BatchProgress {
  processed: number
  total: number
}

/**
 * Process a batch sequentially with progress reporting. `shouldCancel` is
 * polled between items (not mid-item) so a cancelled batch still leaves
 * whatever finished intact (06-photos.md task 3's "cancel button that leaves
 * partial results intact").
 */
export async function processBatch(
  files: readonly File[],
  onProgress: (p: BatchProgress) => void,
  shouldCancel: () => boolean,
): Promise<{ file: File; result: ProcessedImage | null; error: string | null }[]> {
  const out: { file: File; result: ProcessedImage | null; error: string | null }[] = []
  for (let i = 0; i < files.length; i++) {
    if (shouldCancel()) break
    const file = files[i]!
    try {
      const result = await processImage(file)
      out.push({ file, result, error: null })
    } catch (e) {
      out.push({ file, result: null, error: e instanceof Error ? e.message : String(e) })
    }
    onProgress({ processed: i + 1, total: files.length })
  }
  return out
}
