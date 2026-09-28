// Counts cumulative requestAnimationFrame + setTimeout scheduling and window
// `message` events, surfaced in the census (@/debug/census) as `rafN` / `tmoN`
// / `msgN`.
//
// Why: the 2026-08-18 high-heap Aw-snap is a self-sustaining background runaway
// — it ignites right after a `sync: pulled`, then keeps leaking ~10-50 MB/s
// while idle and across every route/view change, never recovering (see
// PROGRESS.md / memory "aw-snap-render-path-ruled-out"). The census already
// proved it's untracked JS (DOM node count and every map cache stay bounded), so
// the leading remaining shape is a scheduling loop that keeps re-arming itself
// (e.g. leaked, never-cancelled rAF/timer chains piling up). This makes that
// visible as a *rate*: between two `memory: climbing` breadcrumbs (~5 s apart) a
// healthy app schedules a few hundred rAFs (one 60 fps loop ≈ 300/5 s); a runaway
// with many concurrent leaked loops schedules thousands. A flat `rafN`/`tmoN`
// while the heap climbs rules scheduling out (⇒ a promise chain or plain data
// retention — go to a heap snapshot).
//
// Both wrappers only increment a counter and pass straight through to the native
// implementation (real ids returned), so cancelAnimationFrame/clearTimeout and
// every caller behave exactly as before.

import { registerCensusCounter } from '@/debug/census'

let rafCount = 0
let timeoutCount = 0
let messageCount = 0
let installed = false

export function installScheduleWatch(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  if (typeof window.requestAnimationFrame === 'function') {
    const nativeRaf = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      rafCount++
      return nativeRaf(cb)
    }
    registerCensusCounter('rafN', () => rafCount)
  }

  if (typeof window.setTimeout === 'function') {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]): number => {
      timeoutCount++
      return nativeSetTimeout(handler as never, timeout, ...args)
    }) as typeof window.setTimeout
    registerCensusCounter('tmoN', () => timeoutCount)
  }

  // The high-heap runaway turned out to be neither: it was a `message`
  // ping-pong — the photo worker's job handler, loaded onto the page by
  // mistake, answering every message the page got by posting another one to
  // the page itself (see AW-SNAP-DEBUGGING.md). No rAF, no timers, so
  // `rafN`/`tmoN` sat flat through every climb and hid it for weeks. A healthy
  // page sees a handful (a sign-in popup, a browser extension); a loop shows as
  // thousands per 5 s. Counting only — delivery is never stopped or altered.
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('message', () => {
      messageCount++
    }, true)
    registerCensusCounter('msgN', () => messageCount)
  }
}
