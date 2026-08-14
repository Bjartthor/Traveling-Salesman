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
import { getRenderVitals, renderVitalsSummary } from '@/debug/renderVitals'

const SAMPLE_INTERVAL_MS = 5_000
const BASELINE_DELAY_MS = 4_000

// Zoom is uncapped in both maps (WorldMap's scaleExtent([1, Infinity]),
// GlobeMap's MAX_ZOOM = Infinity), and deep zoom is a leading suspect for the
// non-heap crashes the heap thresholds below can't see. So flag it the same
// edge-triggered way: crossing a mark upward logs once; zoom must fall back
// below it (leaving the map re-arms it, resetting to 1x) before it re-logs.
const ZOOM_MARKS = [8, 32, 128, 512] as const

// Fractions of jsHeapSizeLimit worth flagging. Crossing one upward logs once;
// pressure must fall back below a mark before crossing it again re-logs, so
// steady state near a mark doesn't spam, but a repeated approach-and-recover
// cycle (the classic pre-OOM sawtooth) still records every approach.
const THRESHOLDS = [0.7, 0.85, 0.93] as const

// Below the first threshold the crossings alone are too coarse to watch a leak
// forming — a climb from 200MB toward 3GB reads as "under 70%" until the very
// end. So also log whenever used heap has grown this much since the last logged
// sample, measured from the most recent trough (a GC drop re-arms it). On a
// healthy, stable heap this never fires; during a leak it lays down a
// fine-grained, timestamped rising trace, so the next captured log shows the
// climb rate and — lined up against the action breadcrumbs — what drives it.
const DELTA_LOG_BYTES = 200 * 1024 * 1024

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
  let lastLoggedUsed = Infinity // low-water mark the delta trigger measures a climb from
  let prevZoom = 0

  const sample = (): void => {
    const h = readHeap()
    if (!h) return // API unavailable — nothing to watch
    // Heap and geometry side by side: the crash can come from either budget,
    // and the heap number alone kept looking innocent right up to the crash.
    const summary = [heapSummary(), renderVitalsSummary()].filter(Boolean).join(' · ')
    let logged = false
    for (const t of THRESHOLDS) {
      if (prevPressure < t && h.pressure >= t) {
        void logError(`memory: heap pressure crossed ${Math.round(t * 100)}%`, summary)
        logged = true
      }
    }
    if (h.used < lastLoggedUsed) lastLoggedUsed = h.used // a GC drop re-arms the delta trigger
    if (!logged && h.used - lastLoggedUsed >= DELTA_LOG_BYTES) {
      void logInfo('memory: climbing', summary)
      logged = true
    }
    if (logged) lastLoggedUsed = h.used
    prevPressure = h.pressure

    // Non-heap watch: leave a mark whenever the map zooms deeper than before,
    // so a crash that correlates with deep zoom shows how far it got even
    // though the heap never budged.
    const zoom = getRenderVitals().zoom
    for (const m of ZOOM_MARKS) {
      if (prevZoom < m && zoom >= m) void logInfo(`render: zoom past ${m}x`, renderVitalsSummary())
    }
    prevZoom = zoom
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
