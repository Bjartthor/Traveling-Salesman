import { useEffect, useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath, type GeoSphere } from 'd3-geo'
import { select } from 'd3-selection'
import { zoom as d3zoom, zoomIdentity, type D3ZoomEvent } from 'd3-zoom'
import type { Status } from '@/db/types'
import { loadCountryDetailTopology, loadCountryTopology, loadWorldTopology, type TopoJson } from '@/geo/loader'
import { loadMapCities, type MapCity } from '@/geo/mapCities'
import { logError } from '@/debug/log'
import { decodeLayer, type MapFeature } from '@/components/map/topo'
import { colorForStatus, UNVISITED_COLOR_VAR } from '@/components/map/statusColor'
import { CITY_MIN_SCALE, selectVisibleCities, visibleRect } from '@/components/map/cityLayer'
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
// Exported so GlobeMap can reveal admin-1 at the same relative zoom level
// rather than maintaining its own, driftable copy of this constant.
export const ADMIN1_ZOOM_THRESHOLD = 4

interface Size {
  width: number
  height: number
}

interface WorldMapProps {
  countryStatus: Map<string, Status>
  subdivisionStatus: Map<string, Status>
  cityStatus: ReadonlyMap<string, Status>
  selectedCode: string | null
  onSelectCountry: (code: string) => void
  onSelectSubdivision: (subdivisionId: string, name: string) => void
  onSelectCity: (refId: string) => void
  onDeselect: () => void
}

export function WorldMap({
  countryStatus,
  subdivisionStatus,
  cityStatus,
  selectedCode,
  onSelectCountry,
  onSelectSubdivision,
  onSelectCity,
  onDeselect,
}: WorldMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const gRef = useRef<SVGGElement>(null)
  // rAF-throttling for the live 'zoom' handler below: pointer/wheel events
  // (especially trackpad wheel deltas) can fire faster than the display can
  // paint, and every tick rewrites --zoom-k, which cascades a style
  // recalc through every rendered city marker. Coalescing to one DOM write
  // per animation frame caps that cost at the paint rate instead of the
  // input rate, with no visible difference — the on-screen result is
  // identical, just computed at most once per frame instead of once per event.
  const pendingZoomTransformRef = useRef<{ k: number; x: number; y: number; toString: () => string } | null>(null)
  const zoomRafIdRef = useRef<number | null>(null)

  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [worldTopo, setWorldTopo] = useState<TopoJson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The settled (post-gesture) zoom transform — k drives the admin-1 and
  // city-reveal thresholds, x/y (together with k) drive which cities are in
  // view. Deliberately only updated on 'end', same rationale as the old
  // scale-only state this replaces: recomputing which features to show is a
  // discrete, occasional decision, not something that needs to track every
  // frame of a gesture.
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 })
  const [admin1Features, setAdmin1Features] = useState<MapFeature[]>([])
  const [countryDetailFeature, setCountryDetailFeature] = useState<MapFeature | null>(null)
  const [mapCities, setMapCities] = useState<readonly MapCity[]>([])

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
      pendingZoomTransformRef.current = event.transform
      if (zoomRafIdRef.current !== null) return
      zoomRafIdRef.current = requestAnimationFrame(() => {
        zoomRafIdRef.current = null
        const t = pendingZoomTransformRef.current
        if (!t) return
        gEl.setAttribute('transform', t.toString())
        // City markers counter-scale against this custom property (WorldMap.css)
        // so their dot/label size stays constant on screen through the gesture,
        // instead of growing without bound — zoom has no upper cap (see
        // ADMIN1_ZOOM_THRESHOLD above), so a marker sized in local units alone
        // would eventually swallow the whole viewport.
        gEl.style.setProperty('--zoom-k', String(t.k))
      })
    })
    zoomBehavior.on('end', (event: D3ZoomEvent<SVGSVGElement, unknown>) => {
      setTransform({ k: event.transform.k, x: event.transform.x, y: event.transform.y })
    })

    const selection = select(svgEl)
    selection.call(zoomBehavior)
    selection.call(zoomBehavior.transform, zoomIdentity)
    setTransform({ k: 1, x: 0, y: 0 })
    gEl.style.setProperty('--zoom-k', '1')

    return () => {
      selection.on('.zoom', null)
      if (zoomRafIdRef.current !== null) cancelAnimationFrame(zoomRafIdRef.current)
      zoomRafIdRef.current = null
      pendingZoomTransformRef.current = null
    }
    // Re-binds on resize to keep pan constrained to the current viewport; also
    // resets to identity, since a stale transform against a re-fitted
    // projection would visibly misalign (e.g. after an orientation change).
  }, [zoomBehavior, size.width, size.height])

  // --- admin-1 overlay: only for the selected country, only once zoomed past
  // the threshold. Loads lazily and resolves null gracefully for countries
  // with no admin-1 file (Bouvet Island etc.) — no error, no overlay. ---
  const overThreshold = transform.k >= ADMIN1_ZOOM_THRESHOLD
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

  // --- country detail: a higher-resolution outline for the selected country
  // only, same reveal condition as admin-1 above. world.topo.json has to
  // simplify every country hard enough to keep the whole world under one
  // shared byte budget (Iceland keeps ~14% of its real points there) — fine
  // zoomed out, visibly blocky once you're zoomed in on one country. This
  // swaps in a per-country file simplified against its own budget instead
  // (tools/build-geo.mjs's buildCountryDetail), painted on top of the coarse
  // shape it's replacing so there's no flash of missing content while it
  // loads. Purely a rendering upgrade — selection/hit-testing/status all
  // still key off the country code, never this shape. ---
  useEffect(() => {
    if (!selectedCode || !overThreshold) {
      setCountryDetailFeature(null)
      return
    }
    let cancelled = false
    loadCountryDetailTopology(selectedCode).then((topo) => {
      if (cancelled) return
      const features = topo ? decodeLayer(topo, 'countries', 'code') : []
      setCountryDetailFeature(features.find((f) => f.id === selectedCode) ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [selectedCode, overThreshold])

  const countryDetailPath = useMemo(
    () =>
      pathGen && countryDetailFeature
        ? getPaths(`countryDetail:${countryDetailFeature.id}`, pathGen, [countryDetailFeature], size.width, size.height)[0]
        : undefined,
    [pathGen, countryDetailFeature, size.width, size.height],
  )

  // --- city layer: loaded lazily (the ~170k-row index costs real time to
  // build, per @/geo/mapCities) the first time the user actually zooms in
  // far enough to reveal cities at all, not on every map mount. ---
  const citiesUnlocked = transform.k >= CITY_MIN_SCALE
  useEffect(() => {
    if (!citiesUnlocked) return
    let cancelled = false
    loadMapCities()
      .then((cities) => {
        if (!cancelled) setMapCities(cities)
      })
      .catch((e: unknown) => {
        // Non-fatal: the city layer is supplementary, unlike the world
        // topology load above — the rest of the map keeps working. But this
        // used to fail silently (no .catch() at all), which would look
        // indistinguishable from "no cities near here yet" — surface it.
        if (!cancelled) {
          console.error('[map] failed to load city index', e)
          void logError('map: failed to load city index', e instanceof Error ? e.stack ?? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [citiesUnlocked])

  const cityMarkers = useMemo(
    () =>
      projection
        ? selectVisibleCities({
            cities: mapCities,
            cityStatus,
            scale: transform.k,
            viewRect: visibleRect(transform, size.width, size.height),
            project: (lon, lat) => projection([lon, lat]),
          })
        : [],
    [projection, mapCities, cityStatus, transform, size.width, size.height],
  )

  // The world layer and the admin-1 layer trace the same real coastline
  // independently (separate Natural Earth datasets, simplified separately),
  // so they don't align to the pixel — a country's admin-1 regions almost
  // always leave a scattering of tiny gaps along its own coastline where no
  // region quite reaches the edge. Normally invisible (nothing renders in a
  // gap), but the selected country's own path sits directly underneath the
  // admin-1 overlay, coloured by *its own* status — so every gap shows a
  // fleck of that colour, and since it's the country's cascade-derived
  // status, every fleck tracks whichever child ranks highest, exactly like a
  // real (but wrong) extra region would. Once admin-1 regions are actually
  // covering the selected country, its own fill switches to the same neutral
  // tone every unvisited area already uses — a gap then reads as an
  // unremarkable seam instead of a phantom status.
  const showingAdmin1 = admin1Paths.length > 0

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
              style={{ fill: p.id === selectedCode && showingAdmin1 ? UNVISITED_COLOR_VAR : colorForStatus(countryStatus.get(p.id)) }}
              onClick={(e) => {
                e.stopPropagation()
                // Once zoomed in past the admin-1 threshold with this country
                // already selected, a click landing back on its own body
                // (rather than a specific subdivision) means admin-1 hasn't
                // finished its lazy fetch yet, or -- rarely -- landed in a
                // coastline gap between this path and the admin-1 overlay
                // (see the showingAdmin1 comment above) -- not "click the
                // already-selected country to deselect it", which only makes
                // sense at the world-view granularity, before drilling into a
                // country's regions. Same fix as GlobeMap's handleTap.
                if (p.id === selectedCode && overThreshold) return
                onSelectCountry(p.id)
              }}
            >
              <title>{p.name}</title>
            </path>
          ))}
          {countryDetailPath && !showingAdmin1 && (
            // Painted directly on top of the coarse path for this same
            // country above — same fill/stroke rules, just sharper geometry.
            // Nothing needs to be removed from orderedCountryPaths for this:
            // an opaque fill on top fully replaces what's visually shown
            // wherever the two shapes differ, and there's no gap while this
            // loads since the coarse path is still there underneath.
            //
            // Deliberately hidden once admin-1 is showing (`!showingAdmin1`
            // above), not just gap-filled: admin-1 is built from a
            // completely different Natural Earth dataset that traces the
            // same coastline independently, at whatever detail that dataset
            // happens to have for this particular country's subdivisions —
            // for some regions (confirmed directly: Iceland's Reykjavík/
            // Capital Region has only 81/56 raw points, versus the ~3,000
            // the country-level coastline has there) that's drastically
            // coarser, no matter how gently it's simplified. Layering a much
            // sharper competing coastline on top of that turned the old,
            // barely-visible simplification gaps into an obvious mismatch —
            // colour fills visibly stopping short of or cutting across real
            // coastal features the sharper line shows (caught live, see
            // PROGRESS.md). Showing only one traced coastline at a time
            // avoids that entirely: admin-1's own edges are the coastline
            // whenever admin-1 is what's actually drawn.
            <path
              d={countryDetailPath.d}
              className="world-map__country world-map__country--selected"
              style={{ fill: colorForStatus(countryStatus.get(countryDetailPath.id)) }}
              onClick={(e) => {
                e.stopPropagation()
                if (overThreshold) return // see the identical guard above
                onSelectCountry(countryDetailPath.id)
              }}
            >
              <title>{countryDetailPath.name}</title>
            </path>
          )}
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
                    onSelectSubdivision(p.id, p.name)
                  }}
                >
                  <title>{p.name}</title>
                </path>
              ))}
            </g>
          )}
          {cityMarkers.length > 0 && (
            <g className="world-map__cities">
              {cityMarkers.map((c) => (
                // Position and counter-scale must live on two DIFFERENT elements.
                // A CSS `transform` on an SVG element completely replaces its
                // `transform` attribute rather than composing with it — putting
                // both the translate(x,y) attribute and the counter-scale CSS
                // rule on the same <g> silently discarded the translate,
                // stranding every marker at wherever the group's local (0,0)
                // happened to map to instead of its real position (found via a
                // live bug report — see PROGRESS.md).
                <g
                  key={c.refId}
                  transform={`translate(${c.x},${c.y})`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectCity(c.refId)
                  }}
                >
                  <title>{c.name}</title>
                  <g className="world-map__city">
                    <circle className="world-map__city-hit" r={22} />
                    <circle
                      className="world-map__city-dot"
                      r={c.isCapital ? 4.5 : 3}
                      style={{ fill: colorForStatus(c.status) }}
                    />
                    {c.labeled && (
                      <text className="world-map__city-label mono" x={7} y={3}>
                        {c.name}
                      </text>
                    )}
                  </g>
                </g>
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  )
}
