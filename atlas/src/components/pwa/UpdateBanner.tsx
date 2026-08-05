// "A new version is waiting" (07-sync-and-deploy.md task 7) — visible only
// once Workbox has a new service worker installed and standing by. Same slim
// strip pattern as SyncIndicator/ActiveTripBanner: renders nothing until
// there is something to say.

import { useUpdateStore } from '@/pwa/updateStore'
import './UpdateBanner.css'

export function UpdateBanner() {
  const needsRefresh = useUpdateStore((s) => s.needsRefresh)
  const applyUpdate = useUpdateStore((s) => s.applyUpdate)

  if (!needsRefresh) return null

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner__text mono">A new version of Atlas is ready.</span>
      <button type="button" className="update-banner__action" onClick={() => applyUpdate?.()}>
        Update
      </button>
    </div>
  )
}
