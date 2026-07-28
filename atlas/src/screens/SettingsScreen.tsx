// The You/Settings tab. 05-trips.md task 5 adds the trip-statistics section
// below; everything else (headline-stat switch, theme, Google Drive sync, the
// GeoNames/Natural Earth/Photon attribution) is a later phase's work, left as
// the original placeholder note rather than half-built ahead of its own phase.

import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { loadTripCountryCodesBatch } from '@/domain/tripPlacesRepo'
import { computeTripStats, newCountriesByTrip, type TripStats } from '@/domain/tripStats'
import type { Trip } from '@/db/types'
import './SettingsScreen.css'

interface TripStatsData {
  stats: TripStats
  perTrip: { trip: Trip; newCountries: string[] }[]
}

async function loadTripStatsData(): Promise<TripStatsData> {
  const trips = await db.trips.filter((t) => t.deletedAt === null).toArray()
  const countriesByTrip = await loadTripCountryCodesBatch(trips.map((t) => t.id))
  const stats = computeTripStats({ trips, countriesByTrip })
  const newByTrip = newCountriesByTrip({ trips, countriesByTrip })

  const perTrip = trips
    .map((trip) => ({ trip, newCountries: newByTrip.get(trip.id) ?? [] }))
    .filter((r) => r.newCountries.length > 0)
    .sort((a, b) => (a.trip.startDate ?? '').localeCompare(b.trip.startDate ?? ''))

  return { stats, perTrip }
}

export function SettingsScreen() {
  const data = useLiveQuery(loadTripStatsData)

  return (
    <div className="settings-screen">
      <h1 className="settings-screen__title">You</h1>
      <p className="settings-screen__hint">
        Your headline stat, theme, Google Drive sync and the map data attribution will live here once those pieces
        are built.
      </p>

      {data && data.stats.totalTrips > 0 && (
        <section className="settings-screen__section">
          <h2 className="settings-screen__section-title">Trip statistics</h2>
          <dl className="settings-screen__stats">
            <div className="settings-screen__stat">
              <dt>Total trips</dt>
              <dd>{data.stats.totalTrips}</dd>
            </div>
            <div className="settings-screen__stat">
              <dt>Longest trip</dt>
              <dd>
                {data.stats.longestTripDays !== null
                  ? `${data.stats.longestTripDays} ${data.stats.longestTripDays === 1 ? 'day' : 'days'}`
                  : '—'}
                {data.stats.longestTripName && <span className="settings-screen__stat-sub"> · {data.stats.longestTripName}</span>}
              </dd>
            </div>
            <div className="settings-screen__stat">
              <dt>Most countries in one trip</dt>
              <dd>
                {data.stats.mostCountriesInOneTrip}
                {data.stats.mostCountriesTripName && (
                  <span className="settings-screen__stat-sub"> · {data.stats.mostCountriesTripName}</span>
                )}
              </dd>
            </div>
            <div className="settings-screen__stat">
              <dt>Average trip length</dt>
              <dd>{data.stats.averageTripLengthDays !== null ? `${data.stats.averageTripLengthDays.toFixed(1)} days` : '—'}</dd>
            </div>
          </dl>

          {data.perTrip.length > 0 && (
            <div className="settings-screen__new-countries">
              <p className="settings-screen__stat-sub-label">Countries first visited, per trip</p>
              <ul className="settings-screen__new-countries-list">
                {data.perTrip.map(({ trip, newCountries }) => (
                  <li key={trip.id}>
                    <span className="settings-screen__new-countries-trip">{trip.name}</span>
                    <span className="settings-screen__new-countries-codes mono">{newCountries.join(', ')}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
