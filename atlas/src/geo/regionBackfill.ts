// One-time repair for cities already saved with no subdivisionId despite
// having coordinates. Two independent causes: an online (Photon) city added
// before @/geo/photon's nearest-region fallback existed (the coastline-
// rounding miss that motivated it — see resolveSubdivisionByPoint), or a
// bundled row whose GeoNames admin1Code never matched subdivisions.json.
// Source-agnostic on purpose — both get re-resolved the same way.
//
// Triggered once per device from @/geo/geoStore (gated by
// Settings.regionBackfillDone), not on every app start.

import { db } from '@/db/schema'
import type { City } from '@/db/types'
import { resolveSubdivisionByPoint } from '@/geo/photon'
import { rebuildDerivedEntries } from '@/domain/cascadeRepo'
import { invalidateSearchIndex } from '@/geo/search'
import { invalidateNearestCityIndex } from '@/geo/nearestCity'
import { invalidateMapCityIndex } from '@/geo/mapCities'

export interface RegionBackfillResult {
  orphaned: number
  resolved: number
}

export async function backfillCityRegions(): Promise<RegionBackfillResult> {
  const orphaned = await db.cities.filter((c) => c.subdivisionId === null && c.lat !== null && c.lon !== null).toArray()

  const updated: City[] = []
  for (const city of orphaned) {
    const subdivisionId = await resolveSubdivisionByPoint(city.countryCode, city.lon!, city.lat!)
    if (subdivisionId) updated.push({ ...city, subdivisionId })
  }

  if (updated.length > 0) {
    await db.cities.bulkPut(updated)
    invalidateSearchIndex()
    invalidateNearestCityIndex()
    invalidateMapCityIndex()
    // The cascade only creates a subdivision-level derived entry from
    // `city.subdivisionId` at write time — these cities were already saved
    // with it null, so nothing upstream knows a region exists until this
    // recomputes every derived row from the now-corrected reference data.
    await rebuildDerivedEntries()
  }

  return { orphaned: orphaned.length, resolved: updated.length }
}
