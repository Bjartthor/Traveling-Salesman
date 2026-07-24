import { useEffect, type ReactNode } from 'react'
import { useGeoStore } from '@/geo/geoStore'
import './GeoGate.css'

const nf = new Intl.NumberFormat()

/**
 * First-run gate. Seeds reference data into IndexedDB, showing a determinate
 * "Loading world data" screen. Once countries have landed the user may start
 * exploring while the ~170k cities finish streaming in (a thin top strip keeps
 * the determinate progress visible).
 */
export function GeoGate({ children }: { children: ReactNode }) {
  const { status, phase, loaded, total, countriesReady, dismissed, error, load, dismiss } = useGeoStore()

  useEffect(() => {
    void load()
  }, [load])

  if (status === 'error') {
    return (
      <div className="geo-gate" role="alert">
        <div className="geo-gate__panel">
          <p className="geo-gate__eyebrow">Something went wrong</p>
          <h1 className="geo-gate__title">Couldn’t load world data</h1>
          <p className="geo-gate__detail">{error}</p>
          <button type="button" className="geo-gate__button" onClick={() => void load()}>
            Try again
          </button>
        </div>
      </div>
    )
  }

  const done = status === 'ready'
  const citiesPhase = phase === 'cities' && total > 0
  const pct = citiesPhase ? Math.round((loaded / total) * 100) : 0

  // Full-screen loader until seeding finishes or the user opts to start early.
  if (!done && !dismissed) {
    return (
      <div className="geo-gate">
        <div className="geo-gate__panel">
          <p className="geo-gate__eyebrow">First run</p>
          <h1 className="geo-gate__title">Loading world data</h1>
          <div
            className="geo-gate__bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={citiesPhase ? pct : undefined}
          >
            <div
              className={`geo-gate__bar-fill${citiesPhase ? '' : ' geo-gate__bar-fill--indeterminate'}`}
              style={citiesPhase ? { width: `${pct}%` } : undefined}
            />
          </div>
          <p className="geo-gate__status">
            {citiesPhase ? `CITIES · ${nf.format(loaded)} / ${nf.format(total)}` : 'FETCHING COUNTRIES & REGIONS'}
          </p>
          {countriesReady && (
            <button type="button" className="geo-gate__button" onClick={dismiss}>
              Start exploring
              <span className="geo-gate__button-note">cities keep loading in the background</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {!done && (
        <div className="geo-strip" role="status">
          <div className="geo-strip__fill" style={{ width: `${pct}%` }} />
          <span className="geo-strip__label">
            Loading cities · {nf.format(loaded)} / {nf.format(total)}
          </span>
        </div>
      )}
      {children}
    </>
  )
}
