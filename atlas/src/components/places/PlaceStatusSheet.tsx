// The status sheet from 04-places.md task 3. One instance, mounted globally
// (see App.tsx), opened from anywhere via @/domain/placeSheetStore. Tapping a
// status option commits immediately — no separate save step, so backfilling a
// list of places (task 6) or correcting one on the fly never takes more than
// one tap plus an optional date.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import type { Entry, Status } from '@/db/types'
import { STATUS_ORDER, explainStatus, type PlaceRef } from '@/domain/cascade'
import { removePlaceEntry, setPlaceStatus, loadCascadeState } from '@/domain/cascadeRepo'
import { addVisit, getCapturingTrip, nextBackfillDate, removeVisit, setVisitDate, tripAttachmentsForEntry } from '@/domain/tripRepo'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { resolvePlaceInfo, type PlaceInfo } from '@/domain/placeInfo'
import { todayISO } from '@/domain/dateFormat'
import { flagEmoji } from '@/geo/flags'
import { STATUS_COLOR_VAR, STATUS_DESCRIPTION, STATUS_LABEL } from '@/components/map/statusColor'
import { DateField } from '@/components/shared/DateField'
import './PlaceStatusSheet.css'

export function PlaceStatusSheet() {
  const openPlace = usePlaceSheetStore((s) => s.openPlace)
  const close = usePlaceSheetStore((s) => s.close)
  if (!openPlace) return null
  // Keyed so switching to a different place (without closing first — e.g. a
  // country sheet reopened for a subdivision) resets all local form state.
  return <SheetContent key={`${openPlace.kind}:${openPlace.refId}`} place={openPlace} onClose={close} />
}

interface SheetData {
  entry: Entry | null
  explanation: { status: Status; becauseName: string } | null
  // While a trip is capturing: whether this place already has a visit on
  // *that* trip — which is what offers "Add another visit" instead.
  onCapturingTrip: boolean
}

// A real touchscreen tap reliably produces a trailing `click` 70-77ms after
// it opens this sheet (confirmed via an on-device debug-log capture,
// PROGRESS.md), even with GlobeMap's pointerdown already calling
// preventDefault() — whatever the browser mechanism is, it isn't something
// this app's own pointer handling controls. Where that trailing click lands
// depends on where the sheet's panel ends up relative to the original tap:
// usually the backdrop, but at some scroll/zoom positions it lands on the
// panel itself instead — e.g. on the date field, silently popping open the
// native date picker right after the sheet opens. No real, deliberate
// interaction with the sheet happens that fast, so both the backdrop and the
// panel's own content refuse to honour a click this soon after opening —
// targets the measured symptom directly rather than chasing the exact
// browser-internal cause.
const SPURIOUS_TRAILING_CLICK_GUARD_MS = 300

function SheetContent({ place, onClose }: { place: PlaceRef; onClose: () => void }) {
  const openedAtRef = useRef(0)
  useEffect(() => {
    openedAtRef.current = performance.now()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const [info, setInfo] = useState<PlaceInfo | null>(null)
  useEffect(() => {
    let cancelled = false
    const fallback =
      place.fallbackName && place.fallbackCountryCode
        ? { name: place.fallbackName, countryCode: place.fallbackCountryCode }
        : undefined
    void resolvePlaceInfo(place.kind, place.refId, fallback).then((r) => {
      if (!cancelled) setInfo(r)
    })
    return () => {
      cancelled = true
    }
  }, [place.kind, place.refId, place.fallbackName, place.fallbackCountryCode])

  const data = useLiveQuery(async (): Promise<SheetData> => {
    const row = await db.entries.where('[kind+refId]').equals([place.kind, place.refId]).first()
    const entry = row && row.deletedAt === null ? row : null

    const capturing = entry ? await getCapturingTrip() : null
    const onCapturingTrip = capturing
      ? (await db.tripEntries.where('entryId').equals(entry!.id).filter((te) => te.tripId === capturing.id && te.deletedAt === null).count()) > 0
      : false

    const state = await loadCascadeState().catch(() => null)
    const cause = state ? explainStatus(state, place.kind, place.refId) : null
    if (!cause) return { entry, explanation: null, onCapturingTrip }
    const becauseInfo = await resolvePlaceInfo(cause.because.kind, cause.because.refId)
    return {
      entry,
      explanation: { status: cause.status, becauseName: becauseInfo?.name ?? 'a place inside it' },
      onCapturingTrip,
    }
  }, [place.kind, place.refId])

  const entryId = data?.entry?.id
  const attachments = useLiveQuery(() => (entryId ? tripAttachmentsForEntry(entryId) : Promise.resolve([])), [entryId])
  const capturingTrip = useLiveQuery(() => getCapturingTrip())
  const backfillingTrip = capturingTrip?.isBackfilling ? capturingTrip : null

  // Saves on change, for any trip (past or capturing) — the trip's dates
  // stretch to cover the new one, and its route re-orders by it.
  async function changeVisitDate(tripEntryId: string, visitedDate: string | null) {
    setError(null)
    try {
      await setVisitDate(tripEntryId, visitedDate)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeTripVisit(tripEntryId: string) {
    setError(null)
    try {
      await removeVisit(tripEntryId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const settings = useLiveQuery(() => settingsRepo.get())
  const [date, setDate] = useState<string | null>(null)
  const [dateTouched, setDateTouched] = useState(false)
  useEffect(() => {
    if (dateTouched) return
    if (data === undefined || capturingTrip === undefined) return // still loading — wait, so `defaultDateToToday` below can't race ahead of a real backfilling trip and lock in today's date first
    // While a trip is capturing, the date here is always the date of a *new*
    // visit on that trip — never the place's own firstVisited (a city lived in
    // years ago must not offer that as the trip's date), and never an existing
    // visit's (those are listed under Trips; "Add another visit" records a
    // second one). So an already-logged place gets the same default a
    // brand-new one does, below.
    if (data.entry && !capturingTrip) {
      // existing entry, no trip capturing — show its own date, or leave blank; don't override with today defaults
      if (data.entry.firstVisited) setDate(data.entry.firstVisited)
      return
    }
    if (backfillingTrip?.startDate) {
      // A new visit on this backfilling trip — chain off the last place
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
      // A new place (or a new visit on the capturing trip) — pre-fill and count it as an
      // explicit choice, so a bare status tap does save today's date, which
      // is the point of the "default new entries to today" preference.
      setDate(todayISO())
      setDateTouched(true)
    }
  }, [data, dateTouched, settings, backfillingTrip, capturingTrip])

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(status: Status) {
    setError(null)
    setPending(true)
    try {
      await setPlaceStatus({
        kind: place.kind,
        refId: place.refId,
        status,
        ...(dateTouched ? { firstVisited: date, lastVisited: date } : {}),
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  // A second (third, …) visit to a place already on the capturing trip — out
  // and back again. Only ever deliberate: a status tap never adds one.
  async function addAnotherVisit() {
    if (!capturingTrip || !entryId || !date) return
    setError(null)
    setPending(true)
    try {
      await addVisit(capturingTrip.id, entryId, date)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  async function remove() {
    if (!data?.entry) return
    setError(null)
    setPending(true)
    try {
      await removePlaceEntry(data.entry.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPending(false)
    }
  }

  function withinTrailingClickGuard() {
    return performance.now() - openedAtRef.current < SPURIOUS_TRAILING_CLICK_GUARD_MS
  }

  function onBackdropClick() {
    if (withinTrailingClickGuard()) return
    onClose()
  }

  // Capture-phase: runs before the click reaches whatever's actually under
  // it (the date field, a status button, ...), so swallowing it here stops
  // that element's own onClick — e.g. DateField's showPicker() — from ever
  // firing, not just from bubbling further.
  function onPanelClickCapture(e: React.MouseEvent) {
    if (withinTrailingClickGuard()) {
      e.stopPropagation()
      e.preventDefault()
    }
  }

  return (
    <div className="place-sheet-backdrop" onClick={onBackdropClick}>
      <div
        className="place-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={info?.name ?? 'Place'}
        onClick={(e) => e.stopPropagation()}
        onClickCapture={onPanelClickCapture}
      >
        <div className="place-sheet__handle" aria-hidden="true" />
        <header className="place-sheet__header">
          <div>
            <p className="place-sheet__eyebrow mono">
              {info && flagEmoji(info.countryCode)} {info?.countryCode}
            </p>
            <h2 className="place-sheet__name">{info?.name ?? '…'}</h2>
            {info && info.breadcrumb.length > 0 && (
              <p className="place-sheet__breadcrumb">{info.breadcrumb.join(', ')}</p>
            )}
          </div>
          <button type="button" className="place-sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {data?.entry && (
          <div className="place-sheet__current">
            <span
              className="place-sheet__current-dot"
              style={{ background: STATUS_COLOR_VAR[data.entry.status] }}
              aria-hidden="true"
            />
            <span className="place-sheet__current-label">
              Currently {STATUS_LABEL[data.entry.status]}
              {data.explanation && ` — because ${data.explanation.becauseName} is ${STATUS_LABEL[data.explanation.status].toLowerCase()}`}
            </span>
          </div>
        )}

        <div className="place-sheet__date">
          <span>Date (optional)</span>
          {backfillingTrip && <p className="place-sheet__backfill-note">Backfilling "{backfillingTrip.name}"</p>}
          <DateField
            value={date}
            ariaLabel="Date"
            onChange={(v) => {
              setDate(v)
              setDateTouched(true)
            }}
          />
          {capturingTrip && data?.onCapturingTrip && (
            <button
              type="button"
              className="place-sheet__add-visit"
              onClick={() => void addAnotherVisit()}
              disabled={pending || !date}
            >
              Add another visit to "{capturingTrip.name}"
            </button>
          )}
        </div>

        <div className="place-sheet__options">
          {STATUS_ORDER.map((status) => {
            const isCurrent = data?.entry?.explicit === true && data.entry.explicitStatus === status
            return (
              <button
                key={status}
                type="button"
                className="place-sheet__option"
                style={{ '--option-color': STATUS_COLOR_VAR[status] } as CSSProperties}
                onClick={() => void pick(status)}
                disabled={pending}
                aria-pressed={isCurrent}
              >
                <span className="place-sheet__option-label">{STATUS_LABEL[status]}</span>
                <span className="place-sheet__option-desc">{STATUS_DESCRIPTION[status]}</span>
              </button>
            )
          })}
        </div>

        {data?.entry && attachments && attachments.length > 0 && (
          <div className="place-sheet__trips">
            <p className="place-sheet__trips-label">Trips</p>
            <div className="place-sheet__trips-list">
              {attachments.map((a) => (
                <div key={a.tripEntryId} className="place-sheet__trip-row">
                  <div className="place-sheet__trip-main">
                    <p className="place-sheet__trip-name">{a.tripName}</p>
                    <div className="place-sheet__trip-date">
                      <DateField
                        value={a.visitedDate}
                        placeholder="No date"
                        ariaLabel={`Date of this visit on ${a.tripName}`}
                        onChange={(v) => void changeVisitDate(a.tripEntryId, v)}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="place-sheet__trip-remove"
                    aria-label={`Remove this visit from ${a.tripName}`}
                    onClick={() => void removeTripVisit(a.tripEntryId)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {data?.entry && (
          <button type="button" className="place-sheet__remove" onClick={() => void remove()} disabled={pending}>
            Remove from places
          </button>
        )}

        {error && (
          <p className="place-sheet__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
