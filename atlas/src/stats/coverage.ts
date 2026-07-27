// Pure coverage statistics. No React, no Dexie — every function takes plain
// arrays/maps and returns plain data, so it is trivially unit-testable.
// See 00-PLAN.md §5 for the status ladder and 03-map-and-stats.md §3 for
// what these functions must compute.
//
// Phase 3 reads each entry's own status directly by kind+refId. Nothing here
// derives a country's status from its subdivisions/cities — that cascade
// (`recomputeAncestors`, plan §5) is Phase 4's job, wired into the write path
// that doesn't exist yet (no add/edit-places UI). A country only counts as
// visited if it has its own explicit entry.

import type { City, Country, CountryDenominator, Entry, EntryKind, StatMode, Status, Subdivision } from '@/db/types'
// The ladder itself belongs to the domain, not to stats — re-exported here so
// this module's existing callers keep their import site.
import { STATUS_ORDER, statusRank } from '@/domain/cascade'

export const STATUSES = STATUS_ORDER
export { statusRank }

/** Only visited and lived count toward coverage; transit and wishlist never do. */
export function countsAsCoverage(status: Status): boolean {
  return status === 'visited' || status === 'lived'
}

// The seven continents a person actually visits. Natural Earth/GeoNames also
// bucket a handful of scattered, uninhabited island territories into a
// "Seven seas (open ocean)" pseudo-continent, which is excluded here.
export const CONTINENTS: readonly string[] = [
  'Africa',
  'Antarctica',
  'Asia',
  'Europe',
  'North America',
  'Oceania',
  'South America',
]

/**
 * Maps each active (non-deleted) entry of one kind to its own directly-set
 * status, keyed by refId. See module doc: this is a direct read, not a
 * cascade — a country with no entry of its own is unvisited on the map even
 * if a city inside it is marked visited.
 */
export function buildStatusIndex(entries: Entry[], kind: EntryKind): Map<string, Status> {
  const index = new Map<string, Status>()
  for (const entry of entries) {
    if (entry.kind === kind && entry.deletedAt === null) {
      index.set(entry.refId, entry.status)
    }
  }
  return index
}

function pct(count: number, total: number): number {
  return total === 0 ? 0 : (count / total) * 100
}

export interface StatusSegment {
  status: Status
  pct: number // 0-100 share of this metric's total
}

function segmentsFromWeights(total: number, byStatus: Record<Status, number>): StatusSegment[] {
  return STATUSES.map((status) => ({ status, pct: pct(byStatus[status], total) }))
}

export interface MetricCoverage {
  count: number // amount counted as coverage, in this metric's unit (countries / km² / people)
  total: number // denominator, in the same unit
  pct: number // headline percentage: count / total * 100
  segments: StatusSegment[] // all four statuses' share of total, for the coverage strip
}

function weighCountries(
  countries: Country[],
  countryStatus: Map<string, Status>,
  weight: (c: Country) => number,
): MetricCoverage {
  let total = 0
  const byStatus: Record<Status, number> = { wishlist: 0, transit: 0, visited: 0, lived: 0 }
  for (const c of countries) {
    const w = weight(c)
    total += w
    const status = countryStatus.get(c.code)
    if (status !== undefined) byStatus[status] += w
  }
  return { count: byStatus.visited + byStatus.lived, total, pct: pct(byStatus.visited + byStatus.lived, total), segments: segmentsFromWeights(total, byStatus) }
}

/** Countries visited/lived out of `denominator` ('all' rows, or UN members only). */
export function countryCoverage(
  countries: Country[],
  countryStatus: Map<string, Status>,
  denominator: CountryDenominator,
): MetricCoverage {
  const pool = denominator === 'unMember' ? countries.filter((c) => c.unMember) : countries
  return weighCountries(pool, countryStatus, () => 1)
}

/** Land area (km²) visited/lived, denominator summed from the dataset itself. */
export function landAreaCoverage(countries: Country[], countryStatus: Map<string, Status>): MetricCoverage {
  return weighCountries(countries, countryStatus, (c) => c.areaKm2)
}

/** Population visited/lived, denominator summed from the dataset itself. */
export function populationCoverage(countries: Country[], countryStatus: Map<string, Status>): MetricCoverage {
  return weighCountries(countries, countryStatus, (c) => c.population)
}

export function metricCoverage(
  mode: StatMode,
  countries: Country[],
  countryStatus: Map<string, Status>,
  denominator: CountryDenominator,
): MetricCoverage {
  if (mode === 'countries') return countryCoverage(countries, countryStatus, denominator)
  if (mode === 'area') return landAreaCoverage(countries, countryStatus)
  return populationCoverage(countries, countryStatus)
}

export const METRIC_LABELS: Record<StatMode, string> = {
  countries: 'of countries visited',
  area: 'of world land area',
  population: 'of world population',
}

const METRIC_CYCLE: readonly StatMode[] = ['countries', 'area', 'population']

/** Tapping the headline cycles countries → land area → population → countries. */
export function nextStatMode(current: StatMode): StatMode {
  const i = METRIC_CYCLE.indexOf(current)
  return METRIC_CYCLE[(i + 1) % METRIC_CYCLE.length] as StatMode
}

export interface TransitResult {
  count: number
  total: number
  pct: number
}

/** Countries passed through (status exactly 'transit') — surfaced separately, never counted as coverage. */
export function transitCoverage(
  countries: Country[],
  countryStatus: Map<string, Status>,
  denominator: CountryDenominator,
): TransitResult {
  const pool = denominator === 'unMember' ? countries.filter((c) => c.unMember) : countries
  const count = pool.filter((c) => countryStatus.get(c.code) === 'transit').length
  return { count, total: pool.length, pct: pct(count, pool.length) }
}

export function continentsTouched(
  countries: Country[],
  countryStatus: Map<string, Status>,
): { touched: number; total: number } {
  const touched = new Set<string>()
  for (const c of countries) {
    const status = countryStatus.get(c.code)
    if (status !== undefined && countsAsCoverage(status) && CONTINENTS.includes(c.continent)) {
      touched.add(c.continent)
    }
  }
  return { touched: touched.size, total: CONTINENTS.length }
}

/** Count of refIds in a status index whose status counts as coverage. */
export function countVisited(statusIndex: Map<string, Status>): number {
  let n = 0
  for (const status of statusIndex.values()) if (countsAsCoverage(status)) n++
  return n
}

/** Subdivisions visited within one country — id already encodes country as `${code}.${admin1}`. */
export function countrySubdivisionsVisited(code: string, subdivisionStatus: Map<string, Status>): number {
  let n = 0
  const prefix = `${code}.`
  for (const [id, status] of subdivisionStatus) {
    if (id.startsWith(prefix) && countsAsCoverage(status)) n++
  }
  return n
}

/** Cities visited among a pre-filtered list of geonameIds (caller scopes by country via an indexed query). */
export function countCitiesVisited(geonameIds: number[], cityStatus: Map<string, Status>): number {
  let n = 0
  for (const id of geonameIds) {
    const status = cityStatus.get(String(id))
    if (status !== undefined && countsAsCoverage(status)) n++
  }
  return n
}

export interface VisitDateRange {
  first: string | null // earliest firstVisited
  mostRecent: string | null // latest lastVisited
}

/** Earliest/latest recorded visit dates across active entries that count as coverage. */
export function visitDateRange(entries: Entry[]): VisitDateRange {
  let first: string | null = null
  let mostRecent: string | null = null
  for (const e of entries) {
    if (e.deletedAt !== null || !countsAsCoverage(e.status)) continue
    if (e.firstVisited && (first === null || e.firstVisited < first)) first = e.firstVisited
    if (e.lastVisited && (mostRecent === null || e.lastVisited > mostRecent)) mostRecent = e.lastVisited
  }
  return { first, mostRecent }
}

export interface WorldSummary {
  continentsTouched: number
  continentsTotal: number
  subdivisionsVisited: number
  citiesVisited: number
  firstVisited: string | null
  mostRecentVisited: string | null
}

/** Everything the global detail panel needs, computed in one pass over entries. */
export function worldSummary(countries: Country[], entries: Entry[]): WorldSummary {
  const countryStatus = buildStatusIndex(entries, 'country')
  const subdivisionStatus = buildStatusIndex(entries, 'subdivision')
  const cityStatus = buildStatusIndex(entries, 'city')
  const { touched, total } = continentsTouched(countries, countryStatus)
  const dates = visitDateRange(entries)
  return {
    continentsTouched: touched,
    continentsTotal: total,
    subdivisionsVisited: countVisited(subdivisionStatus),
    citiesVisited: countVisited(cityStatus),
    firstVisited: dates.first,
    mostRecentVisited: dates.mostRecent,
  }
}

// Re-exported only so callers/tests can build fixtures without reaching into db/types directly.
export type { City, Country, CountryDenominator, Entry, StatMode, Status, Subdivision }
