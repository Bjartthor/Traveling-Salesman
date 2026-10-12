# View a trip on the main map

## Problem

A trip's route is only visible on the trip page's small, fixed map (`TripRouteMap`), which can't be
panned or zoomed. Exploring a trip, for example the LA ↔ San Diego legs next to the long run up to
Tahoe, needs the main map's pan, zoom and globe.

## Goals

1. Open a trip on the main Map tab, with only that trip shown, on both the flat map and the globe.
2. The route arrows stay drawn while panning, zooming and rotating.
3. It opens framed on the trip.

## Non-goals

- Great-circle route lines. Legs are screen-space arcs on both maps, same as the trip page.
- Persisting the trip view across app restarts.
- Coverage stats for the trip on the map. The trip page already has its stats.

## Design

### Opening and closing: `@/domain/tripMapStore`

- A zustand store `{ tripId: string | null, show(tripId), clear() }`. It's in memory only, so it
  survives tab switches but not a restart.
- `TripDetail` gets **Show on map**: `show(trip.id)`, close the trip overlay, then `navigate('/')`.
- In a trip view, `MapScreen`'s header replaces the coverage headline with the trip's name and dates
  and a ✕ (`clear()`). The flat/globe toggle stays. `CoverageStrip` is hidden; `Legend` stays. If the
  trip is deleted (or not found), the map falls back to the normal view.

### What's drawn

`MapScreen` loads the trip with `loadTripPlaces` (live query) and passes the maps the same props
they always get, filtered to the trip:

- `countryStatus`: only the trip's countries. Every other country gets no status, so it paints as
  the unvisited grey.
- `subdivisionStatus`: only the trip's subdivisions (its groups' subdivision keys).
- `cityStatus`: **empty**, so the regular zoom-gated city layer shows nothing.

plus one new optional prop on both maps, `trip?: TripOverlay`:

```ts
interface TripOverlay {
  cities: { refId: string; name: string; lat: number; lon: number; status: Status }[] // every mapped trip city
  route: RouteStop[] // @/domain/tripRoute
  fit: { lat: number; lon: number }[] // what the opening view frames (the trip's cities)
}
```

Trip cities are drawn at every zoom, dot plus label, tappable (`onSelectCity`), styled like
regular city markers.

### Flat map (`WorldMap`)

- **Opening view:** pure `flatFitTransform(bounds, size, padding)` in
  `src/components/map/tripMapView.ts`. `bounds` is the projected bounding box of
  `cityFitBox(trip.fit)` (`@/components/trips/tripMapFit`). It returns the d3-zoom
  `{ k, x, y }` that centres that box, scaled to fit within the padded viewport, with `k >= 1`.
  Applied with `zoomBehavior.transform` when the trip (or the size) changes, in place of identity.
- **Arrows:** drawn inside the zoom group in a child `<g transform="scale(1/k)">`. Each leg is
  `routeLeg(p·k, q·k)`, with `k` = the settled zoom (updated on `end`). Arrowheads and the
  short-leg thresholds then work in on-screen pixels. During a gesture the group scales with the
  map until `end` recomputes it. Strokes use `vector-effect: non-scaling-stroke`.
- **Trip cities:** the existing marker markup (translate group + counter-scaled
  `world-map__city`), always labelled.

### Globe (`GlobeMap`)

- **Opening view:** pure `globeFitView(points)` in `tripMapView.ts` returns the rotation facing the
  `cityFitBox` centre and a zoom that fits the box: the largest great-circle distance θ from the
  centre to a box corner, zoom = `0.85 / sin θ`, clamped to ≥ 1 (θ ≥ 90° → 1). Applied to
  `rotationRef` / `zoomRef` when the trip changes.
- **Arrows:** in `draw()` after the city layer, for each consecutive stop pair. A leg whose
  endpoint isn't front-facing (`isFrontFacing`) is skipped; otherwise it's `routeLeg` on the
  projected points, stroked as a quadratic curve plus a chevron polyline.
- **Trip cities:** drawn like city markers, always labelled, and added to the hit-test list so a
  tap opens the place sheet.

## Testing

- `tripMapView.test.ts`: the flat fit centres the box and fits its larger dimension within the
  padding; `k` never drops below 1; the globe fit faces the box centre, zooms further in for a
  smaller box, and returns 1 for a box spanning a hemisphere.
- Manual (preview): California trip → **Show on map**. On the flat map, only US-California is
  coloured, the arrows LA → San Diego → LA → … are drawn, the opening view frames California, and
  pan/zoom keep the arrows aligned. Switch to the globe: it faces California with arrows drawn.
  ✕ returns to the normal map.
