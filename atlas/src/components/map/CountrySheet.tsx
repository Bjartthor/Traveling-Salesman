// The map's own country panel — replaces opening the full-screen CountryDetail
// when a country is tapped on the Map tab. Same information and the same
// editing actions (tap status / a city to open the place-status sheet, add
// photos), but as a draggable bottom sheet with no backdrop: the map — and
// the countries around the selected one — stays visible and interactive the
// whole time. A country's regions are no longer drawn on a second, separate
// mini-map here; WorldMap now shows them in place on the real map instead
// (see WorldMap.tsx's auto-zoom-on-select effect), so tapping a region opens
// the status sheet directly via `onSelectSubdivision` on WorldMap.
//
// CountryDetail (opened from the Places list, where there's no map behind it
// to keep visible) is unchanged and still exists side by side with this.

import { useEffect, useRef, useState } from 'react'
import { useCountryDetailData, type CountryDetailData } from '@/domain/useCountryDetailData'
import { countrySubdivisionsVisited } from '@/stats/coverage'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import type { PlaceRef } from '@/domain/cascade'
import { flagEmoji } from '@/geo/flags'
import { colorForStatus, STATUS_LABEL } from '@/components/map/statusColor'
import { PhotoGrid } from '@/components/photos/PhotoGrid'
import { PhotoViewer } from '@/components/photos/PhotoViewer'
import { AddPhotosButton } from '@/components/photos/AddPhotosButton'
import { softDeletePhoto, updateCaption } from '@/domain/photoRepo'
import {
  COUNTRY_SHEET_CLOSE_THRESHOLD_VH,
  COUNTRY_SHEET_EXPANDED_VH,
  COUNTRY_SHEET_MIN_DRAG_VH,
  COUNTRY_SHEET_PEEK_VH,
} from '@/domain/countrySheetLayout'
import './CountrySheet.css'

const nf = new Intl.NumberFormat()

interface CountrySheetProps {
  code: string
  onClose: () => void
}

export function CountrySheet({ code, onClose }: CountrySheetProps) {
  const openSheet = usePlaceSheetStore((s) => s.open)
  const data = useCountryDetailData(code)

  const [viewerIndex, setViewerIndex] = useState<number | null>(null)
  useEffect(() => setViewerIndex(null), [code])

  const [heightVh, setHeightVh] = useState(COUNTRY_SHEET_PEEK_VH)
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragRef.current
      if (!drag) return
      const deltaVh = ((drag.startY - e.clientY) / window.innerHeight) * 100
      const next = Math.min(Math.max(drag.startHeight + deltaVh, COUNTRY_SHEET_MIN_DRAG_VH), COUNTRY_SHEET_EXPANDED_VH)
      setHeightVh(next)
    }
    function onPointerUp() {
      if (!dragRef.current) return
      dragRef.current = null
      setIsDragging(false)
      setHeightVh((current) => {
        if (current < COUNTRY_SHEET_CLOSE_THRESHOLD_VH) {
          onClose()
          return current
        }
        const midpoint = (COUNTRY_SHEET_PEEK_VH + COUNTRY_SHEET_EXPANDED_VH) / 2
        return current < midpoint ? COUNTRY_SHEET_PEEK_VH : COUNTRY_SHEET_EXPANDED_VH
      })
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
    }
  }, [onClose])

  function onHandlePointerDown(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, startHeight: heightVh }
    setIsDragging(true)
  }

  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  if (data === null) return null // not a real country code — nothing to show

  return (
    <div
      className="country-sheet"
      role="dialog"
      aria-label={data ? data.country.name : 'Country'}
      style={{
        height: `${heightVh}vh`,
        transition: isDragging || reduceMotion ? 'none' : undefined,
      }}
    >
      <div className="country-sheet__drag-handle" onPointerDown={onHandlePointerDown}>
        <div className="country-sheet__handle-bar" aria-hidden="true" />
      </div>

      {data === undefined ? (
        <p className="country-sheet__empty">Loading…</p>
      ) : (
        <CountrySheetContent data={data} onClose={onClose} onOpenPlaceSheet={openSheet} viewerIndex={viewerIndex} onViewerIndexChange={setViewerIndex} />
      )}
    </div>
  )
}

function CountrySheetContent({
  data,
  onClose,
  onOpenPlaceSheet,
  viewerIndex,
  onViewerIndexChange,
}: {
  data: CountryDetailData
  onClose: () => void
  onOpenPlaceSheet: (place: PlaceRef) => void
  viewerIndex: number | null
  onViewerIndexChange: (index: number | null) => void
}) {
  const { country, entry, subdivisionTotal, subdivisionStatus, cities, explanation, photos } = data
  const code = country.code
  const subdivisionsVisited = countrySubdivisionsVisited(code, subdivisionStatus)

  return (
    <>
      <header className="country-sheet__header">
        <div>
          <p className="country-sheet__eyebrow mono">
            {flagEmoji(code)} {code}
          </p>
          <h2 className="country-sheet__name">{country.name}</h2>
        </div>
        <button type="button" className="country-sheet__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="country-sheet__body">
        <button
          type="button"
          className="country-sheet__status"
          onClick={() => onOpenPlaceSheet({ kind: 'country', refId: code })}
        >
          <span className="country-sheet__status-dot" style={{ background: colorForStatus(entry?.status) }} aria-hidden="true" />
          <span className="country-sheet__status-text">
            <span className="country-sheet__status-label">
              {entry ? STATUS_LABEL[entry.status] : 'Not logged yet'}
              {entry && !entry.explicit ? ' · derived' : ''}
            </span>
            {explanation && (
              <span className="country-sheet__status-because">
                because {explanation.becauseName} is {STATUS_LABEL[explanation.status].toLowerCase()}
              </span>
            )}
          </span>
        </button>

        <dl className="country-sheet__stats">
          {subdivisionTotal > 0 && (
            <div className="country-sheet__stat">
              <dt>Regions visited</dt>
              <dd>
                {subdivisionsVisited} / {subdivisionTotal}
              </dd>
            </div>
          )}
          <div className="country-sheet__stat">
            <dt>Area</dt>
            <dd>{nf.format(Math.round(country.areaKm2))} km²</dd>
          </div>
          <div className="country-sheet__stat">
            <dt>Population</dt>
            <dd>{nf.format(country.population)}</dd>
          </div>
          {country.capital && (
            <div className="country-sheet__stat">
              <dt>Capital</dt>
              <dd>{country.capital}</dd>
            </div>
          )}
        </dl>

        <section className="country-sheet__section">
          <h3 className="country-sheet__section-title">Cities</h3>
          {cities.length === 0 ? (
            <p className="country-sheet__empty">No cities recorded yet.</p>
          ) : (
            <ul className="country-sheet__city-list">
              {cities.map(({ entry: e, city }) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="country-sheet__city-row"
                    onClick={() => onOpenPlaceSheet({ kind: 'city', refId: e.refId })}
                  >
                    <span className="country-sheet__bar" style={{ background: colorForStatus(e.status) }} aria-hidden="true" />
                    <span className="country-sheet__city-name">{city.name}</span>
                    {e.lastVisited && <span className="country-sheet__city-date mono">{e.lastVisited}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="country-sheet__section">
          <h3 className="country-sheet__section-title">Photos</h3>
          {entry ? (
            <AddPhotosButton entryId={entry.id} tripId={null} />
          ) : (
            <p className="country-sheet__empty">Set a status above first, then you can attach photos here.</p>
          )}
          <PhotoGrid photos={photos} onSelect={onViewerIndexChange} />
        </section>
      </div>

      {viewerIndex !== null && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          onClose={() => onViewerIndexChange(null)}
          onIndexChange={onViewerIndexChange}
          onCaptionChange={(photo, caption) => updateCaption(photo.id, caption)}
          onDelete={(photo) => softDeletePhoto(photo.id)}
        />
      )}
    </>
  )
}
