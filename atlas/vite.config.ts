import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Actions sets GITHUB_REPOSITORY to "owner/repo" for every workflow run
// (07-sync-and-deploy.md task 7: "set Vite base correctly for a project site").
// Deriving it here means the repo name never needs to be hand-typed into
// config — local dev and preview keep the relative './' base unchanged.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1]

// https://vite.dev/config/
export default defineConfig({
  base: repoName ? `/${repoName}/` : './',
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
            urlPattern: /\/geo\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'atlas-geo-cache',
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
