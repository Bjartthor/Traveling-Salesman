# Edit a past trip: add places, edit visit dates

## Problem

A finished trip can only have its name and dates edited. Adding a place means **Reopen trip**,
which turns it back into a *live* trip: it clears the end date and defaults new places to today's
date. There's no way to insert, say, a second LA visit on 16 June into a trip already logged, and a
visit's date can't be corrected without removing the visit and adding it again.

## Goals

1. Add places, and extra visits, to a past trip at any date, including in the middle of it, and
   have its route, place order and stats follow.
2. A trip's start/end dates stretch to cover any visit dated outside them.
3. Edit an existing visit's date in place.

## Non-goals

- Shrinking trip dates when a visit is removed or moved inward. Dates only widen; **Edit** sets them
  by hand.
- Ordering same-day visits by hand. They keep following the order they were added
  (`2026-10-07-trip-route-arrows-design.md`).
- A separate add-place form inside the trip page. Adding goes through the existing capture flow.

## Design

### 1. "Add places": resume a past trip as backfill

- `tripRepo.resumeBackfill(tripId, resolution?)` sets `isBackfilling: true, isActive: false` and
  **keeps** `endDate`. "Only one capturing trip" is enforced the same way `reopenTrip` does it:
  without a `resolution`, it throws if another trip is capturing.
- `TripDetail`: a past trip (neither active nor backfilling) shows **Add places** next to
  **Reopen trip**. A capturing-trip conflict goes through the existing `TripConflictDialog`, which
  now remembers which action asked (reopen or add places).
- While backfilling, places are added exactly as when the trip was first logged: map taps, search,
  the place sheet's date field, **Add another visit**. Nothing new is needed there.
  `nextBackfillDate` offers the date of the most recently added visit, and the user sets the
  mid-trip date in the field. A visit's place in the route and itinerary comes from its own date,
  not from when it was added, so a mid-trip date lands mid-trip.
- Finishing: a backfilling trip that already has an `endDate` (a resumed one) shows **Done adding
  places**, which calls `endBackfill(tripId, trip.endDate)` with no dialog. A new backfill trip (no
  end date yet) keeps **End past trip** and its end-date dialog.

### 2. Trip dates stretch to cover visits

- Pure `stretchTripDates({ startDate, endDate }, date)` in `src/domain/tripDates.ts` returns the
  patch, or `null` when nothing changes:
  - `startDate` moves to `date` when it's null or later than `date`;
  - `endDate` moves to `date` only when it's set and earlier than `date`. An open trip (`endDate`
    null) stays open.
- `tripRepo.addVisit`, and through it the first-visit `attachEntryToTrip`, applies it after
  writing the visit. So does the new `setVisitDate`. Each runs in one transaction over `trips`,
  `tripEntries` and `syncState`, nested inside `setPlaceStatus`'s own when called from there.

### 3. Edit a visit's date in place

- `tripRepo.setVisitDate(tripEntryId, date | null)` updates that visit and stretches its trip. A
  null date makes the visit undated: it stays on the trip but drops out of the route.
- In the place sheet's Trips list, each visit's date is a `DateField` that saves on change, for any
  trip, capturing or not.

### Updates

`TripDetail` reads everything through one `useLiveQuery`, so the route arrows, itinerary order,
duration and "new to you" all recompute when a visit or the trip's dates change.

## Testing

- `tripDates.test.ts`: earlier date moves start; later date moves end; an open trip keeps no end
  date; an in-range date returns null; a trip with no start takes the date.
- Manual (preview): build a California backfill trip LA (1 Jun) → San Diego (14 Jun) → Tahoe
  (10 Jul) and finish it. Then **Add places**, add a second LA visit dated 16 Jun, **Done adding
  places**; the route reads LA → San Diego → LA → Tahoe. Adding a place dated 20 Jul stretches the
  end date; editing a visit's date in the sheet re-orders the route.
