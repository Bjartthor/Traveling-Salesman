# Log a past trip: end-date default + inline country picker

## Problem

Logging a past trip via "Log a past trip" ([TripsScreen.tsx](../../../atlas/src/screens/TripsScreen.tsx)) requires picking both a start and end date, often years in the past — the end-date picker currently defaults to today, so backfilling an old trip means navigating the native date picker back years on *both* fields.

Attaching the countries visited on that trip is also multi-step today: the trip is never `isActive` (retroactive trips never become the active trip — see [tripRepo.ts](../../../atlas/src/domain/tripRepo.ts) `createTrip`), so `autoAttachToActiveTrip` never fires for it. The only way to attach a place to a past trip is to go to the Places tab, search the place, set its status/date in [PlaceStatusSheet.tsx](../../../atlas/src/components/places/PlaceStatusSheet.tsx), then toggle the trip on in that sheet — once per country.

## Goals

1. In the "Log a past trip" form, the end-date field should default to wherever the start date is, so backfilling an old trip doesn't mean scrolling back years twice.
2. The same form should let you add the countries visited on that trip directly, each with its own status and date, without leaving the form or visiting the Places tab separately.
3. Each added country's date should default sensibly — first country from the trip's start date, each next country from the previous one's date — while staying freely editable per row.

## Non-goals

- No change to "Start a trip" (no end date field at all) or to plain trip editing (`showEndDate=true, requireEndDate=false`) — the country picker and end-date-follows-start-date behavior are scoped to the past-trip variant only.
- No city-level picking in this form — countries only, matching what was asked for. Cities for a past trip are still added via the Places tab as today.
- No retroactive re-chaining: editing an already-added row's date does not change sibling rows, only the default offered to the *next* row you add.
- No bulk-import/paste flow for countries (that's [BulkAddScreen.tsx](../../../atlas/src/components/places/BulkAddScreen.tsx)'s job, and it doesn't do per-item dates) — this is a small, deliberate add-a-few-countries list.

## Design

### 1. End date follows start date until touched

`TripForm` ([TripForm.tsx](../../../atlas/src/components/trips/TripForm.tsx)) currently initializes `endDate` to `null`. For the past-trip variant (`showEndDate && requireEndDate`):

- `endDate` initializes to `startDate`'s initial value instead of `null`.
- Track whether the end-date field has been touched directly (a new `endDateTouched` boolean, same pattern as `dateTouched` in `PlaceStatusSheet`).
- While `endDateTouched` is false, changing `startDate` also updates `endDate` to match.
- The moment the user edits the end-date field themselves, `endDateTouched` becomes true and the mirroring stops for the rest of the form's lifetime.

This only changes behavior for the past-trip variant; `showEndDate=false` has no end date field, and plain editing (`requireEndDate=false`) already starts from the trip's real `endDate` (which is non-null for a closed trip, or the user explicitly manages it via close/reopen elsewhere), so the mirroring condition (`endDate === null` at mount and untouched) won't spuriously kick in there.

### 2. Countries section (past-trip variant only)

A new subsection appears in the past-trip form, below the date fields, gated on the same `showEndDate && requireEndDate` condition. New component: `TripCountryPicker.tsx` in `atlas/src/components/trips/`, kept separate from `TripForm.tsx` to keep that file focused (matching the existing pattern where `ManualPlaceForm`/`PlaceSearch` are their own components).

**Row list.** Each added country renders as a compact row:
- Country flag + name (via the existing `CountryFlag` component)
- A status `<select>` (Visited / Lived / Transit / Wishlist, from `STATUS_ORDER`/`STATUS_LABEL` in `@/domain/cascade` and `@/components/map/statusColor`) — defaults to "Visited"
- A `DateField`, defaulted per the chaining rule below
- A remove ("×") button

**Add-country search.** Below the row list, an "Add a country" text input filters `db.countries` by name/code (same filter logic as `ManualPlaceForm`'s country search — substring match via `normalize`), rendered as a short flag + name list. Countries already added to this form's list are excluded from the results (dedupe by country code, same idea as `PlaceSearch`'s local/online dedupe). Picking a result appends a new row and clears the search query.

**Date chaining.** When a new row is appended:
- If it's the first row, its date defaults to the form's current `startDate`.
- Otherwise, its date defaults to the *previous row's current date value* (whatever that row's date is at the moment the new one is added — not re-derived later).

This default is only computed once, at the moment the row is created; it's a normal, freely-editable `DateField` after that, exactly like the start/end date fields. Editing an earlier row never touches rows added before it.

**State shape.** `TripCountryPicker` owns an array of rows: `{ code: string; status: Status; date: string | null }[]`, lifted into `TripForm`'s state and passed down/up via props (`countries`, `onChange`), the same lifted-state pattern `TripForm` already uses for its own fields.

### 3. Data flow on submit

`TripFormValues` gains an optional field:

```ts
export interface TripFormValues {
  name: string
  startDate: string
  endDate: string | null
  countries?: { code: string; status: Status; date: string | null }[]
}
```

`TripForm` includes `countries` in the submitted values only when the picker is shown (past-trip variant); other variants omit it.

`TripsScreen.submitLogPast` (already the caller that does `createTrip`) is extended: after `createTrip` resolves, loop over `values.countries` and, for each row, call:

```ts
await setPlaceStatus({ kind: 'country', refId: row.code, status: row.status, firstVisited: row.date, lastVisited: row.date })
const entry = await db.entries.where('[kind+refId]').equals(['country', row.code]).first()
if (entry) await attachEntryToTrip(trip.id, entry.id)
```

This mirrors exactly what `PlaceStatusSheet`'s trip-toggle does today, just run automatically for each picked country instead of requiring a manual visit to the Places tab per country. `setPlaceStatus` already runs each call in its own transaction (see `cascadeRepo.ts`), so this is a sequence of small atomic writes, not one big transaction — consistent with how `BulkAddScreen.commit()` already does its per-line loop.

**Error handling.** No new error-recovery machinery: if a `setPlaceStatus`/`attachEntryToTrip` call throws mid-loop, it surfaces through `TripForm`'s existing `try/catch` (the same one that already wraps `onSubmit`), showing the existing inline error banner. The trip itself is already created and won't be re-created on a retry (the form doesn't re-invoke `createTrip` on error — only `TripsScreen` calling code would need to guard against a literal second submit, which the existing `pending`-disabled submit button already prevents while a submit is in flight). This is the same risk profile `createTrip` itself already has with no rollback; not addressing it further is consistent with the rest of the codebase.

## Testing

- Unit-level: none of this introduces new pure logic worth isolating beyond what's already covered (`cascade.ts`/`cascadeRepo.ts` tests already cover `setStatus`); the new code is UI state (row list, chained defaults) best verified by exercising the form.
- Manual verification in the running app (dev server): open "Log a past trip", confirm end date mirrors start date until touched, add 2-3 countries and confirm date chaining, submit, and confirm the trip's stamp/detail view shows the countries attached with the right status and dates.
