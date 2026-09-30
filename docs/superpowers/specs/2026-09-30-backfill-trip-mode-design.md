# Log a past trip: backfill mode via the Places tab

## Problem

The just-shipped "Log a past trip" flow (see
[2026-09-30-log-past-trip-countries-design.md](2026-09-30-log-past-trip-countries-design.md), now
superseded by this spec) collects a start and end date upfront, then lets you add *countries only*
through an inline picker in the trip form. That's too narrow — a real backfilled trip needs cities,
towns, and subdivisions too, exactly like the Places tab already supports for a live trip.

The Places tab already has everything needed for rich place entry (search, manual add, status +
date per place) and a live trip already auto-attaches anything you touch while it's running
(`autoAttachToActiveTrip`, called from `cascadeRepo.setPlaceStatus`). The gap is just: that
auto-attach only fires for a trip that's genuinely *live* (`isActive`), and nothing chains a
sensible date for a place being entered well after the fact.

## Goals

1. "Log a past trip" starts a lightweight capture session (name + start date only) instead of
   collecting the whole date range upfront.
2. While that session is open, using the Places tab exactly as normal — search, manual add, status
   sheet, for countries, subdivisions, *and* cities — attaches each touched place to the trip, the
   same way a live trip already does.
3. Each place's date defaults sensibly without retyping: the first place defaults to the trip's
   start date; every place after that defaults to the previously-touched place's date. Freely
   editable per place, same as before.
4. An explicit "End past trip" action closes the session, prompting for an end date (defaulted
   sensibly) before finalizing.

## Non-goals

- No "resume backfilling" after a backfill session has been ended — reopening an already-closed trip
  (the existing "Reopen trip" action) always resumes it as a *live* trip, same as today. If dates need
  fixing after the fact, that's what "Edit" is for.
- No support for two capturing trips at once (one live + one backfilling, or two backfills). Only one
  trip — live or backfilling — captures at a time, exactly like today's "only one active trip" rule,
  just widened to cover both modes.
- No persisted memory of "this trip was backfilled" once it's closed — an ended backfill trip is
  stored identically to a normally-closed live trip (`isBackfilling: false`, `endDate` set). Nothing
  downstream needs to tell the two apart after the fact.
- The inline country-only picker this supersedes (`TripCountryPicker.tsx`, `tripCountryDefaults.ts`,
  and the end-date-mirrors-start-date behavior in `TripForm.tsx`) is deleted, not kept alongside this.

## Design

### 1. Data model: `isBackfilling`

`Trip` (`db/types.ts`) gains one new field:

```ts
export interface Trip extends SyncedRecord {
  name: string
  startDate: string | null
  endDate: string | null
  isActive: boolean
  isBackfilling: boolean // new
  notes: string
  coverPhotoId: string | null
}
```

No Dexie schema/version bump is needed — `trips: 'id, isActive, updatedAt'` only declares *indexed*
fields, and `isBackfilling` isn't queried by index (same precedent as `Entry.explicitStatus`, added
without a version bump for the same reason). Every existing trip gets `isBackfilling: false` implicitly
(Dexie returns `undefined` for a missing field on old rows; treated as falsy everywhere it's read —
consistent with how the rest of this codebase already tolerates missing fields on old rows).

**"Capturing"** means `isActive || isBackfilling`. At most one trip is ever capturing, enforced the
same way `isActive` is enforced today: a conflict check before starting or reopening either kind.

### 2. `domain/tripRepo.ts` changes

- **`getCapturingTrip(): Promise<Trip | null>`** replaces `getActiveTrip()` as the conflict/auto-attach
  lookup — returns the one trip (if any) with `isActive || isBackfilling`. `getActiveTrip()` itself is
  deleted; nothing needs "specifically the live one" once callers work in terms of "capturing."
- **`createTrip`** signature changes from `{name, startDate, endDate}` to a `mode`:

  ```ts
  export type CaptureMode = 'live' | 'backfill'

  export interface CreateTripInput {
    name: string
    startDate: string
    mode: CaptureMode
    notes?: string
  }

  export async function createTrip(input: CreateTripInput, resolution?: ActiveTripConflictResolution): Promise<Trip> {
    const capturing = await getCapturingTrip()
    if (capturing) {
      if (!resolution) throw new Error('Another trip is capturing — resolve the conflict first')
      await resolveConflict(capturing, resolution)
    }
    return tripsRepo.create({
      name: input.name,
      startDate: input.startDate,
      endDate: null,
      isActive: input.mode === 'live',
      isBackfilling: input.mode === 'backfill',
      notes: input.notes ?? '',
      coverPhotoId: null,
    })
  }
  ```

  Every new trip starts with `endDate: null` — the "retroactive, already-closed" creation path
  (`endDate` present at creation) is gone; a trip only gets an `endDate` by being closed (live) or
  ended (backfill) or edited.
- **`resolveConflict`** generalizes from "the active trip" to "the capturing trip," clearing both flags:

  ```ts
  async function resolveConflict(capturing: Trip, resolution: ActiveTripConflictResolution): Promise<void> {
    if (resolution === 'close') {
      await tripsRepo.update(capturing.id, { isActive: false, isBackfilling: false, endDate: capturing.endDate ?? today() })
    } else {
      await tripsRepo.update(capturing.id, { isActive: false, isBackfilling: false })
    }
  }
  ```

  "Leave open, just switch" now also stops backfilling without setting an end date — same as it
  already does for a live trip left open elsewhere; the trip simply stops being anyone's auto-attach
  target until reopened/resumed by hand via "Edit".
- **`closeTrip`** unchanged (still the live-trip path).
- **New `endBackfill(tripId: string, endDate: string): Promise<void>`** — the backfill equivalent of
  `closeTrip`, but `endDate` is required (no `today()` fallback — see §5, the dialog always supplies one):

  ```ts
  export async function endBackfill(tripId: string, endDate: string): Promise<void> {
    await tripsRepo.update(tripId, { isBackfilling: false, endDate })
  }
  ```
- **`reopenTrip`** unchanged in behavior (always resumes as live), but its own conflict check switches
  from `getActiveTrip()` to `getCapturingTrip()` so reopening while a backfill is in progress also
  triggers the conflict dialog.
- **`autoAttachToActiveTrip`** renamed **`autoAttachToCapturingTrip`**, body changes `getActiveTrip()` →
  `getCapturingTrip()`. Called from the exact same place in `cascadeRepo.setPlaceStatus` — no change
  to *when* it fires, only *which* trip it can find.
- **New `nextBackfillDate(tripId: string, startDate: string): Promise<string>`** — the backfill
  equivalent of the just-deleted `nextCountryRowDate`, but reading from Dexie instead of in-memory rows:

  ```ts
  export async function nextBackfillDate(tripId: string, startDate: string): Promise<string> {
    const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
    if (rows.length === 0) return startDate
    const latest = rows.reduce((a, b) => (a.addedAt > b.addedAt ? a : b))
    const entry = await db.entries.get(latest.entryId)
    return entry?.firstVisited ?? startDate
  }
  ```

  "Latest" means most-recently-*attached* (by `tripEntries.addedAt`), not latest by date value —
  matching the just-removed picker's chaining rule (chain off the last thing you touched, not the
  latest date typed). If that entry has no `firstVisited` (cleared, or never set), falls back to the
  trip's start date, same fallback shape as before.

### 3. `PlaceStatusSheet.tsx` — the date-chaining + note

Two additions, both gated on `useLiveQuery(getCapturingTrip)` returning a trip with
`isBackfilling: true`:

- In the existing date-default `useEffect` (currently: prefill from `entry.firstVisited`, else
  `todayISO()` if `settings.defaultDateToToday` and no entry yet), add a branch **ahead of** the
  `defaultDateToToday` check: if backfilling and there's no existing entry, resolve
  `nextBackfillDate(capturingTrip.id, capturingTrip.startDate)` and use that (marked `dateTouched`,
  same as the `defaultDateToToday` branch, so a bare status tap saves the chained date without the
  user re-touching the field). Backfill context wins over the `defaultDateToToday` setting when both
  would apply — being mid-backfill is a much stronger signal than the general preference.
- A small note near the date field, shown only while backfilling: `Backfilling "{trip.name}"` (plain
  text, same visual weight as the existing "Currently Visited — because..." line), so the pre-filled
  past date has an obvious explanation instead of looking arbitrary.

No change to the trip-toggle list, to `pick()`, or to how attachment happens — `setPlaceStatus` →
`autoAttachToCapturingTrip` (§2) already covers attaching on save, for country/subdivision/city alike,
because every place kind flows through this one function already.

### 4. `TripForm.tsx` — revert to two variants

Drops `requireEndDate`, `countries`, and the end-date-mirroring behavior entirely — back to close to
its original shape, with one small addition: a `mode?: 'live' | 'backfill'` prop, meaningful only when
`showEndDate={false}`, that selects which hint line renders under the date field:

- `mode: 'live'` (or omitted, existing default): *"This starts the trip now — every place you add
  from here on attaches to it automatically."* (unchanged wording)
- `mode: 'backfill'`: *"Every place you add from here on (search it in Places, same as always) attaches
  to this trip, with the date suggested from the last one — until you end it."*

`TripFormValues` drops `countries`:

```ts
export interface TripFormValues {
  name: string
  startDate: string
  endDate: string | null
}
```

`showEndDate={true}` (the plain-edit variant used by `TripDetail`'s "Edit") is untouched — still
name + start + end, no hint, no picker; it was never part of the picker/mirroring behavior being
removed.

### 5. `TripDetail.tsx` — 3-way lifecycle + new end dialog

The single lifecycle button becomes a 3-way branch on the trip's state:

```tsx
{trip.isActive ? (
  <button onClick={() => void run(() => closeTrip(trip.id))}>Close trip</button>
) : trip.isBackfilling ? (
  <button onClick={() => setShowEndBackfill(true)}>End past trip</button>
) : (
  <button onClick={() => void handleReopenTapped()}>Reopen trip</button>
)}
```

The dates line gains a third state: `trip.endDate ? ... : trip.isActive ? 'ONGOING' : trip.isBackfilling ? 'BACKFILLING' : '—'`.

New component **`EndBackfillDialog.tsx`** (same small-dialog family as `TripConflictDialog.tsx` —
backdrop + centered panel, not a full-screen overlay): one `DateField` for the end date, pre-filled via
`nextBackfillDate(tripId, trip.startDate)` on open, Confirm (calls `endBackfill(tripId, date)`) and
Cancel. This is the "smart default, adjustable" behavior you chose over closing silently.

`handleReopenTapped`'s conflict check switches to `getCapturingTrip()` (§2).

### 6. `TripsScreen.tsx` — Capturing section + Past filter

The "Active" section becomes "Capturing," sourced from `getCapturingTrip()`-equivalent
(`trips.find(t => t.isActive || t.isBackfilling)`, consistent with how the screen already loads all
trips via `useLiveQuery` and filters in memory rather than re-querying):

- Live: unchanged card — `{name} · Day {tripDurationDays(trip)} · started {formatLongDate(startDate)}`.
- Backfilling: `{name} · Backfilling since {formatLongDate(startDate)} · {placeCount} {placeCount === 1 ? 'place' : 'places'}` —
  no day count (a fixed-in-the-past start date has no meaningful "how many days so far" the way a live
  trip's does). `placeCount` computed the same way `ActiveTripBanner` already computes it (count of
  non-deleted `tripEntries` rows for the trip).

Both variants tap through to `TripDetail`, same as today.

`handleStartTapped` (→ "Start a trip") and the new `handleLogPastTapped` (→ "Log a past trip") both
check `getCapturingTrip()` and show `TripConflictDialog` on conflict, then open `TripForm` with
`showEndDate={false}` and the appropriate `mode`. Their submit handlers both become one-liners:

```ts
async function submitStart(values: TripFormValues) {
  await createTrip({ name: values.name, startDate: values.startDate, mode: 'live' }, pendingResolution)
  setFormMode(null)
  setPendingResolution(undefined)
}

async function submitLogPast(values: TripFormValues) {
  await createTrip({ name: values.name, startDate: values.startDate, mode: 'backfill' }, pendingResolution)
  setFormMode(null)
  setPendingResolution(undefined)
}
```

(The conflict-resolution plumbing — `pendingResolution`, `conflictTripName` — already exists for
`start`; it's reused for `logPast` too instead of being a `start`-only path, since both can now hit
the same conflict.)

The `past` list filter changes from `!t.isActive` to `t.endDate !== null` — a trip with no end date
yet (live or backfilling) must never show in Past, whereas today an in-progress backfill (created with
both dates already, old flow) never had this problem because it never existed in an "open, not active"
state.

### 7. `ActiveTripBanner.tsx` — generalize to capturing

Renamed in spirit (file can keep its name, or move to `CapturingTripBanner.tsx` — implementer's call,
not load-bearing) — queries `getCapturingTrip()` instead of `getActiveTrip()`, and branches the
displayed text the same way as the Trips-tab card in §6: live keeps today's `Day N` copy, backfilling
shows `Backfilling {name} · {placeCount} {places}`. Tapping either opens `TripDetail`, unchanged.

### 8. Deletions

- `atlas/src/components/trips/TripCountryPicker.tsx`
- `atlas/src/components/trips/TripCountryPicker.css`
- `atlas/src/domain/tripCountryDefaults.ts`
- `atlas/src/domain/tripCountryDefaults.test.ts`

And the country-loop in the old `submitLogPast` (`setPlaceStatus` + `attachEntryToTrip` per row) is
gone — replaced by the one-liner in §6, since attachment now happens automatically as places are
touched in the Places tab, not as a batch at submit time.

## Testing

- Unit-level: none of this session's new logic is pure. `nextBackfillDate` reads `db.tripEntries`/
  `db.entries` directly, same as every other function in `tripRepo.ts` and `cascadeRepo.ts`
  (`attachEntryToTrip`, `getActiveTrip`/`getCapturingTrip`, `setPlaceStatus`, ...) — none of which have
  unit tests today. There is no `fake-indexeddb` dependency or IndexedDB shim anywhere in this project,
  and `vitest.config.ts` runs under `environment: 'node'` with no such shim configured; adding one
  would be new test infrastructure the rest of the Dexie-facing layer doesn't have either. Consistent
  with that existing convention, `nextBackfillDate` and the other `tripRepo.ts` changes are verified
  manually, same as their neighbors.
- Manual verification in the running app (dev server): start a backfill, add a country via search, a
  manual city, and a subdivision-bearing city across a few Places-tab visits, confirm each date
  chains from the last, confirm the Trips-tab card and the global banner both show "Backfilling," end
  it with the smart-defaulted date, and confirm it now appears correctly in Past with all the places
  attached (mirroring the verification steps already run for the superseded design, extended to
  cities/subdivisions and to the new start/end flow).
