// Creates new rows in the `cities` reference table at runtime: a place picked
// from Photon (@/geo/photon) or one entered through "Add a place manually"
// (04-places.md §2). Both need a geonameId that can never collide with a real
// GeoNames id — negative integers are outside the range GeoNames actually
// uses, so bundled and non-bundled rows can never collide (see the
// reseed-preservation note in @/geo/loader).

import { db } from '@/db/schema'
import type { City } from '@/db/types'
import { logError, logInfo } from '@/debug/log'
import { breadcrumbDetail } from '@/debug/breadcrumb'
import { invalidateSearchIndex } from '@/geo/search'

// Previously "read the current closest-to-zero row, use one less" — a
// counter that needs a read before every write. Two overlapping inserts (a
// double-tap, or two tabs) could both read the same current value before
// either committed, then both try to claim the same next id and one loses
// with ConstraintError. Confirmed empirically (concurrent inserts reliably
// reproduce it) that this isn't just a narrow timing window either: repeated
// and delayed retries of the read kept seeing the same stale "current max",
// even once the winning write had genuinely committed — Dexie's
// transaction-zone tracking appears to let sibling calls issued in the same
// batch share a read. A random draw from a ~4.3 billion-value range needs no
// read at all, so there's nothing to race: collision odds land in the same
// birthday-paradox territory as a UUID. Nothing in the app treats geonameId
// as sequential or meaningful beyond "a stable, negative, unique key" (see
// `git grep geonameId`), so dropping the ordering costs nothing.
function randomNegativeId(): number {
  // A freshly-allocated Uint32Array(1), just filled — index 0 always exists.
  const n = crypto.getRandomValues(new Uint32Array(1))[0]!
  return -(n + 1)
}

// Cheap insurance for the residual, near-negligible chance of a collision —
// not the primary defence, the random range is.
const MAX_INSERT_ATTEMPTS = 5

async function insertCity(fields: Omit<City, 'geonameId' | 'searchTokens'>): Promise<City> {
  void logInfo(`city: insert "${fields.name}" (${fields.source})`, breadcrumbDetail())
  for (let attempt = 0; ; attempt++) {
    try {
      const row: City = { ...fields, geonameId: randomNegativeId(), searchTokens: [] }
      await db.cities.add(row)
      invalidateSearchIndex()
      return row
    } catch (e) {
      const isIdCollision = e instanceof Error && e.name === 'ConstraintError'
      if (!isIdCollision || attempt >= MAX_INSERT_ATTEMPTS - 1) {
        void logError(`city: insert failed for "${fields.name}"`, e instanceof Error ? e.message : String(e))
        throw e
      }
    }
  }
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
