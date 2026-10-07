# Trip overview: route arrows between stops

## Problem

The trip overview's map (`TripRouteMap`, shown by `TripDetail`) shows *where* a trip went — the
trip's countries filled in, a dot per city — but not *in what order*. You can't see how the trip was
traveled.

## Goals

1. On the trip overview map, draw minimalist arrows connecting the trip's cities in travel order.
2. Order comes from each city's visit date *on this trip* (`TripEntry.visitedDate`); cities on the
   same day follow the order they were added to the trip (`TripEntry.addedAt`).
3. Cities with no visit date on this trip, or with no coordinates, keep their dot (if they have
   coordinates) but get no arrows — the route is never guessed.

## Non-goals

- No arrows on the Trips-tab stamp thumbnails (`TripRouteMap compact`) — they're ~92 px tall.
- No route through directly-attached countries or subdivisions — they have no point on the map.
- No loops back to an earlier city: a place sits on a trip at most once (one `TripEntry` per
  trip+entry), so A→B→A can't be represented and isn't attempted.
- No great-circle geometry, no animation, no interaction.

## Design

### 1. Ordering — `src/domain/tripRoute.ts` (pure)

`tripRoute(rows: readonly TripPlaceRow[]): RouteStop[]` where `RouteStop = { name, lat, lon }`.

- Keep only rows with `visitedDate !== null`, `lat !== null`, `lon !== null`.
- Sort by `visitedDate` ascending (ISO strings compare lexically), then `addedAt` ascending.
- Callers with fewer than 2 stops draw no arrows.

### 2. Data — `addedAt` on `TripPlaceRow`

`TripPlaceRow.createdAt` is the *entry's* creation time, not when the place joined this trip. Add
`addedAt: number` to `TripPlaceRow`:

- `TripPlacesInput` gains optional `addedAts?: ReadonlyMap<string, number>` (entryId →
  `TripEntry.addedAt`), mirroring the existing optional `visitedDates`.
- `toRow` fills `addedAt` from that map, falling back to `entry.createdAt` when absent — every
  existing caller and test keeps working.
- `tripPlacesRepo.resolveGroups` passes `addedAts` from the `TripEntry` rows it already loads.

The existing itinerary sort in `tripPlaces.ts` is left as is.

### 3. Drawing — `TripRouteMap` `route` prop

- New optional prop `route?: readonly RouteStop[]`. Only `TripDetail` passes it
  (`tripRoute(cityRows)`); stamps don't.
- Geometry is a pure, exported helper `legPath(p, q)` in `src/components/trips/routeGeometry.ts`,
  working in projected screen coordinates:
  - Quadratic Bézier from `p` to `q`; control point = midpoint offset perpendicular by 20 % of the
    leg length, always to the *left* of travel direction — so A→B and B→A bow to opposite sides.
  - Chevron at the curve's t = 0.5 point (`0.25p + 0.5c + 0.25q`), oriented along the tangent there
    (parallel to `q − p` for a quadratic), arms ~5 px, open (stroke only).
  - Returns `null` for legs shorter than 4 px (nothing drawn); omits the chevron for legs shorter
    than 18 px.
- Rendered as a `<g>` between the countries and the city dots: stroke `var(--chalk)`, ~1.25 px,
  opacity ~0.7, `fill: none`, `vector-effect: non-scaling-stroke`, rounded caps/joins.
- `aria-label` mentions the route when one is drawn.

## Testing

- `tripRoute.test.ts`: date order; same-date tie broken by `addedAt`; undated rows excluded; rows
  without coordinates excluded.
- `tripPlaces.test.ts`: `addedAt` comes from `addedAts` when given, `entry.createdAt` otherwise.
- `routeGeometry.test.ts`: control point on the left of travel; reversed leg bows the other way;
  chevron tip sits at the t = 0.5 point and points along `q − p`; short-leg thresholds.
- Manual: open a dated multi-city trip in the preview, confirm arcs + chevrons in order; screenshot.
