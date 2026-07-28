// Session-only dismissal of the active-trip banner (05-trips.md task 2):
// "dismissible for the current session but reappear on next launch" — kept in
// a plain in-memory Zustand store rather than localStorage, so a reload or
// app restart resets it for free, with nothing to explicitly clear. Keyed by
// trip id rather than a bare boolean so starting (or switching to) a
// different trip mid-session shows the banner again too.

import { create } from 'zustand'

interface ActiveTripBannerState {
  dismissedTripId: string | null
  dismiss: (tripId: string) => void
}

export const useActiveTripBannerStore = create<ActiveTripBannerState>((set) => ({
  dismissedTripId: null,
  dismiss: (tripId) => set({ dismissedTripId: tripId }),
}))
