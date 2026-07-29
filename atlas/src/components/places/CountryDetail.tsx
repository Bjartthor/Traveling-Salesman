// The full country detail screen (04-places.md task 5) — replaces the Phase
// 3 CountrySheet stopgap. A full-screen overlay (not a routed screen — see
// the session's scope decision), "reached from the map or the list."
//
// Editing happens through the same global place-status sheet as everywhere
// else: tapping the status row opens it for the country itself, tapping a
// region on the admin-1 map opens it for that subdivision, tapping a city
// opens it for that city. This screen only displays and routes taps.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { City, Country, Entry, Photo, Status } from '@/db/types'
import { explainStatus } from '@/domain/cascade'
import { loadCascadeState } from '@/domain/cascadeRepo'
import { resolvePlaceInfo } from '@/domain/placeInfo'
import { listPhotosForEntries, softDeletePhoto, updateCaption } from '@/domain/photoRepo'
import { countrySubdivisionsVisited } from '@/stats/coverage'
import { useCountryDetailStore } from '@/domain/countryDetailStore'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { flagEmoji } from '@/geo/flags'
import { colorForStatus, STATUS_LABEL } from '@/components/map/statusColor'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { CountryAdmin1Map } from '@/components/places/CountryAdmin1Map'
import { PhotoGrid } from '@/components/photos/PhotoGrid'
import { PhotoViewer } from '@/components/photos/PhotoViewer'
import { AddPhotosButton } from '@/components/photos/AddPhotosButton'
import './CountryDetail.css'

const nf = new Intl.NumberFormat()

export function CountryDetail() {
  const openCode = useCountryDetailStore((s) => s.openCode)
  const close = useCountryDetailStore((s) => s.close)
  if (!openCode) return null
  return <CountryDetailContent key={openCode} code={openCode} onClose={close} />
}

interface DetailData {
  country: Country
  entry: Entry | null
  subdivisionTotal: number
  subdivisionStatus: Map<string, Status>
  cities: { entry: Entry; city: City }[]
  explanation: { status: Status; becauseName: string } | null
  photos: Photo[]
}

function CountryDetailContent({ code, onClose }: { code: string; onClose: () => void }) {
  const openSheet = usePlaceSheetStore((s) => s.open)

  const data = useLiveQuery(async (): Promise<DetailData | null> => {
    const country = await db.countries.get(code)
    if (!country) return null

    const [entryRow, subdivisionTotal, allEntries] = await Promise.all([
      db.entries.where('[kind+refId]').equals(['country', code]).first(),
      db.subdivisions.where('countryCode').equals(code).count(),
      db.entries.toArray(),
    ])
    const entry = entryRow && entryRow.deletedAt === null ? entryRow : null
    const active = allEntries.filter((e) => e.deletedAt === null)

    const subdivisionEntries = active.filter((e) => e.kind === 'subdivision' && e.refId.startsWith(`${code}.`))
    const subdivisionStatus = new Map(subdivisionEntries.map((e) => [e.refId, e.status]))

    const cityEntries = active.filter((e) => e.kind === 'city')
    const cityRows = await db.cities.bulkGet(cityEntries.map((e) => Number(e.refId)))
    const cities: { entry: Entry; city: City }[] = []
    cityEntries.forEach((e, i) => {
      const city = cityRows[i]
      if (city && city.countryCode === code) cities.push({ entry: e, city })
    })
    cities.sort((a, b) => a.city.name.localeCompare(b.city.name))

    // A country has no dedicated per-subdivision/per-city photo screen (see
    // PROGRESS.md) — photos tagged anywhere in the country still need
    // somewhere real to surface, so this rolls up every descendant's photos
    // onto the one detail screen that does exist for this whole subtree.
    const photoEntryIds = [entry?.id, ...subdivisionEntries.map((e) => e.id), ...cities.map((c) => c.entry.id)].filter(
      (id): id is string => id !== undefined,
    )
    const photos = await listPhotosForEntries(photoEntryIds)

    const state = await loadCascadeState().catch(() => null)
    const cause = state ? explainStatus(state, 'country', code) : null
    const explanation = cause
      ? { status: cause.status, becauseName: (await resolvePlaceInfo(cause.because.kind, cause.because.refId))?.name ?? 'a place inside it' }
      : null

    return { country, entry, subdivisionTotal, subdivisionStatus, cities, explanation, photos }
  }, [code])

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

  const { country, entry, subdivisionTotal, subdivisionStatus, cities, explanation, photos } = data
  const subdivisionsVisited = countrySubdivisionsVisited(code, subdivisionStatus)

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
                    {e.lastVisited && <span className="country-detail__city-date mono">{e.lastVisited}</span>}
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
