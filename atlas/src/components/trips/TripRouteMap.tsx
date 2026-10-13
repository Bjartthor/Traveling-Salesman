// The trip detail screen's route map (05-trips.md task 4): the trip's places
// drawn on the world map, zoomed to fit (to its cities on the detail screen),
// with every other status muted so the trip stands out. Fit-to-container, no
// pan/zoom — same "just render the space available" precedent as @/components/places/CountryAdmin1Map, at
// world scope instead of one country's admin-1 regions. Read-only: editing a
// place always happens through the status sheet, never from a map.
// Optionally draws the route the trip was traveled in — thin arcs with a
// midpoint chevron between consecutive stops (see @/components/trips/routeGeometry).

import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, type GeoSphere } from 'd3-geo'
import type { FeatureCollection, Geometry } from 'geojson'
import type { Status } from '@/db/types'
import { loadWorldTopology, type TopoJson } from '@/geo/loader'
import { decodeLayer } from '@/components/map/topo'
import { colorForStatus } from '@/components/map/statusColor'
import { routeLeg, type RouteLeg } from '@/components/trips/routeGeometry'
import { cityFitBox } from '@/components/trips/tripMapFit'
import { pixelSimplified } from '@/components/trips/pixelSimplify'
import type { RouteStop } from '@/domain/tripRoute'
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
  /** Trips-tab stamp thumbnail: fixed short height instead of the detail screen's 4:3 block, smaller city dots. */
  compact?: boolean
  /** Stops in travel order (@/domain/tripRoute). Arrows are drawn between consecutive stops; omitted = no arrows. */
  route?: readonly RouteStop[]
  /**
   * Zoom to the trip's cities rather than the whole of every country they're
   * in (@/components/trips/tripMapFit) — the detail screen, so a route between
   * nearby cities is legible. `citylessCountryCodes` are trip countries with
   * no city of their own on the map; their whole outline stays in view.
   * Omitted = fit every trip country's outline (the stamps).
   */
  zoomToCities?: { citylessCountryCodes: readonly string[] }
}

export function TripRouteMap({ countryCodes, countryStatus, cities, compact = false, route, zoomToCities }: TripRouteMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [worldTopo, setWorldTopo] = useState<TopoJson | null>(null)
  // A Trips-tab stamp only builds its map once it scrolls near the screen —
  // a long trip history otherwise path-generates every stamp's world map up
  // front. The detail screen's map is always on screen, so it starts visible.
  const [inView, setInView] = useState(!compact || typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    const el = containerRef.current
    if (inView || !el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true)
      },
      { rootMargin: '300px 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [inView])

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
    if (!inView) return
    let cancelled = false
    void loadWorldTopology().then((topo) => {
      if (!cancelled) setWorldTopo(topo)
    })
    return () => {
      cancelled = true
    }
  }, [inView])

  const features = useMemo(() => (worldTopo ? decodeLayer(worldTopo, 'countries', 'code') : []), [worldTopo])
  const tripCodeSet = useMemo(() => new Set(countryCodes), [countryCodes])
  const tripFeatures = useMemo(() => features.filter((f) => tripCodeSet.has(f.id)), [features, tripCodeSet])

  // Keyed by content, not identity: callers rebuild `cities`/`zoomToCities`
  // every render (e.g. each keystroke in the trip's notes), and a new fit
  // target means a new projection and every country path recomputed.
  const zoomCitiesKey = zoomToCities ? cities.map((c) => `${c.lat},${c.lon}`).join(';') : null
  const citylessKey = zoomToCities?.citylessCountryCodes.join(',') ?? ''
  const fitTarget = useMemo((): FeatureCollection<Geometry> | GeoSphere => {
    if (zoomCitiesKey) {
      const points = zoomCitiesKey.split(';').map((p) => {
        const [lat, lon] = p.split(',').map(Number)
        return { lat: lat!, lon: lon! }
      })
      const cityless = new Set(citylessKey.split(','))
      return {
        type: 'FeatureCollection',
        features: [cityFitBox(points), ...tripFeatures.filter((f) => cityless.has(f.id)).map((f) => f.feature)],
      }
    }
    // No countries attached yet — fit the whole sphere rather than an empty collection (undefined bounds).
    return tripFeatures.length > 0 ? { type: 'FeatureCollection', features: tripFeatures.map((f) => f.feature) } : SPHERE
  }, [zoomCitiesKey, citylessKey, tripFeatures])

  const projection = useMemo(() => {
    if (size.width === 0 || size.height === 0 || features.length === 0) return null
    // Clipped to the frame: a map zoomed onto one trip leaves most of the
    // world off-screen, and those countries then produce an empty path (dropped
    // below) instead of full-detail outlines nobody can see.
    return geoNaturalEarth1()
      .fitExtent(
        [
          [12, 12],
          [size.width - 12, size.height - 12],
        ],
        fitTarget,
      )
      .clipExtent([
        [0, 0],
        [size.width, size.height],
      ])
  }, [size.width, size.height, features.length, fitTarget])

  // Country outlines go through the sub-pixel filter (this map never zooms);
  // the sphere and the route keep using the plain projection.
  const pathGen = useMemo(() => (projection ? geoPath(pixelSimplified(projection)) : null), [projection])
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

  const routeLegs = useMemo(() => {
    if (!projection || !route || route.length < 2) return []
    const points = route.map((s) => projection([s.lon, s.lat]))
    const legs: RouteLeg[] = []
    for (let i = 1; i < points.length; i++) {
      const from = points[i - 1]
      const to = points[i]
      const leg = from && to ? routeLeg(from, to) : null
      if (leg) legs.push(leg)
    }
    return legs
  }, [projection, route])

  return (
    <div className={`trip-route-map${compact ? ' trip-route-map--compact' : ''}`} ref={containerRef}>
      <svg
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        role="img"
        aria-label={
          routeLegs.length > 0
            ? "This trip's places on the world map, with arrows showing the order they were visited, other statuses muted"
            : "This trip's places on the world map, other statuses muted"
        }
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
        {routeLegs.length > 0 && (
          <g className="trip-route-map__route" aria-hidden="true">
            {routeLegs.map((leg, i) => (
              <g key={i}>
                <path d={`M${leg.from[0]},${leg.from[1]} Q${leg.control[0]},${leg.control[1]} ${leg.to[0]},${leg.to[1]}`} />
                {leg.chevron && <polyline points={leg.chevron.map((p) => p.join(',')).join(' ')} />}
              </g>
            ))}
          </g>
        )}
        {cityPoints.map((p) => (
          <circle key={p.name} className="trip-route-map__city" cx={p.x} cy={p.y} r={compact ? 2.5 : 4}>
            <title>{p.name}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
