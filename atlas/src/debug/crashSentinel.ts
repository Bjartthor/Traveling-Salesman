// A synchronous "did the last session end cleanly?" sentinel — the one signal a
// durable breadcrumb trail can't carry on its own.
//
// The breadcrumb log (@/debug/log) survives a renderer crash because it lives
// in IndexedDB, but reading it back you can't tell whether the trail stops
// because the user calmly closed the app or because the tab was killed
// (Chrome's "Aw snap!" — an out-of-memory or GPU-process death that runs no JS,
// so nothing gets the chance to write "…and then it crashed"). This closes that
// gap. It keeps a record in localStorage — synchronous, so it's actually on
// disk *before* an unpredictable crash, which an async IndexedDB write might
// never flush in time — marking the session 'active' while the app is in the
// foreground, and flipping it to 'ended' on every orderly teardown
// (visibilitychange→hidden, pagehide). Only an abrupt renderer death leaves it
// stuck at 'active', so the NEXT boot reads it, sees the previous session never
// ended cleanly, and appends a crash marker to the same durable log — right
// after whatever breadcrumbs were the last thing that happened.
//
// Single-window assumption: two tabs of the app share this one localStorage
// key, so simultaneous tabs could log a spurious crash. That's a desktop-dev
// edge case; the target is a standalone single-window PWA on a phone, and only
// the foreground tab holds 'active' (a backgrounded tab writes 'ended' when it
// hides), which makes even the two-tab case mostly self-correcting.

import { logError, logInfo } from '@/debug/log'
import { heapSummary } from '@/debug/memory'
import { renderVitalsSummary } from '@/debug/renderVitals'

const KEY = 'atlas:crashSentinel'
const STAMP_INTERVAL_MS = 5_000

interface Sentinel {
  // 'active' = foreground and running; 'ended' = an orderly hide/pagehide ran.
  phase: 'active' | 'ended'
  bootAt: number
  updatedAt: number
  heap: string
  render: string
  // How many unclean exits we've detected across the sentinel's lifetime —
  // answers "how often is this happening" at a glance, since a crash erases the
  // in-session counters the breadcrumb trail would otherwise use.
  crashCount: number
}

let installed = false
let current: Sentinel | null = null

function read(): Sentinel | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Sentinel) : null
  } catch {
    return null // storage disabled / unparseable — treat as no prior session
  }
}

function write(s: Sentinel): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // storage disabled / full / private mode — degrade to no-op, same
    // best-effort contract as the breadcrumb log itself.
  }
}

function stamp(phase: 'active' | 'ended'): void {
  if (!current) return
  current.phase = phase
  current.updatedAt = Date.now()
  const heap = heapSummary()
  if (heap) current.heap = heap
  current.render = renderVitalsSummary()
  write(current)
}

function describeAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/**
 * Install the crash sentinel. Idempotent; mount it from main.tsx alongside the
 * other debug installers, before the first awaited work, so even a crash during
 * boot/seed is framed by a boot record on the next run.
 */
export function installCrashSentinel(): void {
  if (installed) return
  installed = true

  const now = Date.now()
  const prev = read()
  const priorCrashes = prev?.crashCount ?? 0

  // A previous session still marked 'active' never reached an orderly teardown:
  // that's the crash. Log it loudly, into the same durable trail the pre-crash
  // breadcrumbs already sit in, so the two line up when the log is read back.
  const crashed = prev?.phase === 'active'
  if (crashed && prev) {
    const ran = describeAge(Math.max(0, prev.updatedAt - prev.bootAt))
    const stale = describeAge(Math.max(0, now - prev.updatedAt))
    void logError(
      'crash: previous session ended uncleanly (foreground)',
      `ran ≥${ran} · last ${prev.heap || 'heap n/a'} · on screen ${prev.render || 'n/a'} · last checkpoint ${stale} before this boot · unclean exits so far: ${priorCrashes + 1}`,
    )
  }

  current = {
    phase: 'active',
    bootAt: now,
    updatedAt: now,
    heap: heapSummary(),
    render: renderVitalsSummary(),
    crashCount: crashed ? priorCrashes + 1 : priorCrashes,
  }
  write(current)

  // Orderly-teardown signals. Either firing means "not a crash": a manual
  // reload or close fires pagehide while still visible; backgrounding fires
  // visibilitychange→hidden first. Marking 'ended' on both is exactly what
  // keeps a normal reload from looking identical to an Aw-snap next boot.
  document.addEventListener('visibilitychange', () => {
    stamp(document.visibilityState === 'visible' ? 'active' : 'ended')
  })
  window.addEventListener('pagehide', () => stamp('ended'))

  // Keep the on-disk heap/geometry reasonably fresh, so a crash report reflects
  // the state shortly before death rather than at boot. Cheap: one small
  // synchronous localStorage write every few seconds, only while visible.
  setInterval(() => {
    if (document.visibilityState === 'visible') stamp('active')
  }, STAMP_INTERVAL_MS)

  if (crashed) void logInfo('crash: sentinel re-armed for a fresh session')
}
