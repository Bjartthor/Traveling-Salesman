// "Add a place manually" (04-places.md §2) — for anywhere neither the
// bundled data nor Photon knows about. Full-screen overlay: name, a country
// picker, an optional subdivision picker scoped to that country, and
// optional coordinates.

import { useMemo, useState, type FormEvent } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { City, Country, Subdivision } from '@/db/types'
import { normalize } from '@/geo/search'
import { addManualCity } from '@/geo/cityWrites'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { CountryFlag } from '@/components/places/CountryFlag'
import './ManualPlaceForm.css'

const NO_COUNTRIES: Country[] = []

interface ManualPlaceFormProps {
  initialName: string
  onClose: () => void
  onAdded: (city: City) => void
}

export function ManualPlaceForm({ initialName, onClose, onAdded }: ManualPlaceFormProps) {
  const [name, setName] = useState(initialName)
  const [countryCode, setCountryCode] = useState<string | null>(null)
  const [countryQuery, setCountryQuery] = useState('')
  const [subdivisionId, setSubdivisionId] = useState('')
  const [lat, setLat] = useState('')
  const [lon, setLon] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const countries = useLiveQuery(() => db.countries.toArray()) ?? NO_COUNTRIES
  const selectedCountry = useMemo(() => countries.find((c) => c.code === countryCode) ?? null, [countries, countryCode])
  const filteredCountries = useMemo(() => {
    const q = normalize(countryQuery.trim())
    if (!q) return countries
    return countries.filter((c) => normalize(c.name).includes(q) || normalize(c.code) === q)
  }, [countries, countryQuery])

  const subdivisions: Subdivision[] =
    useLiveQuery(
      () =>
        countryCode
          ? db.subdivisions.where('countryCode').equals(countryCode).sortBy('name')
          : Promise.resolve<Subdivision[]>([]),
      [countryCode],
    ) ?? []

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim() || !countryCode) return
    setPending(true)
    setError(null)
    try {
      const city = await addManualCity({
        name: name.trim(),
        countryCode,
        subdivisionId: subdivisionId || null,
        lat: lat.trim() ? Number(lat) : null,
        lon: lon.trim() ? Number(lon) : null,
      })
      onAdded(city)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setPending(false)
    }
  }

  return (
    <FullScreenOverlay title="Add a place manually" onClose={onClose}>
      <form className="manual-place__form" onSubmit={(e) => void submit(e)}>
        <label className="manual-place__field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Place name"
            required
            autoFocus
          />
        </label>

        <div className="manual-place__field">
          <span>Country</span>
          {selectedCountry ? (
            <div className="manual-place__selected-country">
              <CountryFlag code={selectedCountry.code} />
              <span>{selectedCountry.name}</span>
              <button type="button" className="manual-place__change" onClick={() => setCountryCode(null)}>
                Change
              </button>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="Search countries…"
                aria-label="Search countries"
              />
              <ul className="manual-place__country-list">
                {filteredCountries.slice(0, 30).map((c) => (
                  <li key={c.code}>
                    <button type="button" className="manual-place__country-option" onClick={() => setCountryCode(c.code)}>
                      <CountryFlag code={c.code} />
                      <span>{c.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {countryCode && subdivisions.length > 0 && (
          <label className="manual-place__field">
            <span>Region (optional)</span>
            <select value={subdivisionId} onChange={(e) => setSubdivisionId(e.target.value)}>
              <option value="">— none —</option>
              {subdivisions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="manual-place__coords">
          <label className="manual-place__field">
            <span>Latitude (optional)</span>
            <input type="number" step="any" min={-90} max={90} value={lat} onChange={(e) => setLat(e.target.value)} />
          </label>
          <label className="manual-place__field">
            <span>Longitude (optional)</span>
            <input type="number" step="any" min={-180} max={180} value={lon} onChange={(e) => setLon(e.target.value)} />
          </label>
        </div>

        {error && (
          <p className="manual-place__error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="manual-place__submit" disabled={pending || !name.trim() || !countryCode}>
          Add place
        </button>
      </form>
    </FullScreenOverlay>
  )
}
