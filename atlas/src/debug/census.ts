// A cheap, synchronous census of the things that could grow without bound and
// pin the JS heap — appended to the memoryWatch climbing/pressure breadcrumbs
// and the crash sentinel, so a real-device OOM capture shows *what* grew, not
// just that the heap did.
//
// Why this exists: the 2026-08-17 high-heap Aw-snap climbs usedJSHeapSize to
// multiple GB with no GC recovery, yet every render/cascade/sync path is clean
// when driven in the sandbox (see PROGRESS.md / memory "aw-snap-render-path-
// ruled-out"). The old instrumentation logs heap *total* + on-screen geometry
// (@/debug/renderVitals) but never a DOM-node census or the size of the JS
// caches — which is exactly the discriminator we lack:
//   - `dom` climbs with the heap  ⇒ a view/overlay/list isn't being torn down
//     (a DOM leak). Look at which route/component was mounted.
//   - `dom` stays flat while heap runs away ⇒ the retention is pure JS objects
//     (or detached nodes held by JS) — check the named counters below; whichever
//     one is unexpectedly large is the smoking gun.
//
// Everything here is O(1): a `.size`/`.length`/`getElementsByTagName().length`
// read, never a walk of the data. Safe at module eval in the Node test env —
// `document` is only touched inside the function, behind a typeof guard.

// Modules with a module-scope cache register a named size-getter at import time,
// so this stays decoupled: the watchdog never imports map/geo code, it just
// reads whatever registered itself.
const counters = new Map<string, () => number>()

/**
 * Register a named counter for the census (call once, at module scope, next to
 * the cache it measures). `name` is kept short — it lands in a breadcrumb line.
 */
export function registerCensusCounter(name: string, get: () => number): void {
  counters.set(name, get)
}

// Fire counts for the app's always-live (shell-level) useLiveQuery subscriptions
// — keyed by name so re-wrapping the same querier (e.g. a dep-array change)
// doesn't reset its count. The 2026-08-18 high-heap runaway proved untracked-JS
// and, separately, proved rAF/setTimeout/setInterval are all flat while it
// climbs (PROGRESS.md) — the leading remaining theory is a Dexie liveQuery
// re-firing far more often than its underlying writes justify. This names
// exactly which subscription, if any, is doing that.
const queryFireCounts = new Map<string, number>()

/**
 * Wrap a `useLiveQuery` querier function to count how many times it actually
 * *fires* (not how many times the owning component re-renders) — self-
 * registers with the census under `name`. Pure passthrough otherwise: same
 * args in, same return value out, on every call.
 */
export function countedQuery<Args extends unknown[], T>(name: string, fn: (...args: Args) => T): (...args: Args) => T {
  if (!queryFireCounts.has(name)) {
    queryFireCounts.set(name, 0)
    registerCensusCounter(name, () => queryFireCounts.get(name) ?? 0)
  }
  return (...args: Args): T => {
    queryFireCounts.set(name, (queryFireCounts.get(name) ?? 0) + 1)
    return fn(...args)
  }
}

/**
 * One compact line, e.g. `dom 641 · paths$ 3 · topo$ 5 · cityIdx 170487`. Empty
 * string outside a DOM context with nothing registered, so a caller can append
 * it unconditionally alongside the heap/render summaries.
 */
export function censusSummary(): string {
  const parts: string[] = []
  // Total live (attached) DOM nodes — the key discriminator (see file header).
  if (typeof document !== 'undefined') parts.push(`dom ${document.getElementsByTagName('*').length}`)
  for (const [name, get] of counters) {
    try {
      parts.push(`${name} ${get()}`)
    } catch {
      // A misbehaving counter must never break the thing it's measuring.
    }
  }
  return parts.join(' · ')
}
