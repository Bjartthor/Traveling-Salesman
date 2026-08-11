// A lightweight, low-noise heap watchdog for the crash breadcrumb trail.
//
// A renderer out-of-memory (Chrome's "Aw snap!" page) kills the tab with no
// catchable JS error — the ErrorBoundary and the unhandledrejection handler in
// globalHandlers.ts never see it, because the process is simply gone. The only
// way such a crash leaves a trace is if something recorded the heap *climbing
// toward the ceiling* beforehand. That is this file's whole job.
//
// It samples heap pressure periodically and whenever the app returns to the
// foreground, and writes a breadcrumb only when pressure crosses one of a few
// high-water marks (edge-triggered). So a healthy session logs essentially
// nothing, while a session walking into an OOM leaves a clear rising trail as
// its final entries — turning "it just Aw-snapped" into "heap crossed 93% right
// before the log stops."

import { logError, logInfo } from '@/debug/log'
import { heapSummary, readHeap } from '@/debug/memory'

const SAMPLE_INTERVAL_MS = 15_000
const BASELINE_DELAY_MS = 4_000

// Fractions of jsHeapSizeLimit worth flagging. Crossing one upward logs once;
// pressure must fall back below a mark before crossing it again re-logs, so
// steady state near a mark doesn't spam, but a repeated approach-and-recover
// cycle (the classic pre-OOM sawtooth) still records every approach.
const THRESHOLDS = [0.7, 0.85, 0.93] as const

let installed = false

/**
 * Start the watchdog. Idempotent (StrictMode / double-import safe) and silent
 * where `performance.memory` is unavailable. Mounted once from main.tsx,
 * alongside installGlobalErrorLogging.
 */
export function installMemoryWatch(): void {
  if (installed) return
  installed = true

  let prevPressure = 0

  const sample = (): void => {
    const h = readHeap()
    if (!h) return // API unavailable — nothing to watch
    for (const t of THRESHOLDS) {
      if (prevPressure < t && h.pressure >= t) {
        void logError(`memory: heap pressure crossed ${Math.round(t * 100)}%`, heapSummary())
      }
    }
    prevPressure = h.pressure
  }

  // One baseline sample once the app has settled, so the log always carries a
  // heap reference point even for a session that never trips a threshold.
  setTimeout(() => {
    const first = heapSummary()
    if (first) void logInfo('memory: baseline', first)
    sample()
  }, BASELINE_DELAY_MS)

  setInterval(sample, SAMPLE_INTERVAL_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sample()
  })
}
