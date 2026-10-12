# Repeat visits to a place on one trip

## Problem

A trip can hold a place only once (one `TripEntry` per trip + place), with one visit date. A trip
like *lived in LA for two months, went to San Diego for a weekend, came back, later went to South
Lake Tahoe* can't be recorded, and the route arrows
(`2026-10-07-trip-route-arrows-design.md`, which listed loops as a non-goal for exactly this
reason) can't draw LA → San Diego → LA → South Lake Tahoe.

## Goals

1. A trip can hold several **visits** to the same place, each with its own date.
2. A repeat visit is only ever added deliberately, with an explicit button (never by a status tap).
3. The route arrows run through visits, so a place can appear in the route more than once.

## Non-goals

- Editing a visit's date in place. To fix one, remove it (✕) and add it again.
- Showing a place more than once in the trip's place list. It stays grouped by country, once per
  place, sorted by its first visit. The route map is where the order shows.
- Repeat visits for directly-attached countries or subdivisions get no special treatment. They have
  no point on the map anyway.

## Design

### Data: one `TripEntry` row per visit

No Dexie change: `tripEntries` is keyed by `id`, and nothing indexes the trip + place pair.

`@/domain/tripRepo`:

- `attachEntryToTrip(tripId, entryId, visitedDate)` (via `autoAttachToCapturingTrip`, from every
  status tap while capturing) creates the place's **first** visit when it has no live one on the
  trip. If it already has one, it does nothing: a status tap no longer moves an existing visit's
  date.
- `addVisit(tripId, entryId, visitedDate)`: always creates a new visit.
- `removeVisit(tripEntryId)`: soft-deletes that one visit. Replaces `detachEntryFromTrip`.
- `tripAttachmentsForEntry(entryId)`: returns one row per visit, now carrying `tripEntryId`.
- `countTripPlaces(tripId)`: the number of distinct places with a live visit, used by the active-trip
  banner and the Trips tab instead of counting rows.
- `nextBackfillDate` works per row unchanged: it chains off the most recently added visit.

### Place sheet

- While a trip is capturing, the date field always offers the default for a *new* visit (the
  backfill chain date, or today if that setting is on), whether or not the place is already on the
  trip. Without a capturing trip it shows the place's own date, as before.
- When the place already has a visit on the capturing trip, an **"Add another visit to ‹trip›"**
  button under the date field calls `addVisit` with the field's date, then closes the sheet. It is
  disabled while the date field is empty.
- The Trips list shows one line per visit (trip name + date), each with its own ✕ (`removeVisit`).

### Route and itinerary

- `TripPlaceRow` gains `visits: readonly { visitedDate: string | null; addedAt: number }[]`, this
  place's visits on this trip. `TripPlacesInput` gains an optional
  `visits?: ReadonlyMap<entryId, visit[]>`. When it's absent, a row's `visits` is the single visit
  formed from its own `visitedDate` / `addedAt`, so existing callers and tests keep working.
- `tripPlacesRepo.resolveGroups` builds `visits` from the trip's rows. The `visitedDates` map it
  passes becomes each place's **earliest** dated visit, and `addedAts` its earliest `addedAt`, so
  the itinerary sorts a place by its first visit.
- `tripRoute` makes one stop per dated visit of a row with coordinates. Stops are sorted by date,
  then by `addedAt`. A zero-length leg (the same place twice in a row) is already dropped by
  `legPath`.

### Sync

- `dedupeTripEntries` in `@/sync/merge` keys on trip + place + `visitedDate` instead of trip +
  place. The same visit added offline on two devices still collapses into one; visits on different
  dates both survive.
- A not-yet-updated client still dedupes on trip + place, and would collapse visits back to one on
  its next sync. `SYNC_SCHEMA_VERSION` goes 3 → 4 so it refuses the newer doc and says "update the
  app" instead.

## Testing

- `tripRoute.test.ts`: a place visited twice appears twice in the route, in date order.
- `tripPlaces.test.ts`: `visits` comes from the `visits` map when given, and defaults to the row's
  own single visit otherwise.
- `merge.test.ts`: the same visit from two devices collapses; the same place on different dates
  survives as two visits.
- Manual (preview): a backfill trip LA → San Diego → LA (added with "Add another visit") → South
  Lake Tahoe draws arrows in that order; screenshot.
