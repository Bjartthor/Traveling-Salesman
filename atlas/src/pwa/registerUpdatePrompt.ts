// Registers the service worker ourselves (rather than vite-plugin-pwa's
// auto-injected script) so a waiting update can surface as UI instead of
// applying silently (07-sync-and-deploy.md task 7). `registerType: 'prompt'`
// in vite.config.ts pairs with this: Workbox still checks for updates the
// same way, it just waits for `updateSW(true)` instead of activating on its
// own. Safe to call unconditionally — outside a production build with a
// registered SW (e.g. `vite dev`) the virtual module is a no-op.

import { registerSW } from 'virtual:pwa-register'
import { useUpdateStore } from '@/pwa/updateStore'

// The browser's own "is there a new SW?" check (on register / navigation) is
// throttled to roughly once per 24h per the Service Worker spec — far too
// infrequent for an installed PWA that's mostly *resumed* rather than freshly
// launched, so a deploy can sit unnoticed for a long time. registration.update()
// forces a real check, bypassing that throttle; same "on app foreground" trigger
// @/sync/useSyncTriggers already uses for Drive sync.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

export function registerUpdatePrompt(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      useUpdateStore.getState().setNeedsRefresh(() => {
        void updateSW(true)
      })
    },
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void registration.update()
      })
    },
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })
}
