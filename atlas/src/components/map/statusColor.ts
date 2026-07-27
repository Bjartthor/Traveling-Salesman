// Shared status -> colour/label mapping for anything that draws the status
// ramp: the map fill, the legend, the coverage strip, the country sheet.
// The four status colours are the only saturated colours in the app (00-PLAN.md §8).

import type { Status } from '@/db/types'

export const STATUS_ORDER: readonly Status[] = ['wishlist', 'transit', 'visited', 'lived']

export const STATUS_COLOR_VAR: Record<Status, string> = {
  wishlist: 'var(--wishlist)',
  transit: 'var(--transit)',
  visited: 'var(--visited)',
  lived: 'var(--lived)',
}

export const STATUS_LABEL: Record<Status, string> = {
  wishlist: 'Wishlist',
  transit: 'Transit',
  visited: 'Visited',
  lived: 'Lived',
}

// One-liners for the status sheet (04-places.md task 3) — close paraphrases of
// 00-PLAN.md §5's own definitions, so "transit" and "visited" read as clearly
// different choices rather than two shades of "went there."
export const STATUS_DESCRIPTION: Record<Status, string> = {
  wishlist: 'Want to go',
  transit: "Passed through — a layover, a drive-through, didn't really visit",
  visited: 'Actually spent time here',
  lived: 'Lived here',
}

export const UNVISITED_COLOR_VAR = 'var(--contour)'

export function colorForStatus(status: Status | undefined): string {
  return status ? STATUS_COLOR_VAR[status] : UNVISITED_COLOR_VAR
}
