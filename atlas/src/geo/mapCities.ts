// In-memory city index for the world map's zoom-revealed city layer
// (@/components/map/cityLayer). Same "build once, memoise, invalidate on
// reseed" shape @/geo/search and @/geo/nearestCity already established over
// this same ~170k-row reference table — a third small, purpose-built index
// rather than a shared one, matching how those two already diverged from
// each other (search needs substring-searchable strings, nearestCity needs a
// spatial grid; this one needs population + capital ranking).

import { db } from '@/db/schema'
import { normalize } from '@/geo/search'

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

let indexPromise: Promise<MapCity[]> | null = null

async function buildIndex(): Promise<MapCity[]> {
  const [cities, countries] = await Promise.all([db.cities.toArray(), db.countries.toArray()])

  const capitalNameByCountry = new Map<string, string>()
  for (const country of countries) {
    if (country.capital) capitalNameByCountry.set(country.code, normalize(country.capital))
  }

  const out: MapCity[] = []
  for (const c of cities) {
    if (c.lat === null || c.lon === null) continue // manual place with no coordinates
    const capitalName = capitalNameByCountry.get(c.countryCode)
    const isCapital = capitalName !== undefined && (normalize(c.name) === capitalName || normalize(c.asciiName) === capitalName)
    out.push({ refId: String(c.geonameId), name: c.name, lat: c.lat, lon: c.lon, population: c.population, isCapital })
  }
  // Population-descending, so anything that slices a "top N" off this array
  // keeps the biggest cities first — same rationale @/geo/search's own
  // pre-sort documents.
  out.sort((a, b) => b.population - a.population)
  return out
}

/** Call after @/geo/loader reseeds `cities` — same trigger as the other two in-memory city indexes. */
export function invalidateMapCityIndex(): void {
  indexPromise = null
}

export function loadMapCities(): Promise<readonly MapCity[]> {
  if (!indexPromise) indexPromise = buildIndex()
  return indexPromise
}
