// Decodes one committed TopoJSON layer (world countries, or one country's
// admin-1 regions — see 02-geo-data.md) into individual GeoJSON features the
// map can path-generate and match against entries by id.

import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson'
import type { GeometryCollection, Topology } from 'topojson-specification'
import type { TopoJson } from '@/geo/loader'

export interface MapFeature {
  id: string // country `code`, or subdivision `id` (`${countryCode}.${geonamesAdmin1}`)
  name: string
  feature: Feature<Geometry, GeoJsonProperties>
}

// Decoding is pure for a given (topo, objectKey, idProp) — `loadWorldTopology`/
// `loadCountryTopology` memoise their fetch, so the same `topo` object recurs
// across every caller. Cached per-topo so N small route maps (e.g. the Trips
// tab's per-stamp thumbnails) share one decode of the 237-feature world layer
// instead of redoing it N times.
const decodeCache = new WeakMap<TopoJson, Map<string, MapFeature[]>>()

export function decodeLayer(topo: TopoJson, objectKey: string, idProp: string): MapFeature[] {
  const cacheKey = `${objectKey}:${idProp}`
  let byKey = decodeCache.get(topo)
  const cached = byKey?.get(cacheKey)
  if (cached) return cached

  const object = topo.objects[objectKey] as GeometryCollection<GeoJsonProperties> | undefined
  if (!object) return []
  const collection = feature(topo as unknown as Topology, object) as FeatureCollection<Geometry, GeoJsonProperties>
  const result = collection.features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>
    return { id: String(props[idProp] ?? ''), name: String(props.name ?? ''), feature: f }
  })

  if (!byKey) {
    byKey = new Map()
    decodeCache.set(topo, byKey)
  }
  byKey.set(cacheKey, result)
  return result
}
