// City search over the ~170k bundled cities. See 02-geo-data.md §4.
//
// Design note — why in-memory rather than only the Dexie `*searchTokens` index:
// the acceptance test "'vík' returns the Icelandic village too" requires matching
// "vík" *inside* Reykjavík / Keflavík (an interior substring), and the brief's
// ranking spec explicitly promotes "exact-prefix matches above substring matches".
// A Dexie multi-entry prefix index cannot match interior substrings. So runtime
// search builds a compact in-memory index once (lazily, memoised) and scans it —
// which comfortably beats the 100 ms budget for a three-char query and works
// fully offline. The rows are pre-sorted by population at build time.

import { db } from '@/db/schema'
import type { City } from '@/db/types'
import { loadRefData } from '@/geo/refData'

/** Lowercase + strip diacritics (NFD, drop combining marks). */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

/** Diacritic-stripped, lowercased word tokens of the given strings, de-duped. */
export function tokenize(...strings: string[]): string[] {
  const set = new Set<string>()
  for (const s of strings) {
    for (const token of normalize(s).split(/[^a-z0-9]+/)) {
      if (token) set.add(token)
    }
  }
  return [...set]
}

export interface CityResult {
  geonameId: number
  name: string
  asciiName: string
  countryCode: string
  countryName: string
  subdivisionId: string | null
  subdivisionName: string | null
  lat: number | null
  lon: number | null
  population: number
}

export interface IndexRow {
  id: number
  name: string
  ascii: string
  hay: string // normalized "name\0asciiName" for substring scanning
  cc: string
  sub: string | null
  pop: number
  lat: number | null
  lon: number | null
}

// Separator between the normalized name and asciiName halves of `hay`. A raw
// NUL never occurs in a place name and is distinct from a word space, letting
// us tell "start of the asciiName field" (prefix) from "start of an interior word".
const SEP = '\u0000'

let indexPromise: Promise<IndexRow[]> | null = null

export function toIndexRow(c: Pick<City, 'geonameId' | 'name' | 'asciiName' | 'countryCode' | 'subdivisionId' | 'population' | 'lat' | 'lon'>): IndexRow {
  return {
    id: c.geonameId,
    name: c.name,
    ascii: c.asciiName,
    hay: normalize(c.name) + SEP + normalize(c.asciiName),
    cc: c.countryCode,
    sub: c.subdivisionId,
    pop: c.population,
    lat: c.lat,
    lon: c.lon,
  }
}

const BUILD_PAGE = 20_000

async function buildIndex(): Promise<IndexRow[]> {
  const rows: IndexRow[] = []
  // Read in primary-key pages rather than one toArray(): just as fast (each
  // page is a single getAll), but the full City objects never all exist at
  // once next to the index being built — a lower peak heap on a phone.
  let after = -Infinity
  for (;;) {
    const page = await db.cities.where('geonameId').above(after).limit(BUILD_PAGE).toArray()
    for (const c of page) rows.push(toIndexRow(c))
    if (page.length < BUILD_PAGE) break
    after = page[page.length - 1]!.geonameId
  }
  // Bundled cities are already population-sorted, but online-added ones (Phase 4)
  // will not be — keep the invariant the ranking relies on.
  rows.sort((a, b) => b.pop - a.pop)
  return rows
}

/** Force a rebuild of the in-memory index (call after seeding new cities). */
export function invalidateSearchIndex(): void {
  indexPromise = null
}

/**
 * Slot one newly written city into an already-built index, keeping it
 * population-sorted — instead of throwing the whole ~170k-row index away and
 * rebuilding it on the next keystroke. A no-op if the index isn't built yet
 * (it will read the row from Dexie when it is).
 */
export function addToSearchIndex(city: City): void {
  if (!indexPromise) return
  const row = toIndexRow(city)
  indexPromise = indexPromise.then((rows) => {
    let lo = 0
    let hi = rows.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (rows[mid]!.pop >= row.pop) lo = mid + 1
      else hi = mid
    }
    rows.splice(lo, 0, row)
    return rows
  })
}

function getIndex(): Promise<IndexRow[]> {
  if (!indexPromise) indexPromise = buildIndex()
  return indexPromise
}

/** How well `q` matches `hay`: 3 = a field starts with it, 2 = a word does,
 *  1 = interior substring, 0 = no match. */
function matchWeight(hay: string, q: string): number {
  if (hay.startsWith(q)) return 3 // name starts with the query
  const pos = hay.indexOf(q)
  if (pos === -1) return 0
  const prev = hay[pos - 1]
  if (prev === SEP) return 3 // asciiName field starts with the query
  if (prev === ' ') return 2 // starts a word within name/asciiName
  return 1 // interior substring
}

const MAX_WEIGHT = 3

/**
 * The best `limit` rows for an already-normalized query, scored
 * `(pop + 1) × matchWeight`, best first; ties keep index order. `rows` must be
 * population-descending — that is what lets the scan stop as soon as not even
 * a best-weight match further down could beat the current last place, so a
 * short, common query ("an") touches the biggest few thousand cities instead
 * of scoring and sorting tens of thousands of matches.
 */
export function topMatches(rows: readonly IndexRow[], q: string, limit: number): IndexRow[] {
  const best: { row: IndexRow; score: number }[] = []
  if (limit <= 0) return []
  for (const row of rows) {
    if (best.length === limit && (row.pop + 1) * MAX_WEIGHT <= best[limit - 1]!.score) break
    const weight = matchWeight(row.hay, q)
    if (weight === 0) continue
    const score = (row.pop + 1) * weight
    if (best.length === limit && score <= best[limit - 1]!.score) continue
    // Insert after any equal score, so ties keep their index order.
    let i = best.length
    while (i > 0 && best[i - 1]!.score < score) i--
    best.splice(i, 0, { row, score })
    if (best.length > limit) best.pop()
  }
  return best.map((b) => b.row)
}

/**
 * Search bundled cities. Ranks by population, weighted by match quality so a
 * prefix match is promoted over a same-size substring match (the brief's
 * "ranks by population descending, with exact-prefix promoted above substring").
 * This puts Reykjavík first for "reykja", and still surfaces it for "vík" —
 * where "vík" is an interior match — among the many towns starting with "vik".
 * Resolves subdivision + country names for display.
 */
export async function searchCities(query: string, limit = 20): Promise<CityResult[]> {
  const q = normalize(query).trim()
  if (q.length < 2) return []
  const [rows, ref] = await Promise.all([getIndex(), loadRefData()])

  return topMatches(rows, q, limit).map((row) => ({
    geonameId: row.id,
    name: row.name,
    asciiName: row.ascii,
    countryCode: row.cc,
    countryName: ref.countryByCode.get(row.cc)?.name ?? row.cc,
    subdivisionId: row.sub,
    subdivisionName: row.sub ? (ref.subdivisionById.get(row.sub)?.name ?? null) : null,
    lat: row.lat,
    lon: row.lon,
    population: row.pop,
  }))
}
