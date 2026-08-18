// Runtime geo data loader. See 02-geo-data.md §3.
//
// Seeds the committed artefacts in public/geo/ into IndexedDB on first run, and
// lazily loads map topology. Reference-data (re)seeds ONLY touch the reference
// tables (countries / subdivisions / cities) — never entries / trips / photos.

import { db } from '@/db/schema'
import type { City, Country, Subdivision } from '@/db/types'
import { invalidateSearchIndex } from '@/geo/search'
import { invalidateNearestCityIndex } from '@/geo/nearestCity'
import { invalidateMapCityIndex } from '@/geo/mapCities'
import { registerCensusCounter } from '@/debug/census'

// Bump when the committed artefacts change shape/content so an app update
// reseeds reference data without disturbing user data.
// v2: 11 island territories (Svalbard, French DOMs, Christmas/Cocos, Bonaire,
// Bouvet, Tokelau) gained their own map shape + filled `region`, and their
// parents' centroids no longer include the carved-off land (see tools/build-geo
// addTerritoryShapes).
export const GEO_DATA_VERSION = 2

const base = import.meta.env.BASE_URL // './' for the GitHub Pages build
const geoUrl = (p: string) => `${base}geo/${p}`

export type GeoLoadPhase = 'countries' | 'cities' | 'done'
export interface GeoProgress {
  phase: GeoLoadPhase
  loaded: number
  total: number
}

/** True once reference data for the current GEO_DATA_VERSION is present. */
export async function isReferenceDataReady(): Promise<boolean> {
  const settings = await db.settings.get(1)
  return settings?.geoDataVersion === GEO_DATA_VERSION
}

async function decodeCitiesPayload(buf: ArrayBuffer): Promise<string> {
  // GitHub Pages serves .gz as raw bytes, so we decompress in the client. But
  // some dev servers (Vite/sirv) set Content-Encoding: gzip for a .gz file, so
  // the browser has already decompressed it by the time we see the bytes.
  // Sniff the gzip magic number (0x1f 0x8b) to decide, so we work on both.
  const bytes = new Uint8Array(buf)
  const isGzip = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  if (!isGzip) return new TextDecoder().decode(buf)
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('DecompressionStream unavailable — cannot decode cities.json.gz')
  }
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

interface CitiesFile {
  fields: string[]
  rows: (string | number)[][]
}

/**
 * On first run (or after a GEO_DATA_VERSION bump) fetch the reference artefacts
 * and bulk-insert them into Dexie. Reports determinate progress. `onCountries
 * Ready` fires once countries + subdivisions have landed, so the app can become
 * usable while the ~170k cities are still streaming in.
 */
export async function ensureReferenceData(
  onProgress?: (p: GeoProgress) => void,
  onCountriesReady?: () => void,
): Promise<void> {
  if (await isReferenceDataReady()) {
    onCountriesReady?.()
    onProgress?.({ phase: 'done', loaded: 1, total: 1 })
    return
  }

  const startedAt = performance.now()

  // --- 1. countries + subdivisions (small, fast) ---
  onProgress?.({ phase: 'countries', loaded: 0, total: 1 })
  const [countries, subdivisions] = await Promise.all([
    fetch(geoUrl('countries.json')).then((r) => {
      if (!r.ok) throw new Error(`countries.json ${r.status}`)
      return r.json() as Promise<Country[]>
    }),
    fetch(geoUrl('subdivisions.json')).then((r) => {
      if (!r.ok) throw new Error(`subdivisions.json ${r.status}`)
      return r.json() as Promise<Subdivision[]>
    }),
  ])
  await db.transaction('rw', db.countries, db.subdivisions, async () => {
    await db.countries.clear()
    await db.countries.bulkPut(countries)
    await db.subdivisions.clear()
    await db.subdivisions.bulkPut(subdivisions)
  })
  onProgress?.({ phase: 'countries', loaded: 1, total: 1 })
  onCountriesReady?.()

  // --- 2. cities (large, streamed in chunks) ---
  const subIds = new Set(subdivisions.map((s) => s.id))
  const buf = await fetch(geoUrl('cities.json.gz')).then((r) => {
    if (!r.ok) throw new Error(`cities.json.gz ${r.status}`)
    return r.arrayBuffer()
  })
  const { fields, rows } = JSON.parse(await decodeCitiesPayload(buf)) as CitiesFile
  const colIndex = (name: string): number => {
    const i = fields.indexOf(name)
    if (i === -1) throw new Error(`cities.json.gz is missing the "${name}" column`)
    return i
  }
  const iId = colIndex('geonameId')
  const iName = colIndex('name')
  const iAscii = colIndex('asciiName')
  const iCc = colIndex('countryCode')
  const iAdmin1 = colIndex('admin1Code')
  const iLat = colIndex('lat')
  const iLon = colIndex('lon')
  const iPop = colIndex('population')
  const total = rows.length

  // A version bump reseeds the *bundled* rows, but must not take the user's
  // 'online' (Photon) or 'manual' cities with it — any entry pointing at one
  // would otherwise throw UnknownCityError the moment the cascade next reads
  // it (@/domain/cascadeRepo). Carry them across the clear(), re-checking
  // their subdivisionId against the fresh subdivisions in case an admin1 code
  // was renamed or dropped upstream; their geonameId is always negative
  // (@/geo/cityWrites), so it can never collide with a fresh bundled row.
  const preserved = (await db.cities.filter((c) => c.source !== 'bundled').toArray()).map((c) => ({
    ...c,
    subdivisionId: c.subdivisionId && subIds.has(c.subdivisionId) ? c.subdivisionId : null,
  }))

  await db.cities.clear()
  const CHUNK = 10000
  onProgress?.({ phase: 'cities', loaded: 0, total })
  for (let i = 0; i < total; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    const cityRows: City[] = slice.map((r) => {
      const name = String(r[iName])
      // asciiName is stored empty when identical to name (build-side dedup).
      const asciiName = r[iAscii] ? String(r[iAscii]) : name
      const countryCode = String(r[iCc])
      const admin1Code = r[iAdmin1] ? String(r[iAdmin1]) : ''
      const candidate = admin1Code ? `${countryCode}.${admin1Code}` : ''
      return {
        geonameId: Number(r[iId]),
        name,
        asciiName,
        countryCode,
        subdivisionId: candidate && subIds.has(candidate) ? candidate : null,
        lat: Number(r[iLat]),
        lon: Number(r[iLon]),
        population: Number(r[iPop]),
        source: 'bundled',
        // Left empty deliberately: runtime search is in-memory (src/geo/search.ts)
        // because it must match interior substrings ("vík" inside Reykjavík), which
        // a Dexie prefix index cannot — and which the phase acceptance requires.
        // Populating this multi-entry index over 170k rows would add heavy first-run
        // seed cost on a phone for zero runtime gain. The `*searchTokens` index stays
        // declared (no schema migration) but inert. See PROGRESS.md for the rationale.
        searchTokens: [],
      }
    })
    // bulkAdd (not bulkPut) — the table was just cleared and geonameIds are
    // unique, so we skip the per-row existence check for a faster seed.
    await db.cities.bulkAdd(cityRows)
    onProgress?.({ phase: 'cities', loaded: Math.min(i + CHUNK, total), total })
  }
  if (preserved.length > 0) await db.cities.bulkAdd(preserved)

  // --- 3. mark seeded (device-local; leaves user tables untouched) ---
  await db.settings.update(1, { geoDataVersion: GEO_DATA_VERSION })
  invalidateSearchIndex()
  invalidateNearestCityIndex()
  invalidateMapCityIndex()
  console.info(`[geo] reference data seeded in ${Math.round(performance.now() - startedAt)} ms (${total} cities)`)
  onProgress?.({ phase: 'done', loaded: total, total })
}

// --- Map topology (lazy, memoised) ---

// Minimal TopoJSON shape; Phase 3 decodes it with topojson-client.
export interface TopoJson {
  type: 'Topology'
  objects: Record<string, unknown>
  arcs: unknown[]
  transform?: unknown
}

let worldTopoPromise: Promise<TopoJson> | null = null
const countryTopoPromises = new Map<string, Promise<TopoJson | null>>()

export function loadWorldTopology(): Promise<TopoJson> {
  if (!worldTopoPromise) {
    worldTopoPromise = fetch(geoUrl('world.topo.json')).then((r) => {
      if (!r.ok) throw new Error(`world.topo.json ${r.status}`)
      return r.json() as Promise<TopoJson>
    })
  }
  return worldTopoPromise
}

/** Lazy admin-1 topology for one country; resolves null when the file is absent. */
export function loadCountryTopology(code: string): Promise<TopoJson | null> {
  let promise = countryTopoPromises.get(code)
  if (!promise) {
    promise = fetch(geoUrl(`admin1/${code}.topo.json`))
      .then((r) => (r.ok ? (r.json() as Promise<TopoJson>) : null))
      .catch(() => null)
    countryTopoPromises.set(code, promise)
  }
  return promise
}

const countryDetailTopoPromises = new Map<string, Promise<TopoJson | null>>()

// Census probe (@/debug/census): both maps hold one memoised fetch per country
// code, so together they're bounded by the country count (~250). Each retained
// promise also keeps its resolved topology alive — a plausible steady-state MB
// cost, so a crash breadcrumb showing this near the country count is expected,
// and showing it far larger would point at a re-keying bug.
registerCensusCounter('topo$', () => countryTopoPromises.size + countryDetailTopoPromises.size)

/**
 * Lazy, higher-resolution single-country outline for one country — same
 * Natural Earth source as world.topo.json, but simplified per country
 * instead of against one shared whole-world budget (see
 * tools/build-geo.mjs's buildCountryDetail). Resolves null when absent.
 */
export function loadCountryDetailTopology(code: string): Promise<TopoJson | null> {
  let promise = countryDetailTopoPromises.get(code)
  if (!promise) {
    promise = fetch(geoUrl(`countryDetail/${code}.topo.json`))
      .then((r) => (r.ok ? (r.json() as Promise<TopoJson>) : null))
      .catch(() => null)
    countryDetailTopoPromises.set(code, promise)
  }
  return promise
}
