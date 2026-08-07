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

const FULL_VIEWPORT = { transform: { k: 1, x: 0, y: 0 }, viewportWidth: 1000, viewportHeight: 1000 }

describe('selectVisibleCities — scale gating', () => {
  it('shows nothing below CITY_MIN_SCALE, even for an obviously-eligible capital', () => {
    const capital = mkCity({ refId: 'cap', population: 10_000_000, isCapital: true })
    const result = selectVisibleCities({
      cities: [capital],
      cityStatus: new Map(),
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
      cityStatus: new Map(),
      scale: 24,
      transform: { k: 1, x: 0, y: 0 },
      viewportWidth: 0,
      viewportHeight: 0,
      project: identityProject,
    })
    expect(result).toHaveLength(0)
  })
})

describe('selectVisibleCities — population tiers', () => {
  it('requires a higher population at the minimum reveal scale than at a deeper zoom', () => {
    const city = mkCity({ refId: 'mid', population: 600_000 })
    const at = (scale: number) =>
      selectVisibleCities({ cities: [city], cityStatus: new Map(), scale, ...FULL_VIEWPORT, project: identityProject })
    expect(at(CITY_MIN_SCALE)).toHaveLength(0) // 600k is below the 2,000,000 floor at the minimum scale
    expect(at(4)).toHaveLength(1) // but clears the 500,000 floor once zoomed to scale 4
  })

  it('always includes a capital regardless of population', () => {
    const capital = mkCity({ refId: 'tiny-capital', population: 1, isCapital: true })
    const result = selectVisibleCities({
      cities: [capital],
      cityStatus: new Map(),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(1)
  })

  it('always includes a city the user has logged as an entry, regardless of population', () => {
    const visited = mkCity({ refId: 'tiny-village', population: 1 })
    const result = selectVisibleCities({
      cities: [visited],
      cityStatus: new Map<string, Status>([['tiny-village', 'lived']]),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(1)
    expect(result[0]?.status).toBe('lived')
  })
})

describe('selectVisibleCities — viewport culling', () => {
  it('excludes an otherwise-eligible city outside the current viewport', () => {
    const farAway = mkCity({ refId: 'far', population: 1, isCapital: true, lon: 5000, lat: 5000 })
    const result = selectVisibleCities({
      cities: [farAway],
      cityStatus: new Map(),
      scale: CITY_MIN_SCALE,
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(0)
  })
})

describe('selectVisibleCities — cap and priority', () => {
  it('caps the result at MAX_CITY_MARKERS, keeping entries first, then capitals, then the highest populations', () => {
    const entryCity = mkCity({ refId: 'entry-1', population: 10 })
    const capitalCity = mkCity({ refId: 'capital-1', population: 20, isCapital: true })
    const plainCities = Array.from({ length: MAX_CITY_MARKERS + 10 }, (_, i) => mkCity({ refId: `plain-${i}`, population: i }))
    const result = selectVisibleCities({
      cities: [entryCity, capitalCity, ...plainCities],
      cityStatus: new Map<string, Status>([[entryCity.refId, 'visited']]),
      scale: 24, // deepest tier (population floor 0) — isolates cap/priority from population gating
      ...FULL_VIEWPORT,
      project: identityProject,
    })
    expect(result).toHaveLength(MAX_CITY_MARKERS)
    expect(result[0]?.refId).toBe('entry-1')
    expect(result[1]?.refId).toBe('capital-1')
    expect(result[2]?.refId).toBe(`plain-${MAX_CITY_MARKERS + 9}`) // highest-population plain city
  })

  it('labels only the first MAX_CITY_LABELS markers of the priority-sorted result', () => {
    const cities = Array.from({ length: MAX_CITY_LABELS + 5 }, (_, i) => mkCity({ refId: `c-${i}`, population: i }))
    const result = selectVisibleCities({
      cities,
      cityStatus: new Map(),
      scale: 24,
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
