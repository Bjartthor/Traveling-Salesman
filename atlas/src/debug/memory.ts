// Best-effort JS-heap readout for the crash breadcrumb trail. `performance.memory`
// is a non-standard, Chromium-only API — which is exactly the engine that shows
// the "Aw snap!" renderer-out-of-memory page this instrumentation exists to
// diagnose — so relying on it is a deliberate fit for this app's target. Every
// helper degrades to "nothing to report" (null / '') anywhere the API is absent,
// so callers never have to guard.

interface ChromeMemory {
  usedJSHeapSize: number
  totalJSHeapSize: number
  jsHeapSizeLimit: number
}

export interface HeapSample {
  used: number
  total: number
  limit: number
  /** used / limit, in 0..1 — how close this renderer is to its OOM ceiling. */
  pressure: number
}

export function readHeap(): HeapSample | null {
  const mem = (performance as Performance & { memory?: ChromeMemory }).memory
  if (!mem || typeof mem.usedJSHeapSize !== 'number' || !(mem.jsHeapSizeLimit > 0)) return null
  return {
    used: mem.usedJSHeapSize,
    total: mem.totalJSHeapSize,
    limit: mem.jsHeapSizeLimit,
    pressure: mem.usedJSHeapSize / mem.jsHeapSizeLimit,
  }
}

const MB = 1024 * 1024
const mb = (bytes: number): string => `${Math.round(bytes / MB)}MB`

/**
 * A compact one-line heap summary for a breadcrumb's detail, e.g.
 * "heap 142/210MB · limit 512MB · 27%". Empty string where the API is
 * unavailable, so a caller can append it unconditionally.
 */
export function heapSummary(): string {
  const h = readHeap()
  return h ? `heap ${mb(h.used)}/${mb(h.total)} · limit ${mb(h.limit)} · ${Math.round(h.pressure * 100)}%` : ''
}
