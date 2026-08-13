// Online city search (00-PLAN.md §6) — queried only when local results are
// thin, after a debounce the search UI owns. Fails silently on any error
// (offline, aborted, CORS hiccup, malformed response): 04-places.md §2 is
// explicit that a search which already has local results shows no error
// toast for the online half failing.
//
// Note: §6 also asks to "send a descriptive User-Agent" — fetch() cannot set
// that header; browsers forbid overriding it from JS, full stop, no
// workaround from client-side code. The request goes out as a plain CORS GET
// with the browser's own UA. Photon's public endpoint allows it regardless
// (Access-Control-Allow-Origin: *, confirmed empirically against the live API).

import { geoContains, geoDistance } from 'd3-geo'
import type { Geometry, Position } from 'geojson'
import { db } from '@/db/schema'
import type { City } from '@/db/types'
import { loadCountryTopology } from '@/geo/loader'
import { decodeLayer, type MapFeature } from '@/components/map/topo'
import { addOnlineCity } from '@/geo/cityWrites'

const PHOTON_URL = 'https://photon.komoot.io/api/'

// Photon's `layer` filter values are a fixed enum (house, street, locality,
// district, city, county, state, country, other) — NOT the finer osm_value
// tags like "town"/"village"/"hamlet" it also returns (those get bucketed
// under `city` or `locality`). Restricting to these two keeps roads, POIs
// and admin boundaries out of results without excluding small settlements —
// verified empirically: an unfiltered query for "Vik" surfaces a sports
// arena and an island alongside the real villages, this filter removes both.
const SETTLEMENT_LAYERS = ['city', 'locality']

export interface PhotonResult {
  id: string // stable within one result set (React key) — not a persisted id
  name: string
  countryCode: string
  countryName: string
  regionName: string | null // Photon's own, possibly-localized name — display only
  lat: number
  lon: number
}

interface PhotonProps {
  name?: string
  countrycode?: string
  country?: string
  state?: string
  county?: string
  osm_id?: number
  osm_type?: string
  osm_key?: string
}

interface PhotonFeature {
  properties?: PhotonProps
  geometry?: { coordinates?: [number, number] } // [lon, lat]
}

export async function searchPhoton(query: string, signal?: AbortSignal): Promise<PhotonResult[]> {
  const q = query.trim()
  if (q.length < 2) return []
  try {
    const params = new URLSearchParams({ q, limit: '8' })
    for (const layer of SETTLEMENT_LAYERS) params.append('layer', layer)
    const res = await fetch(`${PHOTON_URL}?${params}`, { signal })
    if (!res.ok) return []
    const body = (await res.json()) as { features?: PhotonFeature[] }

    const results: PhotonResult[] = []
    for (const f of body.features ?? []) {
      const p = f.properties
      const coords = f.geometry?.coordinates
      const countryCode = p?.countrycode?.toUpperCase()
      if (!p?.name || !countryCode || !coords) continue
      // The `layer` param alone still lets through landuse zones named after
      // the place they sit in (found empirically: searching "Tokyo" surfaced
      // "Tokyo Big Sight", a convention-centre landuse polygon, alongside the
      // real city). osm_key 'place' is OSM's own tag for an actual settlement.
      if (p.osm_key !== 'place') continue
      results.push({
        id: `${p.osm_type ?? '?'}${p.osm_id ?? results.length}`,
        name: p.name,
        countryCode,
        countryName: p.country ?? countryCode,
        regionName: p.state ?? p.county ?? null,
        lon: coords[0],
        lat: coords[1],
      })
    }
    return results
  } catch {
    return []
  }
}

const EARTH_RADIUS_KM = 6371

// Admin-1 boundaries are simplified per-country to stay under a size budget
// (tools/build-geo.mjs) — coastlines get rounded inward in the process, so a
// real coastal town's coordinates can land just outside every polygon.
// Confirmed empirically against the shipped Iceland topology: Vík í Mýrdal,
// Höfn and Grindavík all miss direct containment by 1.7-5.3 km, while the
// nearest *wrong* region in each case is 15-90 km away — a wide, unambiguous
// margin. Snapping to the nearest polygon within this radius closes that gap
// without meaningfully risking a wrong region for a point that's genuinely
// ambiguous or offshore.
export const SUBDIVISION_SNAP_KM = 25

function ringsOf(geometry: Geometry): Position[][] {
  if (geometry.type === 'Polygon') return geometry.coordinates
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.flat()
  return []
}

/**
 * Nearest-vertex great-circle distance from a point to a feature. Always ≥
 * the true distance to the polygon's edge (a segment can only be closer than
 * both of its endpoints), so thresholding on it never *over*-accepts —
 * exactly the safe direction to approximate in for a fallback.
 */
function nearestVertexDistanceKm(feature: MapFeature, point: Position): number {
  let best = Infinity
  for (const ring of ringsOf(feature.feature.geometry)) {
    for (const coord of ring) {
      const km = geoDistance(point as [number, number], coord as [number, number]) * EARTH_RADIUS_KM
      if (km < best) best = km
    }
  }
  return best
}

/**
 * Exact point-in-polygon first; on a miss, the nearest feature by vertex
 * distance, accepted only within `maxKm` (the coastline-rounding fallback
 * described above). Exported as its own pure function so it can be tested
 * against synthetic geometry without needing real topology files.
 */
export function nearestAdmin1Id(features: readonly MapFeature[], point: Position, maxKm = SUBDIVISION_SNAP_KM): string | null {
  for (const f of features) {
    if (geoContains(f.feature, point as [number, number])) return f.id
  }
  let best: { id: string; km: number } | null = null
  for (const f of features) {
    const km = nearestVertexDistanceKm(f, point)
    if (!best || km < best.km) best = { id: f.id, km }
  }
  return best && best.km <= maxKm ? best.id : null
}

/**
 * Which of the country's admin-1 regions contains a point — point-in-polygon
 * against the topology already bundled for the map, not name-matching.
 * Photon's region name is localized ("Bayern"); ours is English ("Bavaria"),
 * so text-matching would miss constantly. Falls back to the nearest region
 * within `SUBDIVISION_SNAP_KM` on a near-miss (see nearestAdmin1Id above).
 * Resolves null when the country has no admin-1 file at all, or the point is
 * genuinely nowhere near any of its regions — the city is still added, just
 * at the country level, same as a bundled city with no admin-1 data.
 */
export async function resolveSubdivisionByPoint(countryCode: string, lon: number, lat: number): Promise<string | null> {
  const topo = await loadCountryTopology(countryCode)
  if (!topo) return null
  return nearestAdmin1Id(decodeLayer(topo, 'admin1', 'id'), [lon, lat])
}

/**
 * Turn a picked Photon result into a durable local city: confirm we
 * recognise the country, resolve its subdivision by geometry, and write it
 * into `cities` with source: 'online' — from then on it behaves exactly like
 * a bundled city (04-places.md acceptance: "survives an app restart offline").
 */
export async function commitPhotonResult(result: PhotonResult): Promise<City> {
  const country = await db.countries.get(result.countryCode)
  if (!country) throw new Error(`Photon returned an unrecognised country code "${result.countryCode}"`)
  const subdivisionId = await resolveSubdivisionByPoint(result.countryCode, result.lon, result.lat)
  return addOnlineCity({
    name: result.name,
    countryCode: result.countryCode,
    subdivisionId,
    lat: result.lat,
    lon: result.lon,
  })
}
