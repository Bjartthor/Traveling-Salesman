# Log a past trip: end-date default + inline country picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the "Log a past trip" form, default the end date to the start date (mirroring it until touched) and add an inline "Countries visited" picker whose per-country date defaults chain from the trip's start date.

**Architecture:** A new pure helper (`domain/tripCountryDefaults.ts`) computes the chained date default and owns the `TripCountryRow` type; a new component (`TripCountryPicker.tsx`) renders the search-and-add row list and is mounted inside `TripForm.tsx` only for the past-trip variant; `TripForm.tsx` also gains the end-date-mirrors-start-date behavior; `TripsScreen.tsx`'s `submitLogPast` persists the picked countries after creating the trip, reusing the exact `setPlaceStatus` + `attachEntryToTrip` pair the Places-tab sheet already uses for trip attachment.

**Tech Stack:** React (function components, hooks), TypeScript, Dexie (IndexedDB) via `dexie-react-hooks`' `useLiveQuery`, Vitest for pure-logic tests.

## Global Constraints

- Scoped strictly to the "Log a past trip" `TripForm` variant (`showEndDate && requireEndDate`) — "Start a trip" (no end date field) and plain trip editing (`showEndDate=true, requireEndDate=false`) are untouched.
- Countries only — no city-level picking in this form (spec non-goal).
- No retroactive re-chaining — editing an already-added row's date never changes sibling rows; it only changes the default offered to the *next* row added.
- No new test tooling: `atlas/vitest.config.ts` only runs `src/**/*.test.ts` under a `node` environment (no `jsdom`, no `@testing-library/react` dependency) — pure logic gets a Vitest unit test, UI behavior is verified manually via the dev server, matching how every other component in this codebase (`TripForm`, `PlaceStatusSheet`, `ManualPlaceForm`, ...) is untested at the component level today.
- Follow existing styling conventions exactly: CSS custom properties (`var(--space-*)`, `var(--contour)`, `var(--chalk)`, `var(--haze)`, `var(--shelf)`, `var(--abyss)`, `var(--radius-sm)`, `var(--tap-target-min)`, `var(--text-*)`) as used throughout `atlas/src/components/**/*.css`; BEM-ish `component-name__part` class naming.
- Full path prefix for all files below: `atlas/` (repo root is `/home/bjartthor/BSA/Traveling_Salesman`).

---

### Task 1: Pure date-chaining helper (`nextCountryRowDate`) and `TripCountryRow` type

**Files:**
- Create: `atlas/src/domain/tripCountryDefaults.ts`
- Test: `atlas/src/domain/tripCountryDefaults.test.ts`

**Interfaces:**
- Consumes: `Status` type from `@/db/types` (already defined: `'wishlist' | 'transit' | 'visited' | 'lived'`).
- Produces: `TripCountryRow` (`{ code: string; status: Status; date: string | null }`) and `nextCountryRowDate(rows: readonly TripCountryRow[], startDate: string): string` — both imported by `TripCountryPicker.tsx` (Task 2) and `TripCountryRow` also imported by `TripForm.tsx` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `atlas/src/domain/tripCountryDefaults.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextCountryRowDate, type TripCountryRow } from '@/domain/tripCountryDefaults'

describe('nextCountryRowDate', () => {
  it('defaults to the trip start date when no countries have been added yet', () => {
    expect(nextCountryRowDate([], '2019-03-01')).toBe('2019-03-01')
  })

  it("defaults to the previous row's date once at least one country is added", () => {
    const rows: TripCountryRow[] = [
      { code: 'FR', status: 'visited', date: '2019-03-01' },
      { code: 'DE', status: 'visited', date: '2019-03-05' },
    ]
    expect(nextCountryRowDate(rows, '2019-03-01')).toBe('2019-03-05')
  })

  it("falls back to the start date if the previous row's date was cleared", () => {
    const rows: TripCountryRow[] = [{ code: 'FR', status: 'visited', date: null }]
    expect(nextCountryRowDate(rows, '2019-03-01')).toBe('2019-03-01')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `atlas/`): `npx vitest run src/domain/tripCountryDefaults.test.ts`
Expected: FAIL — `Cannot find module '@/domain/tripCountryDefaults'` (or similar resolution error), since the module doesn't exist yet.

- [ ] **Step 3: Write the minimal implementation**

Create `atlas/src/domain/tripCountryDefaults.ts`:

```ts
// Pure helpers backing the "Countries visited" section of the past-trip form
// (TripCountryPicker.tsx / TripForm.tsx) — kept separate from those
// components so the date-chaining rule is unit-testable without React. See
// docs/superpowers/specs/2026-09-30-log-past-trip-countries-design.md.

import type { Status } from '@/db/types'

export interface TripCountryRow {
  code: string
  status: Status
  date: string | null
}

/**
 * The date offered to a newly-added row: the trip's start date if this is
 * the first country added, otherwise whatever date currently sits on the
 * row added just before it (falling back to the start date if that row's
 * date was cleared to null). Purely a default — the caller still stores
 * whatever the user ends up leaving in the field, and nothing here ever
 * re-derives an already-added row's date.
 */
export function nextCountryRowDate(rows: readonly TripCountryRow[], startDate: string): string {
  const last = rows[rows.length - 1]
  return last?.date ?? startDate
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run (from `atlas/`): `npx vitest run src/domain/tripCountryDefaults.test.ts`
Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add atlas/src/domain/tripCountryDefaults.ts atlas/src/domain/tripCountryDefaults.test.ts
git commit -m "Add nextCountryRowDate date-chaining helper for past-trip country picker"
```

---

### Task 2: `TripCountryPicker` component

**Files:**
- Create: `atlas/src/components/trips/TripCountryPicker.tsx`
- Create: `atlas/src/components/trips/TripCountryPicker.css`

**Interfaces:**
- Consumes: `TripCountryRow`, `nextCountryRowDate` from `@/domain/tripCountryDefaults` (Task 1); `Status` from `@/db/types`; `normalize` from `@/geo/search`; `STATUS_ORDER` from `@/domain/cascade`; `STATUS_LABEL` from `@/components/map/statusColor`; `CountryFlag` from `@/components/places/CountryFlag`; `DateField` from `@/components/shared/DateField`; `db` from `@/db/schema` (for `db.countries`, via `useLiveQuery` from `dexie-react-hooks`).
- Produces: `TripCountryPicker` component with props `{ rows: TripCountryRow[]; onChange: (rows: TripCountryRow[]) => void; startDate: string }`, consumed by `TripForm.tsx` (Task 3).

- [ ] **Step 1: Write the component**

Create `atlas/src/components/trips/TripCountryPicker.tsx`:

```tsx
// The "Countries visited" section of the "Log a past trip" form
// (TripForm.tsx, showEndDate && requireEndDate only) — search-and-pick like
// ManualPlaceForm's country picker, but inline (not a full-screen overlay)
// and producing a list of {code, status, date} rows the form submits
// alongside the trip itself, rather than writing anything immediately. See
// docs/superpowers/specs/2026-09-30-log-past-trip-countries-design.md.

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Status } from '@/db/types'
import { normalize } from '@/geo/search'
import { STATUS_ORDER } from '@/domain/cascade'
import { STATUS_LABEL } from '@/components/map/statusColor'
import { nextCountryRowDate, type TripCountryRow } from '@/domain/tripCountryDefaults'
import { CountryFlag } from '@/components/places/CountryFlag'
import { DateField } from '@/components/shared/DateField'
import './TripCountryPicker.css'

interface TripCountryPickerProps {
  rows: TripCountryRow[]
  onChange: (rows: TripCountryRow[]) => void
  startDate: string
}

export function TripCountryPicker({ rows, onChange, startDate }: TripCountryPickerProps) {
  const [query, setQuery] = useState('')
  const allCountries = useLiveQuery(() => db.countries.toArray()) ?? []

  const addedCodes = useMemo(() => new Set(rows.map((r) => r.code)), [rows])
  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return []
    return allCountries
      .filter((c) => !addedCodes.has(c.code))
      .filter((c) => normalize(c.name).includes(q) || normalize(c.code) === q)
      .slice(0, 20)
  }, [allCountries, addedCodes, query])

  function addCountry(code: string) {
    const date = nextCountryRowDate(rows, startDate)
    onChange([...rows, { code, status: 'visited', date }])
    setQuery('')
  }

  function removeCountry(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function updateRow(index: number, patch: Partial<TripCountryRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <div className="trip-country-picker">
      <span className="trip-country-picker__label">Countries visited (optional)</span>

      {rows.length > 0 && (
        <ul className="trip-country-picker__rows">
          {rows.map((row, i) => (
            <li key={row.code} className="trip-country-picker__row">
              <CountryFlag code={row.code} />
              <select
                className="trip-country-picker__status"
                value={row.status}
                aria-label={`Status for ${row.code}`}
                onChange={(e) => updateRow(i, { status: e.target.value as Status })}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <DateField
                value={row.date}
                ariaLabel={`Date for ${row.code}`}
                onChange={(v) => updateRow(i, { date: v })}
              />
              <button
                type="button"
                className="trip-country-picker__remove"
                aria-label={`Remove ${row.code}`}
                onClick={() => removeCountry(i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        className="trip-country-picker__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add a country…"
        aria-label="Search countries to add"
      />

      {results.length > 0 && (
        <ul className="trip-country-picker__results">
          {results.map((c) => (
            <li key={c.code}>
              <button type="button" className="trip-country-picker__result" onClick={() => addCountry(c.code)}>
                <CountryFlag code={c.code} />
                <span>{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Write the styles**

Create `atlas/src/components/trips/TripCountryPicker.css`:

```css
.trip-country-picker {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.trip-country-picker__label {
  font-size: var(--text-xs);
  color: var(--haze);
}

.trip-country-picker__rows {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.trip-country-picker__row {
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--shelf);
  border: 1px solid var(--contour);
  border-radius: var(--radius-sm);
}

.trip-country-picker__status {
  min-height: var(--tap-target-min);
  padding: var(--space-1) var(--space-2);
  background: var(--abyss);
  border: 1px solid var(--contour);
  border-radius: var(--radius-sm);
  color: var(--chalk);
  font-size: var(--text-sm);
}

.trip-country-picker__remove {
  min-width: var(--tap-target-min);
  min-height: var(--tap-target-min);
  color: var(--haze);
  font-size: var(--text-base);
}

.trip-country-picker__search {
  min-height: var(--tap-target-min);
  padding: var(--space-2) var(--space-3);
  background: var(--abyss);
  border: 1px solid var(--contour);
  border-radius: var(--radius-sm);
  color: var(--chalk);
  font-size: var(--text-base);
}

.trip-country-picker__results {
  display: flex;
  flex-direction: column;
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--contour);
  border-radius: var(--radius-sm);
}

.trip-country-picker__result {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: var(--tap-target-min);
  padding: var(--space-2) var(--space-3);
  color: var(--chalk);
  font-size: var(--text-base);
  text-align: left;
}

.trip-country-picker__result:hover {
  background: var(--shelf);
}
```

- [ ] **Step 3: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors. (This component isn't mounted anywhere yet, so this only confirms it's self-consistent — imports resolve, prop/types line up with `TripCountryRow`, `Status`, `STATUS_ORDER`/`STATUS_LABEL`, `DateField`, `CountryFlag`.)

- [ ] **Step 4: Commit**

```bash
git add atlas/src/components/trips/TripCountryPicker.tsx atlas/src/components/trips/TripCountryPicker.css
git commit -m "Add TripCountryPicker component for the past-trip country list"
```

---

### Task 3: Wire `TripForm.tsx` — end-date mirroring + mount the country picker

**Files:**
- Modify: `atlas/src/components/trips/TripForm.tsx` (full file replaced below)

**Interfaces:**
- Consumes: `TripCountryRow` type from `@/domain/tripCountryDefaults` (Task 1); `TripCountryPicker` component from `@/components/trips/TripCountryPicker` (Task 2).
- Produces: `TripFormValues` now includes `countries?: TripCountryRow[]`, populated only when `showEndDate && requireEndDate` (the past-trip variant) — consumed by `TripsScreen.tsx`'s `submitLogPast` (Task 4). `TripFormProps`, `submitLabel`, `title`, `onClose`, `onSubmit` signatures are unchanged, so `TripDetail.tsx` (which also renders `TripForm` for plain editing) needs no changes.

- [ ] **Step 1: Replace the file**

Replace the full contents of `atlas/src/components/trips/TripForm.tsx` with:

```tsx
// Trip create/edit form (05-trips.md task 1 "start a trip"/"retroactive
// trips" + task 4 "edit name, dates, cover photo"). Full-screen overlay,
// reusing the same shell as ManualPlaceForm/CountryDetail/BulkAddScreen.
//
// Three variants, one component: `showEndDate=false` is "start a trip now" —
// no end-date field at all, always produces a live (`isActive`) trip.
// `showEndDate=true, requireEndDate=true` is "log a past trip" — both dates
// up front, always produces an already-closed trip; no conflict with
// whatever's currently active is possible, since it never sets `isActive`.
// This is also the only variant with the "Countries visited" picker below,
// and the only one where the end date mirrors the start date until touched
// (both exist to make backfilling an old trip fast — see
// docs/superpowers/specs/2026-09-30-log-past-trip-countries-design.md).
// `showEndDate=true, requireEndDate=false` is plain editing of an existing
// trip's name/dates, which never touches `isActive` at all (only the
// dedicated close/reopen actions in TripDetail do that) — the cover photo
// slot lives in TripDetail itself, wired but empty per 00-PLAN.md's Phase 6
// hold-off.
//
// The only-one-trip-active conflict is resolved by the caller *before*
// opening this form (see TripsScreen/TripDetail) — that keeps this component
// a plain, un-nested form rather than one that has to pause mid-submit for a
// second dialog.

import { useState, type FormEvent } from 'react'
import { todayISO } from '@/domain/dateFormat'
import type { TripCountryRow } from '@/domain/tripCountryDefaults'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { DateField } from '@/components/shared/DateField'
import { TripCountryPicker } from '@/components/trips/TripCountryPicker'
import './TripForm.css'

export interface TripFormValues {
  name: string
  startDate: string
  endDate: string | null
  countries?: TripCountryRow[]
}

interface TripFormProps {
  title: string
  submitLabel: string
  showEndDate: boolean
  requireEndDate?: boolean
  initial?: Partial<TripFormValues>
  onClose: () => void
  onSubmit: (values: TripFormValues) => Promise<void>
}

export function TripForm({ title, submitLabel, showEndDate, requireEndDate, initial, onClose, onSubmit }: TripFormProps) {
  const isLogPast = showEndDate && Boolean(requireEndDate)

  const [name, setName] = useState(initial?.name ?? '')
  const initialStartDate = initial?.startDate ?? todayISO()
  const [startDate, setStartDate] = useState(initialStartDate)
  const [endDate, setEndDate] = useState<string | null>(initial?.endDate ?? (isLogPast ? initialStartDate : null))
  const [endDateTouched, setEndDateTouched] = useState(false)
  const [countries, setCountries] = useState<TripCountryRow[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleStartDateChange(v: string) {
    setStartDate(v)
    if (isLogPast && !endDateTouched) setEndDate(v)
  }

  function handleEndDateChange(v: string | null) {
    setEndDateTouched(true)
    setEndDate(v)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (isLogPast && !endDate) {
      setError('Pick an end date.')
      return
    }
    setPending(true)
    try {
      await onSubmit({
        name: name.trim() || `Trip from ${startDate}`,
        startDate,
        endDate: showEndDate ? endDate : null,
        countries: isLogPast ? countries : undefined,
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
            <DateField value={startDate} ariaLabel="Start date" onChange={(v) => v && handleStartDateChange(v)} />
          </div>
          {showEndDate && (
            <div className="trip-form__field">
              <span>End date{requireEndDate ? '' : ' (optional)'}</span>
              <DateField value={endDate} ariaLabel="End date" min={startDate} onChange={handleEndDateChange} />
            </div>
          )}
        </div>
        {!showEndDate && (
          <p className="trip-form__hint">
            This starts the trip now — every place you add from here on attaches to it automatically.
          </p>
        )}

        {isLogPast && <TripCountryPicker rows={countries} onChange={setCountries} startDate={startDate} />}

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

- [ ] **Step 2: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Run the full test suite**

Run (from `atlas/`): `npm test`
Expected: all existing tests still pass (nothing under `domain/` that this task touches has behavior tests other than Task 1's new one, which should also be green).

- [ ] **Step 4: Commit**

```bash
git add atlas/src/components/trips/TripForm.tsx
git commit -m "Mirror end date to start date and mount TripCountryPicker in the past-trip form"
```

---

### Task 4: Persist picked countries from `TripsScreen.submitLogPast` + manual verification

**Files:**
- Modify: `atlas/src/screens/TripsScreen.tsx:1-20` (imports) and `:52-55` (`submitLogPast`)

**Interfaces:**
- Consumes: `TripFormValues.countries` (Task 3); `setPlaceStatus` from `@/domain/cascadeRepo` (existing, signature `(request: SetStatusRequest) => Promise<void>` where `SetStatusRequest = { kind: EntryKind; refId: string; status: Status; firstVisited?: string | null; lastVisited?: string | null }`); `attachEntryToTrip` from `@/domain/tripRepo` (existing, signature `(tripId: string, entryId: string) => Promise<void>`); `createTrip` (existing, already returns `Promise<Trip>`); `db.entries` (Dexie table, existing `[kind+refId]` compound index, already used the same way in `PlaceStatusSheet.tsx`).
- Produces: nothing new consumed elsewhere — this is the final task.

- [ ] **Step 1: Update the imports**

In `atlas/src/screens/TripsScreen.tsx`, replace:

```ts
import { createTrip, getActiveTrip, type ActiveTripConflictResolution } from '@/domain/tripRepo'
```

with:

```ts
import { attachEntryToTrip, createTrip, getActiveTrip, type ActiveTripConflictResolution } from '@/domain/tripRepo'
import { setPlaceStatus } from '@/domain/cascadeRepo'
```

- [ ] **Step 2: Update `submitLogPast`**

Replace:

```ts
  async function submitLogPast(values: TripFormValues) {
    await createTrip({ name: values.name, startDate: values.startDate, endDate: values.endDate })
    setFormMode(null)
  }
```

with:

```ts
  async function submitLogPast(values: TripFormValues) {
    const trip = await createTrip({ name: values.name, startDate: values.startDate, endDate: values.endDate })
    for (const row of values.countries ?? []) {
      await setPlaceStatus({ kind: 'country', refId: row.code, status: row.status, firstVisited: row.date, lastVisited: row.date })
      const entry = await db.entries.where('[kind+refId]').equals(['country', row.code]).first()
      if (entry) await attachEntryToTrip(trip.id, entry.id)
    }
    setFormMode(null)
  }
```

- [ ] **Step 3: Typecheck**

Run (from `atlas/`): `npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run (from `atlas/`): `npm test`
Expected: all tests pass, including `tripCountryDefaults.test.ts` from Task 1.

- [ ] **Step 5: Manual verification in the dev server**

Start the app (`npm run dev` from `atlas/`, or via the harness's preview tool) and in the running app:

1. Open the Trips tab, tap "Log a past trip".
2. Set the start date to something years back (e.g. 5 years ago). Confirm the end date field now shows that same date (not today) without having been touched.
3. Change the start date again; confirm the end date keeps following it.
4. Tap the end date field and pick a different date; confirm that from then on, changing the start date no longer moves the end date.
5. In "Countries visited", type part of a country name (e.g. "Fra") and confirm a filtered, flagged result list appears; tap one to add it as a row. Confirm its date defaults to the trip's start date.
6. Search and add a second country; confirm its date defaults to the first country's date (not the start date), and that it's independently editable.
7. Change the status dropdown on one row (e.g. to "Transit"); confirm it sticks.
8. Remove a row via the ✕ button; confirm it disappears and no longer appears in "already added" (searching for it again should offer it).
9. Fill in the trip name and submit. Confirm the form closes and the new trip appears under "Past" as a stamp.
10. Open the new trip's detail view and confirm the added countries show up with the status and date chosen, and that the Places tab now shows those countries with matching status/date (search for one, open its sheet, and confirm the "Trips" section shows this trip toggled on).

- [ ] **Step 6: Commit**

```bash
git add atlas/src/screens/TripsScreen.tsx
git commit -m "Persist picked countries to a logged past trip"
```
