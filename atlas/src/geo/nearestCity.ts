// Nearest-city lookup for EXIF photo import (06-photos.md task 3). Must work
// entirely offline and must not scan the ~170k-row `cities` table per photo,
// so cities are bucketed into a coarse lat/lon grid once, in-memory, the same
// "build once, memoise, invalidate on reseed" shape @/geo/search already
// established for name search — no new build-time artefact or Dexie index,
// just a second in-memory index over the same reference table.
//
// Grid cell size is a picked constant, 2° (~220 km at the equator, smaller at
// higher latitudes) — coarse enough to keep the index tiny, fine enough that
// the real nearest neighbour among ~170k globally-distributed cities1000 rows
// is essentially always inside the target cell's 3x3 neighbourhood, which is
// as far as the brief asks this to search ("the target cell and its eight
// neighbours"). A photo within a couple of degrees of the antimeridian could
// in principle miss a nearer city on the other side of the ±180° wrap — not
// handled, in the same spirit as the point-in-polygon coastline gap
// Phase 4b's notes already documented rather than fixed (a rare edge case,
// and one that only ever costs "proposes the country instead of the city").

import { geoContains } from 'd3-geo'
import { db } from '@/db/schema'
import { loadWorldTopology } from '@/geo/loader'
import { decodeLayer } from '@/components/map/topo'

export const CELL_SIZE_DEG = 2
export const CONFIDENT_KM = 30
export const UNCERTAIN_KM = 150

export interface CityLite {
  refId: string // String(geonameId) — matches Entry.refId
  name: string
  countryCode: string
  subdivisionId: string | null
  lat: number
  lon: number
}

export type CityGrid = ReadonlyMap<string, readonly CityLite[]>

export function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_SIZE_DEG)}:${Math.floor(lon / CELL_SIZE_DEG)}`
}

/** Bucket every city with known coordinates into its grid cell. Pure — testable without Dexie. */
export function buildCityGrid(cities: readonly CityLite[]): CityGrid {
  const grid = new Map<string, CityLite[]>()
  for (const city of cities) {
    const key = cellKey(city.lat, city.lon)
    const bucket = grid.get(key)
    if (bucket) bucket.push(city)
    else grid.set(key, [city])
  }
  return grid
}

const EARTH_RADIUS_KM = 6371

/** Great-circle distance in kilometres. */
export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export interface NearestCityMatch {
  city: CityLite
  distanceKm: number
}

/** Scans the target cell and its eight neighbours only — never the whole grid. Pure. */
export function findNearestInGrid(grid: CityGrid, lat: number, lon: number): NearestCityMatch | null {
  const cellLat = Math.floor(lat / CELL_SIZE_DEG)
  const cellLon = Math.floor(lon / CELL_SIZE_DEG)

  let best: NearestCityMatch | null = null
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const bucket = grid.get(`${cellLat + dLat}:${cellLon + dLon}`)
      if (!bucket) continue
      for (const city of bucket) {
        const distanceKm = haversineKm({ lat, lon }, city)
        if (!best || distanceKm < best.distanceKm) best = { city, distanceKm }
      }
    }
  }
  return best
}

// --- Dexie-facing: build once, memoised, invalidated on a reference-data reseed ---

let gridPromise: Promise<CityGrid> | null = null

async function buildGridFromDb(): Promise<CityGrid> {
  const rows = await db.cities.toArray()
  const cities: CityLite[] = []
  for (const c of rows) {
    if (c.lat === null || c.lon === null) continue
    cities.push({ refId: String(c.geonameId), name: c.name, countryCode: c.countryCode, subdivisionId: c.subdivisionId, lat: c.lat, lon: c.lon })
  }
  return buildCityGrid(cities)
}

/** Call after @/geo/loader reseeds `cities` — same trigger as @/geo/search's invalidateSearchIndex. */
export function invalidateNearestCityIndex(): void {
  gridPromise = null
}

function getGrid(): Promise<CityGrid> {
  if (!gridPromise) gridPromise = buildGridFromDb()
  return gridPromise
}

export async function findNearestCity(lat: number, lon: number): Promise<NearestCityMatch | null> {
  const grid = await getGrid()
  return findNearestInGrid(grid, lat, lon)
}

/**
 * Which country a point falls in, by geometry — mirrors @/geo/photon's
 * resolveSubdivisionByPoint but one level up, against the world topology
 * instead of one country's admin-1 file. Resolves null for a point that lands
 * in no country at all (open ocean, Antarctica, or a coastline rounding gap).
 */
export async function resolveCountryByPoint(lat: number, lon: number): Promise<string | null> {
  const topo = await loadWorldTopology()
  const point: [number, number] = [lon, lat]
  for (const f of decodeLayer(topo, 'countries', 'code')) {
    if (geoContains(f.feature, point)) return f.id
  }
  return null
}

export type LocationMatch =
  | { tier: 'city'; refId: string; countryCode: string; subdivisionId: string | null; distanceKm: number; confidence: 'confident' | 'uncertain' }
  | { tier: 'country'; countryCode: string }
  | { tier: 'none' }

/**
 * The one entry point the import flow calls per photo (06-photos.md task 3
 * steps 2-4): within 30 km propose the nearest city confidently, 30-150 km
 * propose it flagged uncertain, beyond 150 km (or no bundled city anywhere
 * near) fall back to the country resolved from the coordinates, and if even
 * that fails, `'none'` — the photo goes to manual review.
 */
export async function matchPhotoLocation(lat: number, lon: number): Promise<LocationMatch> {
  const nearest = await findNearestCity(lat, lon)
  if (nearest && nearest.distanceKm <= UNCERTAIN_KM) {
    return {
      tier: 'city',
      refId: nearest.city.refId,
      countryCode: nearest.city.countryCode,
      subdivisionId: nearest.city.subdivisionId,
      distanceKm: nearest.distanceKm,
      confidence: nearest.distanceKm <= CONFIDENT_KM ? 'confident' : 'uncertain',
    }
  }
  const countryCode = await resolveCountryByPoint(lat, lon)
  return countryCode ? { tier: 'country', countryCode } : { tier: 'none' }
}
