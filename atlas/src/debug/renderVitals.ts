// A tiny global snapshot of the render-side numbers that track the renderer's
// *non-JS-heap* memory — the GPU/compositor/canvas/DOM cost that
// `performance.memory` (@/debug/memory) is blind to. Those "Aw snap!" crashes
// happen while the JS heap sits near idle (the captured logs peaked at ~6% of
// the limit), so the heap gauge alone can't explain them; the tab is dying for
// total process memory, and *this* is the part of that total we can actually
// read from JS.
//
// The active map keeps this current (GlobeMap sets canvas dimensions, WorldMap
// sets SVG node counts — see setRenderVitals callers); the memory watchdog and
// crash sentinel read it, so a crash breadcrumb carries the geometry that was
// on screen, not just a reassuringly-small heap number.

export interface RenderVitals {
  /** Which map is mounted, or null when neither is (Places/Trips/Settings). */
  view: 'flat' | 'globe' | null
  dpr: number
  /** City markers actually drawn this frame (capped at MAX_CITY_MARKERS). */
  cities: number
  /** Settled zoom factor over the whole-world fit — uncapped in both maps. */
  zoom: number
  /** Flat map only: rendered SVG <path> count (countries + admin-1 + detail). */
  svgPaths?: number
  /** Globe only: canvas backing-store dimensions in device pixels. */
  canvasW?: number
  canvasH?: number
}

// Read lazily and defensively — never at module-eval time. This module is
// pulled into non-DOM contexts too (cityWrites → breadcrumb → here runs under
// the Node test environment), where `window` simply isn't defined.
const dpr = (): number => (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1)

const cleared = (): RenderVitals => ({ view: null, dpr: dpr(), cities: 0, zoom: 1 })

let vitals: RenderVitals = cleared()

/** Merge in whatever the current map knows; unspecified fields are left as-is. */
export function setRenderVitals(next: Partial<RenderVitals>): void {
  vitals = { ...vitals, ...next }
}

/** Called on map unmount so stale geometry never rides along on a later,
 *  off-map breadcrumb (a nav to Settings shouldn't report the globe's zoom). */
export function resetRenderVitals(): void {
  vitals = cleared()
}

export function getRenderVitals(): Readonly<RenderVitals> {
  return vitals
}

/**
 * A compact one-line summary for a breadcrumb's detail, e.g.
 * "globe · dpr 3 · canvas 1080×2160 · 47 cities · zoom 12.4x". Empty string
 * when no map is mounted, so a caller can append it unconditionally alongside
 * the heap summary.
 */
export function renderVitalsSummary(): string {
  const v = vitals
  if (!v.view) return ''
  const parts = [v.view, `dpr ${v.dpr}`]
  if (v.canvasW && v.canvasH) parts.push(`canvas ${v.canvasW}×${v.canvasH}`)
  if (v.svgPaths !== undefined) parts.push(`${v.svgPaths} paths`)
  parts.push(`${v.cities} cities`, `zoom ${v.zoom.toFixed(1)}x`)
  return parts.join(' · ')
}
