# Progress

## Phase 1 — Scaffold, storage layer and design system (done)

A running, installable PWA with an empty but complete Dexie database, working HashRouter
navigation, and the full design-token system in place. No travel features — that's by design,
per the phase 1 brief.

### What was built

- **Project**: Vite + React 19 + TypeScript in `atlas/`, strict mode plus
  `noUncheckedIndexedAccess`, `@/` → `src/` path alias, `base: './'` for GitHub Pages.
- **Design tokens**: [`atlas/src/styles/tokens.css`](atlas/src/styles/tokens.css) — full palette,
  the three type families (Archivo Expanded / Public Sans / IBM Plex Mono), plus a spacing/radius/
  motion scale (see Deviations). [`atlas/src/styles/base.css`](atlas/src/styles/base.css) — reset,
  dark background, focus-visible rings, `prefers-reduced-motion`.
- **Database**: [`atlas/src/db/schema.ts`](atlas/src/db/schema.ts) implements every table from
  plan §4 (`countries`, `subdivisions`, `cities`, `entries`, `trips`, `tripEntries`, `photos`,
  `photoBlobs`, `settings`, `syncState`) with the indexes called out in phase 1 §3.
  [`atlas/src/db/repo.ts`](atlas/src/db/repo.ts) is the only module that touches the user-data
  tables directly — every write stamps `updatedAt`, bumps `syncState.revision` in the same
  transaction, and soft-deletes only. [`atlas/src/db/seed.ts`](atlas/src/db/seed.ts) seeds the
  `settings` and `syncState` singletons idempotently on every app start.
- **Navigation**: `HashRouter` with routes `/`, `/places`, `/trips`, `/settings`; bottom tab bar
  ([`BottomNav.tsx`](atlas/src/components/nav/BottomNav.tsx)) with 44px-min targets and a shared
  [`EmptyState`](atlas/src/components/layout/EmptyState.tsx) component for the four placeholder
  screens, each with a descriptive sentence instead of "no data yet".
- **PWA**: `vite-plugin-pwa` with `autoUpdate`, full manifest (192/512/512-maskable icons —
  generated placeholder contour-line motif, see Deviations), Workbox precache for the app shell
  plus runtime caching for `/geo/*` and for Google Fonts (stylesheet + woff2), so text renders
  correctly offline after first load.
- **Preview config**: [`.claude/launch.json`](.claude/launch.json) runs `npm --prefix atlas run
  dev` on port 5173.

### Deviations from the plan, and why

1. **Node version bump (18 → 20), not in the plan at all.** The machine only had Node 18.19.1
   (apt's `nodejs` package, and initially not even `npm` — installed separately with the user's
   `sudo apt-get install -y npm`). `create-vite`'s own CLI needs Node ≥20.19/22.12, so scaffolding
   used a pinned `create-vite@6.5.0`, which does support Node 18. That got the app scaffolded, but
   the **production build** then failed with `ReferenceError: crypto is not defined` — traced to
   `vite-plugin-pwa` → `workbox-build` → `@rollup/plugin-terser`, which hard-requires Node ≥20.
   With the user's approval, installed `nvm` (user-space, no sudo) and Node 20.20.2, set as the nvm
   default, and did a clean `node_modules` reinstall under it. **Node 20+ is now a hard
   requirement for this project** — note this for future sessions.
   - Practical note: this sandbox's non-interactive shells don't source `~/.bashrc`, so `node`/
     `npm` on a fresh shell still resolve to the old apt Node 18 unless you first run
     `export NVM_DIR="$HOME/.nvm" && \. "$NVM_DIR/nvm.sh" && nvm use 20`. An interactive login
     shell (a real terminal) picks up the `nvm alias default 20` automatically.
2. **Icon generation.** No SVG rasterizer was available (no `rsvg-convert`, no `sharp`); used
   ImageMagick's built-in SVG coder via a throwaway Node script (procedurally generated wavy
   "contour line" paths) to produce the three required PNGs. The generator script itself lives
   only in the session scratchpad, not committed — it was a one-off for a placeholder icon, not a
   reusable pipeline. If the icon needs revisiting later, it'll likely be redrawn by hand rather
   than regenerated.
3. **Fonts stay on the Google Fonts CDN** (preconnect + `display=swap`) rather than being
   self-hosted, but Workbox runtime-caches both `fonts.googleapis.com` and `fonts.gstatic.com`
   with `CacheFirst`, so the offline requirement in the phase brief is still met after first load.
4. **Added a spacing/radius/motion token scale** beyond what plan §8 spells out verbatim (which
   only enumerates colours and type). Did this because components need *some* non-hardcoded values
   for padding/gaps/corners, and inventing them ad hoc per component would violate the spirit of
   "nothing is hardcoded." Treat these as provisional — nothing downstream depends on their exact
   values yet.
5. **`repo.ts` has a few `as never` / `as IDType<T, 'id'>` casts** inside the generic `makeRepo<T>`
   helper. Dexie's conditional types (`IDType`, `UpdateSpec`) don't simplify for a type parameter
   constrained only by `extends SyncedRecord`, even though every concrete table (`Entry`, `Trip`,
   etc.) has a `string` id. The casts are internal to the helper only — every exported repo
   (`entriesRepo`, `tripsRepo`, `tripEntriesRepo`, `photosRepo`) has a fully type-safe, string-id
   public signature.
6. **"Installable" was verified without a literal Lighthouse run** — no Lighthouse CLI/MCP tool
   was available. Verified the installability criteria directly instead: manifest served with
   correct icons (192/512/512-maskable) and `display: 'standalone'`, service worker registers and
   takes control (`navigator.serviceWorker.controller`), and — for the "works with network
   disabled" criterion — confirmed via `npm run build && npm run preview` that Workbox actually
   precaches the app shell, JS/CSS bundle, icons, and fonts (checked the Cache Storage contents
   directly). If you have a real Lighthouse run available, worth a quick confirmation pass, but
   there's no reason to expect it'd disagree.

### Left undone (correctly, per phase 1 scope)

No map, no geo data, no cascade/status logic, no Google auth, no photos — all later phases. The
`countries` / `subdivisions` / `cities` reference tables exist in the schema but are empty; phase 2
populates them.

### Verified

- `npm run dev` serves with zero console errors (checked at both 390×844 and 360×800).
- All four tabs route correctly and render their empty states; active-tab styling works.
- IndexedDB `atlas` database has all 10 tables from §4 (confirmed via direct `indexedDB.open`
  inspection); `settings` singleton is seeded with the exact defaults from the phase brief.
- `npm run build && npm run preview` works, and Cache Storage after first load contains the full
  app shell + fonts — service worker takes control (`navigator.serviceWorker.controller` is set).
- No hardcoded colours in `src/components` (or `src/screens`, `src/App.css`) — grepped for hex/rgb
  literals, zero hits.
- `npm run lint` is clean.
