// Picks which cities the world map shows at the current zoom/pan, and how
// (dot only vs dot+label). Pure and unit-tested — same "logic lives outside
// the component" precedent as @/domain/countrySheetLayout.
//
// Design: below CITY_MIN_SCALE nothing shows at all — cities are strictly a
// zoomed-in feature, same spirit as the existing ADMIN1_ZOOM_THRESHOLD. Above
// it, a city is a *candidate* once it clears a population floor that relaxes
// the further you zoom in (00-PLAN.md's "first the big cities... then the
// smaller the more you zoom in"), OR unconditionally if it's a country's
// capital or a place already logged as an entry — so a small, obscure
// visited village never waits behind some unrelated country's population
// cutoff. Candidates are then culled to the current viewport, ranked (your
// entries first, then capitals, then population) and capped, so a dense
// region at high zoom can never flood the SVG with thousands of dots.

import type { Status } from '@/db/types'
import type { MapCity } from '@/geo/mapCities'

export const CITY_MIN_SCALE = 2.5
export const MAX_CITY_MARKERS = 200
export const MAX_CITY_LABELS = 36

// [minimum scale, population required at/above that scale]. A capital or an
// already-logged place ignores this table entirely (see module doc above).
// Picked constants, chosen empirically for a reasonable count on screen at
// each step — easy to retune, same precedent as ADMIN1_ZOOM_THRESHOLD.
export const POPULATION_TIERS: readonly (readonly [minScale: number, minPopulation: number])[] = [
  [2.5, 2_000_000],
  [4, 500_000],
  [7, 150_000],
  [11, 40_000],
  [16, 10_000],
  [24, 0],
]

function populationFloor(scale: number): number {
  let floor = Infinity
  for (const [minScale, minPopulation] of POPULATION_TIERS) {
    if (scale >= minScale) floor = minPopulation
  }
  return floor
}

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

function priority(hasEntry: boolean, isCapital: boolean): number {
  return (hasEntry ? 2 : 0) + (isCapital ? 1 : 0)
}

export interface CityMarker {
  refId: string
  name: string
  x: number
  y: number
  population: number
  isCapital: boolean
  status: Status | null
  labeled: boolean
}

export interface SelectVisibleCitiesParams {
  cities: readonly MapCity[]
  cityStatus: ReadonlyMap<string, Status>
  scale: number
  transform: ZoomTransform
  viewportWidth: number
  viewportHeight: number
  /** The map's base (unzoomed) geo projection — same one used for country paths. */
  project: (lon: number, lat: number) => [number, number] | null
}

export function selectVisibleCities(params: SelectVisibleCitiesParams): CityMarker[] {
  const { cities, cityStatus, scale, transform, viewportWidth, viewportHeight, project } = params
  if (scale < CITY_MIN_SCALE || viewportWidth === 0 || viewportHeight === 0) return []

  const floor = populationFloor(scale)
  const rect = visibleRect(transform, viewportWidth, viewportHeight)

  const candidates: { city: MapCity; status: Status | null; x: number; y: number; pri: number }[] = []
  for (const city of cities) {
    const status = cityStatus.get(city.refId) ?? null
    if (city.population < floor && !city.isCapital && status === null) continue
    const projected = project(city.lon, city.lat)
    if (!projected) continue
    const [x, y] = projected
    if (x < rect.x0 || x > rect.x1 || y < rect.y0 || y > rect.y1) continue
    candidates.push({ city, status, x, y, pri: priority(status !== null, city.isCapital) })
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
