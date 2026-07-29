// Main-thread client for @/photos/imageWorker.ts (06-photos.md task 1). One
// worker, reused across a whole import batch, jobs run one at a time — a
// realistic batch (dozens, not thousands, of phone photos) doesn't benefit
// from parallelism enough to justify a pool, and keeping it sequential keeps
// peak memory (one decoded bitmap at a time) predictable.
//
// Falls back to an equivalent main-thread <canvas> pipeline when the worker
// can't do the job (construction throws, or it reports OffscreenCanvas/
// createImageBitmap unavailable) — older Safari, mainly.

import { parse as parseExif } from 'exifr'
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

let worker: Worker | null = null
let workerBroken = false
let nextJobId = 1
const pending = new Map<number, { resolve: (r: ProcessedImage) => void; reject: (e: Error) => void }>()

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
    pending.set(jobId, { resolve, reject })
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

async function processOnMainThread(file: File): Promise<ProcessedImage> {
  const [bitmap, exif] = await Promise.all([
    createImageBitmap(file, { imageOrientation: 'from-image' }),
    readExifMainThread(file),
  ])
  try {
    const [full, thumb] = await Promise.all([
      resizeOnMainThread(bitmap, FULL_MAX_EDGE, FULL_QUALITY),
      resizeOnMainThread(bitmap, THUMB_MAX_EDGE, THUMB_QUALITY),
    ])
    return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height, ...exif }
  } finally {
    bitmap.close()
  }
}

async function readExifMainThread(file: File): Promise<{ lat: number | null; lon: number | null; takenAt: number | null }> {
  try {
    const tags = await parseExif(file, { gps: true, pick: ['DateTimeOriginal'] })
    const lat = typeof tags?.latitude === 'number' ? tags.latitude : null
    const lon = typeof tags?.longitude === 'number' ? tags.longitude : null
    const taken = tags?.DateTimeOriginal
    const takenAt = taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.getTime() : null
    return { lat, lon, takenAt }
  } catch {
    return { lat: null, lon: null, takenAt: null }
  }
}

/** Resize + strip EXIF (keeping GPS/date out-of-band) for one photo. Worker first, main-thread fallback. */
export async function processImage(file: File): Promise<ProcessedImage> {
  try {
    return await processViaWorker(file)
  } catch {
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
