// The full country detail screen (04-places.md task 5) — replaces the Phase
// 3 CountrySheet stopgap. A full-screen overlay (not a routed screen — see
// the session's scope decision), "reached from the map or the list."
//
// Editing happens through the same global place-status sheet as everywhere
// else: tapping the status row opens it for the country itself, tapping a
// region on the admin-1 map opens it for that subdivision, tapping a city
// opens it for that city. This screen only displays and routes taps.

import { useState } from 'react'
import { useCountryDetailData } from '@/domain/useCountryDetailData'
import { countrySubdivisionsVisited } from '@/stats/coverage'
import { useCountryDetailStore } from '@/domain/countryDetailStore'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { formatLongDate } from '@/domain/dateFormat'
import { flagEmoji } from '@/geo/flags'
import { colorForStatus, STATUS_LABEL } from '@/components/map/statusColor'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { CountryAdmin1Map } from '@/components/places/CountryAdmin1Map'
import { PhotoGrid } from '@/components/photos/PhotoGrid'
import { PhotoViewer } from '@/components/photos/PhotoViewer'
import { AddPhotosButton } from '@/components/photos/AddPhotosButton'
import { softDeletePhoto, updateCaption } from '@/domain/photoRepo'
import './CountryDetail.css'

const nf = new Intl.NumberFormat()

export function CountryDetail() {
  const openCode = useCountryDetailStore((s) => s.openCode)
  const close = useCountryDetailStore((s) => s.close)
  if (!openCode) return null
  return <CountryDetailContent key={openCode} code={openCode} onClose={close} />
}

function CountryDetailContent({ code, onClose }: { code: string; onClose: () => void }) {
  const openSheet = usePlaceSheetStore((s) => s.open)
  const data = useCountryDetailData(code)

  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  if (data === null) {
    return (
      <FullScreenOverlay title="Not found" onClose={onClose}>
        <p className="country-detail__empty">This country isn’t in the reference data.</p>
      </FullScreenOverlay>
    )
  }
  if (data === undefined) {
    return (
      <FullScreenOverlay title="Loading…" onClose={onClose}>
        <p className="country-detail__empty">Loading…</p>
      </FullScreenOverlay>
    )
  }

  const { country, entry, subdivisionTotal, subdivisionIds, subdivisionStatus, cities, explanation, photos } = data
  const subdivisionsVisited = countrySubdivisionsVisited(code, subdivisionStatus, subdivisionIds)

  return (
    <FullScreenOverlay title={country.name} onClose={onClose}>
      <div className="country-detail">
        <p className="country-detail__eyebrow mono">
          {flagEmoji(code)} {code}
        </p>

        <button
          type="button"
          className="country-detail__status"
          onClick={() => openSheet({ kind: 'country', refId: code })}
        >
          <span className="country-detail__status-dot" style={{ background: colorForStatus(entry?.status) }} aria-hidden="true" />
          <span className="country-detail__status-text">
            <span className="country-detail__status-label">
              {entry ? STATUS_LABEL[entry.status] : 'Not logged yet'}
              {entry && !entry.explicit ? ' · derived' : ''}
            </span>
            {explanation && (
              <span className="country-detail__status-because">
                because {explanation.becauseName} is {STATUS_LABEL[explanation.status].toLowerCase()}
              </span>
            )}
          </span>
        </button>

        <CountryAdmin1Map
          countryCode={code}
          subdivisionStatus={subdivisionStatus}
          onSelect={(subdivisionId) => openSheet({ kind: 'subdivision', refId: subdivisionId })}
        />

        <dl className="country-detail__stats">
          {subdivisionTotal > 0 && (
            <div className="country-detail__stat">
              <dt>Regions visited</dt>
              <dd>
                {subdivisionsVisited} / {subdivisionTotal}
              </dd>
            </div>
          )}
          <div className="country-detail__stat">
            <dt>Area</dt>
            <dd>{nf.format(Math.round(country.areaKm2))} km²</dd>
          </div>
          <div className="country-detail__stat">
            <dt>Population</dt>
            <dd>{nf.format(country.population)}</dd>
          </div>
          {country.capital && (
            <div className="country-detail__stat">
              <dt>Capital</dt>
              <dd>{country.capital}</dd>
            </div>
          )}
        </dl>

        <section className="country-detail__section">
          <h2 className="country-detail__section-title">Cities</h2>
          {cities.length === 0 ? (
            <p className="country-detail__empty">No cities recorded yet.</p>
          ) : (
            <ul className="country-detail__city-list">
              {cities.map(({ entry: e, city }) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className="country-detail__city-row"
                    onClick={() => openSheet({ kind: 'city', refId: e.refId })}
                  >
                    <span className="country-detail__bar" style={{ background: colorForStatus(e.status) }} aria-hidden="true" />
                    <span className="country-detail__city-name">{city.name}</span>
                    {e.lastVisited && <span className="country-detail__city-date mono">{formatLongDate(e.lastVisited)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="country-detail__section">
          <h2 className="country-detail__section-title">Photos</h2>
          {entry ? (
            <AddPhotosButton entryId={entry.id} tripId={null} />
          ) : (
            <p className="country-detail__empty">Set a status above first, then you can attach photos here.</p>
          )}
          <PhotoGrid photos={photos} onSelect={setViewerIndex} />
        </section>
      </div>

      {viewerIndex !== null && (
        <PhotoViewer
          photos={photos}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
          onCaptionChange={(photo, caption) => updateCaption(photo.id, caption)}
          onDelete={(photo) => softDeletePhoto(photo.id)}
        />
      )}
    </FullScreenOverlay>
  )
}
