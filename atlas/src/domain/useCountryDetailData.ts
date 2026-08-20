// Shared data-fetching for "everything about one country" — status, its
// subdivisions' statuses, its cities, why its status is what it is, and its
// rolled-up photos. Used by both the full-screen CountryDetail (opened from
// the Places list) and the map's own CountrySheet (opened from the Map tab) —
// same data, two different presentations.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { City, Country, Entry, Photo, Status } from '@/db/types'
import { explainStatus } from '@/domain/cascade'
import { loadCascadeState } from '@/domain/cascadeRepo'
import { resolvePlaceInfo } from '@/domain/placeInfo'
import { listPhotosForEntries } from '@/domain/photoRepo'

export interface CountryDetailData {
  country: Country
  entry: Entry | null
  subdivisionTotal: number
  subdivisionIds: ReadonlySet<string>
  subdivisionStatus: Map<string, Status>
  cities: { entry: Entry; city: City }[]
  explanation: { status: Status; becauseName: string } | null
  photos: Photo[]
}

// undefined = still loading, null = code isn't a real country
export function useCountryDetailData(code: string): CountryDetailData | null | undefined {
  return useLiveQuery(async (): Promise<CountryDetailData | null> => {
    const country = await db.countries.get(code)
    if (!country) return null

    const [entryRow, subdivisionRows, allEntries] = await Promise.all([
      db.entries.where('[kind+refId]').equals(['country', code]).first(),
      db.subdivisions.where('countryCode').equals(code).toArray(),
      db.entries.toArray(),
    ])
    const subdivisionTotal = subdivisionRows.length
    const subdivisionIds = new Set(subdivisionRows.map((s) => s.id))
    const entry = entryRow && entryRow.deletedAt === null ? entryRow : null
    const active = allEntries.filter((e) => e.deletedAt === null)

    const subdivisionEntries = active.filter((e) => e.kind === 'subdivision' && e.refId.startsWith(`${code}.`))
    const subdivisionStatus = new Map(subdivisionEntries.map((e) => [e.refId, e.status]))

    const cityEntries = active.filter((e) => e.kind === 'city')
    const cityRows = await db.cities.bulkGet(cityEntries.map((e) => Number(e.refId)))
    const cities: { entry: Entry; city: City }[] = []
    cityEntries.forEach((e, i) => {
      const city = cityRows[i]
      if (city && city.countryCode === code) cities.push({ entry: e, city })
    })
    cities.sort((a, b) => a.city.name.localeCompare(b.city.name))

    // A country has no dedicated per-subdivision/per-city photo screen (see
    // PROGRESS.md) — photos tagged anywhere in the country still need
    // somewhere real to surface, so this rolls up every descendant's photos
    // onto the one place that shows them.
    const photoEntryIds = [entry?.id, ...subdivisionEntries.map((e) => e.id), ...cities.map((c) => c.entry.id)].filter(
      (id): id is string => id !== undefined,
    )
    const photos = await listPhotosForEntries(photoEntryIds)

    const state = await loadCascadeState().catch(() => null)
    const cause = state ? explainStatus(state, 'country', code) : null
    const explanation = cause
      ? { status: cause.status, becauseName: (await resolvePlaceInfo(cause.because.kind, cause.because.refId))?.name ?? 'a place inside it' }
      : null

    return { country, entry, subdivisionTotal, subdivisionIds, subdivisionStatus, cities, explanation, photos }
  }, [code])
}
