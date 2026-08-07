import { describe, expect, it } from 'vitest'
import { dominantLandmass } from './dominantLandmass'

// Closed axis-aligned lon/lat boxes — big enough angular spans that relative
// area differences are unambiguous regardless of spherical distortion.
//
// Winding matters: d3-geo's spherical geoArea treats a ring as its right-hand
// rule (exterior-on-the-outside) orientation, which for a small "normal"
// region is (lon0,lat0) -> (lon0,lat1) -> (lon1,lat1) -> (lon1,lat0) -> close
// — *not* the flat-2D-counterclockwise order intuition would suggest. Get
// this backwards and geoArea returns the area of the ring's complement (most
// of the sphere) instead — verified empirically against real committed
// topojson data (every real ring in world.topo.json reports a small, sane
// area with this winding; the flipped winding reports ~4*PI, i.e. "the whole
// sphere minus a notch") before writing these fixtures.
function box(lon0: number, lat0: number, lon1: number, lat1: number) {
  return [
    [lon0, lat0],
    [lon0, lat1],
    [lon1, lat1],
    [lon1, lat0],
    [lon0, lat0],
  ]
}

describe('dominantLandmass', () => {
  it('isolates the one clearly-dominant piece (the France/USA case)', () => {
    const mainland = box(-5, 42, 8, 51) // a big block, e.g. "mainland France"-sized
    const overseasScrap = box(170, -1, 171, 1) // tiny, and geographically distant
    const result = dominantLandmass({
      type: 'MultiPolygon',
      coordinates: [[mainland], [overseasScrap]],
    })
    expect(result).not.toBeNull()
    expect(result?.coordinates).toEqual([mainland])
  })

  it('returns null when no single piece is a majority (the Indonesia case)', () => {
    const islandA = box(95, -5, 105, 5)
    const islandB = box(110, -8, 120, 2)
    const islandC = box(125, -10, 135, 0)
    const result = dominantLandmass({
      type: 'MultiPolygon',
      coordinates: [[islandA], [islandB], [islandC]],
    })
    expect(result).toBeNull()
  })

  it('returns null for a plain Polygon — nothing to isolate', () => {
    const result = dominantLandmass({ type: 'Polygon', coordinates: [box(0, 0, 10, 10)] })
    expect(result).toBeNull()
  })

  it('returns null for a single-piece MultiPolygon', () => {
    const result = dominantLandmass({ type: 'MultiPolygon', coordinates: [[box(0, 0, 10, 10)]] })
    expect(result).toBeNull()
  })

  it('is not fooled by piece order — the dominant piece can be listed first or last', () => {
    const mainland = box(-5, 42, 8, 51)
    const scrap = box(170, -1, 171, 1)
    const firstLast = dominantLandmass({ type: 'MultiPolygon', coordinates: [[mainland], [scrap]] })
    const lastFirst = dominantLandmass({ type: 'MultiPolygon', coordinates: [[scrap], [mainland]] })
    expect(firstLast?.coordinates).toEqual([mainland])
    expect(lastFirst?.coordinates).toEqual([mainland])
  })

  it('sits right at the threshold: a bare majority isolates, a bare minority does not', () => {
    // ~51% / 49% split (two adjacent-latitude equal-longitude-width boxes,
    // sized so the areas differ slightly) — small area differences near the
    // equator scale ~linearly with lon/lat span, so a slightly wider box
    // gives a bare majority.
    const barelyBigger = box(0, 0, 10.5, 10)
    const barelySmaller = box(20, 0, 30, 10)
    const majority = dominantLandmass({ type: 'MultiPolygon', coordinates: [[barelyBigger], [barelySmaller]] })
    expect(majority).not.toBeNull()

    const evenSplitA = box(0, 0, 10, 10)
    const evenSplitB = box(20, 0, 30, 10)
    const tie = dominantLandmass({ type: 'MultiPolygon', coordinates: [[evenSplitA], [evenSplitB]] })
    expect(tie).toBeNull() // exactly 50/50 is not a *majority*
  })
})
