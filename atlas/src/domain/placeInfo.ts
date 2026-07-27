// Resolves a bare PlaceRef (kind + refId — all the cascade needs) into what
// the UI needs to show a human a place: its name, its country code (for a
// flag) and a nearest-first breadcrumb of ancestor names. Dexie-backed, so it
// stays out of @/domain/cascade, which is deliberately Dexie-free.

import { db } from '@/db/schema'
import type { EntryKind } from '@/db/types'

export interface PlaceInfo {
  name: string
  countryCode: string
  /** Nearest ancestor first, e.g. ["Bavaria", "Germany"] for a city, [] for a country. */
  breadcrumb: string[]
}

export async function resolvePlaceInfo(kind: EntryKind, refId: string): Promise<PlaceInfo | null> {
  if (kind === 'country') {
    const country = await db.countries.get(refId)
    return country ? { name: country.name, countryCode: country.code, breadcrumb: [] } : null
  }

  if (kind === 'subdivision') {
    const sub = await db.subdivisions.get(refId)
    if (!sub) return null
    const country = await db.countries.get(sub.countryCode)
    return { name: sub.name, countryCode: sub.countryCode, breadcrumb: country ? [country.name] : [] }
  }

  const city = await db.cities.get(Number(refId))
  if (!city) return null
  const [country, sub] = await Promise.all([
    db.countries.get(city.countryCode),
    city.subdivisionId ? db.subdivisions.get(city.subdivisionId) : Promise.resolve(undefined),
  ])
  const breadcrumb = [sub?.name, country?.name].filter((n): n is string => Boolean(n))
  return { name: city.name, countryCode: city.countryCode, breadcrumb }
}
