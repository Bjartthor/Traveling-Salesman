// Fixture world (small on purpose, so every expectation is checkable by eye):
//
//   DE (Europe) ─┬─ DE.02 Bavaria ─┬─ '1' Munich     visited  2019-06-01
//                │                 └─ '2' Nuremberg  lived    2021-03-15
//                └─ DE.16 Berlin   ─── '4' Berlin     wishlist (no date, createdAt 1000)
//   JP (Asia)   ──── country-level only               wishlist (no date, createdAt 2000)
//   MC (Europe) ──── '20' Monaco-Ville (no subdivision) transit 2020-01-01
//   FR (Europe) ──── in reference data, never referenced by an entry — must never appear

import { describe, expect, it } from 'vitest'
import type { Country, Entry, EntryKind, Status, Subdivision } from '@/db/types'
import { buildPlacesTree, type CityLookup, type PlacesFilter, type PlacesSort } from '@/domain/placesList'

function mkCountry(code: string, name: string, continent: string): Country {
  return { code, code3: code, name, unMember: true, territoryOf: null, continent, region: continent, areaKm2: 1, population: 1, capital: null, lat: 0, lon: 0 }
}

function mkSub(id: string, countryCode: string, name: string): Subdivision {
  return { id, countryCode, name, type: 'state', geonamesAdmin1: id.split('.')[1] ?? '', iso3166_2: null, lat: 0, lon: 0 }
}

const COUNTRIES: Country[] = [
  mkCountry('DE', 'Germany', 'Europe'),
  mkCountry('JP', 'Japan', 'Asia'),
  mkCountry('MC', 'Monaco', 'Europe'),
  mkCountry('FR', 'France', 'Europe'),
  // GeoNames buckets a handful of scattered island territories into this
  // pseudo-continent, which @/stats/coverage's CONTINENTS deliberately
  // excludes from its "touched out of 7" count — but a logged place there
  // still has to show up in the places list (see the test below).
  mkCountry('GS', 'South Georgia', 'Seven seas (open ocean)'),
]

const SUBDIVISIONS: Subdivision[] = [mkSub('DE.02', 'DE', 'Bavaria'), mkSub('DE.16', 'DE', 'Berlin')]

const CITIES: CityLookup = new Map([
  ['1', { name: 'Munich', countryCode: 'DE', subdivisionId: 'DE.02' }],
  ['2', { name: 'Nuremberg', countryCode: 'DE', subdivisionId: 'DE.02' }],
  ['4', { name: 'Berlin', countryCode: 'DE', subdivisionId: 'DE.16' }],
  ['20', { name: 'Monaco-Ville', countryCode: 'MC', subdivisionId: null }],
])

let idCounter = 0
function mkEntry(o: { kind: EntryKind; refId: string; status: Status; lastVisited?: string; createdAt?: number }): Entry {
  idCounter += 1
  return {
    id: `e${idCounter}`,
    kind: o.kind,
    refId: o.refId,
    status: o.status,
    explicit: true,
    explicitStatus: o.status,
    firstVisited: o.lastVisited ?? null,
    lastVisited: o.lastVisited ?? null,
    notes: '',
    createdAt: o.createdAt ?? 0,
    updatedAt: 0,
    deletedAt: null,
  }
}

const ENTRIES: Entry[] = [
  mkEntry({ kind: 'city', refId: '1', status: 'visited', lastVisited: '2019-06-01' }),
  mkEntry({ kind: 'city', refId: '2', status: 'lived', lastVisited: '2021-03-15' }),
  mkEntry({ kind: 'subdivision', refId: 'DE.02', status: 'lived' }),
  mkEntry({ kind: 'city', refId: '4', status: 'wishlist', createdAt: 1000 }),
  mkEntry({ kind: 'subdivision', refId: 'DE.16', status: 'wishlist' }),
  mkEntry({ kind: 'country', refId: 'DE', status: 'lived' }),
  mkEntry({ kind: 'country', refId: 'JP', status: 'wishlist', createdAt: 2000 }),
  mkEntry({ kind: 'city', refId: '20', status: 'transit', lastVisited: '2020-01-01' }),
  mkEntry({ kind: 'country', refId: 'MC', status: 'transit' }),
]

function build(filter: PlacesFilter = 'all', sort: PlacesSort = 'alphabetical', entries: Entry[] = ENTRIES) {
  return buildPlacesTree({ entries, countries: COUNTRIES, subdivisions: SUBDIVISIONS, cities: CITIES, filter, sort })
}

function findCountry(tree: ReturnType<typeof build>, continent: string, code: string) {
  return tree.find((c) => c.name === continent)?.countries.find((c) => c.code === code)
}

describe('buildPlacesTree — grouping', () => {
  it('groups continent -> country -> subdivision -> city', () => {
    const tree = build()
    expect(tree.map((c) => c.name)).toEqual(['Asia', 'Europe']) // canonical order, only populated continents

    const germany = findCountry(tree, 'Europe', 'DE')!
    expect(germany.subdivisions.map((s) => s.name)).toEqual(['Bavaria', 'Berlin'])
    expect(germany.subdivisions.find((s) => s.name === 'Bavaria')!.cities.map((c) => c.name)).toEqual(['Munich', 'Nuremberg'])
  })

  it('still shows a logged place whose continent is the "Seven seas" pseudo-bucket, appended after the real seven', () => {
    const entries = [...ENTRIES, mkEntry({ kind: 'country', refId: 'GS', status: 'visited' })]
    const tree = build('all', 'alphabetical', entries)
    expect(tree.map((c) => c.name)).toEqual(['Asia', 'Europe', 'Seven seas (open ocean)'])
    expect(findCountry(tree, 'Seven seas (open ocean)', 'GS')?.row?.status).toBe('visited')
  })

  it('puts a city with no subdivision under looseCities, not a subdivision group', () => {
    const monaco = findCountry(build(), 'Europe', 'MC')!
    expect(monaco.subdivisions).toEqual([])
    expect(monaco.looseCities.map((c) => c.name)).toEqual(['Monaco-Ville'])
  })

  it('never shows a country with no entry anywhere under it', () => {
    expect(findCountry(build(), 'Europe', 'FR')).toBeUndefined()
  })

  it('excludes soft-deleted entries but keeps the group if something else in it is still active', () => {
    const entries = ENTRIES.map((e) => (e.refId === '20' ? { ...e, deletedAt: 1 } : e))
    const monaco = findCountry(build('all', 'alphabetical', entries), 'Europe', 'MC')
    expect(monaco?.looseCities).toEqual([])
    expect(monaco?.row?.status).toBe('transit') // the country's own entry is untouched
  })

  it('skips an entry whose reference row no longer exists, without throwing', () => {
    const entries = [...ENTRIES, mkEntry({ kind: 'city', refId: '999', status: 'visited' })]
    expect(() => build('all', 'alphabetical', entries)).not.toThrow()

    const withUnknownCountry = [...ENTRIES, mkEntry({ kind: 'country', refId: 'ZZ', status: 'visited' })]
    expect(findCountry(build('all', 'alphabetical', withUnknownCountry), 'Europe', 'ZZ')).toBeUndefined()
  })
})

describe('buildPlacesTree — filtering', () => {
  it('keeps a header visible for a status only present in a child, without pretending the header matches', () => {
    const germany = findCountry(build('wishlist'), 'Europe', 'DE')!
    expect(germany.row?.status).toBe('lived') // the header always shows its *true* status
    expect(germany.subdivisions.map((s) => s.name)).toEqual(['Berlin']) // Bavaria has nothing wishlist inside
    expect(germany.subdivisions[0]!.cities.map((c) => c.name)).toEqual(['Berlin'])
  })

  it('drops a country entirely once nothing inside it matches the filter', () => {
    const tree = build('lived')
    expect(findCountry(tree, 'Asia', 'JP')).toBeUndefined() // wishlist-only
    expect(findCountry(tree, 'Europe', 'MC')).toBeUndefined() // transit-only
  })

  it('counts only matching rows per group', () => {
    // Matching under 'wishlist': subdivision DE.16 + city Berlin = 2. DE's own row (lived) doesn't count.
    expect(findCountry(build('wishlist'), 'Europe', 'DE')!.matchCount).toBe(2)
    // 'all' counts every row: DE, DE.02, Munich, Nuremberg, DE.16, Berlin = 6.
    expect(findCountry(build('all'), 'Europe', 'DE')!.matchCount).toBe(6)
  })
})

describe('buildPlacesTree — sorting', () => {
  it('alphabetical orders countries and their children by name', () => {
    const europe = build('all', 'alphabetical').find((c) => c.name === 'Europe')!
    expect(europe.countries.map((c) => c.name)).toEqual(['Germany', 'Monaco'])
    expect(europe.countries[0]!.subdivisions.map((s) => s.name)).toEqual(['Bavaria', 'Berlin'])
  })

  it('mostCities ranks the country with more logged cities first', () => {
    const europe = build('all', 'mostCities').find((c) => c.name === 'Europe')!
    expect(europe.countries.map((c) => c.name)).toEqual(['Germany', 'Monaco']) // 3 cities vs 1
  })

  it('recent ranks by the most recent date anywhere in the group, recursing into children too', () => {
    const europe = build('all', 'recent').find((c) => c.name === 'Europe')!
    // Germany's most recent is Nuremberg (2021-03-15); Monaco's is 2020-01-01.
    expect(europe.countries.map((c) => c.name)).toEqual(['Germany', 'Monaco'])

    const bavaria = europe.countries[0]!.subdivisions.find((s) => s.name === 'Bavaria')!
    expect(bavaria.cities.map((c) => c.name)).toEqual(['Nuremberg', 'Munich']) // 2021 before 2019
  })

  it('falls back to createdAt for an undated entry so "recent" still orders it sensibly', () => {
    // Japan (wishlist, no visit date, createdAt 2000) vs a hypothetical earlier wishlist-only country
    // would sort by createdAt — checked indirectly here via Berlin (createdAt 1000) sorting behind
    // Nuremberg/Munich (both dated) within Germany's "recent" ordering across levels.
    const germany = findCountry(build('all', 'recent'), 'Europe', 'DE')!
    expect(germany.subdivisions.map((s) => s.name)).toEqual(['Bavaria', 'Berlin']) // Bavaria (2021) before Berlin (1970, from createdAt)
  })
})
