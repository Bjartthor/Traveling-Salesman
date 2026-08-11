import { describe, expect, it } from 'vitest'
import type { Status } from '@/db/types'
import type { MapCity } from '@/geo/mapCities'
import { CITY_MIN_SCALE, MAX_CITY_LABELS, MAX_CITY_MARKERS, selectVisibleCities, visibleRect } from '@/components/map/cityLayer'

function mkCity(overrides: Partial<MapCity> & { refId: string }): MapCity {
  return {
    name: `City ${overrides.refId}`,
    lat: 0,
    lon: 0,
    population: 0,
    isCapital: false,
    ...overrides,
  }
}

// Treats lon/lat as already-projected x/y — selectVisibleCities doesn't care
// how the projection works, only that it maps to a screen-space point.
const identityProject = (lon: number, lat: number): [number, number] => [lon, lat]

const FULL_VIEWPORT = { viewRect: visibleRect({ k: 1, x: 0, y: 0 }, 1000, 1000) }
const EMPTY_VIEWPORT = { viewRect: { x0: 0, y0: 0, x1: 0, y1: 0 } }

describe('selectVisibleCities — scale gating', () => {
  it('shows nothing below CITY_MIN_SCALE, even for a marked capital', () => {
    const capital = mkCity({ refId: 'cap', population: 10_000_000, isCapital: true })
    const result = selectVisibleCities({
      cities: [capital],
      cityStatus: new Map<string, Status>([['cap', 'lived']]),
      scale: CITY_MIN_SCALE - 0.01,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(0)
  })

  it('shows nothing when the viewport has no size yet', () => {
    const capital = mkCity({ refId: 'cap', population: 10_000_000, isCapital: true })
    const result = selectVisibleCities({
      cities: [capital],
      cityStatus: new Map<string, Status>([['cap', 'lived']]),
      scale: 24,
      ...EMPTY_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(0)
  })
})

describe('selectVisibleCities — only marked cities appear', () => {
  it('excludes a city with no logged entry, however large or however capital it is', () => {
    const megacity = mkCity({ refId: 'unmarked', population: 30_000_000, isCapital: true })
    const result = selectVisibleCities({
      cities: [megacity],
      cityStatus: new Map(),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(0)
  })

  it('includes a tiny, non-capital city once the user has logged any status for it', () => {
    const village = mkCity({ refId: 'tiny-village', population: 1 })
    const result = selectVisibleCities({
      cities: [village],
      cityStatus: new Map<string, Status>([['tiny-village', 'wishlist']]),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe('wishlist')
  })
})

describe('selectVisibleCities — viewport culling', () => {
  it('excludes an otherwise-eligible marked city outside the current viewport', () => {
    const farAway = mkCity({ refId: 'far', isCapital: true, lon: 5000, lat: 5000 })
    const result = selectVisibleCities({
      cities: [farAway],
      cityStatus: new Map<string, Status>([['far', 'visited']]),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(0)
  })
})

describe('selectVisibleCities — cap and priority', () => {
  it('caps the result at MAX_CITY_MARKERS, keeping capitals first, then the highest populations', () => {
    const capitalCity = mkCity({ refId: 'capital-1', population: 20, isCapital: true })
    const plainCities = Array.from({ length: MAX_CITY_MARKERS + 10 }, (_, i) => mkCity({ refId: `plain-${i}`, population: i }))
    const allCities = [capitalCity, ...plainCities]
    const result = selectVisibleCities({
      cities: allCities,
      cityStatus: new Map<string, Status>(allCities.map((c) => [c.refId, 'visited'])),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(MAX_CITY_MARKERS)
    expect(result[0]?.refId).toBe('capital-1')
    expect(result[1]?.refId).toBe(`plain-${MAX_CITY_MARKERS + 9}`) // highest-population plain city
  })

  it('labels only the first MAX_CITY_LABELS markers of the priority-sorted result', () => {
    const cities = Array.from({ length: MAX_CITY_LABELS + 5 }, (_, i) => mkCity({ refId: `c-${i}`, population: i }))
    const result = selectVisibleCities({
      cities,
      cityStatus: new Map<string, Status>(cities.map((c) => [c.refId, 'visited'])),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(MAX_CITY_LABELS + 5)
    expect(result.slice(0, MAX_CITY_LABELS).every((m) => m.labeled)).toBe(true)
    expect(result.slice(MAX_CITY_LABELS).every((m) => !m.labeled)).toBe(true)
  })
})

describe('visibleRect', () => {
  it('inverts a translate+scale transform back to base-projected bounds, unpadded', () => {
    expect(visibleRect({ k: 2, x: -100, y: -50 }, 800, 600, 0)).toEqual({ x0: 50, y0: 25, x1: 450, y1: 325 })
  })

  it('the default padding grows the rect on every side', () => {
    const tight = visibleRect({ k: 2, x: -100, y: -50 }, 800, 600, 0)
    const padded = visibleRect({ k: 2, x: -100, y: -50 }, 800, 600)
    expect(padded.x0).toBeLessThan(tight.x0)
    expect(padded.y0).toBeLessThan(tight.y0)
    expect(padded.x1).toBeGreaterThan(tight.x1)
    expect(padded.y1).toBeGreaterThan(tight.y1)
  })
})
