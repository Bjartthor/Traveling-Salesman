// Synthetic geometry only, deliberately — this exercises nearestAdmin1Id's
// containment-then-snap logic in isolation, without needing a real bundled
// topology file. The real-world regression this guards (Vík í Mýrdal and
// other coastal Icelandic towns missing direct point-in-polygon containment
// against the simplified admin1 boundary) was reproduced separately against
// the actual shipped public/geo/admin1/IS.topo.json before writing the fix.

import { describe, expect, it } from 'vitest'
import type { Feature, GeoJsonProperties, Polygon } from 'geojson'
import type { MapFeature } from '@/components/map/topo'
import { nearestAdmin1Id, territoryForPoint } from '@/geo/photon'

function square(id: string, lonMin: number, latMin: number, lonMax: number, latMax: number): MapFeature {
  const feature: Feature<Polygon, GeoJsonProperties> = {
    type: 'Feature',
    properties: { id, name: id },
    geometry: {
      type: 'Polygon',
      // d3-geo's spherical winding wants exterior rings clockwise (viewed
      // from outside the sphere, north up) — the opposite of the planar/
      // RFC7946 convention. Getting this backwards silently inverts
      // "inside": geoContains then matches everywhere *except* the square,
      // which is exactly what happened before this ring order was fixed.
      coordinates: [
        [
          [lonMin, latMin],
          [lonMin, latMax],
          [lonMax, latMax],
          [lonMax, latMin],
          [lonMin, latMin],
        ],
      ],
    },
  }
  return { id, name: id, feature }
}

// Two adjacent 1°x1° squares sharing the edge at lon=1.
const REGION_A = square('A', 0, 0, 1, 1)
const REGION_B = square('B', 1, 0, 2, 1)
const FEATURES = [REGION_A, REGION_B]

describe('nearestAdmin1Id', () => {
  it('matches directly when the point is inside a polygon — no fallback needed', () => {
    expect(nearestAdmin1Id(FEATURES, [0.5, 0.5])).toBe('A')
    expect(nearestAdmin1Id(FEATURES, [1.5, 0.5])).toBe('B')
  })

  it('snaps to the nearest polygon when the point misses by a small margin, within maxKm', () => {
    // Just outside A's western edge — nearest vertices are ~56 km away by the
    // vertex-distance approximation, nearest B vertices are ~134 km away.
    const point: [number, number] = [-0.1, 0.5]
    expect(nearestAdmin1Id(FEATURES, point)).toBeNull() // default 25 km is well under the ~56 km gap here
    expect(nearestAdmin1Id(FEATURES, point, 100)).toBe('A')
  })

  it('never snaps beyond maxKm — returns null for a point nowhere near any region', () => {
    expect(nearestAdmin1Id(FEATURES, [50, 50], 100)).toBeNull()
  })

  it('returns null for an empty feature list', () => {
    expect(nearestAdmin1Id([], [0.5, 0.5])).toBeNull()
  })
})

describe('territoryForPoint', () => {
  // A split territory (SJ) next to a non-split country (NO) and an unrelated one (US).
  const SJ = square('SJ', 10, 74, 12, 76) // stand-in for Svalbard
  const NO = square('NO', 5, 58, 7, 60) // mainland Norway — NOT a split territory
  const US = square('US', -100, 40, -98, 42)
  const WORLD = [SJ, NO, US]

  it('returns the split territory a point sits inside', () => {
    expect(territoryForPoint(WORLD, 11, 75)).toBe('SJ')
  })

  it('ignores non-split-territory features even when the point is inside one', () => {
    // The point is squarely inside mainland Norway's shape, but NO is not a split
    // territory, so no remap — the caller keeps Photon's own country code.
    expect(territoryForPoint(WORLD, 6, 59)).toBeNull()
    expect(territoryForPoint(WORLD, -99, 41)).toBeNull()
  })

  it('snaps to a split territory just off its coast, within the snap radius', () => {
    // ~11 km north of SJ's corner vertex (10, 76) — inside the 25 km snap. (The
    // fallback measures distance to the nearest vertex, so stay near a corner.)
    expect(territoryForPoint(WORLD, 10, 76.1)).toBe('SJ')
  })

  it('does not claim a point far from every split territory', () => {
    expect(territoryForPoint(WORLD, 0, 0)).toBeNull()
  })
})
