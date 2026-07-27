// Quick add / bulk entry (04-places.md task 6): one place name per line,
// resolved against the local search index, reviewed before committing.
//
// classifyLine/splitLines are pure and unit-tested (see bulkResolve.test.ts).
// resolveLines is the one Dexie-touching function in this module — it just
// runs classifyLine against a real @/geo/search lookup per line — kept here
// rather than split into its own adapter file because, unlike the cascade,
// there's only the one call site and nothing else to keep pure around it.

import type { CityResult } from '@/geo/search'
import { searchCities } from '@/geo/search'

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export type LineResolution =
  | { line: string; status: 'matched'; pick: CityResult }
  | { line: string; status: 'ambiguous'; candidates: CityResult[] }
  | { line: string; status: 'notFound' }

// How much more populous the top candidate must be than the runner-up before
// it's trusted automatically, rather than asked about. Picked so "garmisch"
// (one strong match) auto-resolves while "Springfield" (several
// similarly-sized US cities of the same name) is flagged for review.
const DOMINANCE_RATIO = 3
const MAX_CANDIDATES = 5

export function classifyLine(line: string, results: readonly CityResult[]): LineResolution {
  const [top, second] = results
  if (!top) return { line, status: 'notFound' }
  if (!second) return { line, status: 'matched', pick: top }

  if (top.population >= second.population * DOMINANCE_RATIO) return { line, status: 'matched', pick: top }
  return { line, status: 'ambiguous', candidates: results.slice(0, MAX_CANDIDATES) }
}

export async function resolveLines(lines: readonly string[]): Promise<LineResolution[]> {
  return Promise.all(lines.map(async (line) => classifyLine(line, await searchCities(line, MAX_CANDIDATES))))
}

/** What a line commits as before the reviewer overrides anything — the best guess, or none for a miss. */
export function defaultPick(resolution: LineResolution): CityResult | null {
  if (resolution.status === 'matched') return resolution.pick
  if (resolution.status === 'ambiguous') return resolution.candidates[0] ?? null
  return null
}
