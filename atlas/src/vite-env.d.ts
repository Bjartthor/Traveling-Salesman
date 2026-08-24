/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /**
   * Google OAuth **Web application** client ID for the Drive `appDataFolder`
   * token flow (plan §9, 07-sync-and-deploy.md task 1). Not a secret — safe in a
   * public repo and injected in CI from a repository *variable*. Empty/undefined
   * means Drive sync is unavailable and the UI says so rather than crashing.
   */
  readonly VITE_GOOGLE_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Git short SHA of the commit this bundle was built from (vite.config.ts `define`). `'unknown'` outside a git checkout. */
declare const __APP_COMMIT__: string
/** ISO timestamp of when this bundle was built (vite.config.ts `define`). */
declare const __APP_BUILT_AT__: string
