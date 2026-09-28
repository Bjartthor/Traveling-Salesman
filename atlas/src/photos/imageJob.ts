// The contract between the page and the photo worker (@/photos/imageWorker):
// the job/response message shapes and the resize settings both sides need.
//
// Deliberately its own module, with no side effects: it's the ONLY thing
// main-thread code (@/photos/processImage) may import for the worker.
// Importing anything from imageWorker.ts itself — even one constant —
// evaluates that module on the page's main thread, where its top-level
// `self.onmessage =` lands on the window. The page then answers every message
// it receives (Google sign-in's popup replying with a token, for one) by
// posting a message to itself, forever — and since exifr keeps every options
// object it's ever handed, that loop was the runaway-heap "Aw snap" crash (see
// AW-SNAP-DEBUGGING.md). The worker itself is reached only through
// `new Worker(new URL('./imageWorker.ts', import.meta.url))`.

export const FULL_MAX_EDGE = 2048
export const THUMB_MAX_EDGE = 320
export const FULL_QUALITY = 0.82
export const THUMB_QUALITY = 0.82

export interface ImageJobRequest {
  jobId: number
  file: File
}

export interface ImageJobResult {
  jobId: number
  ok: true
  full: Blob
  thumb: Blob
  width: number // of the stored `full` image, post-resize
  height: number
  lat: number | null
  lon: number | null
  takenAt: number | null // ms epoch, from EXIF DateTimeOriginal
}

export interface ImageJobError {
  jobId: number
  ok: false
  error: string
}

export type ImageJobResponse = ImageJobResult | ImageJobError
