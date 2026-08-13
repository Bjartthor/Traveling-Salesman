// Fixture world (small on purpose, so every expectation is checkable by eye):
//
//   DE (Germany) ─┬─ DE.02 Bavaria (no row of its own) ─┬─ Munich     (attached)
//                 │                                      └─ Nuremberg  (attached)
//                 └─ DE.16 Berlin — attached directly, no cities under it
//   JP (Japan)   ──── attached directly, no subdivision/city at all
//   MC (Monaco)  ──── Monaco-Ville (attached, no subdivision) -> looseCities
//   FR (France)  ──── in reference data, never attached — must never appear

import { describe, expect, it } from 'vitest'
import type { Country, Entry, EntryKind, Status, Subdivision } from '@/db/types'
import { groupTripPlaces, tripCityRows, tripCountryCodes, type TripCityLookup } from '@/domain/tripPlaces'

function mkCountry(code: string, name: string): Country {
  return { code, code3: code, name, unMember: true, territoryOf: null, continent: 'Europe', region: 'Europe', areaKm2: 1, population: 1, capital: null, lat: 0, lon: 0 }
}

function mkSub(id: string, countryCode: string, name: string): Subdivision {
  return { id, countryCode, name, type: 'state', geonamesAdmin1: id.split('.')[1] ?? '', iso3166_2: null, lat: 0, lon: 0 }
}

const COUNTRIES: Country[] = [mkCountry('DE', 'Germany'), mkCountry('JP', 'Japan'), mkCountry('MC', 'Monaco'), mkCountry('FR', 'France')]
const SUBDIVISIONS: Subdivision[] = [mkSub('DE.02', 'DE', 'Bavaria'), mkSub('DE.16', 'DE', 'Berlin')]

const CITIES: TripCityLookup = new Map([
  ['1', { name: 'Munich', countryCode: 'DE', subdivisionId: 'DE.02', lat: 48.14, lon: 11.58 }],
  ['2', { name: 'Nuremberg', countryCode: 'DE', subdivisionId: 'DE.02', lat: 49.45, lon: 11.08 }],
  ['20', { name: 'Monaco-Ville', countryCode: 'MC', subdivisionId: null, lat: 43.73, lon: 7.42 }],
])

let idCounter = 0
function mkEntry(o: {
  kind: EntryKind
  refId: string
  status?: Status
  deletedAt?: number | null
  lastVisited?: string | null
  createdAt?: number
}): Entry {
  idCounter += 1
  return {
    id: `e${idCounter}`,
    kind: o.kind,
    refId: o.refId,
    status: o.status ?? 'visited',
    explicit: true,
    explicitStatus: o.status ?? 'visited',
    firstVisited: o.lastVisited ?? null,
    lastVisited: o.lastVisited ?? null,
    notes: '',
    createdAt: o.createdAt ?? 0,
    updatedAt: 0,
    deletedAt: o.deletedAt ?? null,
  }
}

const ENTRIES: Entry[] = [
  mkEntry({ kind: 'city', refId: '1' }),
  mkEntry({ kind: 'city', refId: '2' }),
  mkEntry({ kind: 'subdivision', refId: 'DE.16', status: 'wishlist' }),
  mkEntry({ kind: 'country', refId: 'JP', status: 'lived' }),
  mkEntry({ kind: 'city', refId: '20' }),
]

function build(entries: Entry[] = ENTRIES) {
  return groupTripPlaces({ entries, countries: COUNTRIES, subdivisions: SUBDIVISIONS, cities: CITIES })
}

function findCountry(groups: ReturnType<typeof build>, code: string) {
  return groups.find((g) => g.code === code)
}

describe('groupTripPlaces', () => {
  it('groups country -> subdivision -> city from attached entries alone', () => {
    const germany = findCountry(build(), 'DE')!
    expect(germany.row).toBeNull() // Germany itself was never attached directly
    expect(germany.subdivisions.map((s) => s.name)).toEqual(['Bavaria', 'Berlin'])
    expect(germany.subdivisions.find((s) => s.name === 'Bavaria')!.cities.map((c) => c.name)).toEqual(['Munich', 'Nuremberg'])
  })

  it('shows a subdivision heading with a row when it was attached directly, even with no cities under it', () => {
    const berlin = findCountry(build(), 'DE')!.subdivisions.find((s) => s.name === 'Berlin')!
    expect(berlin.row?.status).toBe('wishlist')
    expect(berlin.cities).toEqual([])
  })

  it('shows a country attached directly with no subdivisions or cities at all', () => {
    const japan = findCountry(build(), 'JP')!
    expect(japan.row?.status).toBe('lived')
    expect(japan.subdivisions).toEqual([])
    expect(japan.looseCities).toEqual([])
  })

  it('puts a city with no subdivision under looseCities, not a subdivision group', () => {
    const monaco = findCountry(build(), 'MC')!
    expect(monaco.subdivisions).toEqual([])
    expect(monaco.looseCities.map((c) => c.name)).toEqual(['Monaco-Ville'])
  })

  it('never shows a country nothing was attached under', () => {
    expect(findCountry(build(), 'FR')).toBeUndefined()
  })

  it('excludes a soft-deleted attachment (defence in depth — callers are expected to pass active entries only)', () => {
    const entries = ENTRIES.map((e) => (e.refId === '1' ? { ...e, deletedAt: 1 } : e))
    const bavaria = findCountry(build(entries), 'DE')!.subdivisions.find((s) => s.name === 'Bavaria')!
    expect(bavaria.cities.map((c) => c.name)).toEqual(['Nuremberg'])
  })

  it('skips an entry whose reference row no longer exists, without throwing', () => {
    const withUnknownCity = [...ENTRIES, mkEntry({ kind: 'city', refId: '999' })]
    expect(() => build(withUnknownCity)).not.toThrow()

    const withUnknownCountry = [...ENTRIES, mkEntry({ kind: 'country', refId: 'ZZ' })]
    expect(findCountry(build(withUnknownCountry), 'ZZ')).toBeUndefined()
  })
})

describe('chronological ordering (oldest visit first)', () => {
  it('sorts dated groups by visit date, oldest first', () => {
    const entries: Entry[] = [
      mkEntry({ kind: 'country', refId: 'JP', lastVisited: '2024-06-01', createdAt: 1 }),
      mkEntry({ kind: 'city', refId: '20', lastVisited: '2024-01-15', createdAt: 2 }), // Monaco-Ville
    ]
    const codes = build(entries).map((g) => g.code)
    expect(codes).toEqual(['MC', 'JP']) // Monaco visited earlier in the year
  })

  it('breaks a same-date tie by the order the place was added (createdAt)', () => {
    const entries: Entry[] = [
      mkEntry({ kind: 'country', refId: 'JP', lastVisited: '2024-06-01', createdAt: 200 }),
      mkEntry({ kind: 'city', refId: '20', lastVisited: '2024-06-01', createdAt: 100 }), // Monaco-Ville, added first
    ]
    const codes = build(entries).map((g) => g.code)
    expect(codes).toEqual(['MC', 'JP'])
  })

  it('pushes undated groups to the end, alphabetised among themselves', () => {
    const entries: Entry[] = [
      // DE ends up undated: only Bavaria's cities are attached, none dated.
      mkEntry({ kind: 'city', refId: '1', createdAt: 1 }), // Munich
      mkEntry({ kind: 'city', refId: '2', createdAt: 2 }), // Nuremberg
      mkEntry({ kind: 'country', refId: 'JP', createdAt: 3 }), // undated
      mkEntry({ kind: 'city', refId: '20', lastVisited: '2024-01-15', createdAt: 4 }), // Monaco-Ville — dated
    ]
    const codes = build(entries).map((g) => g.code)
    expect(codes).toEqual(['MC', 'DE', 'JP']) // dated MC first, then undated DE/JP alphabetically (Germany < Japan)
  })

  it('derives a country group with no row of its own from the earliest date anywhere under it', () => {
    const entries: Entry[] = [
      mkEntry({ kind: 'city', refId: '1', lastVisited: '2024-03-10', createdAt: 1 }), // Munich
      mkEntry({ kind: 'city', refId: '2', lastVisited: '2024-01-05', createdAt: 2 }), // Nuremberg — earlier
      mkEntry({ kind: 'country', refId: 'JP', lastVisited: '2024-02-01', createdAt: 3 }),
    ]
    // Germany's earliest is Nuremberg's 01-05, ahead of Japan's 02-01.
    expect(build(entries).map((g) => g.code)).toEqual(['DE', 'JP'])
  })

  it('applies the same rule to subdivisions and cities nested under a country', () => {
    const entries: Entry[] = [
      mkEntry({ kind: 'city', refId: '1', lastVisited: '2024-05-01', createdAt: 1 }), // Munich (Bavaria)
      mkEntry({ kind: 'city', refId: '2', lastVisited: '2024-02-01', createdAt: 2 }), // Nuremberg (Bavaria) — earlier
      mkEntry({ kind: 'subdivision', refId: 'DE.16', status: 'wishlist', lastVisited: '2024-01-01', createdAt: 3 }), // Berlin — earliest of all
    ]
    const germany = findCountry(build(entries), 'DE')!
    // Berlin's own date (01-01) is earlier than Bavaria's earliest city (Nuremberg, 02-01).
    expect(germany.subdivisions.map((s) => s.name)).toEqual(['Berlin', 'Bavaria'])
    // Within Bavaria, cities themselves sort oldest first: Nuremberg before Munich.
    const bavaria = germany.subdivisions.find((s) => s.name === 'Bavaria')!
    expect(bavaria.cities.map((c) => c.name)).toEqual(['Nuremberg', 'Munich'])
  })
})

describe('tripCountryCodes / tripCityRows', () => {
  it('returns exactly the countries with something attached under them', () => {
    expect(tripCountryCodes(build()).sort()).toEqual(['DE', 'JP', 'MC'])
  })

  it('flattens every city row across subdivisions and looseCities, carrying coordinates through', () => {
    const rows = tripCityRows(build())
    expect(rows.map((r) => r.name).sort()).toEqual(['Monaco-Ville', 'Munich', 'Nuremberg'])
    expect(rows.find((r) => r.name === 'Munich')).toMatchObject({ lat: 48.14, lon: 11.58 })
  })
})
