// The You/Settings tab. 05-trips.md task 5 adds the trip-statistics section
// below; everything else (headline-stat switch, theme, Google Drive sync, the
// GeoNames/Natural Earth/Photon attribution) is a later phase's work, left as
// the original placeholder note rather than half-built ahead of its own phase.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { loadTripCountryCodesBatch } from '@/domain/tripPlacesRepo'
import { computeTripStats, newCountriesByTrip, type TripStats } from '@/domain/tripStats'
import { clearUploadedBlobs, photoStorageStats } from '@/domain/photoRepo'
import type { Trip } from '@/db/types'
import { PhotoImportFlow } from '@/components/photos/PhotoImportFlow'
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

interface StorageInfo {
  photoCount: number
  photoBytes: number
  usage: number | null
  quota: number | null
  persisted: boolean
}

async function loadStorageInfo(): Promise<StorageInfo> {
  const emptyEstimate: StorageEstimate = {}
  const [{ count, bytes }, estimate, persisted] = await Promise.all([
    photoStorageStats(),
    'storage' in navigator ? navigator.storage.estimate() : Promise.resolve(emptyEstimate),
    'storage' in navigator && 'persisted' in navigator.storage ? navigator.storage.persisted() : Promise.resolve(false),
  ])
  return { photoCount: count, photoBytes: bytes, usage: estimate.usage ?? null, quota: estimate.quota ?? null, persisted }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(1)} ${units[i]}`
}

export function SettingsScreen() {
  const data = useLiveQuery(loadTripStatsData)
  const [showImport, setShowImport] = useState(false)
  const [storage, setStorage] = useState<StorageInfo | null>(null)
  const [persistError, setPersistError] = useState<string | null>(null)
  const [clearedMessage, setClearedMessage] = useState<string | null>(null)

  function refreshStorage() {
    void loadStorageInfo().then(setStorage)
  }
  useEffect(refreshStorage, [])

  async function requestPersistence() {
    setPersistError(null)
    try {
      if (!('storage' in navigator) || !('persist' in navigator.storage)) {
        setPersistError('Persistent storage isn’t supported in this browser.')
        return
      }
      await navigator.storage.persist()
      refreshStorage()
    } catch (e) {
      setPersistError(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleClearUploaded() {
    const n = await clearUploadedBlobs()
    setClearedMessage(n > 0 ? `Freed local storage for ${n} uploaded photo${n === 1 ? '' : 's'}.` : 'No uploaded photos to clear yet.')
    refreshStorage()
  }

  return (
    <div className="settings-screen">
      <h1 className="settings-screen__title">You</h1>
      <p className="settings-screen__hint">
        Your headline stat, theme, Google Drive sync and the map data attribution will live here once those pieces
        are built.
      </p>

      <section className="settings-screen__section">
        <h2 className="settings-screen__section-title">Photos</h2>
        <p className="settings-screen__hint">
          Drop in an old photo library and let the app work out where you have been.
        </p>
        <button type="button" className="settings-screen__action" onClick={() => setShowImport(true)}>
          Import from photos
        </button>
      </section>

      <section className="settings-screen__section">
        <h2 className="settings-screen__section-title">Storage</h2>
        {storage && (
          <>
            <dl className="settings-screen__stats">
              <div className="settings-screen__stat">
                <dt>Photos on this device</dt>
                <dd>{storage.photoCount}</dd>
              </div>
              <div className="settings-screen__stat">
                <dt>Photo storage used</dt>
                <dd>{formatBytes(storage.photoBytes)}</dd>
              </div>
              {storage.usage !== null && storage.quota !== null && (
                <div className="settings-screen__stat">
                  <dt>Device storage</dt>
                  <dd>
                    {formatBytes(storage.usage)} <span className="settings-screen__stat-sub">/ {formatBytes(storage.quota)}</span>
                  </dd>
                </div>
              )}
              <div className="settings-screen__stat">
                <dt>Persistent storage</dt>
                <dd>{storage.persisted ? 'Granted' : 'Not requested'}</dd>
              </div>
            </dl>
            {!storage.persisted && (
              <button type="button" className="settings-screen__action" onClick={() => void requestPersistence()}>
                Request persistent storage
              </button>
            )}
            {persistError && (
              <p className="settings-screen__error" role="alert">
                {persistError}
              </p>
            )}
            <button type="button" className="settings-screen__action settings-screen__action--secondary" onClick={() => void handleClearUploaded()}>
              Clear local copies of uploaded photos
            </button>
            {clearedMessage && <p className="settings-screen__hint">{clearedMessage}</p>}
          </>
        )}
      </section>

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

      {showImport && (
        <PhotoImportFlow
          onClose={() => {
            setShowImport(false)
            refreshStorage()
          }}
        />
      )}
    </div>
  )
}
