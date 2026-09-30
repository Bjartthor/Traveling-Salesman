# Log a past trip: backfill mode via the Places tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the country-only inline picker in "Log a past trip" with a "backfill mode": start a session with just a name + start date, then use the Places tab exactly as normal (countries, subdivisions, cities) — every place touched auto-attaches to the trip with a date chained from the previous one — until you explicitly end it.

**Architecture:** One new `Trip.isBackfilling` field generalizes "the trip currently capturing places" (`isActive || isBackfilling`) so the existing auto-attach-on-touch mechanism (`cascadeRepo.setPlaceStatus` → `tripRepo`) covers backfill mode for free, for every place kind. `PlaceStatusSheet` gains the one genuinely new behavior: defaulting a new place's date from the trip's start date or the previously-touched place's date while backfilling. `TripForm` reverts to its pre-session shape (no picker, no end-date-mirroring); `TripsScreen`/`TripDetail`/`ActiveTripBanner` gain a "Capturing" concept that branches copy between live and backfill.

**Tech Stack:** React (function components, hooks), TypeScript, Dexie (IndexedDB) via `dexie-react-hooks`' `useLiveQuery`, Vitest for pure-logic tests (none of this plan's new code is pure — see Global Constraints).

## Global Constraints

- This session's inline country picker (`TripCountryPicker.tsx/.css`, `tripCountryDefaults.ts/.test.ts`, and `TripForm`'s end-date-mirroring/`countries` prop) is deleted, not kept alongside the new flow.
- "Capturing" = `isActive || isBackfilling`; at most one trip is ever capturing, app-wide — the existing one-active-trip conflict check generalizes to cover both.
- Reopening an ended trip (the existing "Reopen trip" action) always resumes it as **live**, never re-enters backfill mode — unchanged behavior, no new code needed for this.
- No new test tooling: every function this plan adds or changes in `tripRepo.ts` touches Dexie directly (`db.trips`, `db.tripEntries`, `db.entries`) and is therefore impure, exactly like its existing neighbors (`attachEntryToTrip`, `closeTrip`, ...) — none of which have unit tests. `atlas/vitest.config.ts` runs under `environment: 'node'` with no IndexedDB shim (`fake-indexeddb` is not a dependency), so this plan verifies the Dexie-facing layer manually, same as the rest of it.
- Full path prefix for all files below: `atlas/` (repo root is `/home/bjartthor/BSA/Traveling_Salesman`).
- Reference: [docs/superpowers/specs/2026-09-30-backfill-trip-mode-design.md](../specs/2026-09-30-backfill-trip-mode-design.md).

---

### Task 1: Core rewrite — data model, `tripRepo.ts`, and every call site it breaks

This is the one necessarily-atomic task: `Trip.isBackfilling`, `tripRepo.ts`'s renamed/reshaped
functions, and every file that calls those functions all have to land together for the project to
typecheck at all — a half-renamed `getActiveTrip` → `getCapturingTrip` isn't independently
reviewable or shippable. Later tasks build genuinely new, additive behavior on top of this green
baseline.

**Files:**
- Modify: `atlas/src/db/types.ts` (`Trip` interface)
- Modify: `atlas/src/domain/tripRepo.ts` (full rewrite)
- Modify: `atlas/src/domain/cascadeRepo.ts` (import rename only)
- Modify: `atlas/src/components/trips/TripForm.tsx` (revert to pre-session shape + `mode` prop)
- Modify: `atlas/src/screens/TripsScreen.tsx` (full rewrite)
- Modify: `atlas/src/components/trips/TripDetail.tsx:15,112` (rename only — `getActiveTrip` → `getCapturingTrip`; the 3-way lifecycle button and `EndBackfillDialog` come in Task 2)
- Modify: `atlas/src/components/trips/ActiveTripBanner.tsx:9,17` (rename only — backfill copy comes in Task 3)
- Modify: `atlas/src/components/photos/PhotoImportFlow.tsx:19,225` (`createTrip` → `createClosedTrip` — see Step 5a below; this call site infers a trip's full date range from photo EXIF data, so it was never part of the interactive capturing flow this task reshapes)
- Delete: `atlas/src/components/trips/TripCountryPicker.tsx`
- Delete: `atlas/src/components/trips/TripCountryPicker.css`
- Delete: `atlas/src/domain/tripCountryDefaults.ts`
- Delete: `atlas/src/domain/tripCountryDefaults.test.ts`

**Interfaces:**
- Consumes: nothing new from outside this task.
- Produces: `getCapturingTrip(): Promise<Trip | null>`, `CaptureMode = 'live' | 'backfill'`,
  `createTrip(input: {name, startDate, mode: CaptureMode, notes?}, resolution?): Promise<Trip>`,
  `createClosedTrip(input: {name, startDate, endDate: string, notes?}): Promise<Trip>`,
  `endBackfill(tripId: string, endDate: string): Promise<void>`,
  `nextBackfillDate(tripId: string, startDate: string): Promise<string>`,
  `autoAttachToCapturingTrip(entryId: string): Promise<void>` — all from `@/domain/tripRepo`, all
  consumed by Task 2 (`TripDetail`'s `EndBackfillDialog`), Task 3 (`ActiveTripBanner`), and Task 4
  (`PlaceStatusSheet`), except `createClosedTrip`, consumed only by `PhotoImportFlow.tsx` (this
  task). `TripForm`'s new `mode?: 'live' | 'backfill'` prop and reverted `TripFormValues`
  (`{name, startDate, endDate}`, no `countries`) are consumed by `TripsScreen.tsx` (this task) and
  unchanged by `TripDetail.tsx`'s existing "Edit" call (which never used `mode` or `countries`).

- [ ] **Step 1: Delete the superseded picker files**

```bash
git rm atlas/src/components/trips/TripCountryPicker.tsx atlas/src/components/trips/TripCountryPicker.css atlas/src/domain/tripCountryDefaults.ts atlas/src/domain/tripCountryDefaults.test.ts
```

- [ ] **Step 2: Add `isBackfilling` to `Trip`**

In `atlas/src/db/types.ts`, replace:

```ts
export interface Trip extends SyncedRecord {
  name: string
  startDate: string | null
  endDate: string | null
  isActive: boolean
  notes: string
  coverPhotoId: string | null
}
```

with:

```ts
export interface Trip extends SyncedRecord {
  name: string
  startDate: string | null
  endDate: string | null
  isActive: boolean
  // "Capturing" = isActive || isBackfilling; @/domain/tripRepo enforces that
  // at most one trip is ever capturing. No Dexie version bump needed here —
  // only indexed fields need declaring (see `trips: 'id, isActive, updatedAt'`
  // in db/schema.ts), same precedent as `explicitStatus` above.
  isBackfilling: boolean
  notes: string
  coverPhotoId: string | null
}
```

- [ ] **Step 3: Rewrite `tripRepo.ts`**

Replace the full contents of `atlas/src/domain/tripRepo.ts` with:

```ts
// The Dexie-facing half of trip lifecycle (05-trips.md task 1, extended for
// backfill mode — see docs/superpowers/specs/2026-09-30-backfill-trip-mode-design.md).
// Trip/tripEntries writes go through @/db/repo like everything else, but the
// lifecycle rules (only one capturing trip, auto-attach on a touched entry,
// soft-delete never touching places) live here, one level up.
//
// `cascadeRepo.ts` calls `autoAttachToCapturingTrip` from inside its own
// transaction after every `setPlaceStatus`, so "a place touched while a trip
// is capturing attaches to it" is never a step a caller can forget — true for
// a live trip and a backfilling one alike.

import { db } from '@/db/schema'
import { tripEntriesRepo, tripsRepo } from '@/db/repo'
import type { Trip } from '@/db/types'
import { logInfo } from '@/debug/log'

export type ActiveTripConflictResolution = 'close' | 'leaveOpen'

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * The one trip currently capturing (live or backfilling), or null. "Only one
 * trip capturing at a time" is an app-level rule, not a DB constraint —
 * enforced by always routing through `createTrip`/`reopenTrip` below.
 *
 * Reads the (small) table directly rather than `where('isActive')`: IndexedDB
 * keys can't be booleans, so an index on a boolean column silently never
 * matches anything through Dexie's `where()` — harmless here since `trips`
 * stays small, but worth knowing before reaching for that index elsewhere.
 */
export async function getCapturingTrip(): Promise<Trip | null> {
  const capturing = await db.trips.filter((t) => t.deletedAt === null && (t.isActive || t.isBackfilling)).toArray()
  return capturing[0] ?? null
}

async function resolveConflict(capturing: Trip, resolution: ActiveTripConflictResolution): Promise<void> {
  if (resolution === 'close') {
    await tripsRepo.update(capturing.id, { isActive: false, isBackfilling: false, endDate: capturing.endDate ?? today() })
  } else {
    // "Leave the old one open" — still no end date, just no longer the one capturing.
    await tripsRepo.update(capturing.id, { isActive: false, isBackfilling: false })
  }
}

export type CaptureMode = 'live' | 'backfill'

export interface CreateTripInput {
  name: string
  startDate: string
  mode: CaptureMode
  notes?: string
}

/**
 * Every new trip starts open-ended (`endDate: null`) regardless of mode — a
 * trip only gets an end date by being closed (`closeTrip`), ended
 * (`endBackfill`), or edited by hand. `mode: 'live'` sets `isActive`;
 * `mode: 'backfill'` sets `isBackfilling`. Either way, if another trip is
 * already capturing, `resolution` is required (the caller must ask the user
 * first — see TripsScreen/TripConflictDialog).
 */
export async function createTrip(input: CreateTripInput, resolution?: ActiveTripConflictResolution): Promise<Trip> {
  void logInfo(`trip: create "${input.name}" (${input.mode})`)
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

export interface CreateClosedTripInput {
  name: string
  startDate: string
  endDate: string
  notes?: string
}

/**
 * A trip whose full date range is already known at creation — used by the
 * photo-import flow (`PhotoImportFlow.tsx`), which infers a trip's start and
 * end dates directly from photo EXIF timestamps, so there's nothing to
 * "capture" or backfill: never sets `isActive`/`isBackfilling`, so no
 * conflict with whatever else is capturing is possible. This is the one
 * remaining piece of the old (pre-backfill-mode) `createTrip`'s "`endDate`
 * present at creation" branch — split out on its own now that `createTrip`
 * itself is exclusively about starting a capturing session.
 */
export async function createClosedTrip(input: CreateClosedTripInput): Promise<Trip> {
  void logInfo(`trip: create closed "${input.name}"`)
  return tripsRepo.create({
    name: input.name,
    startDate: input.startDate,
    endDate: input.endDate,
    isActive: false,
    isBackfilling: false,
    notes: input.notes ?? '',
    coverPhotoId: null,
  })
}

/** One-tap action, same immediacy as the place-status sheet's status buttons. */
export async function closeTrip(tripId: string, endDate?: string): Promise<void> {
  await tripsRepo.update(tripId, { isActive: false, endDate: endDate ?? today() })
}

/** The backfill equivalent of `closeTrip` — `endDate` is required (no `today()` fallback): the caller (`EndBackfillDialog`) always supplies one, defaulted via `nextBackfillDate`. */
export async function endBackfill(tripId: string, endDate: string): Promise<void> {
  await tripsRepo.update(tripId, { isBackfilling: false, endDate })
}

/** Reversible close (05-trips.md task 1). Clears `endDate` — resuming capture means open-ended again until closed a second time. Always resumes as *live*, never back into backfill mode. */
export async function reopenTrip(tripId: string, resolution?: ActiveTripConflictResolution): Promise<void> {
  const capturing = await getCapturingTrip()
  if (capturing && capturing.id !== tripId) {
    if (!resolution) throw new Error('Another trip is capturing — resolve the conflict first')
    await resolveConflict(capturing, resolution)
  }
  await tripsRepo.update(tripId, { isActive: true, endDate: null })
}

export async function updateTrip(
  tripId: string,
  patch: Partial<Pick<Trip, 'name' | 'startDate' | 'endDate' | 'notes' | 'coverPhotoId'>>,
): Promise<void> {
  await tripsRepo.update(tripId, patch)
}

/**
 * Soft-deletes the trip only — never the places in it (00-PLAN.md §4,
 * 05-trips.md task 4). `tripEntries` rows are left exactly as they are; every
 * reader resolves a trip's places by joining through *active* entries, so a
 * deleted trip's membership rows simply stop being reachable from anywhere,
 * without a second delete path to keep in sync.
 */
export async function softDeleteTrip(tripId: string): Promise<void> {
  await tripsRepo.softDelete(tripId)
}

async function findTripEntryRow(tripId: string, entryId: string) {
  return db.tripEntries.filter((te) => te.tripId === tripId && te.entryId === entryId).first()
}

/** Idempotent — attaching an already-attached entry is a no-op; re-attaching a detached one revives its row rather than duplicating it. */
export async function attachEntryToTrip(tripId: string, entryId: string): Promise<void> {
  const existing = await findTripEntryRow(tripId, entryId)
  if (existing && existing.deletedAt === null) return
  if (existing) {
    await tripEntriesRepo.restore(existing.id, { tripId, entryId, addedAt: existing.addedAt })
    return
  }
  await tripEntriesRepo.create({ tripId, entryId, addedAt: Date.now() })
}

export async function detachEntryFromTrip(tripId: string, entryId: string): Promise<void> {
  const existing = await findTripEntryRow(tripId, entryId)
  if (existing && existing.deletedAt === null) await tripEntriesRepo.softDelete(existing.id)
}

/**
 * Called from `cascadeRepo.setPlaceStatus`, inside its own transaction, after
 * every direct status set — never for the ancestor entries the cascade
 * creates alongside it. This is what "attach at the city level; plus any
 * country added directly" (05-trips.md task 1) resolves to as one rule: the
 * *target* of a direct set attaches (city, subdivision or country alike),
 * whatever it implies upward does not. No-ops when no trip is capturing, or
 * when the place is already attached (re-touching an existing entry, e.g. a
 * second visit to a city already on this trip, is exactly the "existing
 * entries touched" case the brief calls out — attaching again is a harmless
 * no-op). Covers a live trip and a backfilling one identically — the only
 * difference between the two lives in what date `PlaceStatusSheet` offers as
 * a default before calling `setPlaceStatus`, not in attachment itself.
 */
export async function autoAttachToCapturingTrip(entryId: string): Promise<void> {
  const capturing = await getCapturingTrip()
  if (capturing) await attachEntryToTrip(capturing.id, entryId)
}

/**
 * The date offered for the next place touched while backfilling: the trip's
 * start date if nothing has been attached yet, otherwise the `firstVisited`
 * of whichever entry was *most recently attached* (by `tripEntries.addedAt`,
 * not by date value — chains off the last thing you touched, not the latest
 * date typed), falling back to the start date if that entry has no date.
 */
export async function nextBackfillDate(tripId: string, startDate: string): Promise<string> {
  const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
  if (rows.length === 0) return startDate
  const latest = rows.reduce((a, b) => (a.addedAt > b.addedAt ? a : b))
  const entry = await db.entries.get(latest.entryId)
  return entry?.firstVisited ?? startDate
}

/** Trip ids (active membership only) a given entry currently belongs to — for the place-status sheet's trip toggle. */
export async function tripIdsForEntry(entryId: string): Promise<Set<string>> {
  const rows = await db.tripEntries.filter((te) => te.entryId === entryId && te.deletedAt === null).toArray()
  return new Set(rows.map((r) => r.tripId))
}

export function listTrips(): Promise<Trip[]> {
  return tripsRepo.listActive()
}

/** Active (non-deleted) tripEntries rows for one trip, each carrying the entryId to resolve. */
export async function entryIdsForTrip(tripId: string): Promise<string[]> {
  const rows = await db.tripEntries.filter((te) => te.tripId === tripId && te.deletedAt === null).toArray()
  return rows.map((r) => r.entryId)
}
```

- [ ] **Step 4: Rename the import in `cascadeRepo.ts`**

In `atlas/src/domain/cascadeRepo.ts`, replace:

```ts
import { autoAttachToActiveTrip } from '@/domain/tripRepo'
```

with:

```ts
import { autoAttachToCapturingTrip } from '@/domain/tripRepo'
```

And replace the call site (inside `setPlaceStatus`):

```ts
    if (target) await autoAttachToActiveTrip(target.id)
```

with:

```ts
    if (target) await autoAttachToCapturingTrip(target.id)
```

And update the doc comment above `setPlaceStatus` that references it — replace:

```ts
/**
 * Set a place's status, creating and recomputing whatever it implies above
 * it. If a trip is currently active, also attaches the *target* entry (never
 * the ancestors this implies) to it — see @/domain/tripRepo.autoAttachToActiveTrip.
 */
```

with:

```ts
/**
 * Set a place's status, creating and recomputing whatever it implies above
 * it. If a trip is currently capturing (live or backfilling), also attaches
 * the *target* entry (never the ancestors this implies) to it — see
 * @/domain/tripRepo.autoAttachToCapturingTrip.
 */
```

- [ ] **Step 5: Fix `PhotoImportFlow.tsx`'s call site**

This flow infers a trip's full date range from photo EXIF timestamps before it ever calls
`createTrip` — it was relying on the old "`endDate` present means already-closed, no conflict"
branch, which is now `createClosedTrip` (Step 3 above). In
`atlas/src/components/photos/PhotoImportFlow.tsx`, replace:

```ts
import { createTrip } from '@/domain/tripRepo'
```

with:

```ts
import { createClosedTrip } from '@/domain/tripRepo'
```

And replace:

```ts
        const trip = await createTrip({ name: cluster.name.trim() || 'Trip', startDate: cluster.startDate, endDate: cluster.endDate })
```

with:

```ts
        const trip = await createClosedTrip({ name: cluster.name.trim() || 'Trip', startDate: cluster.startDate, endDate: cluster.endDate })
```

- [ ] **Step 6: Revert `TripForm.tsx` to its pre-session shape, plus a `mode` prop**

Replace the full contents of `atlas/src/components/trips/TripForm.tsx` with:

```tsx
// Trip create/edit form (05-trips.md task 1 "start a trip"/"retroactive
// trips" + task 4 "edit name, dates, cover photo"). Full-screen overlay,
// reusing the same shell as ManualPlaceForm/CountryDetail/BulkAddScreen.
//
// Two variants, one component: `showEndDate=false` is "starting a capture
// session now" — no end-date field at all, always produces an open-ended
// trip (`endDate: null`). Which lifecycle flag that trip gets (`isActive` vs
// `isBackfilling`) is entirely the caller's business (TripsScreen), decided
// via `createTrip`'s `mode` — this form only renders a different hint line
// depending on `mode`, purely cosmetic. `showEndDate=true` is plain editing
// of an existing trip's name/dates (TripDetail's "Edit"), which never
// touches `isActive`/`isBackfilling` at all (only the dedicated
// close/reopen/end-backfill actions do that) — the cover photo slot lives in
// TripDetail itself, wired but empty per 00-PLAN.md's Phase 6 hold-off.
//
// The only-one-trip-capturing conflict is resolved by the caller *before*
// opening this form (see TripsScreen/TripDetail) — that keeps this component
// a plain, un-nested form rather than one that has to pause mid-submit for a
// second dialog.

import { useState, type FormEvent } from 'react'
import { todayISO } from '@/domain/dateFormat'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { DateField } from '@/components/shared/DateField'
import './TripForm.css'

export interface TripFormValues {
  name: string
  startDate: string
  endDate: string | null
}

interface TripFormProps {
  title: string
  submitLabel: string
  showEndDate: boolean
  /** Only meaningful when `showEndDate` is false — selects which hint line renders under the date field. */
  mode?: 'live' | 'backfill'
  initial?: Partial<TripFormValues>
  onClose: () => void
  onSubmit: (values: TripFormValues) => Promise<void>
}

const HINT: Record<'live' | 'backfill', string> = {
  live: 'This starts the trip now — every place you add from here on attaches to it automatically.',
  backfill:
    'Every place you add from here on (search it in Places, same as always) attaches to this trip, with the date suggested from the last one — until you end it.',
}

export function TripForm({ title, submitLabel, showEndDate, mode, initial, onClose, onSubmit }: TripFormProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayISO())
  const [endDate, setEndDate] = useState<string | null>(initial?.endDate ?? null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setPending(true)
    try {
      await onSubmit({
        name: name.trim() || `Trip from ${startDate}`,
        startDate,
        endDate: showEndDate ? endDate : null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPending(false)
    }
  }

  return (
    <FullScreenOverlay title={title} onClose={onClose}>
      <form className="trip-form" onSubmit={(e) => void submit(e)}>
        <label className="trip-form__field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={`Trip from ${startDate}`}
            autoFocus
          />
        </label>

        <div className={showEndDate ? 'trip-form__dates' : undefined}>
          <div className="trip-form__field">
            <span>Start date</span>
            <DateField value={startDate} ariaLabel="Start date" onChange={(v) => v && setStartDate(v)} />
          </div>
          {showEndDate && (
            <div className="trip-form__field">
              <span>End date (optional)</span>
              <DateField value={endDate} ariaLabel="End date" min={startDate} onChange={setEndDate} />
            </div>
          )}
        </div>
        {!showEndDate && <p className="trip-form__hint">{HINT[mode ?? 'live']}</p>}

        {error && (
          <p className="trip-form__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="trip-form__submit" disabled={pending}>
          {submitLabel}
        </button>
      </form>
    </FullScreenOverlay>
  )
}
```

- [ ] **Step 7: Rewrite `TripsScreen.tsx`**

Replace the full contents of `atlas/src/screens/TripsScreen.tsx` with:

```tsx
// The Trips tab (05-trips.md task 3, extended for backfill mode): a
// Capturing section (whichever trip — live or backfilling — is currently
// capturing, plus the two ways to start one) and a Past section of stamps in
// reverse chronological order, stacked with slight overlap like a passport
// page.

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Status, Trip } from '@/db/types'
import { buildStatusIndex } from '@/stats/coverage'
import { createTrip, getCapturingTrip, type ActiveTripConflictResolution, type CaptureMode } from '@/domain/tripRepo'
import { loadTripPlaces } from '@/domain/tripPlacesRepo'
import { tripCityRows, tripCountryCodes } from '@/domain/tripPlaces'
import { tripDurationDays } from '@/domain/tripStats'
import { useTripDetailStore } from '@/domain/tripDetailStore'
import { formatLongDate } from '@/domain/dateFormat'
import { TripForm, type TripFormValues } from '@/components/trips/TripForm'
import { TripConflictDialog } from '@/components/trips/TripConflictDialog'
import { TripStamp } from '@/components/trips/TripStamp'
import './TripsScreen.css'

type FormMode = CaptureMode | null

export function TripsScreen() {
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [conflictTripName, setConflictTripName] = useState<string | null>(null)
  const [pendingResolution, setPendingResolution] = useState<ActiveTripConflictResolution | undefined>(undefined)
  const openTrip = useTripDetailStore((s) => s.open)

  const trips = useLiveQuery(() => db.trips.filter((t) => t.deletedAt === null).toArray())
  const capturing = trips?.find((t) => t.isActive || t.isBackfilling) ?? null
  const past = (trips ?? [])
    .filter((t) => t.endDate !== null)
    .sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '') || b.createdAt - a.createdAt)

  // Shared across every stamp's mini route map, computed once rather than per stamp.
  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const countryStatus = useMemo(() => buildStatusIndex(entries ?? [], 'country'), [entries])

  const capturingPlaceCount = useLiveQuery(
    () => (capturing ? db.tripEntries.filter((te) => te.tripId === capturing.id && te.deletedAt === null).count() : Promise.resolve(0)),
    [capturing?.id],
  )

  // `formMode` is set here regardless of whether there's a conflict — a
  // conflict just means TripConflictDialog renders on top and the form
  // itself stays hidden (see the render gate below) until the user resolves
  // it, so `submitForm` still knows which mode to pass to `createTrip`
  // afterward. Canceling the conflict dialog clears `formMode` back to null
  // (see its `onCancel` below) so nothing opens.
  async function requestFormMode(mode: CaptureMode) {
    const conflictTrip = await getCapturingTrip()
    if (conflictTrip) setConflictTripName(conflictTrip.name)
    setFormMode(mode)
  }

  async function submitForm(values: TripFormValues) {
    if (!formMode) return
    await createTrip({ name: values.name, startDate: values.startDate, mode: formMode }, pendingResolution)
    setFormMode(null)
    setPendingResolution(undefined)
  }

  return (
    <div className="trips-screen">
      <h1 className="trips-screen__title">Trips</h1>

      <section className="trips-screen__section">
        <h2 className="trips-screen__section-title mono">Capturing</h2>
        {capturing ? (
          <button type="button" className="trips-screen__active-card" onClick={() => openTrip(capturing.id)}>
            <span className="trips-screen__active-name">{capturing.name}</span>
            <span className="trips-screen__active-meta mono">
              {capturing.isActive
                ? `Day ${tripDurationDays(capturing)} · started ${capturing.startDate ? formatLongDate(capturing.startDate) : '—'}`
                : `Backfilling since ${capturing.startDate ? formatLongDate(capturing.startDate) : '—'} · ${capturingPlaceCount ?? 0} ${capturingPlaceCount === 1 ? 'place' : 'places'}`}
            </span>
          </button>
        ) : (
          <p className="trips-screen__hint">
            No trip running. Start one and everything you add from here on attaches to it automatically.
          </p>
        )}
      </section>

      <div className="trips-screen__actions">
        <button type="button" className="trips-screen__action" onClick={() => void requestFormMode('live')}>
          Start a trip
        </button>
        <button type="button" className="trips-screen__action trips-screen__action--secondary" onClick={() => void requestFormMode('backfill')}>
          Log a past trip
        </button>
      </div>

      <section className="trips-screen__section">
        <h2 className="trips-screen__section-title mono">Past</h2>
        {past.length > 0 ? (
          <div className="trips-screen__stamps">
            {past.map((trip) => (
              <TripPastStamp key={trip.id} trip={trip} countryStatus={countryStatus} onOpen={() => openTrip(trip.id)} />
            ))}
          </div>
        ) : (
          <p className="trips-screen__hint">Trips you close (or finish backfilling) show up here as a stamp.</p>
        )}
      </section>

      {formMode && !conflictTripName && (
        <TripForm
          title={formMode === 'live' ? 'Start a trip' : 'Log a past trip'}
          submitLabel={formMode === 'live' ? 'Start trip' : 'Start backfilling'}
          showEndDate={false}
          mode={formMode}
          onClose={() => {
            setFormMode(null)
            setPendingResolution(undefined)
          }}
          onSubmit={submitForm}
        />
      )}

      {conflictTripName && (
        <TripConflictDialog
          activeTripName={conflictTripName}
          onResolve={(resolution) => {
            setPendingResolution(resolution)
            setConflictTripName(null)
          }}
          onCancel={() => {
            setConflictTripName(null)
            setFormMode(null)
          }}
        />
      )}
    </div>
  )
}

function TripPastStamp({
  trip,
  countryStatus,
  onOpen,
}: {
  trip: Trip
  countryStatus: ReadonlyMap<string, Status>
  onOpen: () => void
}) {
  const groups = useLiveQuery(() => loadTripPlaces(trip.id), [trip.id])
  const countryCodes = useMemo(() => (groups ? tripCountryCodes(groups) : []), [groups])
  const cities = useMemo(
    () =>
      groups
        ? tripCityRows(groups).filter((r): r is typeof r & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
        : [],
    [groups],
  )
  return (
    <TripStamp
      tripId={trip.id}
      name={trip.name}
      startDate={trip.startDate}
      endDate={trip.endDate}
      countryCodes={countryCodes}
      countryStatus={countryStatus}
      cities={cities}
      onClick={onOpen}
    />
  )
}
```

- [ ] **Step 8: Rename `getActiveTrip` → `getCapturingTrip` in `TripDetail.tsx`**

In `atlas/src/components/trips/TripDetail.tsx`, replace:

```ts
import { closeTrip, getActiveTrip, reopenTrip, softDeleteTrip, updateTrip } from '@/domain/tripRepo'
```

with:

```ts
import { closeTrip, getCapturingTrip, reopenTrip, softDeleteTrip, updateTrip } from '@/domain/tripRepo'
```

And replace, inside `handleReopenTapped`:

```ts
  async function handleReopenTapped() {
    const active = await getActiveTrip()
    if (active && active.id !== trip.id) setConflictTripName(active.name)
    else await run(() => reopenTrip(trip.id))
  }
```

with:

```ts
  async function handleReopenTapped() {
    const capturing = await getCapturingTrip()
    if (capturing && capturing.id !== trip.id) setConflictTripName(capturing.name)
    else await run(() => reopenTrip(trip.id))
  }
```

(The 3-way lifecycle button and `EndBackfillDialog` land in Task 2 — this step only keeps the file
compiling against the renamed `tripRepo` export.)

- [ ] **Step 9: Rename `getActiveTrip` → `getCapturingTrip` in `ActiveTripBanner.tsx`**

In `atlas/src/components/trips/ActiveTripBanner.tsx`, replace:

```ts
import { getActiveTrip } from '@/domain/tripRepo'
```

with:

```ts
import { getCapturingTrip } from '@/domain/tripRepo'
```

And replace:

```ts
// Module-scope: stable across renders, matching this query's `deps: []`.
const queryActiveTrip = countedQuery('lqActiveTrip', () => getActiveTrip())

export function ActiveTripBanner() {
  const trip = useLiveQuery(queryActiveTrip)
```

with:

```ts
// Module-scope: stable across renders, matching this query's `deps: []`.
const queryCapturingTrip = countedQuery('lqCapturingTrip', () => getCapturingTrip())

export function ActiveTripBanner() {
  const trip = useLiveQuery(queryCapturingTrip)
```

(The backfill-mode copy branch lands in Task 3 — this step only keeps the file compiling.)

- [ ] **Step 10: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 11: Run the full test suite**

Run (from `atlas/`): `npm test`
Expected: all tests pass (the 3 `tripCountryDefaults.test.ts` tests are gone along with the file;
total count drops by 3 from the last full run).

- [ ] **Step 12: Commit**

```bash
git add -A atlas/src
git commit -m "Replace the country picker with backfill-mode trip capturing (isBackfilling, getCapturingTrip, nextBackfillDate)"
```

---

### Task 2: `TripDetail.tsx` — 3-way lifecycle button + `EndBackfillDialog`

**Files:**
- Create: `atlas/src/components/trips/EndBackfillDialog.tsx`
- Create: `atlas/src/components/trips/EndBackfillDialog.css`
- Modify: `atlas/src/components/trips/TripDetail.tsx`

**Interfaces:**
- Consumes: `endBackfill`, `nextBackfillDate` from `@/domain/tripRepo` (Task 1); `DateField` from
  `@/components/shared/DateField`.
- Produces: `EndBackfillDialog` component with props `{ tripId: string; startDate: string; onDone: () => void; onCancel: () => void }`, consumed only by `TripDetail.tsx`.

- [ ] **Step 1: Write `EndBackfillDialog`**

Create `atlas/src/components/trips/EndBackfillDialog.tsx`:

```tsx
// The "End past trip" prompt — same small-dialog family as
// TripConflictDialog (backdrop + centered panel, not a full-screen
// overlay), shown from TripDetail when a backfilling trip is finished. The
// end date defaults via nextBackfillDate (the same chaining rule that
// offered a date for the last place added) but stays freely editable before
// confirming — the "smart default, adjustable" behavior chosen over closing
// silently. See docs/superpowers/specs/2026-09-30-backfill-trip-mode-design.md.

import { useEffect, useState } from 'react'
import { endBackfill, nextBackfillDate } from '@/domain/tripRepo'
import { DateField } from '@/components/shared/DateField'
import './EndBackfillDialog.css'

interface EndBackfillDialogProps {
  tripId: string
  startDate: string
  onDone: () => void
  onCancel: () => void
}

export function EndBackfillDialog({ tripId, startDate, onDone, onCancel }: EndBackfillDialogProps) {
  const [date, setDate] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void nextBackfillDate(tripId, startDate).then((d) => {
      if (!cancelled) setDate(d)
    })
    return () => {
      cancelled = true
    }
  }, [tripId, startDate])

  async function confirm() {
    if (!date) {
      setError('Pick an end date.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await endBackfill(tripId, date)
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  return (
    <div className="end-backfill-backdrop" onClick={onCancel}>
      <div className="end-backfill" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="end-backfill__title">End this past trip</h2>
        <p className="end-backfill__body">Suggested from the last place you added — change it if it's not quite right.</p>
        <DateField value={date} ariaLabel="End date" min={startDate} onChange={setDate} />
        {error && (
          <p className="end-backfill__error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="end-backfill__confirm" disabled={pending || !date} onClick={() => void confirm()}>
          End trip
        </button>
        <button type="button" className="end-backfill__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Write its styles**

Create `atlas/src/components/trips/EndBackfillDialog.css` (backdrop/panel/title/body ported directly
from `TripConflictDialog.css`'s equivalent rules; `__confirm` styled as a primary action button,
matching `TripForm.css`'s `.trip-form__submit`; `__cancel` ported from `.trip-conflict__cancel`;
`__error` matching `TripForm.css`'s `.trip-form__error`):

```css
/* z-index 40: same layer as the place-status sheet — this can be triggered
   from inside a full-screen overlay (TripDetail). */
.end-backfill-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-5);
  background: color-mix(in srgb, var(--abyss) 60%, transparent);
}

.end-backfill {
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-5);
  background: var(--shelf);
  border: 1px solid var(--contour);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.end-backfill__title {
  font-size: var(--text-lg);
  color: var(--chalk);
}

.end-backfill__body {
  font-size: var(--text-sm);
  color: var(--haze);
}

.end-backfill__error {
  font-size: var(--text-sm);
  color: var(--lived);
}

.end-backfill__confirm {
  min-height: var(--tap-target-min);
  padding: var(--space-3);
  background: var(--visited);
  color: var(--abyss);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-size: var(--text-sm);
}

.end-backfill__confirm:disabled {
  opacity: 0.6;
}

.end-backfill__cancel {
  min-height: var(--tap-target-min);
  color: var(--haze);
  text-align: center;
}

.end-backfill__cancel:hover {
  color: var(--chalk);
}
```

- [ ] **Step 3: Wire the 3-way lifecycle button into `TripDetail.tsx`**

In `atlas/src/components/trips/TripDetail.tsx`, add the new import — replace:

```ts
import { TripForm } from '@/components/trips/TripForm'
import { TripConflictDialog } from '@/components/trips/TripConflictDialog'
import { TripRouteMap } from '@/components/trips/TripRouteMap'
```

with:

```ts
import { TripForm } from '@/components/trips/TripForm'
import { TripConflictDialog } from '@/components/trips/TripConflictDialog'
import { EndBackfillDialog } from '@/components/trips/EndBackfillDialog'
import { TripRouteMap } from '@/components/trips/TripRouteMap'
```

Add the new state — replace:

```ts
  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
```

with:

```ts
  const [showEdit, setShowEdit] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showEndBackfill, setShowEndBackfill] = useState(false)
```

Replace the dates line:

```tsx
        <p className="trip-detail__dates mono">
          {trip.startDate ? formatLongDate(trip.startDate) : '—'} –{' '}
          {trip.endDate ? formatLongDate(trip.endDate) : trip.isActive ? 'ONGOING' : '—'}
        </p>
```

with:

```tsx
        <p className="trip-detail__dates mono">
          {trip.startDate ? formatLongDate(trip.startDate) : '—'} –{' '}
          {trip.endDate ? formatLongDate(trip.endDate) : trip.isActive ? 'ONGOING' : trip.isBackfilling ? 'BACKFILLING' : '—'}
        </p>
```

Replace the lifecycle button block:

```tsx
        <div className="trip-detail__lifecycle">
          {trip.isActive ? (
            <button type="button" className="trip-detail__action" onClick={() => void run(() => closeTrip(trip.id))}>
              Close trip
            </button>
          ) : (
            <button type="button" className="trip-detail__action" onClick={() => void handleReopenTapped()}>
              Reopen trip
            </button>
          )}
          <button type="button" className="trip-detail__action trip-detail__action--secondary" onClick={() => setShowEdit(true)}>
            Edit
          </button>
        </div>
```

with:

```tsx
        <div className="trip-detail__lifecycle">
          {trip.isActive ? (
            <button type="button" className="trip-detail__action" onClick={() => void run(() => closeTrip(trip.id))}>
              Close trip
            </button>
          ) : trip.isBackfilling ? (
            <button type="button" className="trip-detail__action" onClick={() => setShowEndBackfill(true)}>
              End past trip
            </button>
          ) : (
            <button type="button" className="trip-detail__action" onClick={() => void handleReopenTapped()}>
              Reopen trip
            </button>
          )}
          <button type="button" className="trip-detail__action trip-detail__action--secondary" onClick={() => setShowEdit(true)}>
            Edit
          </button>
        </div>
```

Add the dialog, alongside the existing `{showEdit && ...}` / `{conflictTripName && ...}` blocks
(anywhere among them — order doesn't matter, they're mutually exclusive by state):

```tsx
      {showEndBackfill && trip.startDate && (
        <EndBackfillDialog
          tripId={trip.id}
          startDate={trip.startDate}
          onDone={() => setShowEndBackfill(false)}
          onCancel={() => setShowEndBackfill(false)}
        />
      )}
```

- [ ] **Step 4: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run (from `atlas/`): `npm test`
Expected: all tests pass (unchanged count from Task 1 — no new pure logic here).

- [ ] **Step 6: Commit**

```bash
git add atlas/src/components/trips/EndBackfillDialog.tsx atlas/src/components/trips/EndBackfillDialog.css atlas/src/components/trips/TripDetail.tsx
git commit -m "Add End past trip dialog and 3-way lifecycle button to TripDetail"
```

---

### Task 3: `ActiveTripBanner.tsx` — backfill-mode copy

**Files:**
- Modify: `atlas/src/components/trips/ActiveTripBanner.tsx`

**Interfaces:**
- Consumes: nothing new (already imports `getCapturingTrip` from Task 1 Step 8).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Branch the banner text on `trip.isActive`**

In `atlas/src/components/trips/ActiveTripBanner.tsx`, replace:

```tsx
  if (!trip || dismissedTripId === trip.id) return null

  const days = tripDurationDays(trip) ?? 1
  const places = placeCount ?? 0

  return (
    <div className="active-trip-banner">
      <button type="button" className="active-trip-banner__tap" onClick={() => openTrip(trip.id)}>
        <span className="active-trip-banner__text mono">
          {trip.name} · Day {days} · {places} {places === 1 ? 'place' : 'places'}
        </span>
      </button>
```

with:

```tsx
  if (!trip || dismissedTripId === trip.id) return null

  const places = placeCount ?? 0
  const label = trip.isActive
    ? `${trip.name} · Day ${tripDurationDays(trip) ?? 1} · ${places} ${places === 1 ? 'place' : 'places'}`
    : `Backfilling ${trip.name} · ${places} ${places === 1 ? 'place' : 'places'}`

  return (
    <div className="active-trip-banner">
      <button type="button" className="active-trip-banner__tap" onClick={() => openTrip(trip.id)}>
        <span className="active-trip-banner__text mono">{label}</span>
      </button>
```

- [ ] **Step 2: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add atlas/src/components/trips/ActiveTripBanner.tsx
git commit -m "Show backfill-mode copy in the persistent capturing-trip banner"
```

---

### Task 4: `PlaceStatusSheet.tsx` — chained date default + backfilling note

**Files:**
- Modify: `atlas/src/components/places/PlaceStatusSheet.tsx`

**Interfaces:**
- Consumes: `getCapturingTrip`, `nextBackfillDate` from `@/domain/tripRepo` (Task 1).
- Produces: nothing new consumed elsewhere — this is the behavior that makes "everything like
  Places" true, by changing only the sheet every place kind already flows through.

- [ ] **Step 1: Import the new `tripRepo` functions**

In `atlas/src/components/places/PlaceStatusSheet.tsx`, replace:

```ts
import { attachEntryToTrip, detachEntryFromTrip, listTrips, tripIdsForEntry } from '@/domain/tripRepo'
```

with:

```ts
import { attachEntryToTrip, detachEntryFromTrip, getCapturingTrip, listTrips, nextBackfillDate, tripIdsForEntry } from '@/domain/tripRepo'
```

- [ ] **Step 2: Query the capturing trip**

Add, alongside the existing `trips`/`sortedTrips`/`attachedTripIds` queries in `SheetContent`:

```ts
  const capturingTrip = useLiveQuery(() => getCapturingTrip())
  const backfillingTrip = capturingTrip?.isBackfilling ? capturingTrip : null
```

- [ ] **Step 3: Extend the date-default effect**

Replace:

```ts
  const settings = useLiveQuery(() => settingsRepo.get())
  const [date, setDate] = useState<string | null>(null)
  const [dateTouched, setDateTouched] = useState(false)
  useEffect(() => {
    if (dateTouched) return
    if (data?.entry?.firstVisited) {
      setDate(data.entry.firstVisited)
    } else if (!data?.entry && settings?.defaultDateToToday) {
      // A genuinely new place (no entry yet) — pre-fill and count it as an
      // explicit choice, so a bare status tap does save today's date, which
      // is the point of the "default new entries to today" preference.
      setDate(todayISO())
      setDateTouched(true)
    }
  }, [data, dateTouched, settings])
```

with:

```ts
  const settings = useLiveQuery(() => settingsRepo.get())
  const [date, setDate] = useState<string | null>(null)
  const [dateTouched, setDateTouched] = useState(false)
  useEffect(() => {
    if (dateTouched) return
    if (data?.entry?.firstVisited) {
      setDate(data.entry.firstVisited)
      return
    }
    if (data?.entry) return // existing entry, no date on it — leave blank, don't override with backfill/today defaults
    if (backfillingTrip?.startDate) {
      // A genuinely new place while backfilling — chain off the last place
      // touched in this trip (or its start date if this is the first one),
      // and count it as an explicit choice so a bare status tap saves it
      // without the user re-touching the field. This takes priority over
      // `defaultDateToToday` below — being mid-backfill is a much stronger
      // signal than the general "default new entries to today" preference.
      void nextBackfillDate(backfillingTrip.id, backfillingTrip.startDate).then((d) => {
        setDate(d)
        setDateTouched(true)
      })
    } else if (settings?.defaultDateToToday) {
      setDate(todayISO())
      setDateTouched(true)
    }
  }, [data, dateTouched, settings, backfillingTrip])
```

- [ ] **Step 4: Add the "Backfilling" note near the date field**

Replace:

```tsx
        <div className="place-sheet__date">
          <span>Date (optional)</span>
          <DateField
```

with:

```tsx
        <div className="place-sheet__date">
          <span>Date (optional)</span>
          {backfillingTrip && <p className="place-sheet__backfill-note">Backfilling "{backfillingTrip.name}"</p>}
          <DateField
```

- [ ] **Step 5: Add the note's style**

In `atlas/src/components/places/PlaceStatusSheet.css`, append:

```css
.place-sheet__backfill-note {
  font-size: var(--text-xs);
  color: var(--haze);
}
```

- [ ] **Step 6: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 7: Run the full test suite**

Run (from `atlas/`): `npm test`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add atlas/src/components/places/PlaceStatusSheet.tsx atlas/src/components/places/PlaceStatusSheet.css
git commit -m "Chain a suggested date from the capturing backfill trip in the place-status sheet"
```

---

### Task 5: Manual end-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Start the app**

`npm run dev` from `atlas/`, or via the harness's preview tool.

- [ ] **Step 2: Start a backfill session**

1. Trips tab → "Log a past trip". Confirm the form is just Name + Start date (no end date, no
   picker) and the hint line reads the backfill copy (*"...with the date suggested from the last
   one — until you end it."*).
2. Set the start date to a few years back, name it, submit.
3. Confirm the Trips tab's "Capturing" card now shows this trip with *"Backfilling since &lt;date&gt; ·
   0 places"* (no day count), and the persistent banner at the bottom shows *"Backfilling &lt;name&gt; ·
   0 places"*.

- [ ] **Step 3: Add places via the Places tab, across countries/cities/subdivisions**

1. Go to Places tab, search a city (e.g. a French city with a known region), open its sheet. Confirm
   a *"Backfilling '&lt;trip name&gt;'"* note appears near the date field and the date is pre-filled to
   the trip's start date. Set a status (e.g. Visited), confirm the sheet closes.
2. Reopen the Places tab, search a second city in a different country. Confirm its date pre-fills to
   the *first* city's date (chained), not the trip's start date. Change its status.
3. Add a third place — a country directly this time (via `ManualPlaceForm`'s country picker, or by
   searching a city and instead using "Add a place manually" then picking just the country) or a
   subdivision-level place if reachable — confirm its date chains from the second place's date.
4. Back on the Trips tab, confirm the "Capturing" card's place count went up each time (3 places).

- [ ] **Step 4: End the backfill**

1. Tap the Capturing card (or the banner) to open `TripDetail`. Confirm the dates line reads
   "&lt;start&gt; – BACKFILLING" and the lifecycle button reads "End past trip".
2. Confirm the trip's Places section already lists all three places added, correctly grouped by
   country/subdivision/city.
3. Tap "End past trip". Confirm the dialog's date defaults to the last-added place's date, adjust it
   if desired, confirm.
4. Confirm the trip now shows a real end date, no longer appears as "Capturing," and shows up
   correctly in the Past list as a stamp with all three places/countries represented.

- [ ] **Step 5: Confirm the concurrency rule**

1. Tap "Start a trip" while nothing is capturing — confirm it opens cleanly (no conflict dialog).
2. With that live trip running, tap "Log a past trip" — confirm `TripConflictDialog` appears
   ("...is still running... Only one trip can capture places at a time"), and that resolving it
   ("Close and continue" or "Leave open, just switch") correctly starts the backfill session
   afterward with the right mode (verify via the Capturing card showing "Backfilling," not "Day N").

- [ ] **Step 6: Check the console and finish**

Confirm no console errors (`read_console_messages` with `onlyErrors: true`) across the whole flow,
then stop the dev server.
