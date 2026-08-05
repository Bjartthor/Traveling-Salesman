// Registers the service worker ourselves (rather than vite-plugin-pwa's
// auto-injected script) so a waiting update can surface as UI instead of
// applying silently (07-sync-and-deploy.md task 7). `registerType: 'prompt'`
// in vite.config.ts pairs with this: Workbox still checks for updates the
// same way, it just waits for `updateSW(true)` instead of activating on its
// own. Safe to call unconditionally — outside a production build with a
// registered SW (e.g. `vite dev`) the virtual module is a no-op.

import { registerSW } from 'virtual:pwa-register'
import { useUpdateStore } from '@/pwa/updateStore'

export function registerUpdatePrompt(): void {
  const updateSW = registerSW({
    onNeedRefresh() {
      useUpdateStore.getState().setNeedsRefresh(() => {
        void updateSW(true)
      })
    },
    onRegisterError(error) {
      console.error('Service worker registration failed', error)
    },
  })
}
