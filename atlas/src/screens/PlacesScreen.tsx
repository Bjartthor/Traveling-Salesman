import { useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import type { City } from '@/db/types'
import { buildPlacesTree, type CityLookup, type PlacesFilter, type PlacesSort } from '@/domain/placesList'
import { PlaceSearch } from '@/components/places/PlaceSearch'
import { PlacesList } from '@/components/places/PlacesList'
import { BulkAddScreen } from '@/components/places/BulkAddScreen'
import './PlacesScreen.css'

const FILTERS: { value: PlacesFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'visited', label: 'Visited' },
  { value: 'lived', label: 'Lived' },
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'transit', label: 'Transit' },
]

const SORTS: { value: PlacesSort; label: string }[] = [
  { value: 'alphabetical', label: 'Alphabetical' },
  { value: 'recent', label: 'Most recent' },
  { value: 'mostCities', label: 'Most cities' },
]

export function PlacesScreen() {
  const [filter, setFilter] = useState<PlacesFilter>('all')
  const [sort, setSort] = useState<PlacesSort>('alphabetical')
  const [showBulkAdd, setShowBulkAdd] = useState(false)

  const entries = useLiveQuery(() => db.entries.filter((e) => e.deletedAt === null).toArray())
  const countries = useLiveQuery(() => db.countries.toArray())
  const subdivisions = useLiveQuery(() => db.subdivisions.toArray())

  const cityIds = useMemo(() => (entries ?? []).filter((e) => e.kind === 'city').map((e) => Number(e.refId)), [entries])

  const cities = useLiveQuery(async (): Promise<CityLookup> => {
    if (cityIds.length === 0) return new Map()
    const rows = await db.cities.bulkGet(cityIds)
    const map = new Map<string, Pick<City, 'name' | 'countryCode' | 'subdivisionId'>>()
    rows.forEach((row, i) => {
      const id = cityIds[i]
      if (row && id !== undefined) map.set(String(id), { name: row.name, countryCode: row.countryCode, subdivisionId: row.subdivisionId })
    })
    return map
  }, [cityIds])

  const tree = useMemo(() => {
    if (!entries || !countries || !subdivisions || !cities) return null
    return buildPlacesTree({ entries, countries, subdivisions, cities, filter, sort })
  }, [entries, countries, subdivisions, cities, filter, sort])

  const hasAnyEntries = (entries?.length ?? 0) > 0

  return (
    <div className="places-screen">
      <h1 className="places-screen__title">Places</h1>
      <PlaceSearch />
      <button type="button" className="places-screen__quick-add" onClick={() => setShowBulkAdd(true)}>
        Quick add — paste a list of places
      </button>

      {showBulkAdd && <BulkAddScreen onClose={() => setShowBulkAdd(false)} />}

      {!hasAnyEntries ? (
        <p className="places-screen__hint">
          Search above for anywhere you've been, or want to go, to start building your list.
        </p>
      ) : (
        <>
          <div className="places-screen__filters" role="group" aria-label="Filter by status">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`places-screen__filter${filter === f.value ? ' places-screen__filter--active' : ''}`}
                aria-pressed={filter === f.value}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <label className="places-screen__sort">
            <span>Sort</span>
            <select value={sort} onChange={(e) => setSort(e.target.value as PlacesSort)}>
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          {tree && tree.length > 0 ? (
            <PlacesList continents={tree} />
          ) : (
            <p className="places-screen__hint">No places match "{FILTERS.find((f) => f.value === filter)?.label}" yet.</p>
          )}
        </>
      )}
    </div>
  )
}
