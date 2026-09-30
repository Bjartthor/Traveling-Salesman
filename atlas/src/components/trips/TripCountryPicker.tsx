// The "Countries visited" section of the "Log a past trip" form
// (TripForm.tsx, showEndDate && requireEndDate only) — search-and-pick like
// ManualPlaceForm's country picker, but inline (not a full-screen overlay)
// and producing a list of {code, status, date} rows the form submits
// alongside the trip itself, rather than writing anything immediately. See
// docs/superpowers/specs/2026-09-30-log-past-trip-countries-design.md.

import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { Status } from '@/db/types'
import { normalize } from '@/geo/search'
import { STATUS_ORDER } from '@/domain/cascade'
import { STATUS_LABEL } from '@/components/map/statusColor'
import { nextCountryRowDate, type TripCountryRow } from '@/domain/tripCountryDefaults'
import { CountryFlag } from '@/components/places/CountryFlag'
import { DateField } from '@/components/shared/DateField'
import './TripCountryPicker.css'

interface TripCountryPickerProps {
  rows: TripCountryRow[]
  onChange: (rows: TripCountryRow[]) => void
  startDate: string
}

export function TripCountryPicker({ rows, onChange, startDate }: TripCountryPickerProps) {
  const [query, setQuery] = useState('')
  const allCountries = useLiveQuery(() => db.countries.toArray()) ?? []

  const addedCodes = useMemo(() => new Set(rows.map((r) => r.code)), [rows])
  const results = useMemo(() => {
    const q = normalize(query.trim())
    if (!q) return []
    return allCountries
      .filter((c) => !addedCodes.has(c.code))
      .filter((c) => normalize(c.name).includes(q) || normalize(c.code) === q)
      .slice(0, 20)
  }, [allCountries, addedCodes, query])

  function addCountry(code: string) {
    const date = nextCountryRowDate(rows, startDate)
    onChange([...rows, { code, status: 'visited', date }])
    setQuery('')
  }

  function removeCountry(index: number) {
    onChange(rows.filter((_, i) => i !== index))
  }

  function updateRow(index: number, patch: Partial<TripCountryRow>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <div className="trip-country-picker">
      <span className="trip-country-picker__label">Countries visited (optional)</span>

      {rows.length > 0 && (
        <ul className="trip-country-picker__rows">
          {rows.map((row, i) => (
            <li key={row.code} className="trip-country-picker__row">
              <CountryFlag code={row.code} />
              <select
                className="trip-country-picker__status"
                value={row.status}
                aria-label={`Status for ${row.code}`}
                onChange={(e) => updateRow(i, { status: e.target.value as Status })}
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <DateField
                value={row.date}
                ariaLabel={`Date for ${row.code}`}
                onChange={(v) => updateRow(i, { date: v })}
              />
              <button
                type="button"
                className="trip-country-picker__remove"
                aria-label={`Remove ${row.code}`}
                onClick={() => removeCountry(i)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        type="text"
        className="trip-country-picker__search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add a country…"
        aria-label="Search countries to add"
      />

      {results.length > 0 && (
        <ul className="trip-country-picker__results">
          {results.map((c) => (
            <li key={c.code}>
              <button type="button" className="trip-country-picker__result" onClick={() => addCountry(c.code)}>
                <CountryFlag code={c.code} />
                <span>{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
