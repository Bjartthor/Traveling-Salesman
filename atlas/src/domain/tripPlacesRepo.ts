// Dexie-facing resolution of a trip's grouped places — @/domain/tripPlaces is
// pure; this is the glue that feeds it from IndexedDB. Shared by the Trips
// tab's stamps, the trip detail screen, and the You-tab trip statistics, so
// none of them re-derive the same joins independently.

import { db } from '@/db/schema'
import type { City, Entry, TripEntry } from '@/db/types'
import { loadRefData, type RefData } from '@/geo/refData'
import { tripEntryRowsForTrip } from '@/domain/tripRepo'
import { groupTripPlaces, tripCountryCodes, type TripCountryGroup, type TripVisit } from '@/domain/tripPlaces'

type CityLookup = Map<string, Pick<City, 'name' | 'countryCode' | 'subdivisionId' | 'lat' | 'lon'>>

/** One trip's visits, keyed by entry: the earliest dated visit and first addedAt feed the itinerary sort. */
function visitMaps(tripEntries: readonly TripEntry[]) {
  // One row per visit; a place visited twice has two. The route uses every
  // visit; the itinerary sorts each place by its *first* one (earliest dated
  // visit, else none; earliest addedAt).
  const visits = new Map<string, TripVisit[]>()
  for (const te of [...tripEntries].sort((a, b) => a.addedAt - b.addedAt)) {
    const list = visits.get(te.entryId) ?? []
    list.push({ visitedDate: te.visitedDate, addedAt: te.addedAt })
    visits.set(te.entryId, list)
  }
  const visitedDates = new Map<string, string | null>()
  const addedAts = new Map<string, number>()
  for (const [entryId, list] of visits) {
    const dates = list.map((v) => v.visitedDate).filter((d): d is string => d !== null)
    visitedDates.set(entryId, dates.length > 0 ? dates.reduce((a, b) => (b < a ? b : a)) : null)
    addedAts.set(entryId, list[0]!.addedAt)
  }
  return { visits, visitedDates, addedAts }
}

/** Active entries + city rows for a set of entry ids — one bulk read each, however many trips they span. */
async function loadEntriesAndCities(entryIds: readonly string[]): Promise<{ entryById: Map<string, Entry>; cities: CityLookup }> {
  const rows = await db.entries.bulkGet([...entryIds])
  const entries = rows.filter((e): e is Entry => e !== undefined && e.deletedAt === null)
  const cityEntries = entries.filter((e) => e.kind === 'city')
  const cityRows = await db.cities.bulkGet(cityEntries.map((e) => Number(e.refId)))
  const cities: CityLookup = new Map()
  cityEntries.forEach((e, i) => {
    const row = cityRows[i]
    if (row) cities.set(e.refId, { name: row.name, countryCode: row.countryCode, subdivisionId: row.subdivisionId, lat: row.lat, lon: row.lon })
  })
  return { entryById: new Map(entries.map((e) => [e.id, e])), cities }
}

function groupsFor(tripEntries: readonly TripEntry[], entryById: ReadonlyMap<string, Entry>, cities: CityLookup, ref: RefData): TripCountryGroup[] {
  if (tripEntries.length === 0) return []
  const { visits, visitedDates, addedAts } = visitMaps(tripEntries)
  const entries = [...visits.keys()].map((id) => entryById.get(id)).filter((e): e is Entry => e !== undefined)
  if (entries.length === 0) return []
  return groupTripPlaces({ entries, countries: ref.countries, subdivisions: ref.subdivisions, cities, visitedDates, addedAts, visits })
}

export async function loadTripPlaces(tripId: string): Promise<TripCountryGroup[]> {
  const [ref, tripEntries] = await Promise.all([loadRefData(), tripEntryRowsForTrip(tripId)])
  if (tripEntries.length === 0) return []
  const { entryById, cities } = await loadEntriesAndCities([...new Set(tripEntries.map((te) => te.entryId))])
  return groupsFor(tripEntries, entryById, cities, ref)
}

/**
 * `loadTripPlaces` for many trips at once: one read of `tripEntries`, one bulk
 * read of the entries and cities they point at, the cached reference tables —
 * instead of a separate set of queries per trip (the Trips tab's stamps and
 * the trip statistics each used to run one per trip).
 */
export async function loadTripPlacesBatch(tripIds: readonly string[]): Promise<Map<string, TripCountryGroup[]>> {
  const result = new Map<string, TripCountryGroup[]>()
  if (tripIds.length === 0) return result
  const wanted = new Set(tripIds)
  const [ref, allTripEntries] = await Promise.all([loadRefData(), db.tripEntries.filter((te) => te.deletedAt === null && wanted.has(te.tripId)).toArray()])

  const byTrip = new Map<string, TripEntry[]>()
  for (const te of allTripEntries) {
    const list = byTrip.get(te.tripId) ?? []
    list.push(te)
    byTrip.set(te.tripId, list)
  }
  const { entryById, cities } = await loadEntriesAndCities([...new Set(allTripEntries.map((te) => te.entryId))])
  for (const tripId of tripIds) result.set(tripId, groupsFor(byTrip.get(tripId) ?? [], entryById, cities, ref))
  return result
}

export async function loadTripCountryCodes(tripId: string): Promise<string[]> {
  return tripCountryCodes(await loadTripPlaces(tripId))
}

/** Same as `loadTripCountryCodes`, batched across trips (see loadTripPlacesBatch). */
export async function loadTripCountryCodesBatch(tripIds: readonly string[]): Promise<Map<string, string[]>> {
  const groups = await loadTripPlacesBatch(tripIds)
  return new Map([...groups].map(([tripId, g]) => [tripId, tripCountryCodes(g)]))
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
