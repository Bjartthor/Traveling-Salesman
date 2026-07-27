// Global open/closed state for the place-status sheet (04-places.md task 3):
// "the same sheet, reached by tapping any place anywhere in the app." One
// instance is mounted at the app shell (see App.tsx) so it can overlay
// whichever tab — or the country detail screen — is currently showing.

import { create } from 'zustand'
import type { PlaceRef } from '@/domain/cascade'

interface PlaceSheetState {
  openPlace: PlaceRef | null
  open: (place: PlaceRef) => void
  close: () => void
}

export const usePlaceSheetStore = create<PlaceSheetState>((set) => ({
  openPlace: null,
  open: (place) => set({ openPlace: place }),
  close: () => set({ openPlace: null }),
}))
