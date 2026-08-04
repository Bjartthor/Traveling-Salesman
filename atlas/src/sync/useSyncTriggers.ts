// Wires the sync triggers from 07-sync-and-deploy.md task 4: app start, return to
// foreground, reconnect, and a 30 s debounce after a change. (Manual pull-to-
// refresh and the "Sync now" button call syncNow() directly.) Mounted once, at
// the app shell.

import { useEffect, useRef } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { syncNow } from '@/sync/sync'

const CHANGE_DEBOUNCE_MS = 30_000

export function useSyncTriggers(): void {
  const settings = useLiveQuery(() => settingsRepo.get(), [])
  const syncBookkeeping = useLiveQuery(
    async () => {
      const s = await db.syncState.get(1)
      return { revision: s?.revision ?? 0, pushedRevision: s?.pushedRevision ?? 0 }
    },
    [],
  )

  const connected = settings?.driveConnected === true
  const autoSync = settings?.autoSync !== false

  // App start (and whenever the device becomes connected).
  useEffect(() => {
    if (connected) void syncNow()
  }, [connected])

  // Return to foreground, and connectivity coming back.
  useEffect(() => {
    if (!connected) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void syncNow()
    }
    const onOnline = () => void syncNow()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [connected])

  // Debounced 30 s after an authored change. Only arms when there are genuinely
  // unpushed local changes (revision ahead of pushedRevision), so it never fires
  // a no-op loop after a sync bumps the revision on its own.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasUnpushed = !!syncBookkeeping && syncBookkeeping.revision > syncBookkeeping.pushedRevision
  useEffect(() => {
    if (!connected || !autoSync || !hasUnpushed) return
    timer.current = setTimeout(() => void syncNow(), CHANGE_DEBOUNCE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [connected, autoSync, hasUnpushed, syncBookkeeping?.revision])
}
