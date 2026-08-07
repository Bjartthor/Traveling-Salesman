// Pure math for "what zoom transform frames this country's bounding box
// above the country sheet." Kept separate from WorldMap's DOM/d3-zoom wiring
// so the geometry itself is unit-testable without a browser.
//
// bounds is geoPath.bounds(feature) — [[x0,y0],[x1,y1]] in the *base*
// projection's pixel space (the space the pan/zoom transform is layered on
// top of via the <g> transform, not the projection itself).

export interface FitTransformInput {
  bounds: [[number, number], [number, number]]
  viewportWidth: number
  viewportHeight: number
  /** 0..1 — fraction of viewport height the sheet covers, kept clear for framing. */
  peekFraction: number
  /** 0..1 — how much of the *available* (non-sheet) area the bbox should occupy. */
  fitFraction: number
  minScale: number
  maxScale: number
}

export interface FitTransform {
  k: number
  x: number
  y: number
}

export function computeCountryFitTransform({
  bounds,
  viewportWidth,
  viewportHeight,
  peekFraction,
  fitFraction,
  minScale,
  maxScale,
}: FitTransformInput): FitTransform {
  const [[x0, y0], [x1, y1]] = bounds
  const bboxWidth = Math.max(x1 - x0, 1e-6)
  const bboxHeight = Math.max(y1 - y0, 1e-6)
  const availableHeight = viewportHeight * (1 - peekFraction)

  const rawScale = Math.min((viewportWidth * fitFraction) / bboxWidth, (availableHeight * fitFraction) / bboxHeight)
  const k = Math.min(Math.max(rawScale, minScale), maxScale)

  const centerX = (x0 + x1) / 2
  const centerY = (y0 + y1) / 2

  return {
    k,
    x: viewportWidth / 2 - centerX * k,
    y: availableHeight / 2 - centerY * k,
  }
}
