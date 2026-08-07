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
import { usePlaceSheetStore } from '@/domain/placeSheetStore'
import './MapScreen.css'

export function MapScreen() {
  const countries = useLiveQuery(() => db.countries.toArray())
  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const settings = useLiveQuery(() => db.settings.get(1))

  // The selected country: drives WorldMap's admin-1 breakdown + auto-zoom
  // *and* the country sheet below, in place of the old full-screen popup.
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const openPlaceSheet = usePlaceSheetStore((s) => s.open)

  const countryStatus = useMemo(() => buildStatusIndex(entries ?? [], 'country'), [entries])
  const subdivisionStatus = useMemo(() => buildStatusIndex(entries ?? [], 'subdivision'), [entries])

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
          onSelectCountry={selectCountry}
          onSelectSubdivision={(id) => openPlaceSheet({ kind: 'subdivision', refId: id })}
          onDeselect={() => setSelectedCode(null)}
        />
        {!hasAnyEntries && <p className="map-screen__hint">Log a place on the Places tab to see it here.</p>}
      </div>
      <CoverageStrip metric={metric} mode={settings.statMode} />
      <Legend />
      {selectedCode && <CountrySheet code={selectedCode} onClose={() => setSelectedCode(null)} />}
    </div>
  )
}
