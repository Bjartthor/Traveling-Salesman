import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { buildStatusIndex, metricCoverage, nextStatMode } from '@/stats/coverage'
import { WorldMap } from '@/components/map/WorldMap'
import { CoverageHeadline } from '@/components/map/CoverageHeadline'
import { CoverageStrip } from '@/components/map/CoverageStrip'
import { Legend } from '@/components/map/Legend'
import { useCountryDetailStore } from '@/domain/countryDetailStore'
import './MapScreen.css'

export function MapScreen() {
  const countries = useLiveQuery(() => db.countries.toArray())
  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const settings = useLiveQuery(() => db.settings.get(1))

  // Which country's admin-1 breakdown WorldMap shows once zoomed in past its
  // threshold — a map-exploration affordance, independent of whether the
  // full country detail overlay (opened below) happens to be showing for it.
  const [selectedCode, setSelectedCode] = useState<string | null>(null)
  const openCountryDetail = useCountryDetailStore((s) => s.open)

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
    setSelectedCode(code)
    openCountryDetail(code)
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
        />
        {!hasAnyEntries && <p className="map-screen__hint">Log a place on the Places tab to see it here.</p>}
      </div>
      <CoverageStrip metric={metric} mode={settings.statMode} />
      <Legend />
    </div>
  )
}
