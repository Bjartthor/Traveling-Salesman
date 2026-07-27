// Pure grouping/sort/filter logic for the Places tab (04-places.md task 4):
// continent -> country -> subdivision -> city, collapsible, filtered by
// status, with a count per group. No Dexie, no React — takes plain
// arrays/maps (the screen resolves them from Dexie) and returns plain data,
// same shape of contract as @/stats/coverage.
//
// Filtering keeps a row visible when its own status matches the filter, OR
// it's a country/subdivision header structurally needed to contain a
// descendant that matches — but every visible row always shows its own true
// status, never a status implied by the filter. A group's count is the
// number of *matching* rows inside it (itself included), so switching the
// filter to "Wishlist" shows exactly how many wishlist places sit under each
// heading, not the group's total size.

import type { City, Country, Entry, EntryKind, Status, Subdivision } from '@/db/types'
import { CONTINENTS } from '@/stats/coverage'

export type PlacesFilter = Status | 'all'
export type PlacesSort = 'alphabetical' | 'recent' | 'mostCities'

export interface PlaceRow {
  entryId: string
  kind: EntryKind
  refId: string
  name: string
  status: Status
  lastVisited: string | null
}

export interface SubdivisionGroup {
  key: string
  name: string
  row: PlaceRow | null // null when this subdivision has no entry of its own
  cities: PlaceRow[]
  matchCount: number
  /** Most recent date anywhere in this subdivision (itself or a city) — see recencyOf. Empty string = none. */
  recency: string
}

export interface CountryGroup {
  key: string
  code: string
  name: string
  row: PlaceRow | null
  subdivisions: SubdivisionGroup[]
  looseCities: PlaceRow[] // cities with no subdivision (or in a country with none)
  matchCount: number
  cityCount: number
  recency: string
}

export interface ContinentGroup {
  name: string
  countries: CountryGroup[]
  matchCount: number
}

/** Minimal city facts needed to place a city entry in the tree — callers resolve only the referenced ones. */
export type CityLookup = ReadonlyMap<string, Pick<City, 'name' | 'countryCode' | 'subdivisionId'>>

export interface BuildPlacesTreeInput {
  entries: readonly Entry[] // active (non-deleted) only
  countries: readonly Country[]
  subdivisions: readonly Subdivision[]
  cities: CityLookup
  filter: PlacesFilter
  sort: PlacesSort
}

function matchesFilter(status: Status, filter: PlacesFilter): boolean {
  return filter === 'all' || status === filter
}

function toRow(entry: Entry, name: string): PlaceRow {
  return { entryId: entry.id, kind: entry.kind, refId: entry.refId, name, status: entry.status, lastVisited: entry.lastVisited }
}

/** A date to sort by even for an entry with no visit date — when it was added, so "recent" stays meaningful for wishlist entries. */
function recencyOf(entry: Entry): string {
  return entry.lastVisited ?? entry.firstVisited ?? new Date(entry.createdAt).toISOString().slice(0, 10)
}

/** ISO-ish 'YYYY-MM-DD' strings compare lexicographically = chronologically; '' (no date) sorts as oldest. */
function maxRecency(values: readonly string[]): string {
  let best = ''
  for (const v of values) if (v > best) best = v
  return best
}

function rowRecency(row: PlaceRow | null, entryById: ReadonlyMap<string, Entry>): string {
  if (!row) return ''
  const entry = entryById.get(row.entryId)
  return entry ? recencyOf(entry) : ''
}

function sortRows(rows: PlaceRow[], sort: PlacesSort, entryById: ReadonlyMap<string, Entry>): PlaceRow[] {
  if (sort === 'recent') return [...rows].sort((a, b) => rowRecency(b, entryById).localeCompare(rowRecency(a, entryById)))
  // 'mostCities' has no meaning for a leaf row list; alphabetical is the sensible fallback, same as the default case.
  return [...rows].sort((a, b) => a.name.localeCompare(b.name))
}

/** Same three criteria, shared between country groups and subdivision groups. */
function sortGroups<T extends { name: string; recency: string }>(
  groups: T[],
  sort: PlacesSort,
  cityCountOf: (g: T) => number,
): T[] {
  const out = [...groups]
  if (sort === 'mostCities') out.sort((a, b) => cityCountOf(b) - cityCountOf(a) || a.name.localeCompare(b.name))
  else if (sort === 'recent') out.sort((a, b) => b.recency.localeCompare(a.recency) || a.name.localeCompare(b.name))
  else out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

export function buildPlacesTree(input: BuildPlacesTreeInput): ContinentGroup[] {
  const { entries, countries, subdivisions, cities, filter, sort } = input

  const countryByCode = new Map(countries.map((c) => [c.code, c]))
  const subdivisionById = new Map(subdivisions.map((s) => [s.id, s]))
  const entryById = new Map(entries.map((e) => [e.id, e]))

  interface SubBucket {
    subdivision: Subdivision | null
    row: PlaceRow | null
    cities: PlaceRow[]
  }
  interface CountryBucket {
    country: Country
    row: PlaceRow | null
    subdivisions: Map<string, SubBucket>
  }

  const buckets = new Map<string, CountryBucket>()

  function bucketFor(countryCode: string): CountryBucket | null {
    const existing = buckets.get(countryCode)
    if (existing) return existing
    const country = countryByCode.get(countryCode)
    if (!country) return null // defensive: an entry pointing at reference data that no longer exists
    const fresh: CountryBucket = { country, row: null, subdivisions: new Map() }
    buckets.set(countryCode, fresh)
    return fresh
  }

  function subBucketFor(bucket: CountryBucket, subdivisionId: string | null): SubBucket {
    const key = subdivisionId ?? ''
    const existing = bucket.subdivisions.get(key)
    if (existing) return existing
    const fresh: SubBucket = {
      subdivision: subdivisionId ? (subdivisionById.get(subdivisionId) ?? null) : null,
      row: null,
      cities: [],
    }
    bucket.subdivisions.set(key, fresh)
    return fresh
  }

  for (const entry of entries) {
    if (entry.deletedAt !== null) continue // defence in depth — callers are expected to pass active entries only
    if (entry.kind === 'country') {
      const bucket = bucketFor(entry.refId)
      if (bucket) bucket.row = toRow(entry, bucket.country.name)
      continue
    }
    if (entry.kind === 'subdivision') {
      const sub = subdivisionById.get(entry.refId)
      if (!sub) continue // defensive — reference data should always resolve for a live entry
      const bucket = bucketFor(sub.countryCode)
      if (!bucket) continue
      subBucketFor(bucket, entry.refId).row = toRow(entry, sub.name)
      continue
    }
    // city
    const city = cities.get(entry.refId)
    if (!city) continue
    const bucket = bucketFor(city.countryCode)
    if (!bucket) continue
    subBucketFor(bucket, city.subdivisionId).cities.push(toRow(entry, city.name))
  }

  const continents = new Map<string, CountryGroup[]>()

  for (const bucket of buckets.values()) {
    const subdivisionGroups: SubdivisionGroup[] = []
    let looseCities: PlaceRow[] = []
    let looseRecency = ''

    for (const [key, sub] of bucket.subdivisions) {
      const cityRows = sub.cities.filter((r) => matchesFilter(r.status, filter))
      const ownMatches = sub.row && matchesFilter(sub.row.status, filter) ? 1 : 0
      const matchCount = ownMatches + cityRows.length
      if (matchCount === 0) continue

      const cityRecencies = cityRows.map((r) => rowRecency(r, entryById))
      const ownRecency = rowRecency(sub.row, entryById)

      if (key === '') {
        looseCities = sortRows(cityRows, sort, entryById)
        looseRecency = maxRecency(cityRecencies)
        continue
      }
      subdivisionGroups.push({
        key,
        name: sub.subdivision?.name ?? key,
        row: sub.row,
        cities: sortRows(cityRows, sort, entryById),
        matchCount,
        recency: maxRecency([ownRecency, ...cityRecencies]),
      })
    }

    const ownMatches = bucket.row && matchesFilter(bucket.row.status, filter) ? 1 : 0
    const ownRecency = rowRecency(bucket.row, entryById)
    const matchCount = ownMatches + subdivisionGroups.reduce((n, s) => n + s.matchCount, 0) + looseCities.length
    if (matchCount === 0) continue

    const group: CountryGroup = {
      key: bucket.country.code,
      code: bucket.country.code,
      name: bucket.country.name,
      row: bucket.row,
      subdivisions: sortGroups(subdivisionGroups, sort, (g) => g.cities.length),
      looseCities,
      matchCount,
      cityCount: looseCities.length + subdivisionGroups.reduce((n, s) => n + s.cities.length, 0),
      recency: maxRecency([ownRecency, looseRecency, ...subdivisionGroups.map((s) => s.recency)]),
    }

    const list = continents.get(bucket.country.continent)
    if (list) list.push(group)
    else continents.set(bucket.country.continent, [group])
  }

  // The canonical seven first, in their usual order, then anything else that
  // actually has content — GeoNames buckets a handful of scattered island
  // territories (Bouvet, South Georgia, ...) into "Seven seas (open ocean)",
  // which @/stats/coverage's CONTINENTS deliberately excludes from the
  // touched-continents *count*. This is a different concern: a place you
  // logged there is still a place you logged, and must still show up.
  const order = [...CONTINENTS, ...[...continents.keys()].filter((name) => !CONTINENTS.includes(name)).sort()]

  const result: ContinentGroup[] = []
  for (const name of order) {
    const countryGroups = continents.get(name)
    if (!countryGroups || countryGroups.length === 0) continue
    result.push({
      name,
      countries: sortGroups(countryGroups, sort, (g) => g.cityCount),
      matchCount: countryGroups.reduce((n, g) => n + g.matchCount, 0),
    })
  }
  return result
}
