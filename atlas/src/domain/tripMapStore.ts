// Which trip, if any, the Map tab is showing on its own
// (docs/superpowers/specs/2026-10-12-trip-on-main-map-design.md) — set from
// the trip page's "Show on map", cleared by the map header's ✕. In memory
// only: survives switching tabs, not an app restart.

import { create } from 'zustand'

interface TripMapState {
  tripId: string | null
  show: (tripId: string) => void
  clear: () => void
}

export const useTripMapStore = create<TripMapState>((set) => ({
  tripId: null,
  show: (tripId) => set({ tripId }),
  clear: () => set({ tripId: null }),
}))
