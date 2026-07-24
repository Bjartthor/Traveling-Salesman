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

## Phase 2 — Geographic data pipeline (done)

A repeatable Node build script turns public datasets into small committed artefacts in
`atlas/public/geo/`, plus a runtime loader that seeds them into IndexedDB on first run with a
progress screen, and an in-memory city search. Verified through a temporary debug screen — no map
rendering or place-adding UI yet (that's Phases 3–4, by design).

### What was built

- **Build pipeline** (`atlas/tools/`, run with `npm run build:geo`, Node 20 only):
  [`build-geo.mjs`](atlas/tools/build-geo.mjs) downloads sources into gitignored `tools/.cache/`,
  reconciles Natural Earth ↔ GeoNames, **fails loud (exit 1) naming any unmatched country**, and
  writes the artefacts. [`fixups.mjs`](atlas/tools/fixups.mjs) holds every override with a reason.
  [`tools/README.md`](atlas/tools/README.md) documents regeneration + each fixup;
  [`tools/minor_fixes.md`](atlas/tools/minor_fixes.md) documents deferred issues.
- **Artefacts** (`atlas/public/geo/`, ~7.1 MB committed): `world.topo.json` (96 KB, object
  `countries`, `{code,name}`), `admin1/<CC>.topo.json` (240 files, object `admin1`, `{id,name}`),
  `countries.json` (250 rows), `subdivisions.json` (3865 rows), `cities.json.gz` (170k cities,
  columnar `{fields,rows}`).
- **Runtime loader** [`src/geo/loader.ts`](atlas/src/geo/loader.ts): `ensureReferenceData()` (first
  run / version bump only; touches **only** reference tables), `loadWorldTopology()` and
  `loadCountryTopology()` (lazy, memoised, resolves `null` for missing admin-1 files).
- **Search** [`src/geo/search.ts`](atlas/src/geo/search.ts): `searchCities()` over an in-memory
  index (built once, memoised), population-weighted with prefix promotion. `normalize`/`tokenize`
  utilities (diacritic-stripping).
- **First-run UX**: [`geoStore.ts`](atlas/src/geo/geoStore.ts) (Zustand) + [`GeoGate.tsx`](atlas/src/geo/GeoGate.tsx)
  — "Loading world data" screen with a determinate bar; once countries land, a "Start exploring"
  button reveals the app while cities finish behind a thin progress strip.
- **Debug/verify screen** [`DebugScreen.tsx`](atlas/src/screens/DebugScreen.tsx) at `#/debug` (link
  on the You screen) — counts, required-territory checks, topology probe, live search with timing.
- **Data-model touch-ups**: `City.subdivisionId` widened to `string | null`; `Settings.geoDataVersion`
  added (device-local, seeded to 0). No Dexie version bump — Phase 1 already declared the indexes.

### Deviations from the plan, and why

1. **Territory polygons — "relax + document" (your call).** NE 1:50m *Countries* has no separate
   polygon for 13 GeoNames territories (Gibraltar, the French DOMs, Christmas/Cocos, Svalbard,
   Bonaire, Bouvet, Tokelau, US Minor Outlying). They still get country **rows** (trackable) but are
   not distinct map landmasses in v1. Listed in `KNOWN_NO_POLYGON`; the validator treats them as
   expected so *other* gaps still fail the build. **Fully documented with a graft-it-later recipe in
   [minor_fixes.md](atlas/tools/minor_fixes.md) §1.** The reverse direction is clean — every polygon
   maps to a country row.
2. **Runtime search is in-memory, not the Dexie `*searchTokens` prefix index.** The acceptance test
   `"vík"` must match an *interior* substring (vík inside Reykjavík/Keflavík — Vík í Mýrdal itself is
   <1000 pop, below the cities1000 cut), which a prefix index cannot do. `searchTokens` is left `[]`
   (index stays declared but inert — no migration) to spare the first-run seed a 170k-row multi-entry
   index build for zero runtime gain. Warm 3-char query measured **~32–38 ms** (budget 100 ms).
3. **Search ranking = population × match-weight** (name/field-prefix ×3, word-prefix ×2, interior
   ×1) rather than hard tiers. Hard tiers filled the whole `"vík"` page with worldwide "Vik*" prefix
   towns and pushed Reykjavík off; the weighting satisfies *both* `"reykja"→Reykjavík first` and
   `"vík"→Reykjavík returned`, matching the brief's literal "ranks by population descending, **with**
   exact-prefix promoted above substring".
4. **`cities.json.gz` is ~4.2 MB, not the plan's 2–3 MB.** The real cities1000 is 170k rows (plan
   assumed ~150k) and 4-dp coords are plan-mandated. Columnar encoding + asciiName-dedup got it 5.2 →
   4.2 MB; further shrink needs dropping precision or the id key. One-time download, SW+IDB cached.
   See [minor_fixes.md](atlas/tools/minor_fixes.md) §3.
5. **gzip served two ways.** GitHub Pages serves `.gz` raw; Vite dev sets `Content-Encoding: gzip`
   so the browser pre-decompresses. The loader sniffs the gzip magic bytes (`1f 8b`) and only
   `DecompressionStream`s when needed — robust on both. (Found and fixed during browser verification.)
6. **Dependencies:** used Node 20's global `fetch` instead of `node-fetch` (plan listed it); added
   `d3-geo` for spherical country centroids. `mapshaper` emits TopoJSON directly, so `topojson-client`
   isn't used in the build (kept as a dep for Phase-3 runtime decoding). All dev-only.
7. **NE 10m admin-1 is more complete than the plan assumed** — Vatican/Monaco/Singapore *do* have
   admin-1 files; the 10 countries with no file are the small no-polygon territories. The loader
   handles a missing file gracefully (verified `loadCountryTopology('BV') === null`).
8. **Seed throughput:** `bulkAdd` (after `clear()`) + 10k-row chunks. First-run seed ≈ 50 s on this
   desktop (mostly IndexedDB index writes for 170k rows); the progress bar + "Start exploring" escape
   cover it, and it only runs once.

### Left undone (correctly, per scope)

No map rendering (Phase 3), no add/edit places or the online **Photon** city fallback (Phase 4), no
attribution line on the About screen yet (Phase 7). `DebugScreen` + its You-screen link are
temporary Phase-2 scaffolding to delete once real screens exist.

### Verified

- `npm run build:geo` completes from a clean cache, exit 0, prints the size report. **Fail-loud
  confirmed**: removing GI from `KNOWN_NO_POLYGON` exits 1 with "GeoNames country GI (Gibraltar) has
  no Natural Earth polygon…", then restored.
- Sizes: world.topo.json 96 KB (< 500 KB), largest admin-1 RU 76 KB (< 150 KB), cities 170,486 with
  170,103 resolving to a subdivision (383 → null, 0.2%). 250 countries, exactly **193 UN members**.
- Browser (Vite dev): first-run screen → seed → `geoDataVersion` 1, 250/3865/170486 rows. All 7
  required territories present (GL/FO/PR/HK/MO/GI/NC). Topology: world 237 geometries, IS admin-1 9
  regions, BV admin-1 null. Search `"reykja"`→Reykjavík first; `"vík"`→Reykjavík returned; warm query
  ~32–38 ms. Error path (aborted fetch → "Couldn't load world data" + retry) works.
- `npx tsc --noEmit` and `npm run lint` clean.

### Notes for the next session

- Run geo/dev with Node 20 (`nvm use 20`); the non-login shell still defaults to apt Node 18.
- Map (Phase 3) consumes `world.topo.json` object `countries` (props `code`,`name`) and
  `admin1/<CC>.topo.json` object `admin1` (props `id`=`<CC>.<geonamesAdmin1>`, `name`) via
  `loadWorldTopology()`/`loadCountryTopology()`; decode with `topojson-client` (already a dep).
