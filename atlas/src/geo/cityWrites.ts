// Creates new rows in the `cities` reference table at runtime: a place picked
// from Photon (@/geo/photon) or one entered through "Add a place manually"
// (04-places.md §2). Both need a geonameId that can never collide with a real
// GeoNames id — negative integers, allocated downward from -1, are outside
// the range GeoNames actually uses, so bundled and non-bundled rows can never
// collide (see the reseed-preservation note in @/geo/loader).

import { db } from '@/db/schema'
import type { City } from '@/db/types'
import { invalidateSearchIndex } from '@/geo/search'

async function nextSyntheticId(): Promise<number> {
  const closestToZero = await db.cities.where('geonameId').below(0).last()
  return (closestToZero?.geonameId ?? 0) - 1
}

async function insertCity(fields: Omit<City, 'geonameId' | 'searchTokens'>): Promise<City> {
  const city = await db.transaction('rw', db.cities, async () => {
    const geonameId = await nextSyntheticId()
    const row: City = { ...fields, geonameId, searchTokens: [] }
    await db.cities.add(row)
    return row
  })
  invalidateSearchIndex()
  return city
}

export interface OnlineCityInput {
  name: string
  countryCode: string
  subdivisionId: string | null
  lat: number
  lon: number
}

/**
 * A place resolved from Photon. Written once, from then on it behaves exactly
 * like a bundled city (04-places.md acceptance: "it survives an app restart
 * offline"). Photon doesn't report population, so this is always recorded as
 * 0 rather than a guess — it still ranks correctly for its own name in
 * @/geo/search since a village added this way rarely collides with a
 * higher-population match on the same query.
 */
export function addOnlineCity(input: OnlineCityInput): Promise<City> {
  return insertCity({
    name: input.name,
    asciiName: input.name,
    countryCode: input.countryCode,
    subdivisionId: input.subdivisionId,
    lat: input.lat,
    lon: input.lon,
    population: 0,
    source: 'online',
  })
}

export interface ManualCityInput {
  name: string
  countryCode: string
  subdivisionId: string | null
  lat: number | null
  lon: number | null
}

/** "Add a place manually" — anywhere neither the bundled data nor Photon knows. */
export function addManualCity(input: ManualCityInput): Promise<City> {
  return insertCity({
    name: input.name,
    asciiName: input.name,
    countryCode: input.countryCode,
    subdivisionId: input.subdivisionId,
    lat: input.lat,
    lon: input.lon,
    population: 0,
    source: 'manual',
  })
}
