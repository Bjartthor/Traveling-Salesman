// A slim, honest sync status line shown above the bottom nav. Visible only when
// there is something to say — a run in progress, an offline queue, or a failure.
// It never shows a success state (07-sync-and-deploy.md task 4); a finished sync
// simply makes this disappear, and "last synced" lives in the Drive settings.

import { useLiveQuery } from 'dexie-react-hooks'
import { settingsRepo } from '@/db/repo'
import { syncNow } from '@/sync/sync'
import { useSyncStore } from '@/sync/syncStore'
import './SyncIndicator.css'

export function SyncIndicator() {
  const connected = useLiveQuery(async () => (await settingsRepo.get())?.driveConnected ?? false, [])
  const phase = useSyncStore((s) => s.phase)
  const error = useSyncStore((s) => s.error)
  const pendingUploads = useSyncStore((s) => s.pendingUploads)

  if (!connected || phase === 'idle') return null

  return (
    <div className={`sync-indicator sync-indicator--${phase}`} role="status" aria-live="polite">
      {phase === 'syncing' && (
        <span className="sync-indicator__body">
          <span className="sync-indicator__spinner" aria-hidden="true" />
          <span className="sync-indicator__text mono">
            Syncing{pendingUploads > 0 ? ` · ${pendingUploads} photo${pendingUploads === 1 ? '' : 's'} left` : '…'}
          </span>
        </span>
      )}

      {phase === 'offline' && (
        <span className="sync-indicator__body">
          <span className="sync-indicator__text mono">{error ?? 'Offline — will sync when reconnected.'}</span>
        </span>
      )}

      {phase === 'error' && (
        <span className="sync-indicator__body">
          <span className="sync-indicator__text sync-indicator__text--error">{error ?? 'Sync failed.'}</span>
          <button type="button" className="sync-indicator__retry" onClick={() => void syncNow()}>
            Retry
          </button>
        </span>
      )}
    </div>
  )
}
