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

interface IndexRow {
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
let countryNames = new Map<string, string>()
let subNames = new Map<string, string>()

async function buildIndex(): Promise<IndexRow[]> {
  const [cities, countries, subs] = await Promise.all([
    db.cities.toArray(),
    db.countries.toArray(),
    db.subdivisions.toArray(),
  ])
  countryNames = new Map(countries.map((c) => [c.code, c.name]))
  subNames = new Map(subs.map((s) => [s.id, s.name]))
  const rows: IndexRow[] = cities.map((c) => ({
    id: c.geonameId,
    name: c.name,
    ascii: c.asciiName,
    hay: normalize(c.name) + SEP + normalize(c.asciiName),
    cc: c.countryCode,
    sub: c.subdivisionId,
    pop: c.population,
    lat: c.lat,
    lon: c.lon,
  }))
  // Bundled cities are already population-sorted, but online-added ones (Phase 4)
  // will not be — keep the invariant the ranking relies on.
  rows.sort((a, b) => b.pop - a.pop)
  return rows
}

/** Force a rebuild of the in-memory index (call after seeding new cities). */
export function invalidateSearchIndex(): void {
  indexPromise = null
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
  const rows = await getIndex()

  const scored: { row: IndexRow; score: number }[] = []
  for (const row of rows) {
    const weight = matchWeight(row.hay, q)
    if (weight === 0) continue
    scored.push({ row, score: (row.pop + 1) * weight })
  }
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, limit).map(({ row }) => ({
    geonameId: row.id,
    name: row.name,
    asciiName: row.ascii,
    countryCode: row.cc,
    countryName: countryNames.get(row.cc) ?? row.cc,
    subdivisionId: row.sub,
    subdivisionName: row.sub ? (subNames.get(row.sub) ?? null) : null,
    lat: row.lat,
    lon: row.lon,
    population: row.pop,
  }))
}
