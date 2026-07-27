// The grouped list itself (04-places.md task 4): continent -> country ->
// subdivision -> city. Continents are native <details> (always start open —
// there are at most seven). Countries carry their own expand/collapse state
// (closed by default; there can be many) *and* are independently tappable to
// open the full country detail screen (task 5) — two targets on one row, a
// disclosure chevron plus the row body. Subdivisions and cities are always
// one tap from the status sheet, matching "reached by tapping any place
// anywhere in the app."

import { useState } from 'react'
import type { PlaceRef } from '@/domain/cascade'
import type { ContinentGroup, CountryGroup, PlaceRow, SubdivisionGroup } from '@/domain/placesList'
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import { useCountryDetailStore } from '@/domain/countryDetailStore'
import { colorForStatus } from '@/components/map/statusColor'
import { CountryFlag } from '@/components/places/CountryFlag'
import './PlacesList.css'

export function PlacesList({ continents }: { continents: ContinentGroup[] }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const openSheet = usePlaceSheetStore((s) => s.open)
  const openCountry = useCountryDetailStore((s) => s.open)

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="places-list">
      {continents.map((continent) => (
        <details className="places-list__continent" key={continent.name} open>
          <summary className="places-list__continent-summary">
            <span>{continent.name}</span>
            <span className="places-list__count mono">{continent.matchCount}</span>
          </summary>
          <div className="places-list__countries">
            {continent.countries.map((country) => (
              <CountryRow
                key={country.key}
                country={country}
                expanded={expanded.has(country.key)}
                onToggle={() => toggle(country.key)}
                onOpenDetail={() => openCountry(country.code)}
                onOpenSheet={openSheet}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}

function CountryRow({
  country,
  expanded,
  onToggle,
  onOpenDetail,
  onOpenSheet,
}: {
  country: CountryGroup
  expanded: boolean
  onToggle: () => void
  onOpenDetail: () => void
  onOpenSheet: (place: PlaceRef) => void
}) {
  const hasChildren = country.subdivisions.length > 0 || country.looseCities.length > 0
  return (
    <div className="places-list__country">
      <div className="places-list__row">
        {hasChildren ? (
          <button
            type="button"
            className="places-list__chevron"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse ${country.name}` : `Expand ${country.name}`}
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="places-list__chevron" aria-hidden="true" />
        )}
        <button type="button" className="places-list__row-main" onClick={onOpenDetail}>
          <span className="places-list__bar" style={{ background: colorForStatus(country.row?.status) }} aria-hidden="true" />
          <CountryFlag code={country.code} />
          <span className="places-list__name">{country.name}</span>
          <span className="places-list__count mono">{country.matchCount}</span>
        </button>
      </div>

      {expanded && (
        <div className="places-list__children">
          {country.subdivisions.map((sub) => (
            <SubdivisionRows key={sub.key} sub={sub} onOpenSheet={onOpenSheet} />
          ))}
          {country.looseCities.map((city) => (
            <CityRowView key={city.entryId} row={city} onOpenSheet={onOpenSheet} indent={1} />
          ))}
        </div>
      )}
    </div>
  )
}

function SubdivisionRows({ sub, onOpenSheet }: { sub: SubdivisionGroup; onOpenSheet: (place: PlaceRef) => void }) {
  return (
    <div className="places-list__subdivision">
      <button
        type="button"
        className="places-list__row-main places-list__row-main--indent1"
        onClick={() => onOpenSheet({ kind: 'subdivision', refId: sub.key })}
      >
        <span className="places-list__bar" style={{ background: colorForStatus(sub.row?.status) }} aria-hidden="true" />
        <span className="places-list__name">{sub.name}</span>
        <span className="places-list__count mono">{sub.matchCount}</span>
      </button>
      {sub.cities.map((city) => (
        <CityRowView key={city.entryId} row={city} onOpenSheet={onOpenSheet} indent={2} />
      ))}
    </div>
  )
}

function CityRowView({ row, onOpenSheet, indent }: { row: PlaceRow; onOpenSheet: (place: PlaceRef) => void; indent: 1 | 2 }) {
  return (
    <button
      type="button"
      className={`places-list__row-main places-list__row-main--indent${indent}`}
      onClick={() => onOpenSheet({ kind: 'city', refId: row.refId })}
    >
      <span className="places-list__bar" style={{ background: colorForStatus(row.status) }} aria-hidden="true" />
      <span className="places-list__name">{row.name}</span>
      {row.lastVisited && <span className="places-list__date mono">{row.lastVisited}</span>}
    </button>
  )
}
