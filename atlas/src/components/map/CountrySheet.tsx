// Read-only country detail sheet — the Phase 3 stopgap described in
// 03-map-and-stats.md task 1. Phase 4 replaces this with the full,
// editable country detail screen; this version only shows what's already
// on record, with no way to change it.

import { useEffect, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Country, Entry, Status } from '@/db/types'
import { countCitiesVisited, countrySubdivisionsVisited } from '@/stats/coverage'
import { STATUS_LABEL, colorForStatus } from '@/components/map/statusColor'
import './CountrySheet.css'

interface CountrySheetProps {
  country: Country
  entry: Entry | undefined
  subdivisionStatus: Map<string, Status>
  cityStatus: Map<string, Status>
  onClose: () => void
}

export function CountrySheet({ country, entry, subdivisionStatus, cityStatus, onClose }: CountrySheetProps) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const subdivisionTotal = useLiveQuery(
    () => db.subdivisions.where('countryCode').equals(country.code).count(),
    [country.code],
  )
  const cityIds = useLiveQuery(
    () => db.cities.where('countryCode').equals(country.code).primaryKeys() as Promise<number[]>,
    [country.code],
  )

  const subdivisionsVisited = useMemo(
    () => countrySubdivisionsVisited(country.code, subdivisionStatus),
    [country.code, subdivisionStatus],
  )
  const citiesVisited = useMemo(
    () => (cityIds ? countCitiesVisited(cityIds, cityStatus) : 0),
    [cityIds, cityStatus],
  )

  const status = entry?.status

  return (
    <div className="country-sheet-backdrop" onClick={onClose}>
      <div
        className="country-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={country.name}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="country-sheet__handle" aria-hidden="true" />
        <header className="country-sheet__header">
          <div>
            <p className="country-sheet__code mono">{country.code}</p>
            <h2 className="country-sheet__name">{country.name}</h2>
          </div>
          <button type="button" className="country-sheet__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="country-sheet__status">
          <span
            className="country-sheet__status-dot"
            style={{ background: colorForStatus(status) }}
            aria-hidden="true"
          />
          <span className="country-sheet__status-label">{status ? STATUS_LABEL[status] : 'Not logged yet'}</span>
        </div>

        <dl className="country-sheet__stats">
          {subdivisionTotal !== undefined && subdivisionTotal > 0 && (
            <div className="country-sheet__stat">
              <dt>Regions visited</dt>
              <dd>
                {subdivisionsVisited} / {subdivisionTotal}
              </dd>
            </div>
          )}
          <div className="country-sheet__stat">
            <dt>Cities visited</dt>
            <dd>{citiesVisited}</dd>
          </div>
          {entry?.firstVisited && (
            <div className="country-sheet__stat">
              <dt>First visited</dt>
              <dd>{entry.firstVisited}</dd>
            </div>
          )}
          {entry?.lastVisited && (
            <div className="country-sheet__stat">
              <dt>Last visited</dt>
              <dd>{entry.lastVisited}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  )
}
