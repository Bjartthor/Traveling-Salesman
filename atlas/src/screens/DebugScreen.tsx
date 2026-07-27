// Temporary verification screen (Phase 2's "Do not do yet", extended in 4a).
// Not part of the product UI — it exists to confirm behaviour through the
// browser against the real dataset: geo table counts, required territory rows,
// topology loading, live city search, and the status cascade. Reachable at
// #/debug (link on the You screen). Phase 4b deletes all of it once the real
// Places UI exists.

import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { GEO_DATA_VERSION, loadCountryTopology, loadWorldTopology } from '@/geo/loader'
import { searchCities, type CityResult } from '@/geo/search'
import { STATUS_COLOR_VAR } from '@/components/map/statusColor'
import { STATUS_ORDER, effectiveStatus, type CascadeState } from '@/domain/cascade'
import { loadCascadeState, rebuildDerivedEntries, removePlaceEntry, setPlaceStatus } from '@/domain/cascadeRepo'
import type { Entry, Status } from '@/db/types'
import './DebugScreen.css'

// Acceptance: these must all exist as their own country rows.
const REQUIRED_TERRITORIES = ['GL', 'FO', 'PR', 'HK', 'MO', 'GI', 'NC']
const nf = new Intl.NumberFormat()
const KIND_RANK = { country: 0, subdivision: 1, city: 2 } as const

interface EntryRow extends Entry {
  placeName: string
  /** What the cascade says this should be — a mismatch with `status` means drift. */
  effective: Status | null
}

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

  // --- cascade harness (Phase 4a) ---
  const [pickedStatus, setPickedStatus] = useState<Status>('visited')
  const [countryCode, setCountryCode] = useState('DE')
  const [cascadeError, setCascadeError] = useState<string | null>(null)

  const entryRows = useLiveQuery(async (): Promise<EntryRow[] | { error: string }> => {
    const entries = await db.entries.toArray()

    const countryCodes = entries.filter((e) => e.kind === 'country').map((e) => e.refId)
    const subIds = entries.filter((e) => e.kind === 'subdivision').map((e) => e.refId)
    const cityIds = entries.filter((e) => e.kind === 'city').map((e) => Number(e.refId))
    const [countries, subs, cities] = await Promise.all([
      db.countries.bulkGet(countryCodes),
      db.subdivisions.bulkGet(subIds),
      db.cities.bulkGet(cityIds),
    ])
    const names = new Map<string, string>()
    countryCodes.forEach((code, i) => names.set(`country:${code}`, countries[i]?.name ?? '—'))
    subIds.forEach((id, i) => names.set(`subdivision:${id}`, subs[i]?.name ?? '—'))
    cityIds.forEach((id, i) => names.set(`city:${id}`, cities[i]?.name ?? '—'))

    let state: CascadeState
    try {
      state = await loadCascadeState()
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }

    return entries
      .map((e) => ({
        ...e,
        placeName: names.get(`${e.kind}:${e.refId}`) ?? '—',
        effective: e.deletedAt === null ? effectiveStatus(state, e.kind, e.refId) : null,
      }))
      .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.placeName.localeCompare(b.placeName))
  })

  const entries = Array.isArray(entryRows) ? entryRows : []
  const loadError = !Array.isArray(entryRows) && entryRows ? entryRows.error : null
  const live = entries.filter((e) => e.deletedAt === null)
  const drifted = live.filter((e) => e.effective !== e.status).length

  async function run(action: () => Promise<unknown>) {
    setCascadeError(null)
    try {
      await action()
    } catch (e) {
      setCascadeError(e instanceof Error ? e.message : String(e))
    }
  }

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
        <h2 className="debug__heading">Cascade · add a place</h2>
        <div className="debug__picker">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              className={`debug__swatch${s === pickedStatus ? ' debug__swatch--on' : ''}`}
              style={{ '--swatch': STATUS_COLOR_VAR[s] } as React.CSSProperties}
              onClick={() => setPickedStatus(s)}
              aria-pressed={s === pickedStatus}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="debug__inline">
          <input
            className="debug__input"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
            placeholder="ISO code, e.g. DE"
            aria-label="Country code"
          />
          <button
            type="button"
            className="debug__btn"
            onClick={() =>
              void run(() => setPlaceStatus({ kind: 'country', refId: countryCode, status: pickedStatus }))
            }
          >
            Set country
          </button>
        </div>

        <input
          className="debug__input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Try: garmisch, san francisco, tórshavn"
          aria-label="City search query"
        />
        <p className="debug__mono">
          {results.length} results{ms !== null ? ` · ${ms.toFixed(1)} ms` : ''} · tap one to add it as {pickedStatus}
        </p>
        <ol className="debug__results">
          {results.map((r) => (
            <li key={r.geonameId}>
              <button
                type="button"
                className="debug__result"
                onClick={() =>
                  void run(() =>
                    setPlaceStatus({ kind: 'city', refId: String(r.geonameId), status: pickedStatus }),
                  )
                }
              >
                <span className="debug__result-name">{r.name}</span>
                <span className="debug__result-meta">
                  {r.subdivisionName ? `${r.subdivisionName}, ` : ''}
                  {r.countryName} · {nf.format(r.population)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      <section className="debug__section">
        <h2 className="debug__heading">Cascade · entries ({live.length})</h2>
        <div className="debug__inline">
          <button type="button" className="debug__btn" onClick={() => void run(rebuildDerivedEntries)}>
            Rebuild derived
          </button>
          <button type="button" className="debug__btn" onClick={() => void run(() => db.entries.clear())}>
            Clear all (hard)
          </button>
        </div>
        {(cascadeError ?? loadError) && <p className="debug__error">{cascadeError ?? loadError}</p>}
        <p className="debug__mono">
          {drifted === 0 ? 'no drift — every stored status matches the cascade' : `⚠ ${drifted} row(s) drifted`}
        </p>
        <ul className="debug__results">
          {entries.map((e) => (
            <li key={e.id} className={`debug__entry${e.deletedAt !== null ? ' debug__entry--dead' : ''}`}>
              <span className="debug__bar" style={{ background: STATUS_COLOR_VAR[e.status] }} />
              <span className="debug__result-name">{e.placeName}</span>
              <span className="debug__result-meta">
                {e.kind} · {e.refId} · {e.status}
                {e.explicit ? ` (explicit ${e.explicitStatus})` : ' (derived)'}
                {e.deletedAt !== null ? ' · deleted' : ''}
                {e.deletedAt === null && e.effective !== e.status ? ` · ⚠ should be ${e.effective}` : ''}
              </span>
              {e.deletedAt === null && (
                <button
                  type="button"
                  className="debug__btn debug__btn--icon"
                  onClick={() => void run(() => removePlaceEntry(e.id))}
                  aria-label={`Remove ${e.placeName}`}
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
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
