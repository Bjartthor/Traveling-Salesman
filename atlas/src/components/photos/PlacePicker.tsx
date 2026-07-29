// A lightweight place picker for the EXIF import review screen's "Correct"
// action (06-photos.md task 3 step 5) — searches the same way
// @/components/places/PlaceSearch does (local index, then a debounced Photon
// fallback), but returns the chosen place to the caller instead of opening
// the status sheet. Also offers a plain country picker, since a group the
// import only resolved to a country (beyond 150 km — 00-PLAN.md/06-photos.md
// task 3 step 4) may need correcting to a different country, not a city.

import { useEffect, useState } from 'react'
import { db } from '@/db/schema'
import type { Country } from '@/db/types'
import { normalize, searchCities, type CityResult } from '@/geo/search'
import { commitPhotonResult, searchPhoton, type PhotonResult } from '@/geo/photon'
import { CountryFlag } from '@/components/places/CountryFlag'
import './PlacePicker.css'

export type PickedPlace = { kind: 'city'; refId: string; countryCode: string; label: string } | { kind: 'country'; refId: string; label: string }

export function PlacePicker({ onPick, onCancel }: { onPick: (p: PickedPlace) => void; onCancel: () => void }) {
  const [mode, setMode] = useState<'city' | 'country'>('city')
  const [query, setQuery] = useState('')
  const [localResults, setLocalResults] = useState<CityResult[]>([])
  const [onlineResults, setOnlineResults] = useState<PhotonResult[]>([])
  const [onlineLoading, setOnlineLoading] = useState(false)
  const [committingId, setCommittingId] = useState<string | null>(null)
  const [countries, setCountries] = useState<Country[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void db.countries.toArray().then(setCountries)
  }, [])

  const active = query.trim().length >= 2

  useEffect(() => {
    if (mode !== 'city' || !active) {
      setLocalResults([])
      return
    }
    let cancelled = false
    void searchCities(query).then((r) => {
      if (!cancelled) setLocalResults(r)
    })
    return () => {
      cancelled = true
    }
  }, [mode, query, active])

  useEffect(() => {
    if (mode !== 'city' || !active || localResults.length >= 3 || !navigator.onLine) {
      setOnlineResults([])
      setOnlineLoading(false)
      return
    }
    const controller = new AbortController()
    setOnlineLoading(true)
    const timer = setTimeout(() => {
      void searchPhoton(query, controller.signal).then((r) => {
        setOnlineResults(r)
        setOnlineLoading(false)
      })
    }, 500)
    return () => {
      clearTimeout(timer)
      controller.abort()
      setOnlineLoading(false)
    }
  }, [mode, query, active, localResults.length])

  const localKeys = new Set(localResults.map((r) => `${normalize(r.name)}|${r.countryCode}`))
  const dedupedOnline = onlineResults.filter((r) => !localKeys.has(`${normalize(r.name)}|${r.countryCode}`))

  const countryMatches =
    mode === 'country' && active
      ? countries.filter((c) => normalize(c.name).includes(normalize(query)) || c.code.toLowerCase() === query.trim().toLowerCase()).slice(0, 20)
      : []

  async function pickOnline(r: PhotonResult) {
    setError(null)
    setCommittingId(r.id)
    try {
      const city = await commitPhotonResult(r)
      onPick({ kind: 'city', refId: String(city.geonameId), countryCode: city.countryCode, label: `${city.name}, ${r.countryName}` })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommittingId(null)
    }
  }

  return (
    <div className="place-picker">
      <div className="place-picker__tabs">
        <button type="button" className={`place-picker__tab${mode === 'city' ? ' place-picker__tab--active' : ''}`} onClick={() => setMode('city')}>
          City
        </button>
        <button
          type="button"
          className={`place-picker__tab${mode === 'country' ? ' place-picker__tab--active' : ''}`}
          onClick={() => setMode('country')}
        >
          Country
        </button>
        <button type="button" className="place-picker__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>

      <input
        type="search"
        className="place-picker__input"
        placeholder={mode === 'city' ? 'Search for a city…' : 'Search for a country…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {active && mode === 'city' && (
        <div className="place-picker__results">
          {localResults.map((r) => (
            <button
              key={r.geonameId}
              type="button"
              className="place-picker__result"
              onClick={() => onPick({ kind: 'city', refId: String(r.geonameId), countryCode: r.countryCode, label: `${r.name}, ${r.countryName}` })}
            >
              <span>
                {r.name}
                <span className="place-picker__result-meta">{r.subdivisionName ? ` · ${r.subdivisionName}` : ''} · {r.countryName}</span>
              </span>
              <CountryFlag code={r.countryCode} />
            </button>
          ))}
          {onlineLoading && <p className="place-picker__status">Searching online…</p>}
          {dedupedOnline.map((r) => (
            <button key={r.id} type="button" className="place-picker__result" disabled={committingId !== null} onClick={() => void pickOnline(r)}>
              <span>
                {r.name}
                <span className="place-picker__result-meta">
                  {' '}
                  · {r.countryName}
                  {committingId === r.id ? ' · adding…' : ''}
                </span>
              </span>
              <CountryFlag code={r.countryCode} />
            </button>
          ))}
          {localResults.length === 0 && dedupedOnline.length === 0 && !onlineLoading && <p className="place-picker__status">No matches.</p>}
        </div>
      )}

      {active && mode === 'country' && (
        <div className="place-picker__results">
          {countryMatches.map((c) => (
            <button key={c.code} type="button" className="place-picker__result" onClick={() => onPick({ kind: 'country', refId: c.code, label: c.name })}>
              <span>{c.name}</span>
              <CountryFlag code={c.code} />
            </button>
          ))}
          {countryMatches.length === 0 && <p className="place-picker__status">No matches.</p>}
        </div>
      )}

      {error && (
        <p className="place-picker__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
