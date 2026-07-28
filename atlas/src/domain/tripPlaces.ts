// Pure grouping for one trip's attached places (05-trips.md task 4): country
// -> subdivision -> city. Unlike @/domain/placesList (which groups *every*
// logged place, filtered/sorted for browsing), trip membership is the sole
// criterion here — every row shown is a place attached to this trip, full
// stop. No Dexie, no React — same contract as coverage.ts/placesList.ts.
//
// "Attach at the city level; the trip's country list is derived from its
// cities, plus any country added directly" (05-trips.md task 1): a country
// heading appears here either because a city or subdivision attached to the
// trip sits under it, or because the country entry itself was attached
// directly (set explicitly while the trip was active with no city
// drill-down — e.g. a drive-through with no specific stop). Same relationship
// between a subdivision heading and its cities.

import type { City, Country, Entry, Status, Subdivision } from '@/db/types'

export type TripCityLookup = ReadonlyMap<string, Pick<City, 'name' | 'countryCode' | 'subdivisionId' | 'lat' | 'lon'>>

export interface TripPlaceRow {
  entryId: string
  refId: string
  name: string
  status: Status
  lastVisited: string | null
  lat: number | null
  lon: number | null
}

export interface TripSubdivisionGroup {
  key: string
  name: string
  row: TripPlaceRow | null // non-null only if the subdivision itself was attached directly
  cities: TripPlaceRow[]
}

export interface TripCountryGroup {
  code: string
  name: string
  row: TripPlaceRow | null // non-null only if the country itself was attached directly
  subdivisions: TripSubdivisionGroup[]
  looseCities: TripPlaceRow[] // cities with no subdivision
}

export interface TripPlacesInput {
  /** This trip's attached entries, active only — caller resolves via tripRepo.entryIdsForTrip + a live entries query. */
  entries: readonly Entry[]
  countries: readonly Country[]
  subdivisions: readonly Subdivision[]
  cities: TripCityLookup
}

function toRow(entry: Entry, name: string, lat: number | null = null, lon: number | null = null): TripPlaceRow {
  return { entryId: entry.id, refId: entry.refId, name, status: entry.status, lastVisited: entry.lastVisited, lat, lon }
}

export function groupTripPlaces(input: TripPlacesInput): TripCountryGroup[] {
  const { entries, countries, subdivisions, cities } = input
  const countryByCode = new Map(countries.map((c) => [c.code, c]))
  const subdivisionById = new Map(subdivisions.map((s) => [s.id, s]))

  interface SubBucket {
    subdivision: Subdivision | null
    row: TripPlaceRow | null
    cities: TripPlaceRow[]
  }
  interface CountryBucket {
    country: Country
    row: TripPlaceRow | null
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
    if (entry.deletedAt !== null) continue // defence in depth — callers pass active entries only
    if (entry.kind === 'country') {
      const bucket = bucketFor(entry.refId)
      if (bucket) bucket.row = toRow(entry, bucket.country.name)
      continue
    }
    if (entry.kind === 'subdivision') {
      const sub = subdivisionById.get(entry.refId)
      if (!sub) continue
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
    subBucketFor(bucket, city.subdivisionId).cities.push(toRow(entry, city.name, city.lat, city.lon))
  }

  const groups: TripCountryGroup[] = []
  for (const bucket of buckets.values()) {
    const subdivisionGroups: TripSubdivisionGroup[] = []
    let looseCities: TripPlaceRow[] = []

    for (const [key, sub] of bucket.subdivisions) {
      if (key === '') {
        looseCities = [...sub.cities].sort((a, b) => a.name.localeCompare(b.name))
        continue
      }
      subdivisionGroups.push({
        key,
        name: sub.subdivision?.name ?? key,
        row: sub.row,
        cities: [...sub.cities].sort((a, b) => a.name.localeCompare(b.name)),
      })
    }
    subdivisionGroups.sort((a, b) => a.name.localeCompare(b.name))

    groups.push({
      code: bucket.country.code,
      name: bucket.country.name,
      row: bucket.row,
      subdivisions: subdivisionGroups,
      looseCities,
    })
  }
  groups.sort((a, b) => a.name.localeCompare(b.name))
  return groups
}

/** The trip's country code set — the stamp's grid and the "N countries" stat both need exactly this. */
export function tripCountryCodes(groups: readonly TripCountryGroup[]): string[] {
  return groups.map((g) => g.code)
}

/** Every city row across every group, flattened — for the route map's markers. */
export function tripCityRows(groups: readonly TripCountryGroup[]): TripPlaceRow[] {
  const out: TripPlaceRow[] = []
  for (const g of groups) {
    out.push(...g.looseCities)
    for (const s of g.subdivisions) out.push(...s.cities)
  }
  return out
}
