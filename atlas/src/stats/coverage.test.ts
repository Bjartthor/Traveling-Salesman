import { describe, expect, it } from 'vitest'
import type { Country, Entry, Status } from '@/db/types'
import {
  buildStatusIndex,
  continentsTouched,
  countCitiesVisited,
  countrySubdivisionsVisited,
  countryCoverage,
  landAreaCoverage,
  metricCoverage,
  nextStatMode,
  populationCoverage,
  transitCoverage,
  visitDateRange,
  worldSummary,
} from '@/stats/coverage'

function mkCountry(overrides: Partial<Country> & { code: string }): Country {
  return {
    code3: overrides.code.repeat(3).slice(0, 3),
    name: overrides.code,
    unMember: true,
    territoryOf: null,
    continent: 'Europe',
    region: 'Testland',
    areaKm2: 0,
    population: 0,
    capital: null,
    lat: 0,
    lon: 0,
    ...overrides,
  }
}

function mkEntry(overrides: Partial<Entry> & { kind: Entry['kind']; refId: string; status: Status }): Entry {
  return {
    id: `${overrides.kind}-${overrides.refId}`,
    explicit: true,
    explicitStatus: overrides.status,
    firstVisited: null,
    lastVisited: null,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...overrides,
  }
}

// Hand-checkable fixture: A visited, B lived, C transit (not a UN member), D wishlist.
// area: 100/200/300/400 = 1000 total. population: 1000/2000/3000/4000 = 10000 total.
const countries: Country[] = [
  mkCountry({ code: 'A', unMember: true, continent: 'Europe', areaKm2: 100, population: 1000 }),
  mkCountry({ code: 'B', unMember: true, continent: 'Europe', areaKm2: 200, population: 2000 }),
  mkCountry({ code: 'C', unMember: false, continent: 'Asia', areaKm2: 300, population: 3000 }),
  mkCountry({ code: 'D', unMember: true, continent: 'Antarctica', areaKm2: 400, population: 4000 }),
]

const entries: Entry[] = [
  mkEntry({ kind: 'country', refId: 'A', status: 'visited' }),
  mkEntry({ kind: 'country', refId: 'B', status: 'lived' }),
  mkEntry({ kind: 'country', refId: 'C', status: 'transit' }),
  mkEntry({ kind: 'country', refId: 'D', status: 'wishlist' }),
]

describe('buildStatusIndex', () => {
  it('keys active entries of one kind by refId, ignoring other kinds and soft deletes', () => {
    const mixed: Entry[] = [
      ...entries,
      mkEntry({ kind: 'subdivision', refId: 'A.01', status: 'visited' }),
      mkEntry({ kind: 'country', refId: 'E', status: 'lived', deletedAt: 123 }),
    ]
    const index = buildStatusIndex(mixed, 'country')
    expect(index.size).toBe(4)
    expect(index.get('A')).toBe('visited')
    expect(index.has('E')).toBe(false)
    expect(index.has('A.01')).toBe(false)
  })
})

describe('countryCoverage', () => {
  it('counts visited+lived out of all countries', () => {
    const index = buildStatusIndex(entries, 'country')
    const result = countryCoverage(countries, index, 'all')
    expect(result).toMatchObject({ count: 2, total: 4, pct: 50 })
  })

  it('restricts the pool to UN members when denominator is unMember', () => {
    const index = buildStatusIndex(entries, 'country')
    // C is excluded from the pool (not a UN member); A and B remain visited/lived.
    const result = countryCoverage(countries, index, 'unMember')
    expect(result.total).toBe(3)
    expect(result.count).toBe(2)
    expect(result.pct).toBeCloseTo((2 / 3) * 100, 10)
  })

  it('produces four status segments that sum to 100%', () => {
    const index = buildStatusIndex(entries, 'country')
    const result = countryCoverage(countries, index, 'all')
    const byStatus = Object.fromEntries(result.segments.map((s) => [s.status, s.pct]))
    expect(byStatus).toEqual({ wishlist: 25, transit: 25, visited: 25, lived: 25 })
  })
})

describe('landAreaCoverage', () => {
  it('sums area for visited+lived countries against the dataset total', () => {
    const index = buildStatusIndex(entries, 'country')
    const result = landAreaCoverage(countries, index)
    // visited (A=100) + lived (B=200) = 300 of 1000
    expect(result.count).toBe(300)
    expect(result.total).toBe(1000)
    expect(result.pct).toBe(30)
  })
})

describe('populationCoverage', () => {
  it('sums population for visited+lived countries against the dataset total', () => {
    const index = buildStatusIndex(entries, 'country')
    const result = populationCoverage(countries, index)
    expect(result.count).toBe(3000)
    expect(result.total).toBe(10000)
    expect(result.pct).toBe(30)
  })
})

describe('metricCoverage', () => {
  it('dispatches to the right metric by mode', () => {
    const index = buildStatusIndex(entries, 'country')
    expect(metricCoverage('countries', countries, index, 'all').pct).toBe(50)
    expect(metricCoverage('area', countries, index, 'all').pct).toBe(30)
    expect(metricCoverage('population', countries, index, 'all').pct).toBe(30)
  })
})

describe('nextStatMode', () => {
  it('cycles countries -> area -> population -> countries', () => {
    expect(nextStatMode('countries')).toBe('area')
    expect(nextStatMode('area')).toBe('population')
    expect(nextStatMode('population')).toBe('countries')
  })
})

describe('transitCoverage', () => {
  it('counts only exact transit status, separately from coverage', () => {
    const index = buildStatusIndex(entries, 'country')
    expect(transitCoverage(countries, index, 'all')).toMatchObject({ count: 1, total: 4, pct: 25 })
    // C (the only transit country) isn't a UN member, so it drops out of the unMember pool.
    expect(transitCoverage(countries, index, 'unMember')).toMatchObject({ count: 0, total: 3, pct: 0 })
  })
})

describe('continentsTouched', () => {
  it('counts distinct continents among visited+lived countries, out of seven', () => {
    const index = buildStatusIndex(entries, 'country')
    // Visited/lived are A and B, both Europe -> 1 continent touched.
    expect(continentsTouched(countries, index)).toEqual({ touched: 1, total: 7 })
  })

  it('ignores the "Seven seas (open ocean)" pseudo-continent', () => {
    const oceanCountry = mkCountry({ code: 'Z', continent: 'Seven seas (open ocean)' })
    const index = buildStatusIndex([mkEntry({ kind: 'country', refId: 'Z', status: 'lived' })], 'country')
    expect(continentsTouched([oceanCountry], index)).toEqual({ touched: 0, total: 7 })
  })
})

describe('countrySubdivisionsVisited', () => {
  it('counts visited+lived subdivisions whose id is prefixed by the country code', () => {
    const index = buildStatusIndex(
      [
        mkEntry({ kind: 'subdivision', refId: 'A.01', status: 'visited' }),
        mkEntry({ kind: 'subdivision', refId: 'A.02', status: 'wishlist' }),
        mkEntry({ kind: 'subdivision', refId: 'B.01', status: 'lived' }),
      ],
      'subdivision',
    )
    expect(countrySubdivisionsVisited('A', index)).toBe(1)
    expect(countrySubdivisionsVisited('B', index)).toBe(1)
  })
})

describe('countCitiesVisited', () => {
  it('counts visited+lived cities among a caller-scoped geonameId list', () => {
    const index = buildStatusIndex(
      [
        mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
        mkEntry({ kind: 'city', refId: '2', status: 'transit' }),
      ],
      'city',
    )
    expect(countCitiesVisited([1, 2, 3], index)).toBe(1)
  })
})

describe('visitDateRange', () => {
  it('finds the earliest firstVisited and latest lastVisited among coverage entries', () => {
    const dated: Entry[] = [
      mkEntry({ kind: 'country', refId: 'A', status: 'visited', firstVisited: '2019-06-01', lastVisited: '2019-06-10' }),
      mkEntry({ kind: 'country', refId: 'B', status: 'lived', firstVisited: '2021-01-01', lastVisited: '2023-12-31' }),
      // Wishlist entry has dates but must not count.
      mkEntry({ kind: 'country', refId: 'D', status: 'wishlist', firstVisited: '2010-01-01', lastVisited: '2010-01-01' }),
    ]
    expect(visitDateRange(dated)).toEqual({ first: '2019-06-01', mostRecent: '2023-12-31' })
  })

  it('returns nulls when nothing counts as coverage', () => {
    expect(visitDateRange([mkEntry({ kind: 'country', refId: 'D', status: 'wishlist' })])).toEqual({
      first: null,
      mostRecent: null,
    })
  })
})

describe('worldSummary', () => {
  it('bundles continents, subdivisions, cities and dates in one pass', () => {
    const all: Entry[] = [
      ...entries.map((e) => (e.refId === 'A' ? { ...e, firstVisited: '2019-06-01', lastVisited: '2019-06-10' } : e)),
      mkEntry({ kind: 'subdivision', refId: 'A.01', status: 'visited' }),
      mkEntry({ kind: 'city', refId: '42', status: 'lived' }),
    ]
    const summary = worldSummary(countries, all)
    expect(summary).toEqual({
      continentsTouched: 1,
      continentsTotal: 7,
      subdivisionsVisited: 1,
      citiesVisited: 1,
      firstVisited: '2019-06-01',
      mostRecentVisited: '2019-06-10',
    })
  })
})
