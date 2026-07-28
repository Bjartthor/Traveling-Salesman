// The trip detail screen's route map (05-trips.md task 4): the trip's places
// drawn on the world map, zoomed to fit, with every other status muted so the
// trip stands out. Fit-to-container, no pan/zoom — same "just render the
// space available" precedent as @/components/places/CountryAdmin1Map, at
// world scope instead of one country's admin-1 regions. Read-only: editing a
// place always happens through the status sheet, never from a map.

import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, type GeoSphere } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'
import type { Status } from '@/db/types'
import { loadWorldTopology, type TopoJson } from '@/geo/loader'
import { decodeLayer } from '@/components/map/topo'
import { colorForStatus } from '@/components/map/statusColor'
import './TripRouteMap.css'

const SPHERE: GeoSphere = { type: 'Sphere' }

interface Size {
  width: number
  height: number
}

interface TripCityPoint {
  name: string
  lat: number
  lon: number
}

interface TripRouteMapProps {
  countryCodes: readonly string[]
  countryStatus: ReadonlyMap<string, Status>
  cities: readonly TripCityPoint[]
}

export function TripRouteMap({ countryCodes, countryStatus, cities }: TripRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [worldTopo, setWorldTopo] = useState<TopoJson | null>(null)

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
    void loadWorldTopology().then((topo) => {
      if (!cancelled) setWorldTopo(topo)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const features = useMemo(() => (worldTopo ? decodeLayer(worldTopo, 'countries', 'code') : []), [worldTopo])
  const tripCodeSet = useMemo(() => new Set(countryCodes), [countryCodes])
  const tripFeatures = useMemo(() => features.filter((f) => tripCodeSet.has(f.id)), [features, tripCodeSet])

  const projection = useMemo(() => {
    if (size.width === 0 || size.height === 0 || features.length === 0) return null
    // No countries attached yet — fit the whole sphere rather than an empty collection (undefined bounds).
    const fitTarget: FeatureCollection<Geometry> | GeoSphere =
      tripFeatures.length > 0 ? { type: 'FeatureCollection', features: tripFeatures.map((f) => f.feature) } : SPHERE
    return geoNaturalEarth1().fitExtent(
      [
        [12, 12],
        [size.width - 12, size.height - 12],
      ],
      fitTarget,
    )
  }, [size.width, size.height, features.length, tripFeatures])

  const pathGen = useMemo(() => (projection ? geoPath(projection) : null), [projection])
  const spherePath = useMemo(() => pathGen?.(SPHERE) ?? '', [pathGen])

  const countryPaths = useMemo(
    () => (pathGen ? features.map((f) => ({ id: f.id, name: f.name, d: pathGen(f.feature) ?? '' })).filter((p) => p.d) : []),
    [pathGen, features],
  )

  const cityPoints = useMemo(() => {
    if (!projection) return []
    return cities
      .map((c) => {
        const projected = projection([c.lon, c.lat])
        return projected ? { name: c.name, x: projected[0], y: projected[1] } : null
      })
      .filter((p): p is { name: string; x: number; y: number } => p !== null)
  }, [projection, cities])

  return (
    <div className="trip-route-map" ref={containerRef}>
      <svg
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        role="img"
        aria-label="This trip's places on the world map, other statuses muted"
      >
        {spherePath && <path className="trip-route-map__ocean" d={spherePath} />}
        {countryPaths.map((p) => {
          const isTripCountry = tripCodeSet.has(p.id)
          return (
            <path
              key={p.id}
              d={p.d}
              className={`trip-route-map__country${isTripCountry ? '' : ' trip-route-map__country--muted'}`}
              style={isTripCountry ? { fill: colorForStatus(countryStatus.get(p.id)) } : undefined}
            >
              <title>{p.name}</title>
            </path>
          )
        })}
        {cityPoints.map((p) => (
          <circle key={p.name} className="trip-route-map__city" cx={p.x} cy={p.y} r={4}>
            <title>{p.name}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
