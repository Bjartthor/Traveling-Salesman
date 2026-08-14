// Picks which cities the map shows at the current zoom, and how (dot only vs
// dot+label). Pure and unit-tested — same "logic lives outside the
// component" precedent as @/domain/countrySheetLayout. Shared by both
// WorldMap and GlobeMap: neither the selection/ranking/cap logic nor the
// scale gating cares which projection is drawing the map, only
// selectVisibleCities' viewRect/project params are projection-specific (see
// their doc comments below).
//
// Design: below CITY_MIN_SCALE nothing shows at all — a city dot is still a
// zoomed-in feature, same spirit as the existing ADMIN1_ZOOM_THRESHOLD. Above
// it, the *only* candidates are cities the user has actually logged an entry
// for (any status — wishlist through lived). Earlier revisions of this file
// also surfaced capitals and population-ranked cities so the map read as a
// reference atlas even before you'd logged anything, but that produced far
// more dots than a personal travel tracker needs and was the direct cause of
// map lag — this is a travel *log*, not a gazetteer, so an unmarked city
// never appears no matter how large it is. Candidates are then culled to the
// current viewport, ranked (capitals first, then population, both just
// tie-breakers now that every candidate already has a status) and capped —
// the cap is a generous backstop against a pathological case (hundreds of
// entries visible at once), not a routine limiter, since the candidate pool
// is already bounded by how many places you've actually logged.

import type { Status } from '@/db/types'
import type { MapCity } from '@/geo/mapCities'

// Kept low (rather than tied to ADMIN1_ZOOM_THRESHOLD or MIN_ZOOM) purely to
// avoid loading the ~170k-row bundled city index (see @/geo/mapCities) on
// every map mount — the index is still needed to resolve a marked city's
// name/lat/lon, even though most of its rows will never be shown. Once
// loaded, a logged city appears as soon as it's on screen; there's no
// population-driven reason left to delay it further.
export const CITY_MIN_SCALE = 1.5
export const MAX_CITY_MARKERS = 150
export const MAX_CITY_LABELS = 60

export interface ZoomTransform {
  k: number
  x: number
  y: number
}

export interface ViewportRect {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The base-projected (pre-zoom-transform) rectangle currently visible on
 * screen, given a d3-zoom transform (`translate(x,y) scale(k)`) and the
 * container size. Padded a little so a small pan doesn't pop markers in/out
 * right at the edge of the screen.
 */
export function visibleRect(transform: ZoomTransform, width: number, height: number, paddingFraction = 0.25): ViewportRect {
  const x0 = -transform.x / transform.k
  const y0 = -transform.y / transform.k
  const x1 = (width - transform.x) / transform.k
  const y1 = (height - transform.y) / transform.k
  const padX = ((x1 - x0) * paddingFraction) / 2
  const padY = ((y1 - y0) * paddingFraction) / 2
  return { x0: x0 - padX, y0: y0 - padY, x1: x1 + padX, y1: y1 + padY }
}

function priority(isCapital: boolean): number {
  return isCapital ? 1 : 0
}

export interface CityMarker {
  refId: string
  name: string
  x: number
  y: number
  population: number
  isCapital: boolean
  status: Status
  labeled: boolean
}

export interface SelectVisibleCitiesParams {
  cities: readonly MapCity[]
  cityStatus: ReadonlyMap<string, Status>
  scale: number
  // The caller computes this however suits its own projection model — a flat
  // map inverts a d3-zoom transform (see visibleRect below), a globe just
  // uses its own screen bounds, since project() below already excludes
  // anything not on the visible hemisphere. Keeping this projection-agnostic
  // is what lets both WorldMap and GlobeMap share this one selection/ranking
  // pipeline instead of each needing their own copy.
  viewRect: ViewportRect
  /** Projects a point to screen space, or null to exclude it outright — a
   *  flat map has nothing to exclude this way, but a globe uses it to drop
   *  anything on the far side (see @/components/map/globeMath isFrontFacing). */
  project: (lon: number, lat: number) => [number, number] | null
}

export function selectVisibleCities(params: SelectVisibleCitiesParams): CityMarker[] {
  const { cities, cityStatus, scale, viewRect, project } = params
  if (scale < CITY_MIN_SCALE || viewRect.x1 <= viewRect.x0 || viewRect.y1 <= viewRect.y0) return []

  const candidates: { city: MapCity; status: Status; x: number; y: number; pri: number }[] = []
  for (const city of cities) {
    const status = cityStatus.get(city.refId)
    if (status === undefined) continue
    const projected = project(city.lon, city.lat)
    if (!projected) continue
    const [x, y] = projected
    if (x < viewRect.x0 || x > viewRect.x1 || y < viewRect.y0 || y > viewRect.y1) continue
    candidates.push({ city, status, x, y, pri: priority(city.isCapital) })
  }

  candidates.sort((a, b) => b.pri - a.pri || b.city.population - a.city.population)
  const kept = candidates.slice(0, MAX_CITY_MARKERS)

  return kept.map((c, i) => ({
    refId: c.city.refId,
    name: c.city.name,
    x: c.x,
    y: c.y,
    population: c.city.population,
    isCapital: c.city.isCapital,
    status: c.status,
    labeled: i < MAX_CITY_LABELS,
  }))
}
