// "Download map detail for offline": fetch every per-country geo file up
// front, so region outlines still draw abroad without data. Each is otherwise
// only fetched (and so only cached by the service worker's geo runtime cache,
// see vite.config.ts) the first time that country is opened. Fetching goes
// through the service worker like any other geo request, so it lands in that
// same cache; nothing here writes a cache itself.

import { geoUrl } from '@/geo/loader'

const BUILT = typeof __GEO_DETAIL_FILES__ === 'undefined' ? { files: [], bytes: 0 } : __GEO_DETAIL_FILES__
// The world outline too: every map needs it, and it's only cached once the
// service worker is controlling a page that fetches it.
const FILES = BUILT.files.length > 0 ? ['world.topo.json', ...BUILT.files] : []

export const detailFileCount = FILES.length
export const detailBytes = BUILT.bytes

const CONCURRENCY = 6

async function geoCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null
  const name = (await caches.keys()).find((k) => k.startsWith('atlas-geo-cache'))
  return name ? caches.open(name) : null
}

/**
 * How many of the detail files are already in the offline cache, or null
 * where that can't be known (no Cache API, or no service worker yet — e.g.
 * the dev server).
 */
export async function countCachedDetailFiles(): Promise<number | null> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return null
  const cache = await geoCache()
  if (!cache) return 0
  const wanted = new Set(FILES.map((f) => new URL(geoUrl(f), location.href).pathname))
  const keys = await cache.keys()
  return keys.filter((req) => wanted.has(new URL(req.url).pathname)).length
}

/** Fetch every detail file (a few at a time), reporting how many are done. Resolves with how many failed. */
export async function downloadDetailFiles(onProgress: (done: number, total: number) => void): Promise<number> {
  const queue = [...FILES]
  const total = queue.length
  let done = 0
  let failed = 0
  onProgress(0, total)
  async function worker(): Promise<void> {
    for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
      try {
        const response = await fetch(geoUrl(file))
        if (!response.ok) failed++
        // Read the body so the service worker's cache write isn't cut short.
        await response.arrayBuffer()
      } catch {
        failed++
      }
      onProgress(++done, total)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return failed
}
