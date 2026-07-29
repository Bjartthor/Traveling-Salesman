import { describe, expect, it } from 'vitest'
import { buildCityGrid, findNearestInGrid, haversineKm, type CityLite } from '@/geo/nearestCity'

const REYKJAVIK: CityLite = { refId: '1', name: 'Reykjavík', countryCode: 'IS', subdivisionId: 'IS.1', lat: 64.1466, lon: -21.9426 }
const AKUREYRI: CityLite = { refId: '2', name: 'Akureyri', countryCode: 'IS', subdivisionId: 'IS.6', lat: 65.6835, lon: -18.1002 }
const OSLO: CityLite = { refId: '3', name: 'Oslo', countryCode: 'NO', subdivisionId: 'NO.1', lat: 59.9139, lon: 10.7522 }
const PARIS: CityLite = { refId: '4', name: 'Paris', countryCode: 'FR', subdivisionId: 'FR.1', lat: 48.8566, lon: 2.3522 }

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(REYKJAVIK, REYKJAVIK)).toBe(0)
  })

  it('matches a known great-circle distance within 1%', () => {
    // Reykjavík -> Oslo is ~1747 km (independently checked against a second
    // haversine implementation, not just this module's own arithmetic).
    const d = haversineKm(REYKJAVIK, OSLO)
    expect(d).toBeGreaterThan(1747 * 0.99)
    expect(d).toBeLessThan(1747 * 1.01)
  })
})

describe('buildCityGrid / findNearestInGrid', () => {
  const grid = buildCityGrid([REYKJAVIK, AKUREYRI, OSLO, PARIS])

  it('finds the nearest city from a point right next to it', () => {
    const match = findNearestInGrid(grid, 64.15, -21.95)
    expect(match?.city.refId).toBe(REYKJAVIK.refId)
    expect(match?.distanceKm).toBeLessThan(1)
  })

  it('picks the correct one of two nearby candidates in the same country', () => {
    // A point roughly between Reykjavík and Akureyri, closer to Reykjavík.
    const match = findNearestInGrid(grid, 64.3, -21.5)
    expect(match?.city.refId).toBe(REYKJAVIK.refId)
  })

  it('searches across cell boundaries (3x3 neighbourhood), not just the exact cell', () => {
    // Reykjavík's 2°-cell covers lat [64,66); this point sits just across that
    // boundary in the neighbouring cell (lat [62,64)) but is still far nearer
    // to Reykjavík than to any other fixture city.
    const match = findNearestInGrid(grid, 63.9, -21.9426)
    expect(match?.city.refId).toBe(REYKJAVIK.refId)
  })

  it('returns null when nothing is anywhere near (middle of the Pacific)', () => {
    expect(findNearestInGrid(grid, 0, -160)).toBeNull()
  })

  it('never returns a city from a wrong country when a right one is closer', () => {
    // Nearer to Oslo than to Paris.
    const match = findNearestInGrid(grid, 58, 8)
    expect(match?.city.countryCode).toBe('NO')
  })
})
