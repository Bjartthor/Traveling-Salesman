// The search field at the top of the Places tab (04-places.md task 2). Local
// results appear as you type; once they're thin, an online (Photon) fallback
// joins in after a debounce, under its own divider, never blocking the local
// half. Picking a result opens the global status sheet so setting a status
// is always the very next step, whether the place was already known locally
// or just resolved from the network for the first time.

import { useEffect, useState } from 'react'
import { normalize, searchCities, type CityResult } from '@/geo/search'
import { commitPhotonResult, searchPhoton, type PhotonResult } from '@/geo/photon'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { CountryFlag } from '@/components/places/CountryFlag'
import { ManualPlaceForm } from '@/components/places/ManualPlaceForm'
import './PlaceSearch.css'

export function PlaceSearch() {
  const [query, setQuery] = useState('')
  const [localResults, setLocalResults] = useState<CityResult[]>([])
  const [onlineResults, setOnlineResults] = useState<PhotonResult[]>([])
  const [onlineLoading, setOnlineLoading] = useState(false)
  const [committingId, setCommittingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showManualForm, setShowManualForm] = useState(false)

  const openSheet = usePlaceSheetStore((s) => s.open)
  const active = query.trim().length >= 2

  // --- local results: every keystroke, no debounce (searchCities is an
  // in-memory scan, ~30ms warm — see @/geo/search) ---
  useEffect(() => {
    if (!active) {
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
  }, [query, active])

  // --- online fallback: only once local results are thin, after a 500ms
  // debounce, only while online. Never blocks the local list above. ---
  useEffect(() => {
    if (!active || localResults.length >= 3 || !navigator.onLine) {
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
  }, [query, active, localResults.length])

  // A place already surfaced locally (including one added online in an
  // earlier search) shouldn't also show up in the "from online search" list.
  const localKeys = new Set(localResults.map((r) => `${normalize(r.name)}|${r.countryCode}`))
  const dedupedOnline = onlineResults.filter((r) => !localKeys.has(`${normalize(r.name)}|${r.countryCode}`))

  function pickLocal(r: CityResult) {
    openSheet({ kind: 'city', refId: String(r.geonameId) })
    setQuery('')
  }

  async function pickOnline(r: PhotonResult) {
    setError(null)
    setCommittingId(r.id)
    try {
      const city = await commitPhotonResult(r)
      openSheet({ kind: 'city', refId: String(city.geonameId) })
      setQuery('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCommittingId(null)
    }
  }

  return (
    <div className="place-search">
      <input
        type="search"
        className="place-search__input"
        placeholder="Search for a city, town or village…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search for a place"
      />

      {active && (
        <div className="place-search__results">
          {localResults.length > 0 && (
            <ul className="place-search__list">
              {localResults.map((r) => (
                <li key={r.geonameId}>
                  <button type="button" className="place-search__result" onClick={() => pickLocal(r)}>
                    <span className="place-search__result-text">
                      <span className="place-search__result-name">{r.name}</span>
                      <span className="place-search__result-meta">
                        {r.subdivisionName ? `${r.subdivisionName} · ` : ''}
                        {r.countryName}
                      </span>
                    </span>
                    <CountryFlag code={r.countryCode} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {onlineLoading && <p className="place-search__status">Searching online…</p>}

          {dedupedOnline.length > 0 && (
            <>
              <p className="place-search__divider">From online search</p>
              <ul className="place-search__list">
                {dedupedOnline.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="place-search__result"
                      disabled={committingId !== null}
                      onClick={() => void pickOnline(r)}
                    >
                      <span className="place-search__result-text">
                        <span className="place-search__result-name">{r.name}</span>
                        <span className="place-search__result-meta">
                          {r.regionName ? `${r.regionName} · ` : ''}
                          {r.countryName}
                          {committingId === r.id ? ' · adding…' : ''}
                        </span>
                      </span>
                      <CountryFlag code={r.countryCode} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {localResults.length === 0 && dedupedOnline.length === 0 && !onlineLoading && (
            <p className="place-search__status">No matches yet. Try a different spelling, or add it manually.</p>
          )}

          {error && (
            <p className="place-search__error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}

      <button type="button" className="place-search__manual-trigger" onClick={() => setShowManualForm(true)}>
        Add a place manually
      </button>

      {showManualForm && (
        <ManualPlaceForm
          initialName={active ? query.trim() : ''}
          onClose={() => setShowManualForm(false)}
          onAdded={(city) => {
            setShowManualForm(false)
            setQuery('')
            openSheet({ kind: 'city', refId: String(city.geonameId) })
          }}
        />
      )}
    </div>
  )
}
