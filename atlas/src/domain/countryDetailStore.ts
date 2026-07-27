// Global open/closed state for the full-screen country detail overlay
// (04-places.md task 5), "reached from the map or the list" — both need to
// trigger the same overlay without routing through each other.

import { create } from 'zustand'

interface CountryDetailState {
  openCode: string | null
  open: (code: string) => void
  close: () => void
}

export const useCountryDetailStore = create<CountryDetailState>((set) => ({
  openCode: null,
  open: (code) => set({ openCode: code }),
  close: () => set({ openCode: null }),
}))
