import { execSync } from 'node:child_process'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Actions sets GITHUB_REPOSITORY to "owner/repo" for every workflow run
// (07-sync-and-deploy.md task 7: "set Vite base correctly for a project site").
// Deriving it here means the repo name never needs to be hand-typed into
// config — local dev and preview keep the relative './' base unchanged.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]

// Stamped into the About section (SettingsScreen) so a device can be checked
// against `git log` instead of guessing whether a service-worker update
// actually took — see memory "atlas-debug-log-mechanics": there was
// previously no way to tell which build was running. `rev-parse` only needs
// the current commit object, so it works fine against CI's shallow checkout.
function getCommitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: repoName ? `/${repoName}/` : './',
  define: {
    __APP_COMMIT__: JSON.stringify(getCommitSha()),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  // Default stays 5173 — plan §9 registers http://localhost:5173 as an OAuth
  // origin — but honour PORT so a second dev server can run alongside.
  server: { port: Number(process.env.PORT) || 5173 },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' + our own `virtual:pwa-register` import in main.tsx (rather
      // than autoUpdate's silent activation): a waiting update surfaces as the
      // "Update available" banner instead of swapping app code under the
      // user's fingers mid-session (07-sync-and-deploy.md task 7).
      registerType: 'prompt',
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png'],
      manifest: {
        name: 'Atlas',
        short_name: 'Atlas',
        description: 'A personal travel tracker for countries, subdivisions and cities.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0C1216',
        theme_color: '#0C1216',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icons/icon-512-maskable.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            // StaleWhileRevalidate, not CacheFirst: geo data is regenerated and
            // redeployed occasionally (e.g. higher-resolution country shapes), and
            // these files aren't content-hashed the way the precached app shell is
            // — a CacheFirst entry would never be revalidated against the network
            // again until its 1-year expiration, so a phone that had already
            // cached the old data would keep serving it indefinitely even after
            // installing every subsequent app update. StaleWhileRevalidate still
            // serves the cached copy instantly (same offline-first behaviour) but
            // also refreshes it in the background, so a data change is visible
            // within one extra app open instead of never. Bump this cache name
            // (any string change) whenever a geo-data update should land on the
            // very next open instead of the one after — done again for -v3 to
            // ship the admin1 id-collision fix (PROGRESS.md) immediately.
            urlPattern: /\/geo\/.*/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'atlas-geo-cache-v3',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'atlas-google-fonts-stylesheets',
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'atlas-google-fonts-webfonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
})
