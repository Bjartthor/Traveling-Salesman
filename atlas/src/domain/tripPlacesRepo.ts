// Dexie-facing resolution of a trip's grouped places — @/domain/tripPlaces is
// pure; this is the glue that feeds it from IndexedDB. Shared by the Trips
// tab's stamps, the trip detail screen, and the You-tab trip statistics, so
// none of them re-derive the same joins independently.

import { db } from '@/db/schema'
import type { City, Country, Entry, Subdivision } from '@/db/types'
import { entryIdsForTrip } from '@/domain/tripRepo'
import { groupTripPlaces, tripCountryCodes, type TripCountryGroup } from '@/domain/tripPlaces'

interface RefData {
  countries: Country[]
  subdivisions: Subdivision[]
}

async function loadRefData(): Promise<RefData> {
  const [countries, subdivisions] = await Promise.all([db.countries.toArray(), db.subdivisions.toArray()])
  return { countries, subdivisions }
}

async function resolveGroups(tripId: string, ref: RefData): Promise<TripCountryGroup[]> {
  const entryIds = await entryIdsForTrip(tripId)
  if (entryIds.length === 0) return []

  const rows = await db.entries.bulkGet(entryIds)
  const entries = rows.filter((e): e is Entry => e !== undefined && e.deletedAt === null)
  if (entries.length === 0) return []

  const cityEntries = entries.filter((e) => e.kind === 'city')
  const cityRows = await db.cities.bulkGet(cityEntries.map((e) => Number(e.refId)))
  const cities = new Map<string, Pick<City, 'name' | 'countryCode' | 'subdivisionId' | 'lat' | 'lon'>>()
  cityEntries.forEach((e, i) => {
    const row = cityRows[i]
    if (row) cities.set(e.refId, { name: row.name, countryCode: row.countryCode, subdivisionId: row.subdivisionId, lat: row.lat, lon: row.lon })
  })

  return groupTripPlaces({ entries, countries: ref.countries, subdivisions: ref.subdivisions, cities })
}

export async function loadTripPlaces(tripId: string): Promise<TripCountryGroup[]> {
  return resolveGroups(tripId, await loadRefData())
}

export async function loadTripCountryCodes(tripId: string): Promise<string[]> {
  return tripCountryCodes(await loadTripPlaces(tripId))
}

/** Same as `loadTripCountryCodes`, batched across trips so the (small, static) reference tables are only fetched once. */
export async function loadTripCountryCodesBatch(tripIds: readonly string[]): Promise<Map<string, string[]>> {
  const ref = await loadRefData()
  const result = new Map<string, string[]>()
  for (const tripId of tripIds) {
    result.set(tripId, tripCountryCodes(await resolveGroups(tripId, ref)))
  }
  return result
}

/**
 * Earliest `firstVisited` recorded anywhere under each country code, across
 * *all* active entries regardless of trip attachment — the "off the record"
 * check @/domain/tripStats.newCountriesByTrip uses to avoid crediting a trip
 * with a country that was already visited before any trip was ever logged.
 */
export async function loadCountryFirstVisited(): Promise<Map<string, string>> {
  const entries = await db.entries.filter((e) => e.deletedAt === null).toArray()

  const cityEntries = entries.filter((e) => e.kind === 'city')
  const cityRows = await db.cities.bulkGet(cityEntries.map((e) => Number(e.refId)))
  const cityCountry = new Map<string, string>()
  cityEntries.forEach((e, i) => {
    const row = cityRows[i]
    if (row) cityCountry.set(e.refId, row.countryCode)
  })

  const result = new Map<string, string>()
  function consider(code: string, date: string | null) {
    if (!date) return
    const existing = result.get(code)
    if (!existing || date < existing) result.set(code, date)
  }

  for (const e of entries) {
    if (e.kind === 'country') consider(e.refId, e.firstVisited)
    else if (e.kind === 'subdivision') {
      const dot = e.refId.indexOf('.')
      if (dot > 0) consider(e.refId.slice(0, dot), e.firstVisited)
    } else {
      const code = cityCountry.get(e.refId)
      if (code) consider(code, e.firstVisited)
    }
  }
  return result
}
