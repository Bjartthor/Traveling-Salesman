// A country whose map polygon is one clear mainland plus scattered smaller
// pieces — France's overseas départements fused into its shape (no separate
// polygon at this map resolution), the US's Alaska/Hawaii (genuinely part of
// the country, just geographically far-flung), Norway's Svalbard, and many
// more (confirmed empirically against the real committed topology: France
// 84.6% dominant, the US 84.0%, the UK 89.8%, Japan 61.6%, ~40 countries
// total) — has a MultiPolygon whose overall bounding box spans a huge, often
// nonsensical area if every piece is framed together. Isolate the dominant
// piece instead, so the map zooms to *the country*, not to a box wide enough
// to also contain Réunion.
//
// But a genuinely multi-island nation (Indonesia: largest single island is
// only 28.6% of its total area; the Bahamas, Solomon Islands, Vanuatu,
// French Polynesia are similar) has no principled "main" piece to isolate —
// picking one island there would be an equally wrong, just differently wrong,
// frame. Below the dominance threshold there's no single mainland to prefer,
// so the caller should fall back to the whole geometry.

import { geoArea } from 'd3-geo'
import type { Geometry, Polygon, Position } from 'geojson'

const DOMINANCE_THRESHOLD = 0.5

export function dominantLandmass(geometry: Geometry): Polygon | null {
  if (geometry.type !== 'MultiPolygon' || geometry.coordinates.length <= 1) return null

  let totalArea = 0
  let largestArea = -1
  let largestRing: Position[][] | null = null
  for (const ring of geometry.coordinates) {
    const area = geoArea({ type: 'Polygon', coordinates: ring })
    totalArea += area
    if (area > largestArea) {
      largestArea = area
      largestRing = ring
    }
  }
  if (totalArea === 0 || largestRing === null || largestArea / totalArea <= DOMINANCE_THRESHOLD) return null
  return { type: 'Polygon', coordinates: largestRing }
}
