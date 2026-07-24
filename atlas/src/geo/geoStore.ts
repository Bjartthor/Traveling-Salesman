import { create } from 'zustand'
import { ensureReferenceData, type GeoLoadPhase } from '@/geo/loader'

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
    } catch (e) {
      set({ status: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  },
}))
