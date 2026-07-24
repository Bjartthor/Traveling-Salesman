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

export const UNVISITED_COLOR_VAR = 'var(--contour)'

export function colorForStatus(status: Status | undefined): string {
  return status ? STATUS_COLOR_VAR[status] : UNVISITED_COLOR_VAR
}
