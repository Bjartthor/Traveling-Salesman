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

## Phase 3 — World map and coverage statistics (done)

The Map tab: a pannable, zoomable choropleth coloured by status, a tap-to-cycle headline
percentage, the "depth scale" coverage strip, a collapsible legend, and a read-only country
detail sheet. Two scope questions were asked and confirmed before writing code (see Deviations
1–2) since they affected architecture, not just presentation.

### What was built

- **Stats module** [`src/stats/coverage.ts`](atlas/src/stats/coverage.ts) — pure, no React/Dexie:
  `buildStatusIndex`, `countryCoverage`/`landAreaCoverage`/`populationCoverage`/`metricCoverage`,
  `transitCoverage`, `continentsTouched`, `countVisited`, `countrySubdivisionsVisited`,
  `countCitiesVisited`, `visitDateRange`, `worldSummary`, `nextStatMode`. Every function takes
  plain arrays/`Map`s and returns plain data.
  [`coverage.test.ts`](atlas/src/stats/coverage.test.ts) — 16 tests against one hand-checked
  4-country fixture (round numbers chosen so every percentage is checkable by hand); also covers
  the "Seven seas (open ocean)" pseudo-continent exclusion and soft-delete/kind filtering.
- **Map** [`src/components/map/WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx):
  `geoNaturalEarth1` fitted to the container via `ResizeObserver` + `fitSize([...], {type:'Sphere'})`;
  path `d` strings memoised only on projection/topology (never on status — status changes only
  touch the `fill` style, matching the phase brief's perf note). Pan/zoom via `d3-zoom`
  (`scaleExtent [1,12]`, `translateExtent`/`extent` both `[[0,0],[w,h]]` so the map can't be
  dragged off-screen, `clickDistance(6)` so a tap isn't swallowed as a drag); the transform is
  applied with `g.setAttribute` directly inside the `'zoom'` handler — bypassing React state
  during the gesture — and React state (`scale`) only updates on `'end'`, which is all the
  admin-1 threshold check needs. Tapping a country sets `selectedCode` (opens the sheet); once
  `selectedCode` is set **and** `scale >= ADMIN1_ZOOM_THRESHOLD` (constant, `4`), its admin-1
  topology loads lazily and renders on top, resolving to nothing (no error) when the file doesn't
  exist. [`topo.ts`](atlas/src/components/map/topo.ts) wraps `topojson-client` decoding;
  [`statusColor.ts`](atlas/src/components/map/statusColor.ts) is the one shared status→colour/label
  map used by the map, legend, strip and sheet.
- **Country sheet** [`CountrySheet.tsx`](atlas/src/components/map/CountrySheet.tsx) — the Phase 3
  stopgap named in the brief: name, ISO code, status badge, regions/cities visited within that
  country, first/last visited if the country has its own entry. Read-only, no editing.
- **Headline** [`CoverageHeadline.tsx`](atlas/src/components/map/CoverageHeadline.tsx) +
  [`useTweenedNumber.ts`](atlas/src/components/map/useTweenedNumber.ts) — tap cycles
  countries → area → population; a `requestAnimationFrame` ease-out tween animates the digits,
  skipped (jumps straight to the target) under `prefers-reduced-motion`.
- **Coverage strip** [`CoverageStrip.tsx`](atlas/src/components/map/CoverageStrip.tsx) — four
  status-coloured segments sized by each status's share of whichever metric is currently
  selected, hairline tick row underneath with `0` and the formatted total, under 32px tall.
- **Legend** [`Legend.tsx`](atlas/src/components/map/Legend.tsx) — native `<details>`/`<summary>`,
  no JS state needed.
- **Screen** [`MapScreen.tsx`](atlas/src/screens/MapScreen.tsx) rewritten — live-queries
  `countries`/`entries`/`settings` via `dexie-react-hooks`, builds the three status indexes and the
  current metric, wires headline/map/strip/legend/sheet together. Fresh-install state (no active
  entries) is the real grey map plus one line of guidance pointing at Places — not the shared
  `EmptyState` placeholder used by the other still-empty tabs.

### Deviations from the plan, and why

1. **Cascade explicitly deferred to Phase 4 (asked, confirmed).** The phase table (plan §10)
   assigns "cascade rules" to Phase 4, but Phase 3's own task text uses the term "effective status"
   for map fill, which reads like plan §5's cascade. Asked before writing code; confirmed reading:
   Phase 3 reads each entry's own status directly by `kind`+`refId`, nothing derived from children.
   **Consequence:** a country with only a city or subdivision entry (no entry of its own) shows
   unvisited/grey on the map until Phase 4 builds `recomputeAncestors` and the write path that
   would create the derived country entry. This matches the acceptance test's own phrasing
   ("manually inserting entries **rows**" — plural, implying direct rows at whatever level you
   want reflected) and keeps `recomputeAncestors` — which the plan flags as "the piece most likely
   to go subtly wrong" — as one deliverable owned entirely by Phase 4, tests included.
2. **Coverage strip = 4 status segments of the current metric (asked, confirmed).** Plan §8 says
   the strip shows "the three percentages"; the phase brief says "segmented in the status colours,
   proportional to the current metric" (singular). There are 4 status colours, not 3, so these
   don't literally agree. Confirmed the phase brief's reading: one bar for whichever metric
   (countries/area/population) is currently selected, split into wishlist/transit/visited/lived by
   each status's share of that metric's denominator.
3. **Introduced Vitest** — no test runner existed in the repo (Phase 1/2 didn't need one); the
   brief requires `coverage.ts` be "fully unit-tested." Added as a devDependency with a `test`
   script. [`vitest.config.ts`](atlas/vitest.config.ts) is a **separate** file from
   `vite.config.ts`, not merged in, so the PWA/Workbox plugin never runs under the test runner.
4. **`d3-geo` and `topojson-client` moved from `devDependencies` to `dependencies`** — Phase 2 only
   needed them in the Node build script; Phase 3 imports both into `src/`, so they now ship in the
   client bundle. Added `d3-zoom` and `d3-selection` (plus `@types/*`, `@types/geojson`,
   `@types/topojson-specification`) as direct, explicit dependencies rather than relying on
   hoisted transitives.
5. **Admin-1 zoom threshold is a picked constant** (`ADMIN1_ZOOM_THRESHOLD = 4`, i.e. 4× the
   whole-world fit) — the brief says "past a threshold" without a number. Documented inline;
   verified in-browser that zooming Germany to the `scaleExtent` max (12×) via wheel-zoom loads and
   renders all 16 admin-1 regions distinctly.
6. **"Continents touched out of seven" excludes GeoNames' `"Seven seas (open ocean)"` bucket** —
   found while inspecting `countries.json`: 8 distinct `continent` values exist, not 7, because a
   handful of scattered island territories get bucketed into that pseudo-continent. Excluded it
   explicitly in `coverage.ts` with a comment; the other 7 are the real ones a person visits.
7. **No dedicated UI for the `countryDenominator` (all/UN-members) setting.** Phase 3's task list
   doesn't include Settings screen work, and the acceptance criterion only requires that switching
   it changes the number — it doesn't say where the switch lives. Verified by updating
   `settings.countryDenominator` directly (browser console / dynamic import of `db`); left for
   whichever later phase builds out the Settings screen for real.
8. **`.app-content` needed `min-height: 0` added** ([`App.css`](atlas/src/App.css)) — without it,
   the `flex: 1` chain down to the map (`MapScreen` → `.map-screen__map-wrap` → `WorldMap`) doesn't
   actually constrain to the viewport; the map would grow to its content size and the page would
   scroll instead of the map filling available space. Standard flexbox fix, one line.

### Left undone (correctly, per scope)

No editing from the map — the country sheet is read-only, exactly as instructed ("Do not do yet").
No cascade/`recomputeAncestors` (Phase 4). No Settings UI for `statMode`/`countryDenominator`
(not in Phase 3's task list; both are wired in the data layer and verified directly). `CountrySheet`
is deliberately the stopgap version named in the brief — Phase 4 replaces it with the full,
editable country detail screen.

### Verified

- `npx tsc -b`, `npm run lint`, `npx vitest run` (16/16), and `npm run build` all clean.
- Browser (Vite dev, 375×812 mobile viewport, dark colour scheme):
  - All 237 country paths render, including small island territories (Vatican, Monaco, San Marino,
    Nauru, Tuvalu, Liechtenstein, Åland, etc.).
  - Inserting rows **through Dexie** (`db.entries.add`, not raw IndexedDB — see note below)
    recolours the map immediately with no reload, across all four statuses and both country and
    subdivision kinds.
  - Headline cycles countries → area → population → countries; land-area (0.3%) and population
    (1.09%→displayed 1.1%) both hand-checked against the raw `countries` table and matched exactly.
  - Coverage strip's four segment widths hand-checked against land-area-weighted status shares —
    matched (e.g. France/transit 0.365% against a computed 0.370%, within float rounding).
  - Country denominator switch (250 "all" → 193 "unMember") changed 0.8% → 1.0% as expected.
  - Zooming into Germany (wheel-zoom to the 12× `scaleExtent` max) loads and renders all 16
    admin-1 regions as distinct shapes with independent status colouring; the sheet correctly
    reported "Regions visited 1/16" against a single subdivision-level test entry.
  - Zooming into Singapore loads 5 admin-1 regions, no error, no console errors.
  - **Pan clamping verified to the pixel**: dragging far past either edge clamps the transform at
    exactly the mathematically-predicted boundary (`width × (1 − scale)` / `height × (1 − scale)`)
    on both axes — confirms `translateExtent`/`extent` are wired correctly, not just "seems fine."
  - Legend `<details>` toggle opens/closes correctly.
  - No horizontal scroll at 375px width.
  - Fresh-install state (entries cleared) shows the real grey map plus one guidance line pointing
    at Places, not a placeholder block.
  - App left in a clean state afterward: test entries cleared, `countryDenominator`/`statMode`
    settings reset to defaults.

### Notes for the next session

- **Dexie reactivity requires writes through Dexie.** `useLiveQuery` does not observe writes made
  via the raw `indexedDB` API on a separate connection — confirmed this the hard way mid-session
  (a raw-IndexedDB test insert silently didn't recolour the map until reload). For manual
  console-based testing, get the real instance first: `const {db} = await import('/src/db/schema.ts')`,
  then `db.entries.add(...)`.
- **`window.matchMedia` override + double-`requestAnimationFrame` hung the preview tool** during
  reduced-motion testing this session (30s timeout on both `preview_eval` and `preview_screenshot`,
  recovered after a plain `1+1` eval and a page reload). Likely `requestAnimationFrame` not firing
  on a backgrounded/non-focused automation tab, not an app bug — the reduced-motion branch itself
  is a plain `matchMedia(...).matches` check with no other side effects. Worth a quick recheck with
  a different technique (e.g. CDP-level media emulation instead of monkey-patching `matchMedia`) if
  it matters later, but not blocking.
- Once Phase 4 lands `recomputeAncestors`, re-verify the map/stats end-to-end with entries added
  only at the city/subdivision level — right now (by design, see Deviation 1) those don't colour
  their parent country.
- No formal frame-timing capture was done for the "60fps while panning" criterion (no performance-
  trace tool available in this environment); wheel-zoom and drag both felt instantaneous with 237
  paths, and the perf-sensitive parts (memoised `d` strings, DOM-direct transform updates) are in
  place by construction. Worth a real profile pass if the map ever feels janky on an actual phone.

## Phase 3b — Visual polish (done)

A design-only pass over everything Phase 3 built: the map, coverage headline, coverage strip,
legend and country sheet. There is no numbered phase file for "3b" — per `START-HERE.md` it's a
self-directed critique-and-polish session, not a checklist. Confirmed scope and direction with the
user before touching CSS: a general critical pass (not a list of pre-existing complaints), leaning
into "instrument/chart texture" (hairlines, elevation, mono data treatment) rather than staying flat.

### What was built

- **The map's dead-space problem, diagnosed and fixed**
  [`WorldMap.css`](atlas/src/components/map/WorldMap.css)/[`.tsx`](atlas/src/components/map/WorldMap.tsx):
  on a portrait phone, `.world-map__ocean` was filled with `--abyss` — identical to the page
  background — so the projected globe (wide aspect ratio, fitted into a tall container) had no
  visible boundary, and roughly 60% of the screen above/below the landmasses read as a featureless
  black void. Fixed two ways: (1) the ocean/sphere path now fills `--shelf`, giving the globe a
  visible boundary; (2) added a static instrument-panel backdrop — fixed horizontal hairlines every
  48px, drawn *outside* the pan/zoom group (`gRef`) so they read as a screen grid rather than
  geography, sitting behind the ocean fill (visible only in the void, hidden under the globe).
  Confirmed by construction that pan/zoom and the Germany admin-1 threshold are unaffected (the grid
  is a sibling, not a child, of the zoomed group).
- **Coverage headline cycle-position dots**
  [`CoverageHeadline.tsx`](atlas/src/components/map/CoverageHeadline.tsx)/[`.css`](atlas/src/components/map/CoverageHeadline.css):
  three small dots beneath the mono label, the active one filled — a carousel-style affordance that
  the number is tappable and cyclical, using only `--haze`/`--contour`/`--chalk` (no status colours).
- **Bottom nav active-tab indicator**
  [`BottomNav.css`](atlas/src/components/nav/BottomNav.css): a 2px `--chalk` bar fades in above the
  active tab (`scaleX` transform, respects reduced motion) — previously the only cue was an icon/
  label colour change.
- **Coverage strip framing** [`CoverageStrip.css`](atlas/src/components/map/CoverageStrip.css): a
  top hairline (`border-top`) separates the strip from the map above it, and the track itself now
  has rounded ends (`--radius-sm`) instead of a hard-edged rectangle.
- **Country sheet elevation** [`CountrySheet.tsx`](atlas/src/components/map/CountrySheet.tsx)/[`.css`](atlas/src/components/map/CountrySheet.css):
  added a drag-handle bar (bottom-sheet convention, decorative only — the sheet isn't actually
  draggable), a `box-shadow` (new `--shadow-md` token) so it visibly lifts off the map instead of
  looking flush-pasted, and a hairline divider between the status row and the stats grid for a
  data-readout feel.
- **Elevation tokens** [`tokens.css`](atlas/src/styles/tokens.css): added `--shadow-sm`/`--shadow-md`
  — near-black, low-opacity (dark theme, so the usual grey shadow recipe reads muddy) — following the
  same "add the missing token rather than hardcode a value" precedent Phase 1 set for spacing/radius.
  Only `--shadow-md` is used so far (the country sheet); `--shadow-sm` is provisional, added for
  whatever the next elevated surface turns out to be.

### Deviations from the plan, and why

1. **No phase file exists for "3b"** — `00-PLAN.md` §10 only lists phases 1–7; `START-HERE.md`'s
   session table is the only place "3b — Visual polish" appears, with no task list or acceptance
   criteria. Asked the user up front (via two targeted questions) what should drive the pass and how
   far to push the aesthetic, rather than guessing scope. Answers: general critical pass, lean into
   instrument/chart texture. Everything above follows from that brief, not from a written spec.
2. **`CoverageHeadline`'s dot order duplicates `coverage.ts`'s internal `METRIC_CYCLE`** (`['countries',
   'area', 'population']`) as a local `MODE_ORDER` constant rather than exporting the private array.
   `METRIC_CYCLE` is intentionally unexported (only `nextStatMode` is the public surface); adding an
   export purely to feed a decorative dot readout felt like the wrong direction to widen that
   module's API. Three-element order is stable and already relied on implicitly via `METRIC_LABELS`'
   key order.
3. **Preview tool flakiness, again** — `preview_screenshot` intermittently returned stale/desynced
   frames this session (e.g. showing `0.0%` and an unpopulated map immediately after a resize, when
   `preview_snapshot` and Dexie both confirmed the real page state was `2.8%` with 12 test entries).
   Distinct from the reduced-motion/`matchMedia` hang noted in Phase 3 — no monkey-patching was
   involved here, just resize-then-screenshot. Recovered every time by re-issuing the screenshot call
   (sometimes twice) or falling back to `preview_snapshot`/`preview_eval` to confirm ground truth
   first. Treat any single screenshot right after a resize/reload with suspicion; cross-check against
   snapshot if something looks wrong.

### Left undone (correctly, per scope)

This was a polish pass, not a feature phase — there's no acceptance checklist to leave unfinished.
`CountrySheet` remains the deliberate Phase 3 read-only stopgap (Phase 4 replaces it). Places, Trips,
Settings and the empty-state screens on those tabs were untouched — this session was scoped to what
Phase 3 built (map + stats), not the rest of the app.

### Verified

- `npx tsc -b`, `npm run lint`, and `npx vitest run` (16/16) all clean.
- Browser (Vite dev, dark colour scheme), both at **390×844** and **360×800**:
  - Fresh-install state (no entries): the map now shows a clearly-bounded grey globe against a
    gridded backdrop instead of a black void, guidance hint bubble unchanged, cycle dots show the
    first dot active.
  - Populated state (12 test entries added directly via Dexie across 6 continents/4 statuses):
    ocean fill and gridlines correctly sit *behind* the coloured countries (no visual interference
    with status colours); headline cycling (tap) advances the dots in lockstep with the displayed
    metric; coverage strip shows rounded ends and a top separating rule; legend expands with the
    same four swatches, no layout regression.
  - Country sheet (opened on Germany): drag handle, drop shadow and status/stats divider all render;
    close button still works; regions-visited stat still reads correctly (0/16 — Phase 4 territory).
  - Zoom regression check: simulated a ctrl-wheel zoom sequence on the SVG — countries render
    correctly zoomed, grid lines correctly stay hidden under the now-larger ocean fill, no visual
    artifacts from the new static grid layer sitting alongside the pan/zoom group.
  - No horizontal scroll at either width.
  - Test entries cleared and `statMode` reset to `countries` afterward — app left in a clean
    fresh-install state.

### Bug fix: bottom nav pushed off-screen when content exceeds one viewport

Reported by the user after the polish pass above: expanding the Legend pushed the bottom tab bar
(Map/Places/Trips/You) below the fold instead of the map area shrinking to make room.

**Root cause**, confirmed by measuring the box model live in-browser (`clientHeight`/`scrollHeight`
of `html`/`body`/`#root`/`.app-shell`/`.app-content`): the entire shell chain
(`body`, `#root`, `.app-shell` — [`base.css`](atlas/src/styles/base.css),
[`App.css`](atlas/src/App.css)) was sized with `min-height: 100vh` rather than a hard `height`. A
flex chain built entirely of `min-height` never gives its descendants a *definite* height to
allocate — so when the Legend's expanded content made the natural (intrinsic) height of the page
exceed one viewport, every ancestor just grew to fit it instead of `.app-content`'s existing
`overflow-y: auto` kicking in, and the whole page (including the nav bar, `flex-shrink: 0` at the
bottom of `.app-shell`) scrolled down with it. Measured concretely: with the legend open at
360×800, `html.scrollHeight` was 841px against an 800px viewport — the nav bar's bottom edge sat at
841, i.e. 41px below the fold.

**Fix**: gave the chain one definite height instead of a cascade of minimums —
`#root { height: 100dvh }` (was `min-height: 100vh`; `dvh` over `vh` so mobile browser chrome
show/hide doesn't reintroduce the gap), and `.app-shell { min-height: 0 }` (was `min-height: 100vh`,
which fought the new definite parent height and also skipped the classic flexbox
`min-height: auto` fix — the same pattern `.app-content` already used one level down). With a real
height to distribute, `.app-content`'s `flex: 1` now actually clamps to (viewport − nav height), and
`.map-screen__map-wrap`'s `flex: 1` shrinks to fit whatever the Legend needs, exactly as the
flex-based layout always intended.

Re-verified after the fix at both 360×800 and 390×844: `html.scrollHeight` now equals
`clientHeight` exactly (no page-level overflow) with the legend open, nav bar fully visible in both
cases, and the map area visibly shrinks to accommodate the legend instead of the page growing.
`tsc -b` / `lint` / `vitest` (16/16) all still clean. This was a Phase 1 scaffold issue (the
`min-height: 100vh` cascade dates to the original shell), not something Phase 3b's additions caused
— it simply hadn't been exercised with the legend open on a content stack tall enough to overflow
before now.

### Notes for the next session

- The ocean-fill/gridline fix only addresses the *portrait, unzoomed* dead-space case, which is the
  overwhelmingly common one (that's the default view). It doesn't change the underlying
  aspect-ratio-mismatch cause — if a future session wants the globe itself to visually fill more of a
  narrow viewport, that requires either fitting to height (with horizontal pan needed to reach
  Russia/Chile's extremities from the initial view) or a different projection, which is a bigger
  behavioural change than this polish session's scope.
- `--shadow-sm` is unused — decide what it's for (a card component, the legend, something in Phase 4)
  or drop it if nothing ends up needing it.
- Now that the shell has a real height ceiling, any future screen whose content can legitimately
  exceed one viewport (e.g. a long country sheet, a long trip list) will scroll correctly within
  `.app-content` rather than pushing the nav bar away — worth keeping in mind as Phase 4/5 add more
  content-heavy screens.

## Phase 4a — Cascade engine and tests (done)

Task 1 of `04-places.md` only — per `START-HERE.md`, phase 4 is split and 4a is "Cascade engine +
tests". The status cascade of plan §5, built test-first as pure functions, plus the Dexie adapter
that applies it, plus a temporary browser harness to exercise it against the real dataset. **No
Places UI** — that is 4b.

Three scope questions were asked and answered before any code was written (see Deviations 1–3);
all three changed the design rather than just the presentation.

### What was built

- **The engine** [`src/domain/cascade.ts`](atlas/src/domain/cascade.ts) — pure, no Dexie, no React.
  The whole thing reduces to one idea: **the explicit entries are the only truth**, and

  ```
  desired(place) = max( explicitStatus(place), max desired(child) )
  ```

  with a place having a row exactly when that is non-null. So `setStatus`, `removeEntry` and
  `rebuildAllDerived` are all *the same operation* — recompute `desired`, diff it against the rows
  that exist — differing only in how they perturb the explicit set first and how much of the tree
  they diff (target + ancestors for the first two, per plan §5's `recomputeAncestors`; everything
  for the third, per §7.3). That collapse is deliberate: it is what makes "the piece most likely to
  go subtly wrong" have one code path to get right instead of three. Also exports `parentOf` /
  `ancestorsOf` / `effectiveStatus` / `entryKey` / `findEntry` and the status ladder itself
  (`STATUS_ORDER`, `statusRank`, `maxStatus`).
- **The tests** [`src/domain/cascade.test.ts`](atlas/src/domain/cascade.test.ts) — 34 tests written
  **before** the implementation, covering all nine cases the brief enumerates plus the ordering
  ladder, parentage resolution, soft-delete/restore, idempotence, and the fallback rule below. One
  of them (`rebuildAllDerived` "never rewrites what the user set explicitly") caught a real design
  bug during the walkthrough — see Edge case 4.
- **The adapter** [`src/domain/cascadeRepo.ts`](atlas/src/domain/cascadeRepo.ts) —
  `loadCascadeState`, `setPlaceStatus`, `removePlaceEntry`, `rebuildDerivedEntries`. Each reads the
  snapshot and applies the resulting mutations through `repo.ts` inside **one** `db.transaction`
  (the repo's own transactions join the outer one rather than nesting), so a city and the country it
  implies are never half-written. **Nothing else in the app should write to `entries`** — going
  around this module means going around the cascade.
- **`repo.ts` gained `restore(id, patch)`** — see Edge case 3.
- **`Entry.explicitStatus`** added to [`db/types.ts`](atlas/src/db/types.ts) (Deviation 1).
- **Browser harness** — the temporary [`DebugScreen`](atlas/src/screens/DebugScreen.tsx) grew a
  cascade section: a status picker, tap-a-search-result-to-add, a country-code setter, the full
  entry list (explicit vs derived, with each row's `explicitStatus`), remove buttons, "rebuild
  derived", and a **drift indicator** that flags any row whose stored `status` disagrees with
  `effectiveStatus`. Deleted in 4b along with the rest of the screen.

### Deviations from the plan, and why

1. **`Entry.explicitStatus` added — one field beyond plan §4 (asked, confirmed).** Plan §5.3 defines
   a parent's effective status as `max(its own explicit status, highest among its children)`, but §4
   gives the row a single `status` field, which cannot hold both the user's choice and the computed
   result. Confirmed reading: `status` keeps holding the **effective** value (so the Phase-3 map and
   stats keep working as a plain field read) and `explicitStatus` remembers what the user actually
   chose. The user's stated requirement, now a test and verified in-browser: *Germany visited →
   add lived Berlin → Germany shows lived → downgrade Berlin → Germany drops **back to visited***,
   not stuck on lived. The rejected alternative (conflate into `status`) could raise an explicit
   parent but never let it fall back. The field is **not indexed**, so it needed no Dexie version
   bump. Invariant `explicit === (explicitStatus !== null)` is maintained only by `cascade.ts`.
2. **`removeEntry` demotes a parent that still has children (asked, confirmed)** rather than
   deleting it or wiping the subtree. Deleting would orphan the children and break §5.1's guarantee
   that a city's ancestors exist. A UI that means "erase everything here" walks the descendants
   itself — 4b's call.
3. **The harness lives on `DebugScreen` (asked, confirmed)** so 4a could be verified against the
   real 170k-city dataset rather than only against fixtures.
4. **A subdivision's country is derived from its id, not from a lookup table.** `subdivisions.id` is
   `${countryCode}.${geonamesAdmin1}` by construction (plan §4, built that way in `build-geo.mjs`) —
   the same convention `countrySubdivisionsVisited` in `coverage.ts` already relies on. So
   `CascadeState.places` only needs a **city** index, which is one less thing for the adapter to get
   wrong. Malformed ids throw.
5. **The status ladder moved to the domain.** It was defined three times (`coverage.ts`,
   `statusColor.ts`, and now the cascade). `coverage.ts` now imports `statusRank`/`STATUS_ORDER`
   from `cascade.ts` and re-exports them, so its public surface is unchanged;
   `statusColor.ts`'s copy is left alone as a *display* ordering concern.
6. **Derived parents get no dates.** The plan doesn't say whether `firstVisited`/`lastVisited` should
   aggregate upward. They don't — `setStatus` writes dates only on the entry the user set. Nothing
   needs the denormalised version: `visitDateRange` in `coverage.ts` already computes ranges across
   all entries, and 4b's country detail screen has the children to hand.
7. **`UnknownCityError` fails loud** when a city entry's `cities` row is missing, rather than
   skipping the entry. Skipping would let `rebuildAllDerived` delete a country the user really has
   visited — silent data loss. Follows the fail-loud precedent Phase 2 set in the geo build.
8. **`vite.config.ts` now honours `PORT`** (`server.port`), with `autoPort: true` in
   `.claude/launch.json`. Purely so a second dev server can run while another session holds 5173;
   the default is still 5173, which plan §9 registers as an OAuth origin.

### Cascade edge cases the plan did not anticipate

The phase brief asks for these explicitly.

1. **§5.3 needs two values per row but §4 provides one field.** The headline finding — Deviation 1.
   Everything else on this list is smaller.
2. **§5.5 only describes removing a *child*.** Removing a *parent* that still has children is
   undefined by the plan. Resolved as demote-to-derived (Deviation 2).
3. **Soft delete and the unique `[kind+refId]` index interact.** Plan §4 says never hard-delete;
   the index means a soft-deleted row still owns its slot. So re-adding a place the user removed
   must **restore that row** — a naive `create` throws a `ConstraintError`. Hence `repo.restore()`
   and the engine's separate `restore` mutation. This would have been a live bug the first time
   anyone re-added a place they'd deleted.
4. **A place with no row still has to conduct status upward.** Mark Germany explicitly, then add a
   city in Bavaria: Bavaria has no entry at the moment the country's status is recomputed, so
   linking each entry only to its *immediate* parent silently loses the connection and Germany never
   sees the city. The engine links each node to its **whole ancestor chain**. This is exactly the
   "subtly wrong" failure §5 warns about — it produced a plausible-looking wrong answer, not a
   crash, and only the test caught it.
5. **A country's children are not just its subdivisions.** 383 bundled cities have
   `subdivisionId: null` and hang directly off their country, so "does this derived parent still
   have a child?" has to consider both.
6. **Setting a parent explicitly *lower* than a child is a no-visible-op.** Germany derived-lived
   from Berlin; user sets Germany = visited; §5.3 + §5.4 together mean Germany still displays
   *lived*. Correct, but it will read as "the app ignored me" — 4b's status sheet should say
   *"showing lived because you lived in Berlin"*. `explicit`, `explicitStatus` and `effectiveStatus`
   give it everything it needs to.
7. **A reference-data reseed can strand city entries.** `ensureReferenceData` does
   `db.cities.clear()` on a `geoDataVersion` bump ([`loader.ts:112`](atlas/src/geo/loader.ts:112)),
   which would take any `source: 'online'` city with it and leave the user's entry pointing at
   nothing. Currently surfaces as `UnknownCityError`. **4b must preserve non-bundled cities across
   the reseed** — see below.

### Left undone (correctly — this is 4b)

Everything in `04-places.md` §2–§6: the city search UI, the Photon online fallback, manual places,
the status sheet, the Places tab, the country detail screen, and quick/bulk add. The Phase-3
`CountrySheet` is still the read-only stopgap. Two things for 4b to pick up first:

- **`CitySource` needs `'manual'`.** `04-places.md` §2 says to store manual places with
  `source: 'manual'`, but plan §4 and `db/types.ts` only allow `'bundled' | 'online'`. Left
  unchanged rather than silently widening a type outside this session's scope.
- **The reseed hazard above** (Edge case 7) — `ensureReferenceData` should keep non-bundled cities.

### Verified

- `npx tsc -b`, `npm run lint`, `npx vitest run` (**50/50** — 34 cascade + the 16 existing coverage
  tests) and `npm run build` all clean.
- **The tests were checked for teeth by mutation testing**, not just run: inverting `maxStatus`
  kills 8, linking only immediate parents kills 6, trusting a derived row's stored status instead of
  recomputing kills 11. All three restored afterwards.
- Browser (Vite dev, 375×812 and 390×844, dark), against the **real seeded dataset** (250 countries,
  3,865 subdivisions, 170,486 cities):
  - "garmisch" → tapping the result created **Bavaria** and **Germany** as derived entries.
  - "san francisco" (top-ranked hit) → created **California** and the **United States**.
  - "tórshavn" → created the **Faroe Islands** as its own country plus Streymoy; **no DK row**.
  - Germany explicitly *lived* + Munich *visited* → Germany **stays lived**; removing Munich drops
    derived Bavaria and leaves explicit Germany alone.
  - Germany explicitly *visited* + Berlin *lived* → Germany displays **lived** with
    `explicitStatus` still *visited*; downgrading Berlin returns Germany to **visited**; removing
    Berlin entirely leaves Germany *visited*. (The rule the user asked for, end to end.)
  - A *wishlist* city produced a **wishlist** country (Japan), never a visited one.
  - Kyoto *visited* → Japan derived; removing Kyoto removed all three rows from the live set, and
    3 soft-deleted rows remain in the table (nothing hard-deleted).
  - **Map recolours with no reload**: adding a *city* took Japan from `--contour` `rgb(38,52,60)` to
    `--visited` `rgb(79,192,141)`, and to `--lived` `rgb(232,163,61)` for a lived city — this closes
    the gap Phase 3 flagged in its Deviation 1, where city/subdivision entries didn't colour their
    country. Removing it returned Japan to `--contour`.
  - Coverage strip (not animated) read `0.4%` on the `--lived` segment, matching `metricCoverage`
    computed from the same data exactly.
  - Harness at 390×844: no horizontal overflow, 44×44 remove targets, status colour bars correct,
    drift indicator reads "no drift".
  - App left clean afterwards — `entries` cleared, `revision` reset to 0.

### Notes for the next session

- **`cascadeRepo.ts` is the only sanctioned writer to `entries`.** `db.entries.add/put` anywhere
  else bypasses the cascade and will produce exactly the drift the harness's indicator exists to
  catch.
- `rebuildDerivedEntries()` is the repair path and is safe to run any time — it returns the number
  of mutations it applied, so `0` is a clean bill of health.
- **Preview-tool artifacts seen again this session**, consistent with Phase 3/3b's notes, none of
  them app bugs. (a) Navigating by `location.hash` *without* a reload leaves the map blank — the
  `ResizeObserver` never delivers in the backgrounded automation tab, so the projection never gets a
  size; a full reload renders all 237 paths. (b) The tweened headline freezes for the same reason
  (`requestAnimationFrame` stalls), while the non-animated coverage strip stays correct — cross-check
  against the strip or compute from Dexie rather than trusting the headline digits. (c)
  `preview_screenshot` timed out repeatedly; `preview_snapshot`/`preview_eval` were reliable
  throughout. (d) Clicking a search result immediately after `preview_fill` can land on a stale node
  and silently do nothing — re-issue the click once the list has settled.
- The first `searchCities()` call after a reload costs ~1.2 s (cold 170k-row index build) and blocks;
  warm queries are ~27 ms. 4b's search UI should account for that first hit.
