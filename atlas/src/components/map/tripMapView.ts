// The opening view when a trip is shown on the main map
// (docs/superpowers/specs/2026-10-12-trip-on-main-map-design.md): framed on
// the trip's cities, for both the flat map and the globe. Pure — the maps
// apply the result to their own zoom/rotation state.

import { geoDistance } from 'd3-geo'
import type { Status } from '@/db/types'
import type { RouteStop } from '@/domain/tripRoute'
import { cityFitBox } from '@/components/trips/tripMapFit'
import type { Rotation } from '@/components/map/globeMath'

/**
 * What both maps draw on top when a trip is shown (WorldMap/GlobeMap's `trip`
 * prop). The trip's cities show at every zoom, labelled, instead of the
 * regular zoom-gated city layer; `route` is drawn as arrows. The maps frame
 * the opening view on the cities once per trip `id`, not on every update.
 */
export interface TripOverlay {
  id: string
  cities: readonly { refId: string; name: string; lat: number; lon: number; status: Status }[]
  route: readonly RouteStop[]
}

type Box = readonly [readonly [number, number], readonly [number, number]]

export interface ZoomTransform {
  k: number
  x: number
  y: number
}

/**
 * The d3-zoom transform (`translate(x,y) scale(k)`) that centres `bounds` —
 * a box in the map's base projected coordinates — and scales it to fit inside
 * the viewport less `padding` on every side. Never zooms out past the
 * whole-world view (k ≥ 1), matching the map's own scale extent.
 */
export function flatFitTransform(bounds: Box, size: { width: number; height: number }, padding = 48): ZoomTransform {
  const [[x0, y0], [x1, y1]] = bounds
  const bw = Math.max(x1 - x0, 1e-6)
  const bh = Math.max(y1 - y0, 1e-6)
  const k = Math.max(1, Math.min((size.width - 2 * padding) / bw, (size.height - 2 * padding) / bh))
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  return { k, x: size.width / 2 - k * cx, y: size.height / 2 - k * cy }
}

/** Share of the globe's on-screen radius the trip may fill. */
const GLOBE_FILL = 0.85

/**
 * Rotation that faces the middle of the trip's cities, and the zoom
 * (multiplier over the whole-globe fit) that keeps them all in view. On an
 * orthographic globe of radius R, a point θ away from the centre sits R·sin θ
 * from it on screen, so fitting the farthest box corner needs zoom 1 / sin θ
 * (less a margin). Anything a hemisphere or more across shows the whole globe.
 */
export function globeFitView(points: readonly { lat: number; lon: number }[]): { rotation: Rotation; zoom: number } {
  const corners = cityFitBox(points).geometry.coordinates as [number, number][]
  const lons = corners.map(([lon]) => lon)
  const lats = corners.map(([, lat]) => lat)
  const center: [number, number] = [(Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2]
  const theta = Math.max(...corners.map((c) => geoDistance(center, c)))
  const zoom = theta >= Math.PI / 2 ? 1 : Math.max(1, GLOBE_FILL / Math.sin(theta))
  return { rotation: [-center[0], -center[1], 0], zoom }
}
