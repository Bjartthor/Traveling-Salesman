import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { buildStatusIndex, metricCoverage, nextStatMode } from '@/stats/coverage'
import { WorldMap } from '@/components/map/WorldMap'
import { GlobeMap } from '@/components/map/GlobeMap'
import { CoverageHeadline } from '@/components/map/CoverageHeadline'
import { CoverageStrip } from '@/components/map/CoverageStrip'
import { Legend } from '@/components/map/Legend'
import { CountrySheet } from '@/components/map/CountrySheet'
import { MapIcon } from '@/components/nav/BottomNav'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { useTripMapStore } from '@/domain/tripMapStore'
import { loadTripPlaces } from '@/domain/tripPlacesRepo'
import { tripCityRows, tripCountryCodes } from '@/domain/tripPlaces'
import { tripRoute } from '@/domain/tripRoute'
import { formatLongDate } from '@/domain/dateFormat'
import type { TripOverlay } from '@/components/map/tripMapView'
import type { Status } from '@/db/types'
import { countedQuery } from '@/debug/census'
import './MapScreen.css'

// Module-scope: stable across renders, matching these queries' implicit
// `deps: []` (dexie-react-hooks normalizes an omitted deps array the same
// way). `entries` is the table every sync merge clears + rewrites, and its
// result cascades into 3 useMemos + the whole map render below — the
// sharpest remaining liveQuery suspect once the shell-level ones were ruled
// out flat across a real crash (see PROGRESS.md / memory).
const queryCountries = countedQuery('lqCountries', () => db.countries.toArray())
const queryEntries = countedQuery('lqEntries', () => db.entries.filter((e) => e.deletedAt === null).toArray())
const queryMapSettings = countedQuery('lqMapSettings', () => db.settings.get(1))

// In a trip view the regular zoom-gated city layer shows nothing — the trip's
// own cities come through the maps' `trip` overlay instead, at every zoom.
const NO_CITIES: ReadonlyMap<string, Status> = new Map()

function onlyKeys(statuses: Map<string, Status>, keep: ReadonlySet<string>): Map<string, Status> {
  return new Map([...statuses].filter(([key]) => keep.has(key)))
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </svg>
  )
}

export function MapScreen() {
  const countries = useLiveQuery(queryCountries)
  const entries = useLiveQuery(queryEntries)
  const settings = useLiveQuery(queryMapSettings)

  // The selected country: drives WorldMap's admin-1 breakdown + auto-zoom
  // *and* the country sheet below, in place of the old full-screen popup.
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const openPlaceSheet = usePlaceSheetStore((s) => s.open)

  // --- trip view (docs/superpowers/specs/2026-10-12-trip-on-main-map-design.md):
  // one trip shown on its own — its countries/regions keep their colours,
  // everything else goes grey, its cities and route are drawn on top. ---
  const shownTripId = useTripMapStore((s) => s.tripId)
  const clearShownTrip = useTripMapStore((s) => s.clear)
  const shownTrip = useLiveQuery(async () => {
    if (!shownTripId) return null
    const trip = await db.trips.get(shownTripId)
    if (!trip || trip.deletedAt !== null) return null
    return { trip, groups: await loadTripPlaces(shownTripId) }
  }, [shownTripId])
  // A trip deleted while shown (or never found) just drops back to the normal map.
  useEffect(() => {
    if (shownTripId && shownTrip === null) clearShownTrip()
  }, [shownTripId, shownTrip, clearShownTrip])
  // Entering or leaving a trip view starts with no country selected.
  useEffect(() => setSelectedCode(null), [shownTripId])

  const tripView = useMemo(() => {
    if (!shownTrip) return null
    const { trip, groups } = shownTrip
    const rows = tripCityRows(groups)
    const overlay: TripOverlay = {
      id: trip.id,
      cities: rows
        .filter((r): r is typeof r & { lat: number; lon: number } => r.lat !== null && r.lon !== null)
        .map((r) => ({ refId: r.refId, name: r.name, lat: r.lat, lon: r.lon, status: r.status })),
      route: tripRoute(rows),
    }
    return {
      trip,
      countryCodes: new Set(tripCountryCodes(groups)),
      subdivisionIds: new Set(groups.flatMap((g) => g.subdivisions.map((s) => s.key))),
      overlay,
    }
  }, [shownTrip])

  const countryStatus = useMemo(() => buildStatusIndex(entries ?? [], 'country'), [entries])
  const subdivisionStatus = useMemo(() => buildStatusIndex(entries ?? [], 'subdivision'), [entries])
  const cityStatus = useMemo(() => buildStatusIndex(entries ?? [], 'city'), [entries])

  // What the maps actually paint: everything, or in a trip view only the trip's own places.
  const mapCountryStatus = useMemo(() => (tripView ? onlyKeys(countryStatus, tripView.countryCodes) : countryStatus), [tripView, countryStatus])
  const mapSubdivisionStatus = useMemo(
    () => (tripView ? onlyKeys(subdivisionStatus, tripView.subdivisionIds) : subdivisionStatus),
    [tripView, subdivisionStatus],
  )
  const mapCityStatus = tripView ? NO_CITIES : cityStatus

  const metric = useMemo(
    () =>
      countries && settings
        ? metricCoverage(settings.statMode, countries, countryStatus, settings.countryDenominator)
        : null,
    [countries, settings, countryStatus],
  )

  // Fully grey map + one line of guidance is the fresh-install state — an
  // invitation, not an empty-state apology (03-map-and-stats.md §5).
  const hasAnyEntries = (entries?.length ?? 0) > 0

  if (!countries || !settings || !metric) return null

  function selectCountry(code: string) {
    // tapping the already-selected country again deselects it
    setSelectedCode((prev) => (prev === code ? null : code))
  }

  // Admin-1 topology ids aren't always in the GeoNames CC.NN namespace
  // `db.subdivisions` is keyed by (Natural Earth falls back to its own
  // adm1_code or a bare ISO-3166-2 code when it has no GeoNames
  // cross-reference for that region — see PROGRESS.md) — when that lookup
  // misses, resolvePlaceInfo has no name to show. The map already decoded a
  // real name for whatever it just drew, so pass it through as a fallback
  // rather than let the sheet open with a blank title.
  function selectSubdivision(id: string, name: string) {
    openPlaceSheet({ kind: 'subdivision', refId: id, fallbackName: name, fallbackCountryCode: selectedCode ?? undefined })
  }

  const isGlobe = settings.mapView === 'globe'

  return (
    <div className="map-screen">
      <div className="map-screen__header">
        {tripView ? (
          <div className="map-screen__trip-header">
            <button type="button" className="map-screen__trip-close" onClick={clearShownTrip} aria-label="Close trip view" title="Close trip view">
              ✕
            </button>
            <p className="map-screen__trip-eyebrow mono">Trip</p>
            <h1 className="map-screen__trip-name">{tripView.trip.name}</h1>
            <p className="map-screen__trip-dates mono">
              {tripView.trip.startDate ? formatLongDate(tripView.trip.startDate) : '—'} –{' '}
              {tripView.trip.endDate ? formatLongDate(tripView.trip.endDate) : 'ongoing'}
            </p>
          </div>
        ) : (
          <CoverageHeadline
            metric={metric}
            mode={settings.statMode}
            onCycle={() => void settingsRepo.update({ statMode: nextStatMode(settings.statMode) })}
          />
        )}
        <button
          type="button"
          className="map-screen__view-toggle"
          onClick={() => void settingsRepo.update({ mapView: isGlobe ? 'flat' : 'globe' })}
          aria-label={isGlobe ? 'Switch to flat map' : 'Switch to 3D globe'}
          title={isGlobe ? 'Switch to flat map' : 'Switch to 3D globe'}
        >
          {isGlobe ? <MapIcon /> : <GlobeIcon />}
        </button>
      </div>
      <div className="map-screen__map-wrap">
        {isGlobe ? (
          <GlobeMap
            countryStatus={mapCountryStatus}
            subdivisionStatus={mapSubdivisionStatus}
            cityStatus={mapCityStatus}
            trip={tripView?.overlay}
            selectedCode={selectedCode}
            onSelectCountry={selectCountry}
            onSelectSubdivision={selectSubdivision}
            onSelectCity={(refId) => openPlaceSheet({ kind: 'city', refId })}
            onDeselect={() => setSelectedCode(null)}
          />
        ) : (
          <WorldMap
            countryStatus={mapCountryStatus}
            subdivisionStatus={mapSubdivisionStatus}
            cityStatus={mapCityStatus}
            trip={tripView?.overlay}
            selectedCode={selectedCode}
            onSelectCountry={selectCountry}
            onSelectSubdivision={selectSubdivision}
            onSelectCity={(refId) => openPlaceSheet({ kind: 'city', refId })}
            onDeselect={() => setSelectedCode(null)}
          />
        )}
        {!hasAnyEntries && !tripView && <p className="map-screen__hint">Log a place on the Places tab to see it here.</p>}
      </div>
      {!tripView && <CoverageStrip metric={metric} mode={settings.statMode} />}
      <Legend />
      {selectedCode && <CountrySheet code={selectedCode} onClose={() => setSelectedCode(null)} />}
    </div>
  )
}
