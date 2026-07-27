// The status sheet from 04-places.md task 3. One instance, mounted globally
// (see App.tsx), opened from anywhere via @/domain/placeSheetStore. Tapping a
// status option commits immediately — no separate save step, so backfilling a
// list of places (task 6) or correcting one on the fly never takes more than
// one tap plus an optional date.

import { useEffect, useState, type CSSProperties } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Entry, Status } from '@/db/types'
import { STATUS_ORDER, explainStatus, type PlaceRef } from '@/domain/cascade'
import { removePlaceEntry, setPlaceStatus, loadCascadeState } from '@/domain/cascadeRepo'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { resolvePlaceInfo, type PlaceInfo } from '@/domain/placeInfo'
import { flagEmoji } from '@/geo/flags'
import { STATUS_COLOR_VAR, STATUS_DESCRIPTION, STATUS_LABEL } from '@/components/map/statusColor'
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

function SheetContent({ place, onClose }: { place: PlaceRef; onClose: () => void }) {
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
    void resolvePlaceInfo(place.kind, place.refId).then((r) => {
      if (!cancelled) setInfo(r)
    })
    return () => {
      cancelled = true
    }
  }, [place.kind, place.refId])

  const data = useLiveQuery(async (): Promise<SheetData> => {
    const row = await db.entries.where('[kind+refId]').equals([place.kind, place.refId]).first()
    const entry = row && row.deletedAt === null ? row : null

    const state = await loadCascadeState().catch(() => null)
    const cause = state ? explainStatus(state, place.kind, place.refId) : null
    if (!cause) return { entry, explanation: null }
    const becauseInfo = await resolvePlaceInfo(cause.because.kind, cause.because.refId)
    return { entry, explanation: { status: cause.status, becauseName: becauseInfo?.name ?? 'a place inside it' } }
  }, [place.kind, place.refId])

  const [date, setDate] = useState('')
  const [dateTouched, setDateTouched] = useState(false)
  useEffect(() => {
    if (!dateTouched && data?.entry?.firstVisited) setDate(data.entry.firstVisited)
  }, [data, dateTouched])

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
        ...(dateTouched ? { firstVisited: date || null, lastVisited: date || null } : {}),
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

  return (
    <div className="place-sheet-backdrop" onClick={onClose}>
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

        <label className="place-sheet__date">
          <span>Date (optional)</span>
          <input
            type="date"
            className="place-sheet__date-input"
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              setDateTouched(true)
            }}
          />
        </label>

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
