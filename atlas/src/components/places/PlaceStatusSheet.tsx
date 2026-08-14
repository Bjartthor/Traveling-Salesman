// The status sheet from 04-places.md task 3. One instance, mounted globally
// (see App.tsx), opened from anywhere via @/domain/placeSheetStore. Tapping a
// status option commits immediately — no separate save step, so backfilling a
// list of places (task 6) or correcting one on the fly never takes more than
// one tap plus an optional date.

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import type { Entry, Status, Trip } from '@/db/types'
import { STATUS_ORDER, explainStatus, type PlaceRef } from '@/domain/cascade'
import { removePlaceEntry, setPlaceStatus, loadCascadeState } from '@/domain/cascadeRepo'
import { attachEntryToTrip, detachEntryFromTrip, listTrips, tripIdsForEntry } from '@/domain/tripRepo'
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
}

// A real touchscreen tap reliably produces a `click` on this sheet's own
// backdrop 70-77ms after it opens (confirmed via an on-device debug-log
// capture, PROGRESS.md), even with GlobeMap's pointerdown already calling
// preventDefault() — whatever the browser mechanism is, it isn't something
// this app's own pointer handling controls. No real, deliberate "tap
// outside to dismiss" happens that fast, so the backdrop just refuses to
// honour a click this soon after opening — targets the measured symptom
// directly rather than chasing the exact browser-internal cause.
const SPURIOUS_BACKDROP_CLICK_GUARD_MS = 300

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

    const state = await loadCascadeState().catch(() => null)
    const cause = state ? explainStatus(state, place.kind, place.refId) : null
    if (!cause) return { entry, explanation: null }
    const becauseInfo = await resolvePlaceInfo(cause.because.kind, cause.because.refId)
    return { entry, explanation: { status: cause.status, becauseName: becauseInfo?.name ?? 'a place inside it' } }
  }, [place.kind, place.refId])

  const trips = useLiveQuery(() => listTrips())
  const sortedTrips = trips ? [...trips].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? '')) : []
  const entryId = data?.entry?.id
  const attachedTripIds = useLiveQuery(
    () => (entryId ? tripIdsForEntry(entryId) : Promise.resolve(new Set<string>())),
    [entryId],
  )

  async function toggleTrip(trip: Trip, attached: boolean) {
    if (!entryId) return
    setError(null)
    try {
      if (attached) await detachEntryFromTrip(trip.id, entryId)
      else await attachEntryToTrip(trip.id, entryId)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

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

  function onBackdropClick() {
    if (performance.now() - openedAtRef.current < SPURIOUS_BACKDROP_CLICK_GUARD_MS) return
    onClose()
  }

  return (
    <div className="place-sheet-backdrop" onClick={onBackdropClick}>
      <div
        className="place-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={info?.name ?? 'Place'}
        onClick={(e) => e.stopPropagation()}
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
          <DateField
            value={date}
            ariaLabel="Date"
            onChange={(v) => {
              setDate(v)
              setDateTouched(true)
            }}
          />
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

        {data?.entry && sortedTrips.length > 0 && (
          <div className="place-sheet__trips">
            <p className="place-sheet__trips-label">Trips</p>
            <div className="place-sheet__trips-list">
              {sortedTrips.map((trip) => {
                const attached = attachedTripIds?.has(trip.id) ?? false
                return (
                  <button
                    key={trip.id}
                    type="button"
                    className={`place-sheet__trip-toggle${attached ? ' place-sheet__trip-toggle--on' : ''}`}
                    aria-pressed={attached}
                    onClick={() => void toggleTrip(trip, attached)}
                  >
                    {trip.name}
                  </button>
                )
              })}
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
