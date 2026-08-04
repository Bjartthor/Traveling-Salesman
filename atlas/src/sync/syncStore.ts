// Transient sync UI state (07-sync-and-deploy.md task 4: "surface state honestly").
// The durable facts — last-synced time, connected-or-not, pending-photo backlog —
// live in Dexie and are read with useLiveQuery; this store only holds the live
// phase of an in-progress run so the indicator can spin, report, and — crucially
// — never show success for a sync that did not finish.

import { create } from 'zustand'

export type SyncPhase =
  | 'idle' // nothing running; last run (if any) finished cleanly
  | 'syncing' // a run is in progress
  | 'offline' // could not reach Drive; queued to retry on reconnect
  | 'error' // a run failed with something the user should see

interface SyncStore {
  phase: SyncPhase
  error: string | null
  /** Photos still to upload in the current run — shown as a live count. */
  pendingUploads: number
  setSyncing: () => void
  setIdle: () => void
  setOffline: (message?: string) => void
  setError: (message: string) => void
  setPendingUploads: (n: number) => void
}

export const useSyncStore = create<SyncStore>((set) => ({
  phase: 'idle',
  error: null,
  pendingUploads: 0,
  setSyncing: () => set({ phase: 'syncing', error: null }),
  setIdle: () => set({ phase: 'idle', error: null, pendingUploads: 0 }),
  setOffline: (message) => set({ phase: 'offline', error: message ?? null, pendingUploads: 0 }),
  setError: (message) => set({ phase: 'error', error: message, pendingUploads: 0 }),
  setPendingUploads: (n) => set({ pendingUploads: n }),
}))
