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

export function decodeLayer(topo: TopoJson, objectKey: string, idProp: string): MapFeature[] {
  const object = topo.objects[objectKey] as GeometryCollection<GeoJsonProperties> | undefined
  if (!object) return []
  const collection = feature(topo as unknown as Topology, object) as FeatureCollection<Geometry, GeoJsonProperties>
  return collection.features.map((f) => {
    const props = (f.properties ?? {}) as Record<string, unknown>
    return { id: String(props[idProp] ?? ''), name: String(props.name ?? ''), feature: f }
  })
}
