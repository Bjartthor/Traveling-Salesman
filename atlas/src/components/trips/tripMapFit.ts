// What the trip detail map zooms to: the trip's cities, not the whole of every
// country they're in. Fitting a country's outline puts LA and San Diego ~4 px
// apart on a map of the entire US, too close for a route arrow to show; a box
// around the cities themselves makes the route legible. Pure.
//
// The box is returned as a MultiPoint of its four corners rather than a
// Polygon: d3-geo treats polygons spherically, where a wrongly-wound ring
// means "everything but this box", and corner points have no winding at all.

import type { Feature, MultiPoint } from 'geojson'

interface LatLon {
  lat: number
  lon: number
}

/** Keeps the box off the poles, where Natural Earth stretches lon/lat boxes into slivers. */
const MAX_LAT = 85

/**
 * A lon/lat box around `points` with a `margin` (fraction of each axis' span,
 * on each side), never narrower than `minSpanDeg` on either axis so a single
 * city — or two right next to each other — still shows its surroundings.
 * Doesn't handle a trip straddling the antimeridian: that box just comes out
 * very wide, which is still correct, only zoomed out.
 */
export function cityFitBox(points: readonly LatLon[], minSpanDeg = 1.5, margin = 0.15): Feature<MultiPoint> {
  const lons = points.map((p) => p.lon)
  const lats = points.map((p) => p.lat)
  const [west, east] = padAxis(Math.min(...lons), Math.max(...lons), minSpanDeg, margin)
  let [south, north] = padAxis(Math.min(...lats), Math.max(...lats), minSpanDeg, margin)
  if (north > MAX_LAT) [south, north] = [south - (north - MAX_LAT), MAX_LAT]
  if (south < -MAX_LAT) [south, north] = [-MAX_LAT, north + (-MAX_LAT - south)]

  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'MultiPoint',
      coordinates: [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
      ],
    },
  }
}

function padAxis(min: number, max: number, minSpan: number, margin: number): [number, number] {
  const center = (min + max) / 2
  const span = Math.max((max - min) * (1 + 2 * margin), minSpan)
  return [center - span / 2, center + span / 2]
}
