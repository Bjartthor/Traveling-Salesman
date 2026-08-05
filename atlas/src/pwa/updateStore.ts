// Transient "a new version is waiting" state (07-sync-and-deploy.md task 7).
// Mirrors @/sync/syncStore's shape: a small store for the one live fact the UI
// needs, set once by @/pwa/registerUpdatePrompt when Workbox reports a waiting
// service worker.

import { create } from 'zustand'

interface UpdateStore {
  needsRefresh: boolean
  /** Tell the waiting worker to activate and reload. Only set once a refresh is actually needed. */
  applyUpdate: (() => void) | null
  setNeedsRefresh: (applyUpdate: () => void) => void
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  needsRefresh: false,
  applyUpdate: null,
  setNeedsRefresh: (applyUpdate) => set({ needsRefresh: true, applyUpdate }),
}))
