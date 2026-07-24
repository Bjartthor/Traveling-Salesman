import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { buildStatusIndex, metricCoverage, nextStatMode } from '@/stats/coverage'
import { WorldMap } from '@/components/map/WorldMap'
import { CoverageHeadline } from '@/components/map/CoverageHeadline'
import { CoverageStrip } from '@/components/map/CoverageStrip'
import { Legend } from '@/components/map/Legend'
import { CountrySheet } from '@/components/map/CountrySheet'
import './MapScreen.css'

export function MapScreen() {
  const countries = useLiveQuery(() => db.countries.toArray())
  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const settings = useLiveQuery(() => db.settings.get(1))

  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const countryStatus = useMemo(() => buildStatusIndex(entries ?? [], 'country'), [entries])
  const subdivisionStatus = useMemo(() => buildStatusIndex(entries ?? [], 'subdivision'), [entries])
  const cityStatus = useMemo(() => buildStatusIndex(entries ?? [], 'city'), [entries])

  const metric = useMemo(
    () =>
      countries && settings
        ? metricCoverage(settings.statMode, countries, countryStatus, settings.countryDenominator)
        : null,
    [countries, settings, countryStatus],
  )

  const selectedCountry = useMemo(
    () => (selectedCode ? countries?.find((c) => c.code === selectedCode) : undefined),
    [countries, selectedCode],
  )
  const selectedEntry = useMemo(
    () => entries?.find((e) => e.kind === 'country' && e.refId === selectedCode),
    [entries, selectedCode],
  )

  // Fully grey map + one line of guidance is the fresh-install state — an
  // invitation, not an empty-state apology (03-map-and-stats.md §5).
  const hasAnyEntries = (entries?.length ?? 0) > 0

  if (!countries || !settings || !metric) return null

  return (
    <div className="map-screen">
      <CoverageHeadline
        metric={metric}
        mode={settings.statMode}
        onCycle={() => void settingsRepo.update({ statMode: nextStatMode(settings.statMode) })}
      />
      <div className="map-screen__map-wrap">
        <WorldMap
          countryStatus={countryStatus}
          subdivisionStatus={subdivisionStatus}
          selectedCode={selectedCode}
          onSelectCountry={setSelectedCode}
        />
        {!hasAnyEntries && <p className="map-screen__hint">Log a place on the Places tab to see it here.</p>}
      </div>
      <CoverageStrip metric={metric} mode={settings.statMode} />
      <Legend />
      {selectedCountry && (
        <CountrySheet
          country={selectedCountry}
          entry={selectedEntry}
          subdivisionStatus={subdivisionStatus}
          cityStatus={cityStatus}
          onClose={() => setSelectedCode(null)}
        />
      )}
    </div>
  )
}
