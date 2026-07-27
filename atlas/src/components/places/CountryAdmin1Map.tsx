// The country detail screen's "own admin-1 map with subdivisions coloured,
// tappable to set status directly" (04-places.md task 5). Deliberately not a
// smaller WorldMap: no pan/zoom, no world sphere/backdrop — just that one
// country's regions fitted to the space available. Renders nothing when the
// country has no admin-1 file (Bouvet Island etc.), same "resolves null,
// no error" precedent as the world map's own admin-1 overlay.

import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'
import type { Status } from '@/db/types'
import { loadCountryTopology } from '@/geo/loader'
import { decodeLayer, type MapFeature } from '@/components/map/topo'
import { colorForStatus } from '@/components/map/statusColor'
import './CountryAdmin1Map.css'

interface Size {
  width: number
  height: number
}

interface CountryAdmin1MapProps {
  countryCode: string
  subdivisionStatus: ReadonlyMap<string, Status>
  onSelect: (subdivisionId: string) => void
}

export function CountryAdmin1Map({ countryCode, subdivisionStatus, onSelect }: CountryAdmin1MapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [features, setFeatures] = useState<MapFeature[] | null>(null) // null = still loading

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    setFeatures(null)
    void loadCountryTopology(countryCode).then((topo) => {
      if (cancelled) return
      setFeatures(topo ? decodeLayer(topo, 'admin1', 'id') : [])
    })
    return () => {
      cancelled = true
    }
  }, [countryCode])

  const pathGen = useMemo(() => {
    if (size.width === 0 || size.height === 0 || !features || features.length === 0) return null
    const collection: FeatureCollection<Geometry> = { type: 'FeatureCollection', features: features.map((f) => f.feature) }
    const projection = geoMercator().fitExtent(
      [
        [8, 8],
        [size.width - 8, size.height - 8],
      ],
      collection,
    )
    return geoPath(projection)
  }, [size.width, size.height, features])

  const paths = useMemo(
    () =>
      pathGen && features
        ? features.map((f) => ({ id: f.id, name: f.name, d: pathGen(f.feature) ?? '' })).filter((p) => p.d)
        : [],
    [pathGen, features],
  )

  if (features && features.length === 0) return null // no admin-1 data for this country — omit the section entirely

  return (
    <div className="country-admin1-map" ref={containerRef}>
      {paths.length > 0 && (
        <svg viewBox={`0 0 ${size.width || 1} ${size.height || 1}`} role="img" aria-label={`${countryCode} regions`}>
          {paths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              className="country-admin1-map__region"
              style={{ fill: colorForStatus(subdivisionStatus.get(p.id)) }}
              onClick={() => onSelect(p.id)}
            >
              <title>{p.name}</title>
            </path>
          ))}
        </svg>
      )}
    </div>
  )
}
