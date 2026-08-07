import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, type GeoSphere } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import type { Status } from '@/db/types'
import { loadCountryTopology, loadWorldTopology, type TopoJson } from '@/geo/loader'
import { decodeLayer, type MapFeature } from '@/components/map/topo'
import { colorForStatus } from '@/components/map/statusColor'
import './WorldMap.css'

const SPHERE: GeoSphere = { type: 'Sphere' }

// Generating each feature's SVG path `d` string (d3.geoPath) is the expensive
// part of rendering this map — walking every coordinate of every
// country/subdivision polygon (~250 countries for the world layer).
// `decodeLayer` (@/components/map/topo) already caches the topo→GeoJSON
// decode, but path generation is a separate step with no cache of its own,
// and useMemo's cache dies the moment WorldMap unmounts. A rapid remount
// storm — fast tab-switching, an OS back-gesture misfire, whatever the
// trigger — redoes this for all ~250 countries from scratch on every single
// remount. None of the inputs actually change across a remount on the same
// device (same topology, same viewport), so caching at module scope turns a
// remount storm into a cache hit instead of a repeated CPU/memory spike.
const pathsCache = new Map<string, { key: string; paths: { id: string; name: string; d: string }[] }>()

function getPaths(
  cacheId: string,
  pathGen: (f: MapFeature['feature']) => string | null,
  features: readonly MapFeature[],
  width: number,
  height: number,
): { id: string; name: string; d: string }[] {
  const key = `${width}x${height}:${features.length}`
  const cached = pathsCache.get(cacheId)
  if (cached?.key === key) return cached.paths
  const paths = features.map((f) => ({ id: f.id, name: f.name, d: pathGen(f.feature) ?? '' })).filter((p) => p.d)
  pathsCache.set(cacheId, { key, paths })
  return paths
}

// Past this zoom factor (relative to the whole-world fit), a selected
// country's admin-1 regions load and draw on top of it. Chosen so a
// mid-sized country (e.g. Germany) has grown large enough on screen for
// its subdivisions to read as individual shapes rather than a smear.
const ADMIN1_ZOOM_THRESHOLD = 4

interface Size {
  width: number
  height: number
}

interface WorldMapProps {
  countryStatus: Map<string, Status>
  subdivisionStatus: Map<string, Status>
  selectedCode: string | null
  onSelectCountry: (code: string) => void
  onSelectSubdivision: (subdivisionId: string) => void
  onDeselect: () => void
}

export function WorldMap({
  countryStatus,
  subdivisionStatus,
  selectedCode,
  onSelectCountry,
  onSelectSubdivision,
  onDeselect,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)

  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [worldTopo, setWorldTopo] = useState<TopoJson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [admin1Features, setAdmin1Features] = useState<MapFeature[]>([])

  // --- container size (drives the projection fit; never changes on pan/zoom) ---
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      setSize({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // --- world topology (fetched once) ---
  useEffect(() => {
    let cancelled = false
    loadWorldTopology()
      .then((topo) => {
        if (!cancelled) setWorldTopo(topo)
      })
      .catch((e: unknown) => {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const worldFeatures = useMemo(() => (worldTopo ? decodeLayer(worldTopo, 'countries', 'code') : []), [worldTopo])

  // --- projection + path generator: only depend on layout size and the decoded
  // world features, never on status. Recomputing on every status change would
  // blow the 60fps pan/zoom budget for no visual benefit (fill is a plain attribute). ---
  const projection = useMemo(() => {
    if (size.width === 0 || size.height === 0 || worldFeatures.length === 0) return null
    return geoNaturalEarth1().fitSize([size.width, size.height], SPHERE)
  }, [size.width, size.height, worldFeatures.length])

  const pathGen = useMemo(() => (projection ? geoPath(projection) : null), [projection])

  const spherePath = useMemo(() => pathGen?.(SPHERE) ?? '', [pathGen])

  // Static instrument-panel backdrop: on a portrait phone the projected globe
  // (wide aspect ratio) only fills a band of the tall container, leaving a lot
  // of empty space above/below. Fixed hairlines (outside the pan/zoom group,
  // so they read as a screen grid rather than geography) fill that space
  // deliberately instead of leaving it a featureless void.
  const GRID_STEP = 48
  const gridLines = useMemo(() => {
    if (size.height === 0) return []
    const lines: number[] = []
    for (let y = GRID_STEP; y < size.height; y += GRID_STEP) lines.push(y)
    return lines
  }, [size.height])

  const countryPaths = useMemo(
    () => (pathGen ? getPaths('world', pathGen, worldFeatures, size.width, size.height) : []),
    [pathGen, worldFeatures, size.width, size.height],
  )

  // SVG paints siblings in document order, so whichever country happens to
  // sit later in this array paints over its neighbours' shared-border stroke
  // — normally invisible (every stroke is the same thin --abyss hairline,
  // so it doesn't matter who's "on top"), but the selected country's outline
  // needs to win that fight on every side, not just where it happens to
  // border the ocean or a dataset-earlier neighbour. Moving it to the end of
  // the paint order (not the array itself — countryPaths stays cache-stable)
  // guarantees nothing is drawn after it. React's key-based reconciliation
  // moves the existing DOM node rather than remounting it.
  const orderedCountryPaths = useMemo(() => {
    if (!selectedCode) return countryPaths
    const selected = countryPaths.find((p) => p.id === selectedCode)
    if (!selected) return countryPaths
    return [...countryPaths.filter((p) => p.id !== selectedCode), selected]
  }, [countryPaths, selectedCode])

  // --- pan/zoom: transform is applied directly to the DOM outside React's
  // render cycle (setAttribute, not setState) so drag/pinch stays smooth;
  // React state only updates once a gesture settles ('end'), which is all
  // the admin-1 threshold check needs. ---
  const zoomBehavior = useMemo(
    () =>
      d3zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, Infinity]) // no cap on zooming in
        .clickDistance(6), // tolerate small finger jitter without swallowing a tap as a drag
    [],
  )

  useEffect(() => {
    const svgEl = svgRef.current
    const gEl = gRef.current
    if (!svgEl || !gEl || size.width === 0 || size.height === 0) return

    const extent: [[number, number], [number, number]] = [
      [0, 0],
      [size.width, size.height],
    ]
    zoomBehavior.extent(extent).translateExtent(extent)
    zoomBehavior.on('zoom', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      gEl.setAttribute('transform', event.transform.toString())
    })
    zoomBehavior.on('end', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      setScale(event.transform.k)
    })

    const selection = select(svgEl)
    selection.call(zoomBehavior)
    selection.call(zoomBehavior.transform, zoomIdentity)
    setScale(1)

    return () => {
      selection.on('.zoom', null)
    }
    // Re-binds on resize to keep pan constrained to the current viewport; also
    // resets to identity, since a stale transform against a re-fitted
    // projection would visibly misalign (e.g. after an orientation change).
  }, [zoomBehavior, size.width, size.height])

  // --- admin-1 overlay: only for the selected country, only once zoomed past
  // the threshold. Loads lazily and resolves null gracefully for countries
  // with no admin-1 file (Bouvet Island etc.) — no error, no overlay. ---
  const overThreshold = scale >= ADMIN1_ZOOM_THRESHOLD
  useEffect(() => {
    if (!selectedCode || !overThreshold) {
      setAdmin1Features([])
      return
    }
    let cancelled = false
    loadCountryTopology(selectedCode).then((topo) => {
      if (cancelled) return
      setAdmin1Features(topo ? decodeLayer(topo, 'admin1', 'id') : [])
    })
    return () => {
      cancelled = true
    }
  }, [selectedCode, overThreshold])

  const admin1Paths = useMemo(
    () => (pathGen && selectedCode ? getPaths(`admin1:${selectedCode}`, pathGen, admin1Features, size.width, size.height) : []),
    [pathGen, admin1Features, selectedCode, size.width, size.height],
  )

  if (loadError) {
    return (
      <div className="world-map world-map--error" role="alert">
        <p>Couldn’t load the map. {loadError}</p>
      </div>
    )
  }

  return (
    <div className="world-map" ref={containerRef}>
      <svg
        ref={svgRef}
        className="world-map__svg"
        viewBox={`0 0 ${size.width || 1} ${size.height || 1}`}
        role="img"
        aria-label="World map coloured by visit status"
        onClick={onDeselect}
      >
        <g className="world-map__grid" aria-hidden="true">
          {gridLines.map((y) => (
            <line key={y} x1={0} x2={size.width} y1={y} y2={y} />
          ))}
        </g>
        <g ref={gRef}>
          {spherePath && <path className="world-map__ocean" d={spherePath} />}
          {orderedCountryPaths.map((p) => (
            <path
              key={p.id}
              d={p.d}
              className={p.id === selectedCode ? 'world-map__country world-map__country--selected' : 'world-map__country'}
              style={{ fill: colorForStatus(countryStatus.get(p.id)) }}
              onClick={(e) => {
                e.stopPropagation()
                onSelectCountry(p.id)
              }}
            >
              <title>{p.name}</title>
            </path>
          ))}
          {admin1Paths.length > 0 && (
            <g className="world-map__admin1">
              {admin1Paths.map((p) => (
                <path
                  key={p.id}
                  d={p.d}
                  className="world-map__subdivision"
                  style={{ fill: colorForStatus(subdivisionStatus.get(p.id)) }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectSubdivision(p.id)
                  }}
                >
                  <title>{p.name}</title>
                </path>
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  )
}
