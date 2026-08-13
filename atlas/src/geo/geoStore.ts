import { create } from 'zustand'
import { settingsRepo } from '@/db/repo'
import { ensureReferenceData, type GeoLoadPhase } from '@/geo/loader'
import { backfillCityRegions } from '@/geo/regionBackfill'
import { logError, logInfo } from '@/debug/log'

interface GeoState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  phase: GeoLoadPhase
  loaded: number
  total: number
  countriesReady: boolean
  dismissed: boolean // user chose to start exploring while cities finish
  error: string | null
  load: () => Promise<void>
  dismiss: () => void
}

/**
 * Runs once per device, ever — a background repair, not part of the gate's
 * loading state, so it never blocks first paint. Errors (e.g. offline, so a
 * country's admin1 topology can't be fetched) are swallowed after logging:
 * a failed backfill just leaves `regionBackfillDone` false, so it's retried
 * on the next app start rather than getting stuck.
 */
async function runRegionBackfillOnce(): Promise<void> {
  try {
    const settings = await settingsRepo.get()
    if (settings?.regionBackfillDone) return
    const { orphaned, resolved } = await backfillCityRegions()
    await settingsRepo.update({ regionBackfillDone: true })
    void logInfo(`geo: region backfill resolved ${resolved}/${orphaned} orphaned cities`)
  } catch (e) {
    void logError('geo: region backfill failed', e instanceof Error ? e.message : String(e))
  }
}

export const useGeoStore = create<GeoState>((set, get) => ({
  status: 'idle',
  phase: 'countries',
  loaded: 0,
  total: 0,
  countriesReady: false,
  dismissed: false,
  error: null,
  dismiss: () => set({ dismissed: true }),
  load: async () => {
    const status = get().status
    if (status === 'loading' || status === 'ready') return // idempotent (StrictMode-safe)
    set({ status: 'loading', error: null })
    try {
      await ensureReferenceData(
        (p) => set({ phase: p.phase, loaded: p.loaded, total: p.total }),
        () => set({ countriesReady: true }),
      )
      set({ status: 'ready', countriesReady: true })
      void runRegionBackfillOnce()
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
