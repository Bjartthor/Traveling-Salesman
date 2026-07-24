// Temporary Phase-2 verification screen (see 02-geo-data.md "Do not do yet").
// Not part of the product UI — it exists to confirm the geo data through the
// browser: table counts, the required territory rows, topology loading, and
// live city search with timing. Reachable at #/debug (link on the You screen).

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { GEO_DATA_VERSION, loadCountryTopology, loadWorldTopology } from '@/geo/loader'
import { searchCities, type CityResult } from '@/geo/search'
import './DebugScreen.css'

// Acceptance: these must all exist as their own country rows.
const REQUIRED_TERRITORIES = ['GL', 'FO', 'PR', 'HK', 'MO', 'GI', 'NC']
const nf = new Intl.NumberFormat()

export function DebugScreen() {
  const counts = useLiveQuery(async () => ({
    countries: await db.countries.count(),
    subdivisions: await db.subdivisions.count(),
    cities: await db.cities.count(),
  }))
  const settings = useLiveQuery(() => db.settings.get(1))
  const territories = useLiveQuery(() => db.countries.bulkGet(REQUIRED_TERRITORIES))

  const [topo, setTopo] = useState<string>('loading…')
  useEffect(() => {
    void (async () => {
      try {
        const world = await loadWorldTopology()
        const layer = world.objects.countries as { geometries?: unknown[] } | undefined
        const withAdmin1 = await loadCountryTopology('IS') // Iceland has admin-1
        const noAdmin1 = await loadCountryTopology('BV') // Bouvet Island has no admin-1 file
        const isLayer = (withAdmin1?.objects.admin1 as { geometries?: unknown[] } | undefined)?.geometries?.length
        setTopo(
          `world.objects.countries = ${layer?.geometries?.length ?? '?'} geometries · ` +
            `IS admin-1 = ${isLayer ?? '?'} regions · BV admin-1 = ${noAdmin1 === null ? 'null (ok)' : 'present?!'}`,
        )
      } catch (e) {
        setTopo('ERROR: ' + (e instanceof Error ? e.message : String(e)))
      }
    })()
  }, [])

  const [query, setQuery] = useState('reykja')
  const [results, setResults] = useState<CityResult[]>([])
  const [ms, setMs] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    const t0 = performance.now()
    void searchCities(query, 15).then((r) => {
      if (cancelled) return
      setMs(performance.now() - t0)
      setResults(r)
    })
    return () => {
      cancelled = true
    }
  }, [query])

  return (
    <div className="debug">
      <h1 className="debug__title">Geo data · debug</h1>

      <section className="debug__section">
        <div className="debug__stats">
          <Stat label="Countries" value={counts ? nf.format(counts.countries) : '…'} />
          <Stat label="Subdivisions" value={counts ? nf.format(counts.subdivisions) : '…'} />
          <Stat label="Cities" value={counts ? nf.format(counts.cities) : '…'} />
          <Stat label="geoDataVersion" value={`${settings?.geoDataVersion ?? '…'} / ${GEO_DATA_VERSION}`} />
        </div>
      </section>

      <section className="debug__section">
        <h2 className="debug__heading">Required territory rows</h2>
        <div className="debug__chips">
          {REQUIRED_TERRITORIES.map((code, i) => {
            const row = territories?.[i]
            return (
              <span key={code} className={`debug__chip${row ? ' debug__chip--ok' : ' debug__chip--bad'}`}>
                {code} {row ? `✓ ${row.name}` : '✗ missing'}
              </span>
            )
          })}
        </div>
      </section>

      <section className="debug__section">
        <h2 className="debug__heading">Topology</h2>
        <p className="debug__mono">{topo}</p>
      </section>

      <section className="debug__section">
        <h2 className="debug__heading">City search</h2>
        <input
          className="debug__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: reykja, vík, san fran, 北京"
          aria-label="City search query"
        />
        <p className="debug__mono">
          {results.length} results{ms !== null ? ` · ${ms.toFixed(1)} ms` : ''}
        </p>
        <ol className="debug__results">
          {results.map((r) => (
            <li key={r.geonameId} className="debug__result">
              <span className="debug__result-name">{r.name}</span>
              <span className="debug__result-meta">
                {r.subdivisionName ? `${r.subdivisionName}, ` : ''}
                {r.countryName} · {nf.format(r.population)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="debug__stat">
      <span className="debug__stat-value">{value}</span>
      <span className="debug__stat-label">{label}</span>
    </div>
  )
}
