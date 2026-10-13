// The logged cities the map's zoom-revealed city layer draws
// (@/components/map/cityLayer), resolved to name/position/capital and cached.

import { db } from '@/db/schema'
import { normalize } from '@/geo/search'
import { loadRefData } from '@/geo/refData'
import { registerCensusCounter } from '@/debug/census'

export interface MapCity {
  refId: string // String(geonameId) — matches Entry.refId
  name: string
  lat: number
  lon: number
  population: number
  // Best-effort: Country.capital is a bare name string with no geonameId
  // link in the data model, so this is a normalized-name match within the
  // same country. A miss (accented spelling drift, a renamed capital
  // GeoNames hasn't caught up with) just falls back to ranking that capital
  // by population like any other city — it can never wrongly promote an
  // unrelated one, since the match requires equality, not a guess.
  isCapital: boolean
}

// Logged cities only, keyed by refId and kept: the map's city layer only ever
// shows cities the user has an entry for (@/components/map/cityLayer), so it
// loads just those rows instead of all ~170k — which used to cost a full table
// read, a second 170k-object index next to @/geo/search's, and a 170k-row walk
// in selectVisibleCities on every globe frame. `null` = no coordinates.
// City rows never change after they're written (a reseed calls
// invalidateMapCityIndex), so a cached row stays valid.
const cache = new Map<string, MapCity | null>()

// Census probe (@/debug/census): how many logged cities the map has resolved.
registerCensusCounter('cityIdx', () => cache.size)

async function fetchMissing(refIds: readonly string[]): Promise<void> {
  const missing = refIds.filter((id) => !cache.has(id))
  if (missing.length === 0) return
  const [rows, ref] = await Promise.all([db.cities.bulkGet(missing.map(Number)), loadRefData()])
  missing.forEach((refId, i) => {
    const c = rows[i]
    // No row yet (an entry synced ahead of its city): not cached, retried next call.
    if (!c) return
    if (c.lat === null || c.lon === null) {
      cache.set(refId, null) // a manual place with no coordinates
      return
    }
    const capital = ref.countryByCode.get(c.countryCode)?.capital
    const capitalName = capital ? normalize(capital) : undefined
    const isCapital = capitalName !== undefined && (normalize(c.name) === capitalName || normalize(c.asciiName) === capitalName)
    cache.set(refId, { refId, name: c.name, lat: c.lat, lon: c.lon, population: c.population, isCapital })
  })
}

/** Call after @/geo/loader reseeds `cities` — same trigger as the search index. */
export function invalidateMapCityIndex(): void {
  cache.clear()
}

/** The given logged cities (by refId) that can be drawn, biggest first. */
export async function loadMapCities(refIds: readonly string[]): Promise<MapCity[]> {
  await fetchMissing(refIds)
  const out: MapCity[] = []
  for (const id of refIds) {
    const city = cache.get(id)
    if (city) out.push(city)
  }
  // Population-descending, so anything that slices a "top N" off this array
  // keeps the biggest cities first — same rationale @/geo/search's own
  // pre-sort documents.
  return out.sort((a, b) => b.population - a.population)
}
