import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { geoOrthographic, geoPath, type GeoProjection, type GeoSphere } from 'd3-geo'
import type { Status } from '@/db/types'
import { loadCountryDetailTopology, loadCountryTopology, loadWorldTopology, type TopoJson } from '@/geo/loader'
import { loadMapCities, type MapCity } from '@/geo/mapCities'
import { logError } from '@/debug/log'
import { decodeLayer, type MapFeature } from '@/components/map/topo'
import { STATUS_ORDER, colorForStatus, UNVISITED_COLOR_VAR } from '@/components/map/statusColor'
import { CITY_MIN_SCALE, selectVisibleCities, type CityMarker } from '@/components/map/cityLayer'
import { ADMIN1_ZOOM_THRESHOLD } from '@/components/map/WorldMap'
import { clampScale, isFrontFacing, rotateByDrag, rotationTowardPoint, type Rotation } from '@/components/map/globeMath'
import './GlobeMap.css'

const SPHERE: GeoSphere = { type: 'Sphere' }

// Fixed hairlines behind the globe — same instrument-panel backdrop
// treatment WorldMap uses for its dead space. A circle inside a rectangular
// phone screen leaves even more of that space than the flat map's wide
// projection did, so it matters here too.
const GRID_STEP = 48

// Full parity with WorldMap (confirmed): admin-1 drill-down and city markers
// both work here too, so — like WorldMap's own uncapped scaleExtent — there's
// no principled reason to cap how far you can zoom in once fine detail is
// actually on screen to look at.
const MIN_ZOOM = 1
const MAX_ZOOM = Infinity
const GLOBE_PADDING = 8

// Tolerate small finger jitter without swallowing a tap as a drag — same
// value and reasoning as WorldMap's d3-zoom .clickDistance(6).
const CLICK_DISTANCE = 6

// Generous tap target for a city marker's tiny visible dot, matching the
// ~44px (radius 22) hit circle WorldMap gives its own city markers (00-PLAN.md
// §8's tap-target floor) — there's no invisible hit-circle to draw on canvas,
// this radius is purely a hit-testing concern.
const CITY_HIT_RADIUS = 22

// How far a zoom anchor has to drift from where the current zoom-toward
// target was locked (see zoomAt) before it's treated as pointing somewhere
// new rather than continuing to home in on the old target — generous enough
// to absorb natural cursor/pinch-midpoint jitter during one sustained
// gesture, tight enough that deliberately pointing elsewhere starts a fresh
// zoom-toward right away.
const ZOOM_TARGET_DRIFT_PX = 32

// A view centred a little east of the Atlantic, tilted to bring more of the
// northern hemisphere's landmass into the opening frame. Picked, not derived
// from anything in particular — easy to retune.
const INITIAL_ROTATION: Rotation = [-10, -25, 0]

interface Size {
  width: number
  height: number
}

interface GlobePalette {
  status: ReadonlyMap<Status, string>
  unvisited: string
  ocean: string
  grid: string
  strokeDefault: string
  strokeSelected: string
  labelText: string
  labelFont: string
}

// Canvas fillStyle/strokeStyle can't resolve `var(--x)` the way CSS can — the
// token has to be read out via getComputedStyle first. statusColor.ts stays
// the single source of truth for *which* token belongs to which status; this
// only adds "and here's how to turn that token into a paintable value."
function resolveToken(token: string, styles: CSSStyleDeclaration): string {
  const varName = /^var\((--[\w-]+)\)$/.exec(token)?.[1]
  return varName ? styles.getPropertyValue(varName).trim() : token
}

function resolveGlobePalette(): GlobePalette {
  const rootStyles = getComputedStyle(document.documentElement)
  const resolve = (token: string) => resolveToken(token, rootStyles)
  // Canvas font strings need a concrete size, not a `rem` a browser might
  // resolve against the canvas element's own (unrelated) font context — read
  // the root's actual px size and do the rem math ourselves.
  const rootFontSizePx = parseFloat(rootStyles.fontSize) || 16
  const labelRem = parseFloat(resolve('var(--text-2xs)')) || 0.625
  return {
    status: new Map(STATUS_ORDER.map((s) => [s, resolve(colorForStatus(s))])),
    unvisited: resolve(UNVISITED_COLOR_VAR),
    ocean: resolve('var(--shelf)'),
    grid: resolve('var(--contour)'),
    strokeDefault: resolve('var(--abyss)'),
    strokeSelected: resolve('var(--chalk)'),
    labelText: resolve('var(--chalk)'),
    labelFont: `${Math.round(labelRem * rootFontSizePx)}px ${resolve('var(--font-mono)')}`,
  }
}

function fillFor(status: Status | undefined, palette: GlobePalette): string {
  return (status && palette.status.get(status)) || palette.unvisited
}

interface GlobeMapProps {
  countryStatus: Map<string, Status>
  subdivisionStatus: Map<string, Status>
  cityStatus: ReadonlyMap<string, Status>
  selectedCode: string | null
  onSelectCountry: (code: string) => void
  onSelectSubdivision: (subdivisionId: string, name: string) => void
  onSelectCity: (refId: string) => void
  onDeselect: () => void
}

export function GlobeMap({
  countryStatus,
  subdivisionStatus,
  cityStatus,
  selectedCode,
  onSelectCountry,
  onSelectSubdivision,
  onSelectCity,
  onDeselect,
}: GlobeMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [worldTopo, setWorldTopo] = useState<TopoJson | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  // The only piece of gesture state that needs to be React-visible: just
  // enough to drive "did we cross the admin-1/city reveal threshold"
  // effects below, updated once per completed gesture step (not every
  // frame) — same "settled transform" rationale as WorldMap's transform.k.
  const [settledZoom, setSettledZoom] = useState(1)

  // Every input a redraw needs lives in a ref, always the latest render's
  // value — draw() itself is created once (useCallback, no deps) so it can
  // be called safely from long-lived pointer listeners without ever closing
  // over stale props, the same "bypass React during the gesture" precedent
  // WorldMap uses for its own pan/zoom transform.
  const rotationRef = useRef<Rotation>(INITIAL_ROTATION)
  const zoomRef = useRef(1) // multiplier over the whole-globe fit scale, like WorldMap's transform.k
  const baseScaleRef = useRef(0)
  const projectionRef = useRef<GeoProjection | null>(null)
  const paletteRef = useRef<GlobePalette | null>(null)
  const featuresRef = useRef<MapFeature[]>([])
  const admin1FeaturesRef = useRef<MapFeature[]>([])
  const countryDetailFeatureRef = useRef<MapFeature | null>(null)
  const mapCitiesRef = useRef<readonly MapCity[]>([])
  const cityMarkersRef = useRef<CityMarker[]>([]) // cached from the last draw, reused for hit-testing
  const countryStatusRef = useRef(countryStatus)
  const subdivisionStatusRef = useRef(subdivisionStatus)
  const cityStatusRef = useRef(cityStatus)
  const selectedCodeRef = useRef(selectedCode)
  const onSelectCountryRef = useRef(onSelectCountry)
  const onSelectSubdivisionRef = useRef(onSelectSubdivision)
  const onSelectCityRef = useRef(onSelectCity)
  const onDeselectRef = useRef(onDeselect)
  const frameRef = useRef<number | null>(null)

  countryStatusRef.current = countryStatus
  subdivisionStatusRef.current = subdivisionStatus
  cityStatusRef.current = cityStatus
  selectedCodeRef.current = selectedCode
  onSelectCountryRef.current = onSelectCountry
  onSelectSubdivisionRef.current = onSelectSubdivision
  onSelectCityRef.current = onSelectCity
  onDeselectRef.current = onDeselect

  // --- container size ---
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

  // --- world topology (fetched once; loadWorldTopology memoises the fetch,
  // so switching over from the flat map reuses whatever it already loaded) ---
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
  featuresRef.current = worldFeatures

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    const proj = projectionRef.current
    const width = canvas?.clientWidth ?? 0
    const height = canvas?.clientHeight ?? 0
    if (!canvas || !ctx || !proj || width === 0 || height === 0) return
    if (!paletteRef.current) paletteRef.current = resolveGlobePalette()
    const palette = paletteRef.current

    // The globe is always centred in its container — there's no panning
    // independent of rotation (see zoomAt below: turning to face a point
    // *is* this component's equivalent of panning), so translate is a plain
    // function of the current container size, never a drifting value that
    // needs to be tracked across gestures.
    proj.rotate(rotationRef.current).scale(baseScaleRef.current * zoomRef.current).translate([width / 2, height / 2])
    const path = geoPath(proj, ctx)

    // All drawing below happens in CSS-pixel-equivalent units; this is the
    // only place device pixel ratio is dealt with. Zoom is baked into the
    // projection's own .scale() (above) rather than a canvas transform, so
    // stroke widths and marker radii given in plain units below stay a
    // constant on-screen size regardless of zoom — the same effect SVG gets
    // from vector-effect: non-scaling-stroke (or, for WorldMap's city
    // markers, an explicit counter-scale), for free.
    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    ctx.strokeStyle = palette.grid
    ctx.globalAlpha = 0.55
    ctx.lineWidth = 1
    for (let y = GRID_STEP; y < height; y += GRID_STEP) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    ctx.globalAlpha = 1

    ctx.beginPath()
    path(SPHERE)
    ctx.fillStyle = palette.ocean
    ctx.fill()

    const admin1Features = admin1FeaturesRef.current
    const showingAdmin1 = admin1Features.length > 0

    // Canvas paints in draw order, same as SVG siblings — the selected
    // country is skipped in the main loop and drawn last instead, so its
    // highlighted outline is never covered by a neighbour (WorldMap solves
    // the same problem by moving it to the end of the SVG paint order).
    let selectedFeature: MapFeature | null = null
    for (const f of featuresRef.current) {
      if (f.id === selectedCodeRef.current) {
        selectedFeature = f
        continue
      }
      ctx.beginPath()
      path(f.feature)
      ctx.fillStyle = fillFor(countryStatusRef.current.get(f.id), palette)
      ctx.fill()
      ctx.strokeStyle = palette.strokeDefault
      ctx.lineWidth = 0.5
      ctx.stroke()
    }
    if (selectedFeature) {
      ctx.beginPath()
      // Prefer the higher-resolution per-country outline once it's loaded
      // (see the country-detail effect below, WorldMap's identical trick) —
      // but only while admin-1 isn't showing. Admin-1 is a completely
      // different Natural Earth dataset tracing the same coastline
      // independently, at whatever detail it happens to have for this
      // country's subdivisions — for some regions (confirmed directly:
      // Iceland's Reykjavík/Capital Region has only 81/56 raw points versus
      // ~3,000 for the country-level coastline there) that's drastically
      // coarser no matter how it's simplified. Drawing the sharper country
      // outline underneath admin-1 anyway turned the old, barely-visible
      // simplification gaps into an obvious mismatch (caught live, see
      // PROGRESS.md) — colour fills visibly stopping short of, or cutting
      // across, real coastal features the sharper line shows. Falling back
      // to the coarse `selectedFeature` here once admin-1 shows means only
      // one traced coastline is ever drawn at a time — admin-1's own edges
      // are the coastline whenever admin-1 is what's actually on screen.
      const detailFeature = countryDetailFeatureRef.current
      path((detailFeature && !showingAdmin1 ? detailFeature : selectedFeature).feature)
      // Same gap-fill trick WorldMap uses: the world layer and the admin-1
      // layer are two independently simplified traces of the same coastline
      // and don't align to the pixel, so once admin-1 regions are actually
      // covering this country, its own base fill switches to the neutral
      // unvisited tone instead of its real status — otherwise a coastline
      // gap between the two layers flashes the country's own (possibly
      // misleading) status colour through.
      ctx.fillStyle = showingAdmin1 ? palette.unvisited : fillFor(countryStatusRef.current.get(selectedFeature.id), palette)
      ctx.fill()
      ctx.strokeStyle = palette.strokeSelected
      ctx.lineWidth = 2
      ctx.stroke()
    }

    // Admin-1 — drawn through the same clipAngle-aware path generator as
    // everything else, so the portion on the far hemisphere is already
    // hidden for free, exactly like the country polygons above.
    if (showingAdmin1) {
      for (const f of admin1Features) {
        ctx.beginPath()
        path(f.feature)
        ctx.fillStyle = fillFor(subdivisionStatusRef.current.get(f.id), palette)
        ctx.fill()
        ctx.strokeStyle = palette.strokeDefault
        ctx.lineWidth = 0.75
        ctx.stroke()
      }
    }

    // Cities — topmost layer. Unlike polygons, a bare projected point gets
    // no automatic back-hemisphere clipping from d3-geo (verified directly:
    // a point and its exact antipode project to the identical screen
    // coordinate), so the project() callback does its own visibility check
    // via isFrontFacing before ever calling the raw projection.
    const rotation = rotationRef.current
    const markers = selectVisibleCities({
      cities: mapCitiesRef.current,
      cityStatus: cityStatusRef.current,
      scale: zoomRef.current,
      viewRect: { x0: 0, y0: 0, x1: width, y1: height },
      project: (lon, lat) => (isFrontFacing(rotation, [lon, lat]) ? proj([lon, lat]) : null),
    })
    cityMarkersRef.current = markers

    if (markers.length > 0) {
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.lineJoin = 'round'
      for (const m of markers) {
        ctx.beginPath()
        ctx.arc(m.x, m.y, m.isCapital ? 4.5 : 3, 0, Math.PI * 2)
        ctx.fillStyle = fillFor(m.status, palette)
        ctx.fill()
        ctx.strokeStyle = palette.strokeDefault
        ctx.lineWidth = 1
        ctx.stroke()

        if (m.labeled) {
          const label = m.name.toUpperCase()
          ctx.font = palette.labelFont
          ctx.letterSpacing = '0.05em' // silently ignored where unsupported, no fallback needed
          // Stroke-then-fill halo so the label stays legible over any status
          // colour or the ocean beneath it — same paint-order:stroke trick
          // WorldMap's CSS uses for its SVG text labels.
          ctx.strokeStyle = palette.strokeDefault
          ctx.lineWidth = 2
          ctx.strokeText(label, m.x + 7, m.y)
          ctx.fillStyle = palette.labelText
          ctx.fillText(label, m.x + 7, m.y)
        }
      }
    }
  }, [])

  // --- canvas sizing + projection fit: recomputed on resize or once the
  // world topology first decodes. Rotation/zoom are deliberately NOT reset
  // here — resizing (e.g. an orientation change) shouldn't spin the globe
  // back to its start. ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0 || worldFeatures.length === 0) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    canvas.style.width = `${size.width}px`
    canvas.style.height = `${size.height}px`

    baseScaleRef.current = Math.min(size.width, size.height) / 2 - GLOBE_PADDING
    if (!projectionRef.current) projectionRef.current = geoOrthographic().clipAngle(90)
    draw()
  }, [size.width, size.height, worldFeatures.length, draw])

  // --- admin-1: lazy-loaded once the selected country's zoom crosses the
  // same relative threshold WorldMap uses, cleared on deselect or zooming
  // back out (unlike the city index below, this is scoped to one specific
  // country, so it's cleared eagerly to avoid a stale country's shapes
  // flashing before a new fetch resolves). ---
  useEffect(() => {
    if (!selectedCode || settledZoom < ADMIN1_ZOOM_THRESHOLD) {
      admin1FeaturesRef.current = []
      draw()
      return
    }
    let cancelled = false
    loadCountryTopology(selectedCode).then((topo) => {
      if (cancelled) return
      admin1FeaturesRef.current = topo ? decodeLayer(topo, 'admin1', 'id') : []
      draw()
    })
    return () => {
      cancelled = true
    }
  }, [selectedCode, settledZoom, draw])

  // --- country detail: a higher-resolution outline for the selected country,
  // same reveal condition and same "cleared eagerly" rationale as admin-1
  // above. See WorldMap's identical effect for the full explanation of why
  // this exists — world.topo.json simplifies every country hard enough to
  // keep the whole world under one shared budget, which reads as visibly
  // blocky once zoomed in on just one of them. ---
  useEffect(() => {
    if (!selectedCode || settledZoom < ADMIN1_ZOOM_THRESHOLD) {
      countryDetailFeatureRef.current = null
      draw()
      return
    }
    let cancelled = false
    loadCountryDetailTopology(selectedCode).then((topo) => {
      if (cancelled) return
      const features = topo ? decodeLayer(topo, 'countries', 'code') : []
      countryDetailFeatureRef.current = features.find((f) => f.id === selectedCode) ?? null
      draw()
    })
    return () => {
      cancelled = true
    }
  }, [selectedCode, settledZoom, draw])

  // --- cities: lazy-loaded once past CITY_MIN_SCALE, same as WorldMap.
  // Loaded once and kept — the ~170k-row index is reused however many times
  // the user zooms back and forth across the threshold; selectVisibleCities'
  // own scale gate (inside draw(), above) is what actually hides them again
  // at low zoom, not clearing this. ---
  useEffect(() => {
    if (settledZoom < CITY_MIN_SCALE || mapCitiesRef.current.length > 0) return
    let cancelled = false
    loadMapCities()
      .then((cities) => {
        if (cancelled) return
        mapCitiesRef.current = cities
        draw()
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error('[globe] failed to load city index', e)
          void logError('globe: failed to load city index', e instanceof Error ? (e.stack ?? e.message) : String(e))
        }
      })
    return () => {
      cancelled = true
    }
  }, [settledZoom, draw])

  // --- drag-to-rotate, pinch/wheel-to-zoom, tap-to-select-or-deselect.
  // Bound once — callbacks and data are read through the refs kept in sync
  // above, so this never needs to rebind on every parent re-render. ---
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const pointers = new Map<number, { x: number; y: number }>()
    let drag: { moved: number; lastX: number; lastY: number } | null = null
    let pinchStart: { distance: number; zoom: number } | null = null
    // Lazily-created, reused across taps — see handleTap below.
    let hitCanvas: HTMLCanvasElement | null = null

    function scheduleDraw() {
      if (frameRef.current !== null) return
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null
        draw()
      })
    }

    function pointerDistance(): number | null {
      const pts = [...pointers.values()]
      if (pts.length < 2) return null
      const [a, b] = pts
      if (!a || !b) return null
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    function pointerMidpoint(): { x: number; y: number } | null {
      const pts = [...pointers.values()]
      if (pts.length < 2) return null
      const [a, b] = pts
      if (!a || !b) return null
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
    }

    // The lon/lat currently being homed in on by a zoom-in sequence, and the
    // screen position it was captured at — see zoomAt. Cleared whenever
    // zooming isn't actively increasing, so the next zoom-in starts fresh.
    let zoomTarget: [number, number] | null = null
    let zoomTargetAnchor: [number, number] | null = null

    // Rotates toward a point under (localX, localY) as the zoom level
    // increases to targetZoom — "zoom toward cursor/pinch" adapted for a
    // sphere. A flat map (or an earlier version of this function) gets that
    // behaviour from a pure scale+translate change, keeping the anchor pixel
    // fixed on screen. A globe can't stop there: an orthographic projection
    // foreshortens everything away from its own centre (the same reason the
    // edge of a real globe looks "on a slant"), so magnifying an off-centre
    // point without also turning to face it just makes the same oblique
    // angle bigger, never straightens it out (reported directly: zooming in
    // on a country sitting in a corner should end up looking at it face-on,
    // not at a slant). Only rotation fixes that — scale alone can't.
    //
    // The target point is captured *once* per zoom-in sequence
    // (zoomTarget/zoomTargetAnchor above), not re-sampled on every tick —
    // re-sampling was tried first and doesn't converge on the place the
    // gesture actually started over: a centred scale change alone already
    // pulls whatever's at a fixed pixel toward the *current* centre (the
    // same way zooming into a photo without panning reveals more of what
    // was already in the middle), so re-inverting the same screen point
    // after every tick's scale bump chases a target that's itself drifting
    // toward the old centre — verified directly against real topology: it
    // still converges to *something* centred, just not the country the
    // gesture actually started on (a corner tap that inverted to China
    // ended up centring Russia instead, 12 ticks later). Locking the target
    // once and re-using it for the rest of the zoom-in avoids that; it's
    // only replaced once the anchor drifts more than ZOOM_TARGET_DRIFT_PX
    // from where the lock was taken (pointing somewhere new) or the gesture
    // zooms back out (done with that target).
    //
    // draw() now always centres the projection in its container (see the
    // "always centred" comment there), so turning to face a point is this
    // component's entire equivalent of panning — there's no separate
    // translate bookkeeping left to do here.
    function zoomAt(localX: number, localY: number, targetZoom: number) {
      const proj = projectionRef.current
      if (baseScaleRef.current === 0 || !proj || !proj.invert) return // not laid out yet
      const clamped = clampScale(targetZoom, MIN_ZOOM, MAX_ZOOM)
      if (clamped > zoomRef.current) {
        const needsNewTarget =
          !zoomTarget ||
          !zoomTargetAnchor ||
          Math.hypot(localX - zoomTargetAnchor[0], localY - zoomTargetAnchor[1]) > ZOOM_TARGET_DRIFT_PX
        if (needsNewTarget) {
          // Same disk-membership check handleTap uses before trusting
          // .invert() — an anchor sitting in the dead space around the globe
          // (still over the canvas, just not over the sphere) has no real
          // point to turn toward, so plain scale is all that applies then.
          const [tx, ty] = proj.translate()
          const insideDisk = Math.hypot(localX - tx, localY - ty) <= proj.scale()
          const point = insideDisk ? proj.invert([localX, localY]) : null
          zoomTarget = point && !Number.isNaN(point[0]) && !Number.isNaN(point[1]) ? point : null
          zoomTargetAnchor = zoomTarget ? [localX, localY] : null
        }
        if (zoomTarget) {
          // Same growth ratio however big or small this particular tick is,
          // so a steady scroll or pinch converges at a consistent felt rate
          // regardless of the zoom level it starts from — doubling always
          // rotates the same fraction of the remaining distance toward the
          // locked target, whether that's 1x→2x or 10x→20x.
          const t = 1 - zoomRef.current / clamped
          rotationRef.current = rotationTowardPoint(rotationRef.current, zoomTarget, t)
        }
      } else {
        zoomTarget = null
        zoomTargetAnchor = null
      }
      zoomRef.current = clamped
    }

    function handleTap(clientX: number, clientY: number) {
      const proj = projectionRef.current
      if (!proj) return
      // TS doesn't carry the outer `if (!canvas) return` guard's narrowing
      // into a nested function declaration's body — canvas is genuinely
      // non-null here (the effect returned early otherwise).
      const rect = canvas!.getBoundingClientRect()
      const localX = clientX - rect.left
      const localY = clientY - rect.top

      // Cities are drawn topmost, so they get first refusal — a plain
      // pixel-radius hit test against the markers actually drawn on the
      // last frame (there's no polygon to run geoContains against for a
      // point feature).
      let closestCity: CityMarker | null = null
      let closestDist = CITY_HIT_RADIUS
      for (const m of cityMarkersRef.current) {
        const d = Math.hypot(localX - m.x, localY - m.y)
        if (d <= closestDist) {
          closestDist = d
          closestCity = m
        }
      }
      if (closestCity) {
        onSelectCityRef.current(closestCity.refId)
        return
      }

      // geoOrthographic's own .invert() does NOT return null for a point
      // outside the projected disk — verified directly (not assumed): it
      // clamps to the rim instead, silently returning the same coordinate
      // for a tap 5px past the edge as for one 1.5 radii away. So "did this
      // tap land on the globe at all" has to be our own screen-space check
      // against the projection's own centre/radius — cheap enough to do
      // before ever touching the canvas below.
      const [tx, ty] = proj.translate()
      if (Math.hypot(localX - tx, localY - ty) > proj.scale()) {
        onDeselectRef.current()
        return
      }

      // Countries and admin-1 have no DOM nodes to hit-test against (unlike
      // WorldMap's SVG paths, where the browser's own hit-testing always
      // agrees with whatever it just rendered, by construction). This used
      // to invert the tap to a lon/lat point and run geoContains against
      // each feature's own geometry independently — that matched the real
      // topology almost everywhere (verified directly against real country
      // and admin-1 data, byte-checked pixel by pixel), *except* wherever
      // the shape actually painted on screen wasn't the same shape being
      // geometrically tested: concretely, the selected country's
      // higher-resolution outline (see countryDetailFeatureRef below,
      // painted once zoomed in) was never what got hit-tested — only the
      // coarser world-topology shape underneath it — so a tap that visibly
      // landed on the selected country's own sharper coastline could
      // silently resolve to nothing. Painting a throwaway offscreen buffer
      // from *the exact same shapes draw() just painted*, in the same
      // order, and reading back the single tapped pixel removes that whole
      // class of mismatch structurally: whatever is actually on screen is,
      // by construction, what gets tapped — the same guarantee WorldMap
      // gets for free from the DOM.
      const width = canvas!.clientWidth
      const height = canvas!.clientHeight
      if (width === 0 || height === 0) {
        onDeselectRef.current()
        return
      }
      if (!hitCanvas) hitCanvas = document.createElement('canvas')
      if (hitCanvas.width !== width || hitCanvas.height !== height) {
        hitCanvas.width = width
        hitCanvas.height = height
      }
      const hitCtx = hitCanvas.getContext('2d', { willReadFrequently: true })
      if (!hitCtx) return
      hitCtx.clearRect(0, 0, width, height)
      const hitPath = geoPath(proj, hitCtx)

      // 1-based ids — 0 stays "nothing painted here" (open water; the dead
      // space outside the disk is already handled above). Paint order
      // mirrors draw() exactly: non-selected countries, then the selected
      // one last (preferring its higher-res detail shape under the same
      // condition draw() uses), then admin-1 on top — so any overlap
      // between independently-simplified layers resolves to whichever one
      // draw() itself would actually paint last, same as everywhere else in
      // this component.
      const picks: { kind: 'country' | 'subdivision'; id: string; name: string }[] = []
      function paint(kind: 'country' | 'subdivision', id: string, name: string, shape: MapFeature['feature']) {
        picks.push({ kind, id, name })
        hitCtx!.beginPath()
        hitPath(shape)
        hitCtx!.fillStyle = `rgb(${(picks.length >> 16) & 255},${(picks.length >> 8) & 255},${picks.length & 255})`
        hitCtx!.fill()
      }

      const admin1Features = admin1FeaturesRef.current
      const showingAdmin1 = admin1Features.length > 0
      const selectedCode = selectedCodeRef.current
      let selectedFeature: MapFeature | null = null
      for (const f of featuresRef.current) {
        if (f.id === selectedCode) {
          selectedFeature = f
          continue // painted last, below — same reason draw() defers it
        }
        paint('country', f.id, f.name, f.feature)
      }
      if (selectedFeature) {
        const detailFeature = countryDetailFeatureRef.current
        const shape = detailFeature && !showingAdmin1 ? detailFeature : selectedFeature
        paint('country', selectedFeature.id, selectedFeature.name, shape.feature)
      }
      if (showingAdmin1) {
        for (const f of admin1Features) {
          paint('subdivision', f.id, f.name, f.feature)
        }
      }

      const pixel = hitCtx.getImageData(Math.round(localX), Math.round(localY), 1, 1).data
      const pickId = (pixel[0]! << 16) | (pixel[1]! << 8) | pixel[2]!
      const pick = pickId > 0 ? picks[pickId - 1] : undefined

      if (!pick) onDeselectRef.current()
      else if (pick.kind === 'subdivision') onSelectSubdivisionRef.current(pick.id, pick.name)
      else onSelectCountryRef.current(pick.id)
    }

    function onPointerDown(e: PointerEvent) {
      canvas!.setPointerCapture(e.pointerId)
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (pointers.size === 1) {
        drag = { moved: 0, lastX: e.clientX, lastY: e.clientY }
      } else if (pointers.size === 2) {
        drag = null // a second finger landing cancels any in-flight rotate/tap
        const distance = pointerDistance()
        if (distance) pinchStart = { distance, zoom: zoomRef.current }
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!pointers.has(e.pointerId)) return
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

      if (pointers.size >= 2 && pinchStart) {
        const distance = pointerDistance()
        const midpoint = pointerMidpoint()
        if (distance && midpoint) {
          const rect = canvas!.getBoundingClientRect()
          zoomAt(midpoint.x - rect.left, midpoint.y - rect.top, (distance / pinchStart.distance) * pinchStart.zoom)
          scheduleDraw()
        }
        return
      }

      if (!drag) return
      const dx = e.clientX - drag.lastX
      const dy = e.clientY - drag.lastY
      drag.lastX = e.clientX
      drag.lastY = e.clientY
      drag.moved += Math.hypot(dx, dy)
      rotationRef.current = rotateByDrag(rotationRef.current, dx, dy, baseScaleRef.current * zoomRef.current)
      // A manual rotate invalidates any zoom-in target locked earlier (see
      // zoomAt) — it was a promise to keep converging on a specific point,
      // and dragging just moved that point out from under it without
      // zoomAt's own knowledge. Next zoom-in tick samples fresh instead of
      // homing in on wherever the target used to be before this drag.
      zoomTarget = null
      zoomTargetAnchor = null
      scheduleDraw()
    }

    function onPointerUp(e: PointerEvent) {
      const tapCandidate = pointers.size === 1 ? drag : null
      pointers.delete(e.pointerId)
      if (pointers.size < 2) pinchStart = null
      if (pointers.size === 0) {
        drag = null
        setSettledZoom(zoomRef.current)
      }

      if (tapCandidate && tapCandidate.moved < CLICK_DISTANCE) {
        handleTap(e.clientX, e.clientY)
      }
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const factor = Math.exp(-e.deltaY * 0.002)
      const rect = canvas!.getBoundingClientRect()
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, zoomRef.current * factor)
      scheduleDraw()
      setSettledZoom(zoomRef.current)
    }

    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('wheel', onWheel)
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    }
  }, [draw])

  // The canvas has no persistent per-feature nodes to update in place, so
  // any change to status data or the current selection needs a full
  // repaint — same cost either way, unlike the flat map's per-path fill.
  useEffect(() => {
    draw()
  }, [countryStatus, subdivisionStatus, cityStatus, selectedCode, draw])

  if (loadError) {
    return (
      <div className="globe-map globe-map--error" role="alert">
        <p>Couldn’t load the globe. {loadError}</p>
      </div>
    )
  }

  return (
    <div className="globe-map" ref={containerRef}>
      <canvas ref={canvasRef} className="globe-map__canvas" role="img" aria-label="World globe coloured by visit status" />
    </div>
  )
}
