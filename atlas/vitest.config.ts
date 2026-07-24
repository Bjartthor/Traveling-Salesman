import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts (not merged into it) so the PWA
// plugin's manifest/workbox setup never runs under the test runner — the
// modules under test are plain TypeScript with no build-plugin dependency.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
