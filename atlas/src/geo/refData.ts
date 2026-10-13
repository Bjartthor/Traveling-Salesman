// The two small reference tables — ~250 countries and ~3.9k subdivisions —
// read out of IndexedDB once and kept. They only ever change on a reference-
// data (re)seed (@/geo/loader), which calls invalidateRefData(), so every
// screen and per-trip query that needs them shares one copy instead of each
// re-reading ~4k rows on every live-query fire (the Trips tab used to do that
// once per stamp, on every place edit).

import { db } from '@/db/schema'
import type { Country, Subdivision } from '@/db/types'

export interface RefData {
  countries: Country[]
  subdivisions: Subdivision[]
  countryByCode: ReadonlyMap<string, Country>
  subdivisionById: ReadonlyMap<string, Subdivision>
}

let refPromise: Promise<RefData> | null = null

async function readRefData(): Promise<RefData> {
  const [countries, subdivisions] = await Promise.all([db.countries.toArray(), db.subdivisions.toArray()])
  return {
    countries,
    subdivisions,
    countryByCode: new Map(countries.map((c) => [c.code, c])),
    subdivisionById: new Map(subdivisions.map((s) => [s.id, s])),
  }
}

/** Countries + subdivisions, memoised. Not cached while still empty (before the first seed lands). */
export function loadRefData(): Promise<RefData> {
  if (!refPromise) {
    const pending = readRefData()
    refPromise = pending
    pending.then(
      (data) => {
        if (data.countries.length === 0 && refPromise === pending) refPromise = null
      },
      () => {
        if (refPromise === pending) refPromise = null
      },
    )
  }
  return refPromise
}

/** Call after @/geo/loader rewrites the countries/subdivisions tables. */
export function invalidateRefData(): void {
  refPromise = null
}
