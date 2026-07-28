// Global open/closed state for the full-screen trip detail overlay
// (05-trips.md task 4), mirroring @/domain/countryDetailStore — opened from
// the active-trip banner, the Trips tab's active card, or a stamp.

import { create } from 'zustand'

interface TripDetailState {
  openTripId: string | null
  open: (tripId: string) => void
  close: () => void
}

export const useTripDetailStore = create<TripDetailState>((set) => ({
  openTripId: null,
  open: (tripId) => set({ openTripId: tripId }),
  close: () => set({ openTripId: null }),
}))
