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

## Phase 4b — Places UI (done)

Everything `04-places.md` §2–§6 left for this half: city search with the Photon online fallback,
manual entry, the global place-status sheet, the Places tab's grouped list, the country detail
screen (replacing the Phase 3 `CountrySheet` stopgap), and quick/bulk add. One scope question was
asked and confirmed before writing UI code (see Deviation 1); everything else below is a documented
default, stated up front rather than asked, per the session's own steer.

### What was built

- **The status sheet** [`PlaceStatusSheet.tsx`](atlas/src/components/places/PlaceStatusSheet.tsx) —
  one global instance mounted in [`App.tsx`](atlas/src/App.tsx), opened from anywhere via
  [`placeSheetStore.ts`](atlas/src/domain/placeSheetStore.ts) (Zustand, `openPlace: PlaceRef | null`).
  Four status buttons commit immediately (no separate save step — picking a status *is* the action);
  an optional date field sits above them and is only sent to the cascade if the user actually touches
  it (`SetStatusRequest`'s "omitted means leave it" contract, honoured exactly); a "Remove from
  places" action appears once a row exists. Shows *why* a status is what it is via the new
  `explainStatus` (below) — "Currently Lived — because Berlin is lived" — not just for countries, for
  any place with descendants.
- **`cascade.ts` gained `explainStatus`** (plus `StatusCause`) — the one addition to the domain layer
  this session. Walks down through purely-derived intermediates to the *nearest place whose own
  explicit choice* accounts for a status, so a country showing lived because of a city three levels
  of "no entry yet" away names the city, not the also-derived subdivision in between. Six new tests
  in [`cascade.test.ts`](atlas/src/domain/cascade.test.ts) (40/40 total, up from 34).
  [`placeInfo.ts`](atlas/src/domain/placeInfo.ts) is the Dexie-facing half: `resolvePlaceInfo` turns a
  bare `PlaceRef` into a name/flag/breadcrumb for display.
- **City search** [`PlaceSearch.tsx`](atlas/src/components/places/PlaceSearch.tsx) — local
  `searchCities()` results on every keystroke; once thin (<3) and online, a 500 ms-debounced
  [`photon.ts`](atlas/src/geo/photon.ts) query joins under a divider, never blocking the local list.
  Picking a local result opens the status sheet directly; picking an online one first resolves it
  through [`cityWrites.ts`](atlas/src/geo/cityWrites.ts) (`source: 'online'`) so it's durable before
  the sheet opens. Online results already visible locally are filtered out of the online list.
  [`ManualPlaceForm.tsx`](atlas/src/components/places/ManualPlaceForm.tsx) is the "add a place
  manually" fallback — name, a searchable country picker, an optional subdivision `<select>` scoped to
  that country, optional lat/lon — writing with `source: 'manual'`.
- **`geo/cityWrites.ts`** — `addOnlineCity`/`addManualCity`, the only two writers to the `cities`
  table outside `loader.ts`'s bulk reference seed. Both allocate a **negative** synthetic
  `geonameId` (real GeoNames ids are always positive, so the two ranges can never collide — see
  Deviation 6) inside a transaction, then invalidate the search index.
- **Places tab** — [`placesList.ts`](atlas/src/domain/placesList.ts) is the pure grouping engine
  (continent → country → subdivision → city, filter, sort — no Dexie, no React, same contract as
  `coverage.ts`), with 13 tests on a hand-checked fixture in
  [`placesList.test.ts`](atlas/src/domain/placesList.test.ts).
  [`PlacesList.tsx`](atlas/src/components/places/PlacesList.tsx) renders it: continents as native
  `<details open>`, countries with their own expand/collapse chevron *and* an independent tap target
  that opens the country detail screen, subdivisions and cities always one tap from the status sheet.
  [`PlacesScreen.tsx`](atlas/src/screens/PlacesScreen.tsx) wires search, the All/Visited/Lived/
  Wishlist/Transit filter row, the sort `<select>`, and quick add together; the empty state is the
  real search field plus one hint line, not the shared `EmptyState` placeholder — the same call
  Phase 3 made for the map, for the same reason.
- **Country detail** [`CountryDetail.tsx`](atlas/src/components/places/CountryDetail.tsx) — a
  full-screen overlay (Deviation 1), opened via
  [`countryDetailStore.ts`](atlas/src/domain/countryDetailStore.ts) from either the map or the
  Places list. Flag/code/name, an effective-status row (tappable → the status sheet, with the
  `explainStatus` wording when derived), a new lightweight
  [`CountryAdmin1Map.tsx`](atlas/src/components/places/CountryAdmin1Map.tsx) (fit-to-container, no
  pan/zoom, tap a region → the status sheet for that subdivision), a stats grid (regions visited,
  area, population, capital), a tappable cities list with dates, and an empty photos slot for Phase 6.
  Replaces `CountrySheet` entirely — [`MapScreen.tsx`](atlas/src/screens/MapScreen.tsx)'s
  `onSelectCountry` now opens this store instead of a local sheet, while keeping its own `selectedCode`
  purely for WorldMap's existing "admin-1 overlay once zoomed in" affordance, which is a separate
  concern from whether the detail screen happens to be open.
- **Quick add** [`BulkAddScreen.tsx`](atlas/src/components/places/BulkAddScreen.tsx) — paste, one
  status for the whole batch (Deviation 9), a review step built on
  [`bulkResolve.ts`](atlas/src/domain/bulkResolve.ts)'s pure `classifyLine` (matched / ambiguous /
  notFound, 11 tests in [`bulkResolve.test.ts`](atlas/src/domain/bulkResolve.test.ts)), an
  include/skip toggle and a candidate picker per line, committed sequentially through
  `setPlaceStatus` with per-line error collection rather than an all-or-nothing abort.
- **A shared full-screen overlay shell**
  [`FullScreenOverlay.tsx`](atlas/src/components/layout/FullScreenOverlay.tsx)/`.css` — header,
  close button, Escape-to-close, scrollable body — used by `ManualPlaceForm`, `CountryDetail` and
  `BulkAddScreen` so the three don't each reinvent the same chrome. Two new z-index layers,
  documented inline: **30** for these full-screen overlays, **40** for the place-status sheet (which
  can stack on top of any of them — confirmed in-browser: opening a subdivision from inside
  `CountryDetail` layers the sheet correctly and closing it returns to the still-open detail screen).
- **`CountryFlag.tsx`** + [`geo/flags.ts`](atlas/src/geo/flags.ts) — ISO code → regional-indicator
  emoji, always paired with the mono code (Deviation 8) so nothing is lost where the emoji font
  doesn't render flags.
- Deleted `DebugScreen`/`.css`, its `/debug` route and its link on the You screen (Phase 4a's own
  "delete this in 4b" note), and the Phase 3 `CountrySheet`/`.css`.

### Deviations from the plan/brief, and why

1. **Country detail is a full-screen overlay, not a routed screen (asked, confirmed).** Task 5 calls
   it a "screen," which could mean either in an app where the 4 tabs are also "screens." Overlay won:
   same pattern as the (now-replaced) `CountrySheet`, no change to `HashRouter`'s route table, and no
   need to design how the browser/Android back button should interact with a sheet stacked on top.
   The status sheet was never in question — task 3's own language ("reached by tapping any place
   anywhere in the app") only makes sense as a global overlay.
2. **`explainStatus` lives in `cascade.ts`, not a new domain module.** It's cascade-status reasoning
   (reads `explicit`/`explicitStatus`/`status`, walks the same `children` graph `effectiveStatus`
   already builds) — extending the module that owns those concepts beat re-deriving a shallower,
   less-correct version in the UI layer. An early draft that just compared flat lists of a country's
   subdivisions/cities would have named "Berlin state" instead of "Berlin" whenever the responsible
   place was two levels down; the real version recurses through purely-derived intermediates
   specifically to avoid that.
3. **`CitySource` widened to `'bundled' | 'online' | 'manual'`, `City.lat`/`lon` widened to
   `number | null`.** The first was flagged as 4b's job by 4a. The second follows from it: a manually
   entered place with no known coordinates needs *no value*, not a fabricated `0,0` (Gulf of Guinea).
   Neither needed a Dexie version bump (neither field is indexed) — same precedent as
   `explicitStatus` in 4a.
4. **The reference-data reseed hazard 4a flagged is fixed.** `ensureReferenceData` in
   [`loader.ts`](atlas/src/geo/loader.ts) now reads out every non-`'bundled'` city before
   `db.cities.clear()`, re-validates each one's `subdivisionId` against the *fresh* subdivisions (in
   case an admin1 code was renamed upstream, nulling it out rather than leaving a dangling
   reference), and re-inserts them after the bundled rows land. **Verified under a real full reseed,
   not just reasoned about**: forced `geoDataVersion` back to 0 with two non-bundled cities on
   record, re-ran `ensureReferenceData()` end to end (170,486 bundled rows reloaded from the network
   in 10k chunks — well over a minute, same order of magnitude as Phase 2's documented ~50 s
   first-run seed plus the extra preserve/restore step), and confirmed both survived byte-for-byte
   and `loadCascadeState()` — which throws `UnknownCityError` on any dangling city reference — still
   resolved cleanly afterward.
5. **A country's "regions visited" stat, and the country/subdivision status bars, always show the
   *true* stored status — filtering never fakes one.** Directly follows from how `placesList.ts`
   decides what's visible (Deviation 7), not a separate choice.
6. **Online and manual cities get a synthetic *negative* `geonameId`**, allocated downward from -1.
   Real GeoNames ids are always positive, so the two ranges can never collide — which is what makes
   Deviation 4's reseed-preservation safe without any per-row existence check. Not in the plan; filled
   an obvious gap (Photon has no GeoNames id, a manual place has no id at all).
7. **`placesList.ts`'s filter semantics, spelled out since the brief doesn't**: a row shows if its
   own status matches the active filter, *or* it's a country/subdivision header structurally needed
   to contain a descendant that matches — but every visible row still shows its own real status, and
   a group's count is the number of *matching* rows inside it. Filtering to "Wishlist" under a
   `lived`-status Germany still shows Germany's header (green "lived" bar and all) because a wishlist
   city sits inside it, with the count reading how many wishlist places that is.
8. **Country identity is always the mono ISO code, with the flag emoji as a bonus, never emoji-only.**
   Regional-indicator flag emoji don't render as flags on every platform (notably some Linux/Chromium
   builds without a colour-emoji font show two-letter boxes instead) — the mono code is the
   guaranteed-correct fallback and also fits the project's established cartographic-mono aesthetic.
9. **Quick add applies one status to the whole pasted batch**, chosen once before matching, rather
   than a per-line syntax. Task 6 doesn't mention per-line status at all; backfilling history is
   normally done a status at a time in practice ("everywhere on this trip" = one paste, one status),
   and a line-parsing micro-syntax the brief never asked for would be scope creep.
10. **Quick add resolves against the local index only — no Photon fallback.** Task 6 says "the search
    index" (definite article, singular), matching the one already defined for task 2. A line that
    misses locally is shown as "no match found" for the user to add afterward through the normal
    search, which does have online fallback.
11. **Photon's `layer` filter uses the actual valid enum (`city`, `locality`, …), and is backstopped
    by a client-side `osm_key === 'place'` check.** Found empirically, not anticipated: Photon's
    `layer` param rejects values like `town`/`village`/`hamlet` outright (its real enum is `house,
    street, locality, district, city, county, state, country, other`) — village/hamlet results are
    bucketed under `city`/`locality` regardless. Even with the corrected `layer=city&layer=locality`,
    a search for "Tokyo" surfaced a convention centre and a department store as `landuse` polygons
    named after the place they sit in; filtering to `osm_key === 'place'` (OSM's own tag for an
    actual settlement) removes that class of noise without excluding genuine hamlets (re-verified
    against the "Vik"/"Garmisch"/"Adligenswil" cases below).
12. **Photon subdivision resolution is point-in-polygon against the bundled admin-1 topology, not
    name-matching.** Found empirically: Photon returns the *localized* region name ("Bayern"), while
    `subdivisions.json` (built from GeoNames) has the English one ("Bavaria") — checked directly
    against Germany's real subdivision rows. Text-matching would miss constantly; geometry doesn't
    care what language the name is in. Implemented with `d3-geo`'s `geoContains` against whatever
    `loadCountryTopology` already has cached for the map, so no new data is fetched.
13. **§6's "send a descriptive User-Agent" is not implemented — it isn't implementable.** Browser
    `fetch()` is on the platform's forbidden-header list; no client-side workaround exists (this is
    deliberate: it's a phishing/impersonation guard, not an oversight). The request goes out as a
    plain CORS GET with the browser's own real UA. Flagged to the user before writing any Photon code
    rather than silently dropping the requirement.

### Edge cases found this session (the brief asks to note these)

1. **A logged place whose continent is GeoNames' "Seven seas (open ocean)" pseudo-bucket was
   invisible in the Places tab — a real bug, caught by manual testing, not the unit tests.**
   `coverage.ts`'s `CONTINENTS` deliberately excludes that bucket (it's not one of the seven you can
   "touch"), and `placesList.ts` was iterating that same curated list to assemble its output —
   so a country GeoNames buckets there (found live: South Georgia, added as a manual place) had a
   perfectly good active entry that never appeared anywhere in the list, though it still coloured
   correctly on the map (which doesn't group by continent). Fixed by appending any continent with
   real content that isn't one of the seven, sorted, after them — never dropping it. New test in
   `placesList.test.ts` pins this down. Worth remembering: `coverage.ts`'s `CONTINENTS` is a
   *counting* concern (touched-out-of-7), not an exhaustive list of valid continent values — any
   future code that iterates it as if it were the latter will have this same bug.
2. **Point-in-polygon subdivision resolution can miss for a village sitting right on a simplified
   coastline** — confirmed live with Vík í Mýrdal (Iceland): its real coordinates fall just outside
   the mapshaper-simplified Suðurland polygon (an inland point at the same longitude resolves fine;
   the issue is specifically the coastline generalisation, verified by testing points at increasing
   latitude toward the coast). Not a bug — this is exactly the "coastline rounding" case
   `resolveSubdivisionByPoint`'s own doc comment already anticipates, and the fallback (city still
   added, linked to the country only) works as designed. Recorded here as a confirmed real instance,
   not a hypothetical.
3. **An online-added city with `population: 0` can rank far down a crowded query.** Photon doesn't
   report population, so an added city always scores at the bottom among same-substring matches in
   `searchCities`'s population-weighted ranking. Harmless for the realistic case (a search term
   distinctive enough that little else matches — nothing else does, and the acceptance test's own
   `search → add → find again` loop confirms it), but a bare, very common fragment (tested with "vik"
   after adding "Vik, Iceland" — 118 total matches worldwide) can push a freshly-added place past the
   default 20-result window even though it's genuinely present (confirmed at rank 111 by widening the
   query limit). Not fixed — inventing a population estimate or special-casing online-city relevance
   is a real design question of its own, not a 4b-scope bug fix.
4. **Restoring a soft-deleted place via `setPlaceStatus` after re-adding it keeps working exactly as
   4a designed** (`repo.restore`) — re-exercised end to end this session (add → remove → re-add the
   same city through search) with no new findings; noted only because it's easy to assume UI-level
   flows might hit a path the harness never did.

### Left undone (correctly, per scope)

No trips, no photos — `CountryDetail`'s photos section is a placeholder label only, and nothing
references a trip anywhere (the status sheet has no "which trip" row, since Phase 5 doesn't exist
yet). `TripsScreen` and `SettingsScreen` are untouched. Nothing here attempts a Lighthouse/perf trace,
consistent with prior phases — no such tool was available in this environment either.

### Verified

- `npx tsc -b`, `npm run lint`, `npx vitest run` (**80/80** — 16 coverage + 40 cascade + 13 placesList
  + 11 bulkResolve) and `npm run build` (under Node 20 — see Phase 1's note, this sandbox's
  non-interactive shells still default to apt Node 18) all clean.
- Browser (Vite dev, 390×844 and 360×800, dark), against the real seeded dataset:
  - **Every acceptance criterion in `04-places.md`, exercised through the real UI (not the deleted
    harness) against the full 170,486-city dataset**:
    - "Garmisch-Partenkirchen" → search → set to **Visited** creates derived **Bavaria** and
      **Germany**, both also visited, confirmed by reading the live entry rows back out of Dexie by
      name.
    - "San Francisco" (top-ranked hit) set to **Lived** → creates **California**/**United States**
      as lived; then "Chicago" set to **Visited** → **United States stays Lived**, California stays
      Lived, Illinois shows Visited — the exact rule the user asked for in Phase 4a, now proven
      through the real search-and-sheet UI rather than the debug harness.
    - "Tórshavn" → creates the **Faroe Islands** (flag 🇫🇴, code FO) as its own country — never a `DK`
      row — with subdivision Streymoy.
    - Removing Tórshavn (its only city) via the status sheet's "Remove" action soft-deletes **all
      three** rows (city, Streymoy, Faroe Islands) — confirmed `deletedAt` set on each, zero active
      rows remain for `FO`, nothing hard-deleted.
    - "Vík í Mýrdal" found **zero** local results and **one** online result (Photon); added it,
      confirmed the stored row has `source: 'online'`; reloaded with `window.fetch` monkey-patched to
      always reject (simulating offline) and confirmed the place is still in the Places list and
      still locally searchable (see Edge case 3 for the one caveat on generic-query ranking).
    - Map recolours with **no reload** confirmed repeatedly: Japan/Tokyo turned visited-green
      immediately after the sheet closed; the world map showed all ten-plus logged countries
      correctly coloured (US amber/lived, Greenland/Iceland/Argentina/etc. green/visited) without
      any navigation.
    - Quick add: 10 lines pasted (`Reykjavik, Nuuk, Ushuaia, Springfield, Zurich, Marrakesh, Suva,
      Wellington, Bogota, Nowhereaskdjaskldj`) → 8 auto-matched cleanly (including correctly
      accent-restoring "Zurich"→"Zürich", "Bogota"→"Bogotá"), **two** ambiguous (Springfield *and*
      Suva, exceeding the "one ambiguous name" requirement), one correctly reported as no match.
      Picked a **non-default** candidate for Springfield (Illinois over the top-ranked Missouri) to
      prove the override path works, unchecked "Include" on Bogota to prove skip works, committed →
      "Added 8 places", and confirmed Illinois (not Missouri) is the subdivision actually recorded.
  - **Manual add**: "Grytviken" / South Georgia and the South Sandwich Islands, coordinates left
    blank → row created with `source: 'manual'`, `lat: null`, `lon: null`, negative synthetic id;
    opened the status sheet automatically on success.
  - **Country detail**: opened from a map tap (Japan) and from a Places-list row tap (Morocco) —
    both routes work. Admin-1 mini-map rendered all 47 Japanese prefectures once a genuine
    `ResizeObserver` delivery occurred (see notes below); tapping a region opened the status sheet
    for that subdivision, stacked correctly over the still-open detail screen, and closing the sheet
    left the detail screen exactly as it was. Stats (regions visited, area, population, capital) read
    correct real values in both cases.
  - No horizontal overflow at 360px for the search results list, the status sheet (including its
    four ~70–90px-tall option buttons), or the country detail screen — checked by comparing
    `scrollWidth`/`clientWidth` directly, not just eyeballing a screenshot.
  - App left in a clean state afterward: `entries` cleared, `syncState.revision` reset to 0,
    `settings` untouched (all still at their defaults — nothing in this session's testing needed to
    change `statMode`/`countryDenominator`). The extra non-bundled `cities` rows (Vik, Grytviken) were
    left in place deliberately — they're the same kind of residue a real user's online/manual adds
    would leave, not test pollution to scrub.

### Notes for the next session

- **`cascadeRepo.ts` remains the only sanctioned writer to `entries`; `geo/cityWrites.ts` is now the
  only sanctioned writer to `cities` outside `loader.ts`'s bulk reference seed.** Going around either
  risks exactly the class of silent, non-crashing bug this phase's own verification caught once
  already (Edge case 1 above).
- **Two z-index layers are now established and documented inline**: `30` for full-screen overlays
  (`FullScreenOverlay`, so `CountryDetail`/`BulkAddScreen`/`ManualPlaceForm` all share it), `40` for
  the place-status sheet, deliberately above everything else since it can stack on top of a
  full-screen overlay. Phase 5's trip screens and Phase 6's photo viewer should probably slot into
  this same scheme rather than inventing new numbers.
- **The status sheet's date field is a single date, not a range** — it writes the same value to both
  `firstVisited` and `lastVisited`. This was a deliberate 4b simplification (the brief says "optional
  date," singular); Phase 5's trips, which naturally have a start/end date, are the more likely home
  for real date-range capture. Worth deciding explicitly when Phase 5 starts whether trips backfill
  `firstVisited`/`lastVisited` on their member entries, or leave that alone.
- **Preview-tool artifacts, same family as Phase 3/3b/4a's, seen again — none of them app bugs, all
  confirmed by cross-checking `preview_eval`/`preview_snapshot` ground truth against the flaky tool**:
  (a) `preview_screenshot` timed out repeatedly, including well after the page had genuinely finished
  rendering (confirmed via direct DOM queries in the same moment) — always recovered on a retry. (b)
  A `ResizeObserver`-dependent component that mounts *without* a full page navigation (i.e. any
  overlay opened by a click, not just `WorldMap` after a hash-navigation) does not reliably receive
  its first callback in this automation environment — confirmed directly this session for the new
  `CountryAdmin1Map`: `getBoundingClientRect()` reported a correct non-zero size while the component's
  own `size` state stayed at its zero default, and a genuine `preview_resize` viewport change (not a
  synthetic DOM event) was what finally triggered the real callback. Real phone usage won't hit this
  — the tab is always focused when a user is tapping into it. (c) Long-running Dexie work (the
  multi-minute forced reseed above) keeps running in the browser tab even after a `preview_eval`
  call waiting on it times out at 30 s — poll with a fresh short `preview_eval` afterward rather
  than assuming the operation was interrupted.
- `resolveSubdivisionByPoint` (in `photon.ts`) piggybacks on whatever `loadCountryTopology` already
  has cached for the map — the first online-add for a given country will pay that fetch cost
  up front rather than it being pre-warmed.

## Phase 5 — Trips (done)

Trip lifecycle, auto-capture while a trip is active, the persistent banner, the Trips tab (Active +
Past-as-stamps), the full trip detail screen with a route map, and trip statistics on the You tab.
Two scope questions were asked and answered before writing code (see Deviations 1–2); everything
else below is a documented default, decided and noted rather than asked, following the session's own
steer and the precedent set by earlier phases.

### What was built

- **Trip lifecycle** [`domain/tripRepo.ts`](atlas/src/domain/tripRepo.ts) — `getActiveTrip`,
  `createTrip` (endDate present at creation = a retroactive, already-closed trip; endDate absent =
  starting now, `isActive: true`), `closeTrip`/`reopenTrip` (reopen clears `endDate`, "resumes
  capture"), `softDeleteTrip` (trip only, never its places), `attachEntryToTrip`/
  `detachEntryFromTrip` (idempotent, revives a soft-deleted membership row rather than duplicating
  it), `tripIdsForEntry`, `entryIdsForTrip`. `resolveConflict` is the one shared "only one trip
  active" resolution (`close` stamps today's date if none is set; `leaveOpen` just clears
  `isActive`), used identically by `createTrip` and `reopenTrip`.
- **Auto-attach, wired into the existing single writer** — [`cascadeRepo.ts`](atlas/src/domain/cascadeRepo.ts)'s
  `setPlaceStatus` now also looks up the entry it just wrote (by `[kind+refId]`, the *target* only,
  never the ancestors the cascade creates alongside it) and calls
  `tripRepo.autoAttachToActiveTrip`, inside the same transaction (widened to include `db.trips`/
  `db.tripEntries`). One rule handles "attach at the city level" and "plus any country added
  directly" (05-trips.md task 1) at once: whatever kind of place the user *directly* set attaches;
  whatever it implies upward does not. Re-touching an already-attached place (a second visit) is a
  harmless no-op, which is exactly "existing entries touched...are also attached."
- **Trip statistics, pure** — [`domain/tripStats.ts`](atlas/src/domain/tripStats.ts):
  `tripDurationDays` (inclusive day count, `endDate ?? today` — the one function the active-trip
  banner's day count and every duration stat share), `computeTripStats` (total/longest/most
  countries/average, active trip included per Deviation 2), `newCountriesByTrip` ("countries first
  visited on each trip" — earliest trip by `startDate`, ties broken by `createdAt`, disqualified by
  an earlier non-trip `firstVisited` record). 10 tests in
  [`tripStats.test.ts`](atlas/src/domain/tripStats.test.ts).
- **Trip place grouping, pure** — [`domain/tripPlaces.ts`](atlas/src/domain/tripPlaces.ts):
  `groupTripPlaces` (country → subdivision → city from a trip's attached entries alone, mirroring
  `placesList.ts`'s bucket shape but with trip-membership as the only criterion — no filter/sort),
  `tripCountryCodes`, `tripCityRows`. 9 tests in
  [`tripPlaces.test.ts`](atlas/src/domain/tripPlaces.test.ts).
  [`domain/tripPlacesRepo.ts`](atlas/src/domain/tripPlacesRepo.ts) is the Dexie-facing glue —
  `loadTripPlaces`/`loadTripCountryCodes`/`loadTripCountryCodesBatch` (reference tables fetched once,
  shared across trips) and `loadCountryFirstVisited` (earliest `firstVisited` per country across
  *all* active entries, trip-attached or not) — shared by the Trips tab's stamps, trip detail, and
  the You-tab statistics so the joins aren't re-derived a third and fourth time.
- **The stamp** [`components/trips/TripStamp.tsx`](atlas/src/components/trips/TripStamp.tsx)/`.css` —
  rounded rect, double hairline border in `--haze`, name in Archivo Expanded (uppercase + wide
  letter-spacing for the "small caps feel"), IBM Plex Mono date range, a country-code grid
  (`repeat(auto-fill, minmax(44px,1fr))`, legible at 1 code and at 15), rotation seeded from the trip
  id via [`domain/stampSeed.ts`](atlas/src/domain/stampSeed.ts) (`stampRotationDeg`, −2..+2°;
  `stampInkSeed` for the texture — 4 tests in
  [`stampSeed.test.ts`](atlas/src/domain/stampSeed.test.ts)), entrance animation dropped under
  `prefers-reduced-motion` (rotation itself is a static `transform`, unaffected), cover-photo slot
  wired (`coverPhotoUrl` prop, desaturated/dimmed background) but always `null` — Phase 6. The "edge
  texture suggesting uneven ink" is an SVG `feTurbulence`/`feDisplacementMap` filter applied only to
  two thin absolutely-positioned border layers, never to the text content, so nothing legible blurs.
- **Trip form + conflict dialog** — [`TripForm.tsx`](atlas/src/components/trips/TripForm.tsx)/`.css`
  (one component, three variants via `showEndDate`/`requireEndDate`: "start now" has no end-date
  field at all; "log a past trip" requires one; "edit" makes it optional and never touches
  `isActive`) and [`TripConflictDialog.tsx`](atlas/src/components/trips/TripConflictDialog.tsx)/`.css`
  (close-old vs. leave-old-open vs. cancel), resolved *before* the form ever opens (Deviation 3) so
  the form itself never pauses mid-submit for a second dialog.
- **Trips tab** [`screens/TripsScreen.tsx`](atlas/src/screens/TripsScreen.tsx)/`.css` — Active section
  (a card if one is running, else a hint + "Start a trip"/"Log a past trip" entry points) then Past
  stamps in reverse chronological order, overlapping via negative `margin-top` (paint order alone
  gives the "stacked passport page" look — no z-index bookkeeping needed).
- **Active-trip banner** [`ActiveTripBanner.tsx`](atlas/src/components/trips/ActiveTripBanner.tsx)/`.css` —
  one mono line in `--visited`, pinned between `.app-content` and `BottomNav` in `App.tsx` (so it
  survives every route), name/day-count/place-count (via `tripDurationDays` and a live
  `tripEntries` count), tap opens the trip detail overlay directly, dismiss ✕.
  [`domain/activeTripBannerStore.ts`](atlas/src/domain/activeTripBannerStore.ts) tracks dismissal by
  *trip id* (not a bare boolean) in a plain in-memory Zustand store — nothing persisted, so a reload
  or app restart shows it again for free, and starting a different trip mid-session does too.
- **Trip detail** [`components/trips/TripDetail.tsx`](atlas/src/components/trips/TripDetail.tsx)/`.css`
  — full-screen overlay (Deviation 4), opened via
  [`domain/tripDetailStore.ts`](atlas/src/domain/tripDetailStore.ts) from the banner, the active card,
  or a stamp: the route map, duration/countries/new-to-you stats, close-or-reopen + edit actions,
  countries → subdivisions → cities (tapping any row opens the same global place-status sheet
  everywhere else uses), a notes textarea (saves on blur, no separate save step — same "tapping is
  the action" philosophy as the status sheet), the empty cover-photo section, and delete with a
  confirmation dialog that says outright it won't touch the places.
- **Route map** [`components/trips/TripRouteMap.tsx`](atlas/src/components/trips/TripRouteMap.tsx)/`.css`
  — fit-to-container, no pan/zoom (same precedent as `CountryAdmin1Map`, at world scope): the
  projection is `fitExtent`ed to just the trip's country features (falling back to the whole sphere
  when the trip has none yet), trip countries keep their real status colour, everything else is
  muted `--contour` at low opacity, and cities with known coordinates get a small dot marker.
  Read-only — editing always goes through the status sheet, never a map tap.
- **PlaceStatusSheet gained a Trips section**
  [`PlaceStatusSheet.tsx`](atlas/src/components/places/PlaceStatusSheet.tsx)/`.css` — a toggle button
  per non-deleted trip (shown once the place has an entry), attaching/detaching via
  `tripRepo.attachEntryToTrip`/`detachEntryFromTrip`. This one mechanism is both "move a place between
  trips" (task 1) and how a retroactive trip gets "populated by hand" — no second attach path.
- **You-tab trip statistics** [`screens/SettingsScreen.tsx`](atlas/src/screens/SettingsScreen.tsx)/`.css`
  (new) — total trips, longest trip (+ name), most countries in one trip (+ name), average trip
  length, and a per-trip list of newly-first-visited countries. Everything else on the tab (theme,
  sync, attribution) is left as the original placeholder note — later phases' work, not touched.

### Deviations from the plan/brief, and why

1. **One attach mechanism, not two (asked, confirmed).** Task 1's "add places to it manually" for a
   retroactive trip and "move a place between trips" are both served by the new Trips toggle in the
   place-status sheet — no separate "add a place" search flow on the trip detail screen. Confirmed
   over adding a second attach path; keeps scope tight and there is exactly one place in the codebase
   that writes a `tripEntries` row on the user's explicit say-so.
2. **The active trip counts in every You-tab stat, using today as a stand-in end date (asked,
   confirmed).** Rejected alternative: exclude the running trip from "longest"/"average" until it
   closes. Chosen so an in-progress trip is reflected immediately rather than looking like it doesn't
   exist statistically yet.
3. **The "only one trip active" conflict is resolved *before* `TripForm` opens, not inside its
   submit handler.** An earlier design tried threading the conflict dialog through the form's
   `onSubmit` (pausing mid-submit, waiting on a second dialog, then resuming) — correct but awkward.
   Splitting "Start a trip" into two steps (check for a conflict → resolve it if any → *then* show a
   plain name/date form) is simpler and reads better: the conflict is about the *old* trip, the form
   is about the *new* one, and they don't need to interleave.
4. **Trip detail is a full-screen overlay, not a routed screen** — same call Phase 4b made for
   `CountryDetail`, for the same reasons (no `HashRouter` route-table change, no back-button design
   question for a sheet stacked on top of a tab).
5. **`isActive` conflict resolution's "close the old one" defaults the end date to today**, with no
   date picker in the conflict dialog itself — one tap, consistent with the app's "tapping is the
   action" pattern elsewhere (the status sheet's buttons, `closeTrip`'s own one-tap action). A more
   precise back-dated closure is always available afterward via that trip's own Edit form.
6. **Notes save on blur**, no separate save button — same immediacy precedent as the status sheet.
7. **The stamp's rotation and ink-texture seed both derive from a plain string hash of the trip id**
   ([`stampSeed.ts`](atlas/src/domain/stampSeed.ts)), not a cryptographic one — determinism is the
   only requirement (plan §8: "a given trip always looks the same"), and a fast, pure `Math.imul`
   hash is simplest.

### Edge cases found this session (the brief asks to note these)

1. **`trips`'s `isActive` index (declared back in Phase 1's schema, `'id, isActive, updatedAt'`) is
   silently non-functional for querying.** IndexedDB keys can't be booleans — a boolean-valued
   property is simply never entered into an index built on it, no error, just an index that never
   matches anything through `where('isActive')`. Not a Phase 5 bug (the schema line predates this
   phase), but this phase is the first to actually need "the active trip," so it's the first to hit
   it. Routed around by reading the (always small) `trips` table directly and filtering in memory
   (`getActiveTrip` in `tripRepo.ts`) rather than trusting the index. No migration needed — Dexie
   doesn't validate index feasibility at schema-declare time, and nothing else was relying on that
   index actually working.
2. **A live-query place count takes a beat to reflect a just-committed transaction.** Manually
   tested a status-sheet commit and read the banner's place count in the same instant — it briefly
   still showed the pre-write value before the `useLiveQuery` subscription's next tick updated it.
   Confirmed via a direct Dexie read that the underlying `tripEntries` row was already correct;
   this is async re-render timing, not a bug in the write path.
3. **Two distinct city rows can exist for what looks like the same place** — re-encountered Phase
   4b's bundled-vs-online duality while testing "a city can belong to two trips": searching
   "Reykjavik" once the full 170k-row bundled dataset had finished loading surfaced both the
   Phase-2 bundled row (accented "Reykjavík", with its subdivision) and the earlier Phase-4b
   online-added row (unaccented "Reykjavik", the one that actually had an entry). Picking the wrong
   one opens the status sheet for an unrelated, entry-less row. Not a Phase 5 bug — a pre-existing
   identity question Phase 4b's own notes already flagged (Edge case 3 there), just the first time
   trip-membership testing happened to walk into it.

### Left undone (correctly, per scope)

Photos — the stamp's `coverPhotoUrl` prop and the trip detail screen's "Cover photo" section are
wired but always empty/`null`, exactly as instructed. Nothing on the You tab beyond trip statistics
(headline-stat switch, theme, Google Drive sync, attribution) — later phases' work, left as the
original placeholder note rather than half-built ahead of its own phase.

### Verified

- `npx tsc -b`, `npm run lint`, `npx vitest run` (**103/103** — 16 coverage + 40 cascade +
  13 placesList + 11 bulkResolve (all pre-existing) + 9 tripPlaces + 10 tripStats + 4 stampSeed
  (new this phase)) and `npm run build` all clean.
- Browser (Vite dev, 390×844, dark), **every acceptance criterion in `05-trips.md` exercised through
  the real UI**, against the real seeded dataset:
  - Started "Test Road Trip" → added Reykjavík (online-resolved), Paris, Tokyo through the normal
    search-and-status-sheet flow while it was active → banner counted 1, 2, 3 places in step, each
    confirmed against `tripEntries` rows directly. Closed it → stamp shows exactly those 3 cities'
    derived countries (FR/IS/JP at that point).
  - Set a place's status (Cairo/Egypt) with **no** active trip → committed with zero console errors
    and zero `tripEntries` rows for it.
  - Reopened the closed trip → `isActive` true, `endDate` cleared, banner reappeared; added a 4th
    city (Berlin) → banner went to 4 places, confirming "resumes capture."
  - Starting a second trip while one was active correctly showed the conflict dialog; tested **both**
    resolutions for real (not just reasoned about) — "close" set the old trip's `endDate` to today
    and deactivated it, "leave open" deactivated it with `endDate` still `null`, in both cases the
    new trip became the sole active one.
  - Attached the same Reykjavík entry to a second trip via the status sheet's new Trips toggle →
    confirmed two live `tripEntries` rows, one per trip, same `entryId`.
  - Created "Old Backpacking Trip" with 2019 dates via "Log a past trip" (`isActive: false`
    immediately, no conflict prompt shown) → attached Paris to it by hand via the same Trips toggle →
    it appeared as a proper stamp with FR.
  - Deleted "Test Road Trip" (4 places) → confirmed `deletedAt` set on the trip, **zero** change in
    the active `entries` count (11 before, 11 after), the trip vanished from the Trips tab, and the
    world map still showed all four countries visited/lived exactly as before — "leaves every place
    intact and the map unchanged," not just asserted but diffed.
  - Built a 15-country trip ("Grand Tour") and re-checked the 1-country stamp ("Old Backpacking
    Trip") side by side — both render legibly (the 15-code grid wraps to 3 rows of up to 6, the
    1-code stamp doesn't stretch to fill the row).
  - Dismissed the active-trip banner, then did a real `window.location.reload()` (not just a
    re-render) → banner reappeared showing the same still-active trip, confirming the dismissal is
    session-only.
  - Trip statistics on the You tab hand-checked against the fixture data present at the time (3 live
    trips after the deletion above): total 3, longest 20 days/"Old Backpacking Trip", most countries
    1 tied between two trips, average `(20+1+1)/3 = 7.3` days, and the first-visited list correctly
    omitted the deleted trip's countries entirely.
  - No horizontal overflow observed on the Trips screen, the stamps, the trip detail overlay (route
    map, stats grid, places tree, notes textarea), or the conflict dialog at 390×844.
  - App left in a clean state afterward: `entries`/`trips`/`tripEntries` all cleared, `syncState`
    revision reset to 0. The stray online-added city row from testing (negative-id "Reykjavik") was
    left in place deliberately — same precedent Phase 4b set: it's ordinary residue a real user's
    online add would leave, not test pollution to scrub.

### Notes for the next session

- **`cascadeRepo.setPlaceStatus` is now also the trip-capture point** — it calls
  `tripRepo.autoAttachToActiveTrip` internally, so anything that writes an entry outside it (there
  shouldn't be anything) would silently skip trip capture too, the same class of risk Phase 4a/4b
  already flagged for the cascade itself.
- **`domain/tripPlacesRepo.ts` is the shared resolver for "this trip's places," reused three ways**
  (Trips-tab stamps, trip detail, You-tab statistics). Extend it rather than re-deriving the
  entries→cities→groups join a fourth time.
- **Don't add a `where('isActive')` Dexie query expecting it to work** — see Edge case 1. Read
  `trips` directly and filter in memory; the table is small enough that this is not a performance
  concern.
- Phase 6's photo work has two exact slots ready: `TripStamp`'s `coverPhotoUrl` prop and
  `TripDetail`'s empty "Cover photo" section — both already styled for it, just need a real URL.

## Phase 5b — Stamp polish (done)

A design-only pass over `TripStamp`, same self-directed critique-and-polish shape as 3b (no numbered
phase file — the session brief named the job directly: "5b — Stamp polish"). Scoped to the stamp
component alone; nothing else in Trips was touched.

### What was built

- **The border is now actually "partially inked."** Plan §8 says the edge should suggest "partially
  inked edges, as if hand-stamped," but the Phase 5 border was a continuous 1px solid line pushed
  through the existing `feTurbulence`/`feDisplacementMap` filter — wobbly, but 100% coverage, i.e.
  uniformly inked. [`TripStamp.css`](atlas/src/components/trips/TripStamp.css) changes both rings
  from `border-style: solid` to `dashed` (outer 1.5px/opacity 0.85, inner 1px/opacity 0.5) before the
  same displacement filter runs — the filter now shifts each dash independently (it samples the noise
  map at that dash's own position), so gaps land at irregular points around the rect instead of a
  perfectly even dash-dash-dash rhythm. Same filter, same seed, no `.tsx` change needed.
- **Country-code grid destyled from "chip" to "manifest row."** The old `.trip-stamp__code` was a
  full bordered box in `--contour` — the token `tokens.css` documents as "borders, unvisited
  landmass," i.e. the map's *nothing-here* colour, an odd connotation to borrow for a completed trip's
  own country list, and its crisp rectangular edges sat oddly against the wobbly hand-stamped border
  framing it. Now a bottom-hairline only, in `color-mix(in srgb, var(--haze) 45%, transparent)` —
  `--haze` is the stamp's own border colour, so the grid now reads as part of the same ink rather than
  a UI control. (`color-mix` was already an established pattern — `TripConflictDialog`, `GeoGate`,
  `PlaceStatusSheet`, `TripDetail` all use it for translucent overlays.)
- **Hover/active feedback added.** `.trip-stamp` is a `<button>`, and every other tappable
  row/card/dialog-option in the app (`PlacesList`, `CountryAdmin1Map`, `TripConflictDialog`,
  `PlaceSearch`, …) gets a `:hover` state — the stamp had none. Added a restrained
  `filter: brightness()` lift/dip on hover/active (not a translate or scale, which would fight the
  fixed per-trip rotation) with a `var(--duration-fast)` transition, automatically silenced under
  `prefers-reduced-motion` by the existing global rule in `base.css` — no new media query needed.
- **A faint background texture**, since plan §8 explicitly calls the stamp "the one place the design
  is allowed to be showy" and the card was otherwise flat `--shelf`, identical to every ordinary
  sheet/card in the app. One soft `radial-gradient` vignette (`color-mix(..., var(--haze) 10%, ...)`,
  upper-right, `::before`, `pointer-events: none`) — paints below the cover-photo layer and the
  content (pseudo-elements generate before an element's real children, so DOM/paint order already put
  it at the back without a `z-index`). Deliberately restrained, not a pattern/watermark, matching the
  plan's "everything else stays quiet" counterweight even where showy is allowed.

### Deviations from the plan/brief, and why

1. **No phase file for "5b"**, same situation 3b was in — the session brief named the scope directly
   rather than pointing at a numbered file in `travelingSalesmanClaudeInputs/`. Read as: polish the
   stamp component visually, verified at 390×844 and 360×800, nothing else in Trips in scope.
2. **Corner "registration marks" considered, not built.** Real print/registration tick marks would
   tie the stamp into the "instrument/chart texture" language 3b established elsewhere (hairlines,
   mono data treatment) — but it's an invented embellishment with no anchor in plan §8's actual
   wording, unlike the four changes above (each ties to a specific spec line or a specific
   cross-component inconsistency). Left out to keep this pass to defensible fixes rather than
   decoration for its own sake; worth a look if a future session wants to push further.
3. **A pre-existing labelling wrinkle, noted but not touched**: `TripsScreen`'s Past section is
   `!isActive`, not `endDate !== null` — a trip left open via the "leave old one open" conflict
   resolution (`isActive: false`, `endDate: null`) lands in Past with its stamp reading
   `"… – ONGOING"`. Existing Phase 5 lifecycle behaviour, not a stamp-*visual* defect, so left alone;
   flagging here in case a future session wants `TripsScreen`'s split or the date-range fallback text
   to account for it.

### Addendum — flags in the code grid + a mini route map per stamp (same session, user-directed)

Two follow-up requests after the polish pass above, both scoped to the stamp: put the flag next to
each ISO code, and put a small version of the trip-detail route map on every stamp too ("the map it
shows of which countries you went to on that trip").

- **Flags**: each `.trip-stamp__code` cell now renders the existing
  [`CountryFlag`](atlas/src/components/places/CountryFlag.tsx) component (flag emoji + mono code,
  already the app's one pairing for this — Phase 4b's deviation 8 is exactly why the code is never
  emoji-only) instead of a bare code string. `CountryFlag`'s own default text colour (`--haze`) is
  overridden to `--chalk` only inside the stamp (`.trip-stamp__code .country-flag`), for contrast
  against the dark card — every other call site keeps `CountryFlag`'s own default.
- **Mini route map**: [`TripRouteMap`](atlas/src/components/trips/TripRouteMap.tsx) (built in Phase 5
  for the trip detail screen) gained a `compact` prop — same component, same data shape, just a fixed
  92px height instead of the detail screen's 4:3 block and smaller city dots (`r=2.5` vs `4`) — rather
  than building a second map component. `TripStamp` renders it between the date range and the code
  grid, wired with real data end to end:
  - [`TripsScreen.tsx`](atlas/src/screens/TripsScreen.tsx) now computes `countryStatus` once for the
    whole screen (`buildStatusIndex` over one live query of all entries — the exact pattern
    `MapScreen.tsx` already uses) instead of each stamp resolving its own, and `TripPastStamp` switched
    from the codes-only `loadTripCountryCodes` to the richer `loadTripPlaces`, which already contained
    everything needed for both the code grid *and* the city dots (`tripCountryCodes`/`tripCityRows` on
    the same `groups` result) — one query per stamp instead of what would otherwise have been two.
  - **Performance call**: rendering N stamps means N `TripRouteMap` instances, each of which would
    otherwise re-decode the same 237-feature world TopoJSON from scratch
    ([`topo.ts`](atlas/src/components/map/topo.ts)'s `decodeLayer` was a plain pure function, no
    caching). Added a `WeakMap<TopoJson, Map<string, MapFeature[]>>` cache keyed by the topo object
    reference (safe because `loadWorldTopology()`/`loadCountryTopology()` already memoise their fetch,
    so the same parsed object recurs across every caller) plus `objectKey:idProp`. Pure/deterministic
    function, read-only at every call site (`WorldMap`, `CountryAdmin1Map`, `TripRouteMap`, `photon.ts`
    all checked) — a behaviour-preserving cache, not a semantic change, and it benefits the existing
    map screens too, not just the new thumbnails.
  - A trip with zero attached places (a freshly logged past trip, or the pre-existing
    `TripsScreen`/`TripDetail` empty-groups case) falls back to `TripRouteMap`'s existing
    whole-sphere-muted rendering — verified live, no crash, no empty-grid layout break.

**Verified** (browser, both 390×844 and 360×800, real data via the sanctioned writers): 1-country,
6-country, 15-country, and a city-level 3-country trip (to exercise the city-dot markers, which
country-level test entries don't produce) all render correctly — flags paired with every code, mini
maps zoomed to fit each trip's own countries with the rest of the world muted behind them, city dots
visible at compact scale. Empty-trip fallback confirmed live. No console errors. `tsc -b`/lint/vitest
(103/103) all still clean after both changes. App left clean afterward (same reset as above).

### Left undone (correctly, per scope)

Everything about trip *lifecycle* (Phase 5's own domain: conflict resolution, auto-attach, statistics)
is untouched, as is every other Trips screen (`TripForm`, `TripConflictDialog`, the active-trip banner,
the You-tab statistics). `TripDetail`'s own full-size route map, stats and places tree are unchanged —
only `TripRouteMap` itself gained the new opt-in `compact` prop, the existing (non-compact) call site
keeps its original rendering exactly. Final file list for the whole session: `TripStamp.tsx`/`.css`,
`TripsScreen.tsx`, `TripRouteMap.tsx`/`.css`, `topo.ts`.

### Verified

- `npx tsc -b`, `npm run lint`, `npx vitest run` (**103/103**, unchanged — this was a CSS-only pass,
  no domain/test code touched) all clean.
- Browser (Vite dev, dark colour scheme), **both 390×844 and 360×800**, against real trip data created
  through the sanctioned writers (`tripRepo.createTrip`/`closeTrip` + `cascadeRepo.setPlaceStatus`,
  not raw Dexie writes):
  - 1-country stamp (Iceland), 6-country (Central Europe Loop), and 15-country (Grand Tour, wraps to
    3 rows) all legible at both widths, grid `auto-fill` re-wrapping correctly at the narrower 360px
    (6-code row wraps 5+1 instead of 6+0).
  - A deliberately absurd long name ("The Really Very Extremely Long Family Reunion Road Trip Across
    Three Continents") wraps to 4 lines with no clipping, no horizontal overflow, uppercase transform
    intact.
  - Zoomed inspection (temporary wide/short viewport, same technique 3b used) confirmed the dashed
    border reads as genuinely broken/irregular ink at the rounded corners — no rendering artefacts
    where the dash pattern meets the `border-radius` curve — and the vignette sits correctly behind
    the border/content layers with no z-index needed.
  - `el.scrollWidth === el.clientWidth` at both 390 and 360 (no horizontal overflow); vertical
    overflow negligible (786 vs 780 at 390px) and scrolls correctly within `.app-content`.
  - App left in a clean state afterward: `entries`/`trips`/`tripEntries` cleared, `syncState.revision`
    reset to 0 (same precedent every prior phase's testing has followed).

### Notes for the next session

- `preview_screenshot` timed out repeatedly again this session, same known artefact documented since
  Phase 3 — recovered every time via a throwaway `1+1` eval before retrying, never an app bug.
- If Phase 6 wants to push the stamp further once real cover photos exist, the vignette `::before` and
  the cover-photo `<div>` now both need to be checked together for contrast — currently only
  smoke-tested by reasoning about paint order (cover photo is a later DOM sibling so it correctly
  paints on top), not by attaching a real photo, since Phase 6 hasn't landed yet.

## Phase 6 — Photos (done)

Photo attachment, the resize/EXIF worker pipeline, and the "Import from photos" flow that matches an
old library against the nearest bundled city and proposes trips by date. Two scope questions were
asked and answered before writing code (see Deviations 1–2); both narrowed the brief significantly,
and everything else below is a documented default following the session's own steer.

### What was built

- **Storage** — no schema change at all: `photos`/`photoBlobs` (plan §4) and their indexes were
  already fully declared back in Phase 1, so this phase needed no Dexie version bump anywhere.
  [`domain/photoRepo.ts`](atlas/src/domain/photoRepo.ts) is the sanctioned writer (same convention as
  `cascadeRepo.ts`/`tripRepo.ts`): `attachPhoto` (one transaction across `photos`+`photoBlobs`),
  `updateCaption`, `reassignPhoto` (moves/clears the `entryId`/`tripId` tagging), `softDeletePhoto`
  (metadata only — the blob stays until Phase 7 actually uploads it), `listPhotosForEntry(ies)`,
  `listPhotosForTrip` (with an optional per-entryId filter for a trip's per-city tag view), and the
  storage-accounting pair `photoStorageStats`/`clearUploadedBlobs`.
- **The resize/EXIF pipeline** (task 1) — [`photos/imageWorker.ts`](atlas/src/photos/imageWorker.ts):
  a Web Worker, one job per photo: `exifr` reads GPS + `DateTimeOriginal`, `createImageBitmap(file,
  {imageOrientation:'from-image'})` decodes **and auto-rotates per the EXIF orientation tag in one
  step** (see Deviation 3), then `OffscreenCanvas` resizes twice (2048 px full @ q0.82, 320 px thumb)
  and re-encodes as JPEG — which also **strips EXIF automatically**, since a fresh canvas-encode never
  carries the source's metadata through (see Deviation 4; not a separate step). [`photos/
  processImage.ts`](atlas/src/photos/processImage.ts) is the main-thread client: one worker reused
  across a batch, sequential (bounded peak memory), `processBatch` for progress + a between-item
  cancel that leaves finished photos intact, and an equivalent main-thread `<canvas>` fallback if the
  worker can't do the job at all (old Safari).
- **Attaching photos** (task 2, narrowed — see Deviation 1) —
  [`components/photos/PhotoGrid.tsx`](atlas/src/components/photos/PhotoGrid.tsx) (thumbnail grid,
  cover badge) + [`usePhotoBlobUrl.ts`](atlas/src/components/photos/usePhotoBlobUrl.ts) (object-URL
  lifecycle for thumb/full blobs) + [`AddPhotosButton.tsx`](atlas/src/components/photos/AddPhotosButton.tsx)
  (`accept="image/*" multiple"`, processes through the worker, writes via `attachPhoto`, inline
  progress + cancel). [`PhotoViewer.tsx`](atlas/src/components/photos/PhotoViewer.tsx) is the
  full-screen viewer: swipe between photos and pinch-zoom hand-rolled on the Pointer Events API (no
  new dependency — recommended and confirmed with the user, see Deviation 2), double-tap to
  zoom in *and back out*, caption (blur commits, same immediacy precedent as the status sheet's
  fields), delete with confirmation, and an optional "set as cover" + contextual reassign/untag
  actions supplied by the caller. New topmost z-index layer, **50**, documented inline (above the
  existing 30/40 scheme — it can be opened from inside any full-screen detail overlay and nothing
  needs to stack on top of it).
- **Country photos** — [`CountryDetail.tsx`](atlas/src/components/places/CountryDetail.tsx)'s Photos
  section is now real: `AddPhotosButton` tags the country's own entry (gated on that entry existing —
  never silently creates one just because a photo arrived), and the grid **rolls up every descendant
  subdivision/city photo** too, not just the country's own (Deviation 1's "no dedicated subdivision/
  city screen" still needs those photos to surface *somewhere real*).
- **Trip photos** — [`TripDetail.tsx`](atlas/src/components/trips/TripDetail.tsx)'s old "Cover photo"
  placeholder is now a real Photos section: a trip-general grid (`entryId: null`, `tripId` set) plus,
  per the user's explicit ask, a small 📷-and-count affordance on every city row in
  `TripPlacesTree` opening a nested `CityPhotosOverlay` scoped to `{tripId, entryId: thatCity}` — this
  is "add a photo to a city you tag" within a trip, without a second full detail screen for cities.
  "Set as cover" (→ `Trip.coverPhotoId`, already wired to `TripStamp` since Phase 5) and the
  "tag/untag to a city" reassignment are available from **both** the general grid and every per-city
  view — a gap in the general grid found and fixed during this session's own testing, see Edge case 3.
- **EXIF import** (task 3) — the "clever" feature.
  [`geo/nearestCity.ts`](atlas/src/geo/nearestCity.ts): cities bucketed into a coarse 2° lat/lon grid,
  built once in-memory and memoised (same "no build-time artefact, no new Dexie index" precedent
  `geo/search.ts` set in Phase 2 — confirmed with the user over precomputing it in `tools/build-geo.mjs`),
  searched 3×3 cells only, haversine distance, the 30 / 150 km confidence tiers, falling back to
  `resolveCountryByPoint` (point-in-polygon against the world topology, the exact `geo/photon.ts`
  pattern one level up) beyond that. [`domain/exifImport.ts`](atlas/src/domain/exifImport.ts):
  `groupByProposedPlace` and `clusterTrips` (gap > 4 days), pure, 11 hand-checked tests.
  [`components/photos/PhotoImportFlow.tsx`](atlas/src/components/photos/PhotoImportFlow.tsx): select →
  process (worker, progress + cancel, partial results kept) → review (grouped by proposed place,
  accept/correct/skip, an "uncertain" badge for the 30–150 km band, a no-match bucket offered for
  manual assignment) → trips (editable cluster names/dates, include/skip) → one confirm tap that does
  every write. **Nothing is written before that tap** — processed images live only as in-memory Blobs
  in React state through review and trip-editing; [`components/photos/PlacePicker.tsx`](atlas/src/components/photos/PlacePicker.tsx)
  (city search + Photon fallback, or a plain country search) backs the "Correct" action without
  reusing `PlaceSearch` (that component's contract is "pick a result, open the status sheet," not
  "return a ref to the caller"). On confirm: accepted trip clusters become real `trips` rows first, then
  each group's target entry is created/upgraded to *visited* — **but only if it isn't already at least
  visited**, so import can never downgrade a place the user already marked *lived* (a guard the literal
  brief text doesn't spell out but plan §5's "never lowers" principle clearly implies; see Deviation 5)
  — then every photo in the batch is attached with its resolved `entryId`/`tripId`.
- **Storage management** (task 4) — a new section in
  [`SettingsScreen.tsx`](atlas/src/screens/SettingsScreen.tsx): photo count + bytes from
  `photoStorageStats`, `navigator.storage.estimate()` against the quota, a persisted-status readout with
  a "request persistent storage" button calling `navigator.storage.persist()`, and "clear local copies
  of uploaded photos" calling `clearUploadedBlobs` (real, but inert until Phase 7 — see Left undone).

### Deviations from the plan/brief, and why

1. **Attaching photos is scoped to country and trip only — no standalone subdivision/city photo UI
   (asked, confirmed).** The brief's task 2 lists "country, subdivision, city or trip detail screen,"
   but subdivisions and cities have never had a detail screen of their own (only the global
   `PlaceStatusSheet`, a bottom sheet) — asked before writing any UI code whether to build two new
   full-screen detail screens just for this, or fold photos into the existing sheet. The user's answer
   went a different direction from either option offered: no photo UI for subdivision/city as
   standalone places at all, *but* a photo should be taggable to a city specifically **when that city
   is part of a trip**. That is exactly what got built (the per-city affordance inside `TripDetail`,
   Deviation described above) — `PlaceStatusSheet` gained no photo section. Consequence: a city visited
   outside any trip has no photo UI of its own; see Deviation 1's follow-on below and Left undone.
2. **Viewer gestures are hand-rolled on Pointer Events, not a third-party library (asked, recommended,
   confirmed).** The plan's tech stack (00-PLAN.md §3) lists no viewer/gesture package, and the app has
   otherwise stuck to platform APIs (`d3-zoom` is the one prior exception, already in the stack for the
   map) — recommended hand-rolling over adding a new dependency, user agreed. This is also what
   surfaced Edge cases 1–2 below: a library would likely have gotten pointer capture and tap-vs-pan
   detection right by construction; hand-rolling it meant finding both the hard way, during this
   session's own testing, not in a bug report.
3. **`createImageBitmap`'s `imageOrientation: 'from-image'` replaces the manual rotation math the
   brief implies is needed ("honouring EXIF orientation").** Found while implementing the worker: this
   option (part of the spec, supported in every engine current enough to have `OffscreenCanvas` at
   all) decodes an already-correctly-oriented bitmap, so there is no separate rotate-by-orientation-tag
   step to write or get subtly wrong.
4. **"Strip EXIF from the stored copies" (task 1 step 4) needed no code at all.** Re-encoding through
   `OffscreenCanvas.convertToBlob`/`HTMLCanvasElement.toBlob` produces a brand-new JPEG with no
   embedded metadata, regardless of what the source carried — the brief phrases this as an explicit
   step, but it falls out of "resize by drawing to a canvas and re-encoding" for free.
5. **EXIF import never lowers an existing place's status, and only stamps `firstVisited` on a
   genuinely new entry (not spelled out in 06-photos.md, inferred from plan §5).** Task 3 step 6 says
   flatly "create the entries with status visited, set firstVisited from the earliest
   `DateTimeOriginal`" — read literally, importing old photos of a country you've since *lived* in
   would downgrade it back to *visited*, and re-importing photos of a place you've already logged
   would overwrite a `firstVisited` you might have set by hand. `cascade.ts`'s own `setStatus` assigns
   `explicitStatus` unconditionally (by design — a direct user request *should* be able to change an
   explicit choice), so this guard lives in the import writer itself (`ensureVisitedEntry` in
   `PhotoImportFlow.tsx`), not in the cascade: skip the status write entirely when an active entry
   already exists at *visited* or above, and only pass a date when creating the entry for the first
   time.
6. **No Dexie migration anywhere this phase** — every field task 1 needs (`entryId`, `tripId`,
   `caption`, `takenAt`, `lat`, `lon`, `width`, `height`, `bytes`, `driveFileId`, `uploadState`) and
   every index (`entryId`, `tripId`, `uploadState`) was already in the Phase 1 schema, unused until now.

### Edge cases found this session (the brief asks to note these)

1. **`Element.setPointerCapture` can throw, and it silently ate the entire gesture when it did — a
   real bug, not just a testing artefact.** Found while verifying pinch-zoom: constructing and
   dispatching synthetic `PointerEvent`s to test the gesture (no real touch hardware in this
   environment) hit `"Failed to execute 'setPointerCapture': No active pointer with the given id is
   found"` — thrown from the very first line of `onPointerDown`, which meant the *rest* of the handler
   (recording the pointer at all) never ran. A second, real, same-shaped pointer session (e.g. a
   pointer capture that has become stale between dispatch and handling) would hit the same exception
   and silently drop that entire touch on a real device too, not just in this test harness. Fixed by
   wrapping the capture call in `try/catch` — capture is a nice-to-have (keeps receiving events if the
   finger slides off the image), gesture tracking must not depend on it succeeding. Confirmed
   before/after: pinch was completely inert (`scale` never left 1) before the fix, computed the
   correct clamped ratio (verified against hand-worked arithmetic, e.g. a 40→120 px separation change
   landing at exactly `scale(3)`) immediately after.
2. **Double-tap could zoom in but never back out — a real logic bug, found by deliberately testing
   both directions.** `wasTap` (the condition gating `toggleZoom`) checked `Math.abs(dragX) < 6`, but
   `dragX` is *only* updated in the branch taken while **not** zoomed — while zoomed in, a stationary
   tap leaves `dragX` holding whatever stale value an earlier swipe left it at, so the check could
   never reliably pass once `scale > 1`. Fixed by measuring the actual distance between a gesture's own
   start (`gesture.current.singleStart`) and its release point, independent of `scale`/`dragX`/
   `translate` entirely. Verified explicitly both ways: double-tap 1→2, then a second double-tap
   2→1, on the same photo.
3. **A photo tagged to a specific city within a trip couldn't be set as that trip's cover — only
   photos in the trip-general grid could.** `CityPhotosOverlay`'s `PhotoViewer` was wired with
   `onCaptionChange`/`onDelete`/reassign actions but no `isCover`/`onSetCover`, an inconsistency found
   by exercising the feature end-to-end (opening a city's photos and looking for "Set as cover" in the
   menu) rather than by inspection. Fixed by threading the trip's `coverPhotoId` down to the nested
   overlay too — any photo on the trip, tagged to a city or not, can now become its cover.
4. **A pre-existing, unrelated data bug, found while a country detail screen happened to be open for
   testing: Iceland's admin-1 topology has one subdivision id, `IS.39`, duplicated across two separate
   map features** (of 9 total), which throws a React "duplicate key" console error every time
   `CountryAdmin1Map` renders Iceland. This is a Phase 2 geo-build-pipeline data issue
   (`tools/build-geo.mjs`/Natural Earth↔GeoNames reconciliation for Iceland specifically), completely
   unrelated to photos — not fixed here, flagged as a separate follow-up task instead (chip
   `task_ce173374`) rather than reaching into an already-shipped, already-tested pipeline outside this
   phase's scope.

### Left undone (correctly, per scope)

No Drive upload (Phase 7) — `uploadState`/`driveFileId` are populated (`'pending'`, `null`) and
otherwise unused, exactly as instructed. No standalone photo UI for a subdivision or a city visited
*outside* a trip (Deviation 1) — that place's photos, if any ever get attached to it (e.g. by a future
EXIF import running with no trip created), are only reachable today via the country roll-up in
`CountryDetail`, never their own screen. The `PlaceStatusSheet` was not touched. The `#/settings`
"Clear local copies of uploaded photos" action has nothing to do yet — `uploadState` can't reach
`'uploaded'` before Phase 7 exists.

### Verified

- `npx tsc -b`, `npm run lint`, `npx vitest run` (**121/121** — 103 pre-existing + 7 new
  `nearestCity.test.ts` + 11 new `exifImport.test.ts`), and `npm run build` all clean.
- **`nearestCity`'s core algorithm checked against the real seeded 170,486-city dataset, not just the
  7-city unit fixture**: Reykjavík's own coordinates → confident match on Reykjavík itself, 0 km. A
  point in Iceland's uninhabited interior (Vatnajökull) → correctly found the true nearest real
  bundled city (Höfn, 67.7 km) and classified it *uncertain* (30–150 km band). Central Australian
  outback (nothing within 150 km) → fell back to the country tier, resolved to `AU` by point-in-polygon.
  Open Pacific → `'none'`. All four tiers, against real data, not mocks.
- Browser (Vite dev, 390×844, dark), **every acceptance criterion exercised as directly as this
  environment allows** — see the honesty note below on the one criterion this couldn't fully reach:
  - Set Iceland to *visited* through the real search-and-status-sheet flow (creates the derived
    subdivision/city, exactly as Phase 4); opened `CountryDetail`, confirmed the Photos section and its
    gated `AddPhotosButton`.
  - Ran two photos through the **real** pipeline end to end — `processImage` (worker path) → `attachPhoto`
    — with synthetic in-browser-generated JPEGs (this environment has no real phone photo library or a
    way to drive an OS file picker; see the honesty note): both resized correctly (800×600, under the
    2048 cap, untouched), wrote both `photos` and `photoBlobs` rows in one transaction, appeared in the
    grid with no reload.
  - Opened the viewer: swipe (drag past the threshold advances/retreats, rubber-bands back under it),
    pinch-zoom (verified the clamped scale formula against hand-worked arithmetic), pan while zoomed
    (confirmed it never gets misread as a swipe), double-tap in and back out, caption edit (commits on
    blur, confirmed the row in Dexie), delete (soft-deletes the row, **blob confirmed still present**
    per the design — see Deviation 6's storage-management note).
  - Trips: created a real trip via `tripRepo.createTrip`, attached Reykjavík (auto-attach, Phase 5); the
    per-city 📷 affordance appeared on its row; attached a photo tagged to `{tripId, entryId: city}` —
    appeared in the city-scoped grid, the row's count badge updated live (`📷 1`); attached a second,
    trip-general photo; set it as cover (`Trip.coverPhotoId` confirmed in Dexie, `PhotoGrid`'s Cover
    badge rendered); reassigned it onto Reykjavík via "Tag to Reykjavík" (confirmed `entryId` changed in
    Dexie); untagged the other photo back to trip-general via the city-scoped view (confirmed `entryId`
    reverted to `null`).
  - **Restart survival, explicitly**: attached a photo to Norway's country entry, did a genuine
    `window.location.reload()` (not just a re-render), reopened `CountryDetail` for Norway — the photo
    was still there. This is the literal acceptance criterion, not reasoned about from IndexedDB's
    general durability.
  - Settings: the Photos/Storage sections render real counts (3 active photos, correct combined
    full+thumb byte total), `navigator.storage.estimate()`'s usage/quota, and a persisted-status
    readout; tapped "Request persistent storage" and confirmed against the raw `navigator.storage
    .persist()`/`.persisted()` calls directly that the browser itself denies the grant in this
    automated environment (resolves `false`, does not throw) — expected browser policy, not a bug.
  - `PhotoImportFlow`'s select step opens and renders correctly from the You tab.
  - No console errors from anything built this session (the one recurring console error, `IS.39`, is
    the pre-existing, unrelated bug in Edge case 4).
  - App left in a clean state afterward: `entries`/`trips`/`tripEntries`/`photos`/`photoBlobs` all
    cleared, `syncState.revision` reset to 0 — same precedent every prior phase's testing has followed.
  - **Honesty note, per this project's own stated verification standard**: this environment's browser
    automation has no file-chooser injection tool, so the *literal* OS "select photos" gesture inside
    `PhotoImportFlow`, and therefore the full select→review→trips→confirm click-path with real files,
    could not be driven end to end. What *was* verified directly: every function that path calls
    (`processImage`, `matchPhotoLocation` against real data, `groupByProposedPlace`/`clusterTrips`,
    `setPlaceStatus`, `createTrip`, `attachPhoto`) works correctly in isolation, the pure grouping/
    clustering logic has 11 hand-checked unit tests, and the component's own code has no write call
    anywhere except the final `runImport()` (confirmed by reading it, not just assuming it). Also not
    measured: real-world throughput for "30 photos" — the synthetic test images used here (solid-colour
    canvases, a few KB each) are not representative of 4–8 MB phone originals, so no import-throughput
    number is reported; worth a real-device pass with an actual photo library before trusting the
    "stays responsive" criterion fully. Multi-touch pinch/swipe was verified via synthetic
    `PointerEvent` dispatch (which is how Edge cases 1–2 were found) rather than real touch hardware.

### Notes for the next session

- **`domain/photoRepo.ts` is now the only sanctioned writer to `photos`/`photoBlobs`** — same
  convention, same risk if bypassed, as `cascadeRepo.ts`/`tripRepo.ts` before it.
- **New z-index layer: 50, for `PhotoViewer`**, above the existing 30 (full-screen overlays) / 40
  (place-status sheet, trip dialogs) scheme. `PlacePicker` (used inside the import flow) sits at 40,
  the same tier as the status sheet, since it's a dialog stacked on a 30-layer flow.
  - **Fix the pre-existing `IS.39` duplicate-topology-feature bug** (Edge case 4) — flagged as a
  separate task (`task_ce173374`); unrelated to photos, but easy to hit again the next time Iceland's
  country detail screen is opened.
- **Bundle size crossed Vite's 500 kB advisory threshold this phase** (~590 KB / 193 KB gzip main
  chunk) — `exifr` is the main contributor, needed both in the worker chunk and (rarely) the
  main-thread fallback. Tried splitting it out via a dynamic `import()` in the fallback path; Rollup
  won't split a module that's *also* statically imported by a Worker entry, so that made no difference
  and was reverted in favour of the simpler static import. Not fixed further — this is a soft warning,
  not a failure, and restructuring chunking is a build-config exercise orthogonal to this phase's scope.
  Worth a `manualChunks` pass if bundle size ever becomes a real problem.
- **The next real gap, if a future session wants to close it**: a place visited outside any trip has
  nowhere to show a city/subdivision-level photo except the country roll-up (Deviation 1's boundary).
  If that ever feels wrong in practice, the two live options are a dedicated subdivision/city detail
  screen (more surface area) or a photo section inside `PlaceStatusSheet` (the option not chosen this
  session) — both were considered, neither was asked for.
- Worth a real-device pass for the two things this environment couldn't fully exercise: an actual OS
  photo-picker interaction, and true multi-touch (real fingers, not synthetic `PointerEvent`s) — see
  the honesty note under Verified.

### Addendum — iOS safe-area handling for the two new fixed full-screen surfaces (same session, user-directed)

A follow-up after a question about iOS support in general: every other fixed full-screen surface in the
app (`FullScreenOverlay`, `BottomNav`, `PlaceStatusSheet`) already pads for the notch/Dynamic Island and
home-indicator via `max(<space>, env(safe-area-inset-*))`, established back in earlier phases — but
this phase's two *new*, custom `position: fixed` surfaces that don't route through `FullScreenOverlay`
(`PhotoViewer` and `PlacePicker`) had skipped it, found on inspection rather than in the browser (this
environment has no notched-device emulation to actually see the gap; `env(safe-area-inset-*)` is `0` on
a plain desktop/generic-mobile viewport, so nothing here was ever visibly broken to *this* testing —
only on a real notched iPhone).

- [`PhotoViewer.css`](atlas/src/components/photos/PhotoViewer.css): `.photo-viewer__header`'s top
  padding, `.photo-viewer__footer`'s bottom padding (the caption field), the `⋯` menu's `top` offset
  (kept in sync with the header so it still sits flush beneath it), and `.photo-viewer__confirm`'s
  (the delete-confirmation bottom sheet) bottom padding all now use the same `max(...)` pattern.
- [`PlacePicker.css`](atlas/src/components/photos/PlacePicker.css): same treatment, top and bottom,
  on its single outer padding declaration.

**Verified**: `npx tsc -b`, `npm run lint`, `npx vitest run` (121/121), `npm run build` all clean.
Inspected the computed styles directly in-browser rather than trusting the CSS by eye: with
`env(safe-area-inset-*)` resolving to `0` here, `.photo-viewer__header`'s `padding-top` is `12px`
(unchanged from before the fix), `.photo-viewer__footer`'s `padding-bottom` is `16px` (unchanged), and
the `⋯` menu's `top` is `56px` (`44px` tap target + `12px` gap + `0px` inset) — confirms the `max()`
fallback resolves correctly and nothing regressed visually in an unnotched context, which is the only
kind this environment can render; the actual safe-area behavior on a real notched device follows from
the same `env()`/`max()` pattern already proven correct elsewhere in the app, not from anything newly
verified here.

## Phase 7a — Google Drive sync core: auth, Drive layer, merge, orchestration, photo sync (done)

Tasks 1–5 of `07-sync-and-deploy.md` only. Per `START-HERE.md` the phase is split 7a/7b; the user
confirmed this session as **sync core** and deferred manual backup (task 6) and deployment (task 7)
to a fresh session. Three questions were asked and answered before any code (scope, deploy target,
Cloud-Console state). Everything runs offline-first and mirrors to the user's own Drive
`appDataFolder`; **no server anywhere**.

### What was built (all under `atlas/src/sync/`)

- **Auth** [`auth.ts`](atlas/src/sync/auth.ts) — Google Identity Services token flow. Loads
  `accounts.google.com/gsi/client`, `initTokenClient` for scope `drive.appdata`, **access token in
  module memory only** (never localStorage/IndexedDB). `getAccessToken()` returns the cached token
  while valid, else requests `prompt: ''` (silent when the user has a live Google session + prior
  grant, consent UI only when it can't be satisfied silently — the plan's exact rule). The four
  failure modes each get a specific human sentence (`describeAuthError`): **declined**, **popup
  blocked**, **offline**, **revoked** (plus `not_configured`). `signIn()` marks the device connected;
  `signOut()` revokes, drops the token, clears the sync bookkeeping, and **leaves all local data
  intact** (the UI confirmation says so). No client secret anywhere.
- **Drive** [`drive.ts`](atlas/src/sync/drive.ts) — REST v3, everything in `appDataFolder`:
  `findFile / downloadJson / uploadJson / uploadBlob / downloadBlob / deleteFile`. Retry on 429/5xx
  with exponential backoff + jitter capped at 5 attempts; **401 → refresh token and retry once**;
  other 4xx → terminal `DriveError`; retries exhausted → `DriveUnavailableError` (transient, the
  orchestrator queues). Idempotent throughout — a 404 delete resolves, multipart bodies are
  re-sendable Blobs.
- **Merge** [`merge.ts`](atlas/src/sync/merge.ts) + **17 tests**
  [`merge.test.ts`](atlas/src/sync/merge.test.ts) — pure, no I/O. LWW keyed on
  `max(updatedAt, deletedAt)` (which implements the plan's separate "tombstone wins if its deletedAt
  is later than the other side's updatedAt" rule in one comparison). Entries merge by **natural key**
  (see Deviation 1); settings merge **field-by-field** three-way (Deviation 2). `canonicalize` /
  `snapshotsEqual` give the orchestrator its "did anything actually change?" check and underwrite
  idempotency.
- **Snapshot bridge** [`snapshot.ts`](atlas/src/sync/snapshot.ts) — `buildLocalSnapshot` reads the
  synced state (explicit + tombstoned entries only; derived excluded per plan §7.3);
  `applyMergedSnapshot` writes a merged snapshot back **preserving each row's own updatedAt/deletedAt**
  (a raw write, deliberately *not* through `repo.ts`, which would stamp `updatedAt = now` and destroy
  LWW), in one transaction, then `rebuildDerivedEntries()`.
- **Orchestration** [`sync.ts`](atlas/src/sync/sync.ts) — `syncNow()` with an in-memory lock (a
  second call returns the first promise). Pull → skip if remote revision unchanged & no local changes
  & no photo work → photo pass → merge → write-local-if-changed → **push only if content changed**
  (keeps re-syncing an unchanged payload from bumping the revision forever) → bookkeeping →
  `lastSyncAt`. Honest outcomes: `ok / not-connected / not-configured / offline / auth / error`;
  never a success state for a run that didn't finish.
- **Photo sync** [`photos.ts`](atlas/src/sync/photos.ts) — uploads `uploadState: 'pending'` blobs one
  at a time as `photo-<id>.jpg`, storing the returned `driveFileId` (photo pass runs *before* the JSON
  push so new ids ride along in the same document). Soft-deleted photos with a `driveFileId` get their
  Drive file deleted, the id nulled, and the local blob reclaimed. **Lazy download** `ensurePhotoBlob`:
  on first view of a photo whose local blob is missing, download the full from Drive, regenerate the
  thumbnail via the existing `processImage` pipeline, cache both; concurrent views share one download.
  A **cellular gate** (`photoUploadOnCellular`, default off = Wi-Fi only) blocks uploads only on a
  *positively-detected* cellular radio.
- **UI**: [`GoogleDriveSettings.tsx`](atlas/src/components/sync/GoogleDriveSettings.tsx) (connect /
  disconnect with an inline confirm, last-synced time, "Sync now", pending-upload count, the two
  device-local toggles, honest error/offline/notice lines) in the You screen;
  [`SyncIndicator.tsx`](atlas/src/components/sync/SyncIndicator.tsx) — a slim app-wide status line
  (spinner + pending count while syncing, offline note, error + Retry) that is **invisible when idle**;
  the **About attribution** (Natural Earth / GeoNames CC BY 4.0 / Photon-OSM ODbL) added to Settings.
- **Triggers** [`useSyncTriggers.ts`](atlas/src/sync/useSyncTriggers.ts) — app start, return to
  foreground (`visibilitychange`), reconnect (`online`), and a 30 s debounce that only arms when there
  are genuinely unpushed changes. Store [`syncStore.ts`](atlas/src/sync/syncStore.ts) (zustand) holds
  only transient run state; durable facts come from Dexie via `useLiveQuery`.
- **Schema/infra**: `Settings` gained `driveConnected` + `photoUploadOnCellular`; `SyncState` gained
  `pushedRevision` + `lastSyncedSettings` (Deviation 3). `seed.ts` writes the new defaults and
  **backfills** them onto existing singletons (no Dexie version bump — none are indexed). `repo.ts`'s
  `bumpRevision` changed from a whole-row `put` to a field-scoped `update` (Deviation 4 — the old code
  would have wiped the new fields on every write). `vite-env.d.ts` types `VITE_GOOGLE_CLIENT_ID`;
  `.env.local` (git-ignored) holds the dev client ID, `.env.example` is committed documentation.

### Deviations from the plan, and why

1. **Entries merge by natural key `[kind+refId]`, not by `id` (flagged to the user before coding).**
   Plan §7.2 says "key records by id", correct for trips/tripEntries/photos. But `entries` has a
   **unique `&[kind+refId]` index** that forbids two rows sharing that key — even a tombstone plus an
   active row. Two devices adding the same place offline mint two ids for one key; merging by id keeps
   both and the local write then throws (or drops data). So entries collapse by natural key, the
   surviving id is chosen by a total deterministic order (`stamp` desc, deletion-first, id desc) so
   every device converges, and any `tripEntries`/`photos` that referenced a dropped duplicate id are
   **re-pointed** to the survivor (`tripEntries` then de-duplicated on `[tripId,entryId]`). The dropped
   id is hard-removed, not tombstoned — the *place* (the natural key) is preserved, only the redundant
   duplicate row is discarded; other devices self-heal on their next merge. All pure and tested.
2. **Only `statMode`, `countryDenominator`, `theme` sync; everything else on `Settings` is
   device-local.** `deviceId`/`geoDataVersion` (already per-device), `autoSync` and
   `photoUploadOnCellular` (this device's network policy), `driveConnected` and `lastSyncAt` (this
   device's own state). "Field-by-field" is a **three-way merge** against a persisted baseline
   (`syncState.lastSyncedSettings`): a field only one side changed is kept; both-changed → remote wins;
   no baseline (a new device meeting an existing doc) → the shared Drive value wins. That last rule is
   what makes it converge across a push/pull cycle instead of ping-ponging (tested).
3. **Four device-local fields added beyond plan §4** (`Settings.driveConnected`,
   `Settings.photoUploadOnCellular`, `SyncState.pushedRevision`, `SyncState.lastSyncedSettings`). None
   indexed → no Dexie version bump; `seed.ts` backfills them onto existing rows at startup (before
   render), so the rest of the code can assume they exist.
4. **`bumpRevision` rewritten** from `db.syncState.put({...whole row})` to `db.syncState.update(1,
   {revision})`. The old whole-row put reconstructed `SyncState` from a handful of fields and would
   have silently wiped `pushedRevision`/`lastSyncedSettings` on every single user write. Caught before
   it could bite.
5. **Sync is a second sanctioned raw writer to the user tables** (alongside the cascade). `snapshot.ts`
   and `photos.ts` write rows through `db.*` directly rather than `repo.ts`, because sync must preserve
   the *incoming* `updatedAt` (LWW depends on it) and must not spuriously bump the local revision.
   Documented at both call sites. `repo.ts` remains the only writer for ordinary user actions.
6. **The Drive document's `revision` increments only when pushed content actually changed** (compared
   via `canonicalize`). This is what makes "merging the same payload twice changes nothing" true at the
   revision level, not just the row level — no perpetual re-push loop between two idle devices.
7. **Service-worker update flow left as `registerType: 'autoUpdate'`.** The "Update available" button
   is task 7 (deployment); switching to `'prompt'` belongs to the deploy session, not here.
8. **Pull-to-refresh gesture not implemented.** The brief lists it among task 4's triggers; the manual
   trigger this session ships is the **"Sync now"** button (and the indicator's **Retry**). The touch
   gesture is deferred to the deploy/polish session — it can't be verified in this headless environment
   and risks breaking existing scroll on the list screens. All four *automatic* triggers are wired.
9. **Cellular detection only blocks a positively-detected cellular radio** (`navigator.connection.type
   === 'cellular'`). When the platform can't classify the link (desktop, Safari), uploads proceed —
   blocking everything we can't classify would break sync on the machines that most want it.

### Edge cases found / reasoned through (the brief asks to note these)

1. **The `[kind+refId]` unique index vs tombstones — the headline finding (Deviation 1).** A table
   whose *natural* key is unique cannot be merged purely by surrogate `id` without either crashing on
   write or silently losing a row. This is exactly the "subtle mistake that stays hidden for weeks"
   §7 warns about, and the reason entries needed their own merge path.
2. **Demotion of an explicit parent that still has children does not propagate as "became derived"
   across devices — a known, documented, self-healing limitation.** When the user removes the explicit
   status from e.g. Germany while a visited city keeps it alive, the cascade demotes the row in place
   (explicit→derived) rather than tombstoning it; a union merge has no signal to carry "this stopped
   being explicit", so another device that still holds an explicit Germany will re-teach it on the next
   sync. **Effective status is identical on every device** (recomputed from the still-synced children),
   so there is no visible or statistical divergence — only the internal explicit/derived flag on that
   one parent, which self-heals the moment the user next sets or clears it. Fully propagating this would
   need per-field tombstones or syncing derived rows (which reintroduces the cross-device `updatedAt`
   churn §7.3 exists to avoid); disproportionate for a rare action in a one-user app. Every common
   operation (add city → derived parents, set/clear a leaf, delete with no children → tombstone) syncs
   exactly.
3. **Merge-write must preserve `updatedAt`** — hence the deliberate `repo.ts` bypass (Deviation 5).
4. **The derived rebuild after a merge bumps the local `revision`** (derived rows are written through
   `repo`). Those are local-only, non-syncable changes, so the orchestrator sets `pushedRevision` to
   the *final* revision after the write — otherwise every merge would leave a phantom "unpushed change"
   and trigger a no-op re-push next time.
5. **A sync interrupted between the JSON push and a photo upload still completes.** The photo pass runs
   on every sync regardless of the JSON skip-optimisation, so a leftover `pending` photo is never
   stranded by the "nothing changed" fast path.

### Left undone (correctly — 7b / deployment)

- **Manual backup** (task 6): `.zip` export/import via the share sheet, merge-or-replace, working with
  no Google account. Planned lib: `fflate` (the existing `adm-zip` is Node-only, used only by the geo
  build). Not started.
- **Deployment** (task 7): GitHub Actions → Pages, Vite `base` set to `/<repo>/`, `VITE_GOOGLE_CLIENT_ID`
  injected from a repo **variable**, the SW "Update available" button (`registerType: 'prompt'`), and
  the README Android-install instructions. Not started — **there is no GitHub repo yet** (the user will
  create it), so `base` is untouched and stays `'./'`.
- **`docs/OPERATIONS.md`**: the sync-failure triage, client-ID rotation, and geo-regeneration sections
  are written now; the deploy runbook (CI variable, Pages origin check) is marked TODO for 7b.
- **Pull-to-refresh** gesture (Deviation 8).

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**138/138** — 121 prior + 17 new merge), and
  `npm run build` all clean. Build output unchanged in shape (the >500 kB warning is the pre-existing
  `exifr` one from Phase 6, not sync).
- Browser (Vite dev, 375×812, dark) — everything a headless environment *can* reach was driven directly:
  - You screen shows the **Google Drive** section: *Not connected → "Connect Google Drive"* when
    disconnected; the full connected panel (status, *Last synced NEVER*, *Sync now*, both toggles,
    *Disconnect*) after flipping `driveConnected` via Dexie; the **About attribution** renders the exact
    Natural Earth / GeoNames CC BY 4.0 / Photon-OSM ODbL line.
  - **Both device-local toggles persist** (clicked "upload on mobile data" → `true`, "sync
    automatically" → `false`, confirmed in Dexie).
  - **Honest-error contract holds.** With `driveConnected` true and no Google session in the sandbox,
    the app-start sync attempted a token, GIS reported the popup blocked (no user gesture), and the app
    surfaced `phase: 'error'` with *"Your browser blocked the Google sign-in popup…"* — in both the
    Drive panel (as an alert) and the global indicator (with a **Retry** button). **No fake success.**
    The store returns to `phase: 'idle'` and the indicator disappears once disconnected.
  - **The client-ID wiring is confirmed from Google's own request.** The GSI popup URL the library
    built carries `client_id=213622094791-…`, `scope=…/auth/drive.appdata`, `response_type=token` (token
    flow, no secret), and `origin=http://localhost:5173` — exactly the intended configuration.
  - No app console errors; `syncState` left pristine (`revision/remoteRevision/pushedRevision = 0`,
    `lastSyncedSettings = null`), test flags reset — app left in a clean, disconnected state.
- **Honesty note (this project's standard).** A *real* end-to-end Google sign-in, an actual Drive
  upload/download, and true cross-device convergence **could not be exercised here** — there is no way
  to complete interactive Google consent or open the OAuth popup in this headless automation context,
  and no second device. What *is* proven: the merge (the risky pure core §7 flags) is exhaustively unit-
  tested including the natural-key collision, re-pointing, tombstone ties, idempotency and settings
  convergence; the auth/Drive wiring is verified structurally and via the exact GSI request parameters;
  the UI, triggers, store, and error mapping are driven live. **The definitive test — sign in on a real
  device, confirm the consent screen appears once, watch data and photos appear on a second device — is
  the user's to run.** The acceptance criteria that require two real devices / a real Drive are left for
  that pass.

### Notes for the next session (7b — deploy)

- **The user still needs to confirm the Cloud-Console state** (their answer was "did everything per
  Claude's guidance", not a checklist): consent screen **published to Production** (else weekly
  re-auth), Drive API enabled, `drive.appdata` scope added, client is **Web application** type, and
  authorized origins. Only `http://localhost:5173` matters until the repo exists; **add
  `https://<user>.github.io` (origin only, no path, no trailing slash) when it does.**
- **Sync is the third raw writer to the user tables** — `auth.ts`/`snapshot.ts`/`photos.ts` bypass
  `repo.ts` on purpose. Anything new that writes synced rows during a merge must preserve `updatedAt`.
- **Deploy checklist**: set Vite `base` to `/<repo>/`; switch PWA `registerType` to `'prompt'` + wire
  the update button; inject `VITE_GOOGLE_CLIENT_ID` from a GitHub repo **variable** (not a secret);
  verify the deployed origin exactly matches the OAuth authorized origin.
- **Backup (task 6)**: add `fflate`; export/import must work with no Google account.
- The **demotion limitation** (edge case 2) is the one place cross-device state can differ; revisit
  only if it ever matters in practice.
- Dev/build still require **Node 20** (`nvm use 20`); the non-login shell defaults to apt Node 18.

## Phase 7b — Manual backup and deployment (done)

Tasks 6 and 7 of `07-sync-and-deploy.md`, both explicitly deferred by 7a's own hand-off notes above.
Two scope questions were asked and confirmed before writing code: who runs the actual GitHub-side
steps (repo creation, Pages source, the repo variable) given this sandbox has neither a `gh` CLI nor
stored GitHub credentials — the user does, from a runbook, same spirit as plan §9's Cloud Console
walkthrough — and whether this session covers both backup and deployment or deployment only, since
`START-HERE.md`'s session table labels 7b just "Deploy" while PROGRESS.md's own 7a notes filed both
under "7b / deployment." Confirmed: both.

### What was built

- **Manual backup** (`atlas/src/backup/`): [`types.ts`](atlas/src/backup/types.ts) (`BackupDoc`,
  schema v1) and [`backup.ts`](atlas/src/backup/backup.ts) — `exportBackup()`/`readBackupFile()`/
  `importBackupMerge()`/`importBackupReplace()`. Deliberately thin: export reuses `buildLocalSnapshot()`
  (the exact same explicit-entries-plus-tombstones view Drive sync pushes), merge reuses
  `mergeSnapshots()`/`applyMergedSnapshot()` (the same LWW rule and Dexie write path Drive pull uses),
  and replace is the one genuinely new operation — a full wipe-and-restore in one transaction. Photo
  bytes ride as `photo-<id>.jpg` zip entries (same naming Drive uses, independently defined, not
  shared code) written via [`fflate`](atlas/package.json)'s async `zip`/`unzip` (now a direct
  dependency — it was already present transitively via `mapshaper`, the geo-build tool). Photo blob
  restore mirrors `@/sync/photos` `ensurePhotoBlob`'s trick exactly: keep the zip's bytes as-is for
  `full` (already resized/EXIF-stripped when first attached) and only re-run `processImage` to
  regenerate the `thumb`, avoiding a second lossy JPEG re-encode.
  [`share.ts`](atlas/src/backup/share.ts) — `shareOrDownloadZip()`, the Web Share API (file sharing)
  with a plain `<a download>` fallback; a cancelled share sheet is treated as a non-error, not an
  unexpected surprise download.
- **Backup UI** [`BackupSettings.tsx`](atlas/src/components/backup/BackupSettings.tsx) — added to the
  You screen directly below Google Drive (the existing `GoogleDriveSettings` "not configured" branch
  already said "a backup is still available below," which is exactly where it now lives), following
  its `busy`/local-error/notice conventions and the two-step confirm pattern for **Replace**
  specifically (destructive; **Merge** commits immediately, same "the action is the save" logic the
  status sheet uses). Works with **no Drive dependency at all** — doesn't call `isConfigured()` or
  read any sync state.
- **Service-worker update flow**: [`vite.config.ts`](atlas/vite.config.ts) switched
  `registerType: 'autoUpdate'` → `'prompt'`. [`registerUpdatePrompt.ts`](atlas/src/pwa/registerUpdatePrompt.ts)
  imports `virtual:pwa-register` itself and calls it once from
  [`main.tsx`](atlas/src/main.tsx) — which also makes vite-plugin-pwa stop auto-injecting its own
  bare `registerSW.js` script (`injectRegister: 'auto'`'s documented behaviour once you import the
  virtual module yourself; confirmed in the build output, see Verified). A waiting update sets
  [`updateStore.ts`](atlas/src/pwa/updateStore.ts) (zustand, mirrors `syncStore.ts`'s shape), which
  [`UpdateBanner.tsx`](atlas/src/components/pwa/UpdateBanner.tsx) — mounted in `App.tsx`'s shell stack
  next to `SyncIndicator`/`ActiveTripBanner` — turns into the "a new version is ready" strip with an
  **Update** button, exactly the brief's "small button rather than reloading under the user's fingers."
- **Deployment**: [`vite.config.ts`](atlas/vite.config.ts)'s `base` is now derived from
  `process.env.GITHUB_REPOSITORY` (which every GitHub Actions run sets to `owner/repo`) instead of a
  hand-typed `/<repo>/` — falls back to the existing `'./'` outside CI, so local dev/preview are
  untouched and the repo can be renamed with no config edit.
  [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) — checkout, Node 20, `npm ci`, lint,
  test, build (`VITE_GOOGLE_CLIENT_ID` from a repo **variable**), then the official
  `actions/configure-pages` + `actions/upload-pages-artifact` + `actions/deploy-pages` two-job flow.
  Runs lint+test+build on every `pull_request` too (as a check, never deploying), and on `workflow_dispatch`
  for a manual redeploy with no new commit.
- **Docs**: [`README.md`](README.md) gained a *Deploying* section (the one-time GitHub setup,
  condensed) and Android home-screen install steps. [`docs/OPERATIONS.md`](docs/OPERATIONS.md) §4's
  TODO stub is now the real deploy runbook — one-time setup, verifying the deployed origin against
  Cloud Console, what the Update banner means operationally, where icons/manifest are edited — plus a
  short pointer to Backup added to the end of §1, since "the sync is broken, now what" and "I want a
  copy I can trust independent of sync" are the same underlying worry.

### Deviations from the plan, and why

1. **README's link to `travelingSalesmanClaudeInputs/00-PLAN.md` was dead and got removed, not
   fixed-in-place.** That directory lives one level *above* the repo root (sibling to
   `Traveling_Salesman/`, not inside it), so the relative link could never resolve once pushed to
   GitHub. `START-HERE.md`'s own workflow pastes these files into fresh sessions rather than shipping
   them with the app, so this reads like a Phase-1-era assumption of co-location that was never true,
   not a deliberate structure to preserve. Didn't copy the design docs into the repo either — that's a
   bigger call than this session's scope — just dropped the dead link and the "Project layout" bullet
   built on it, replacing both with what the repo actually contains.
2. **`base` is derived from `GITHUB_REPOSITORY` at build time rather than set to a literal `/<repo>/`.**
   The task only says "set Vite `base` correctly for a project site"; deriving it removes a whole class
   of "forgot to update config after renaming the repo" bug for free, and needed no answer to "what's
   the repo actually called" to write correct code — verified both branches by building with and
   without the env var set (see Verified).
3. **Backup's settings merge always takes the backup's values** (`mergeSnapshots({ ..., settingsBase:
   null })`) rather than a real three-way merge. A one-off file has no persisted baseline the way two
   synced devices do (`syncState.lastSyncedSettings`), so this is `@/sync/merge`'s own "no baseline yet
   → the shared value wins" branch, the same rule a brand-new device follows on its first Drive sync —
   reused rather than inventing a bespoke rule for three low-stakes display preferences.
4. **Did not create the GitHub repo, push, or touch any GitHub settings** — confirmed with the user
   before writing anything. This sandbox has no `gh` CLI and no stored GitHub credentials, and repo
   creation / pushing / flipping Pages settings are the kind of visible, hard-to-reverse-ish actions
   worth confirming regardless. Wrote the exact steps into `docs/OPERATIONS.md` §4 instead — the same
   "the AI cannot do this part" boundary plan §9 already drew for the Cloud Console. **The user still
   needs to run these**; see Notes.
5. **New branch `phase-7b-deploy`**, off `phase-7a-sync` (which already carries all of Phase 7a),
   rather than committing directly onto `phase-7a-sync`. Matches the one-branch-per-phase pattern the
   repo's history already shows. `main` is a confirmed trivial fast-forward behind it (`git log
   phase-7a-sync..main` is empty) — merging both branches into `main` is folded into the GitHub runbook
   in Notes rather than done here, since `main` only matters once a remote exists to push it to.

### Left undone

Nothing from `07-sync-and-deploy.md`'s task list — all seven tasks across 7a and 7b are built and
verified to the extent this sandbox can reach. What remains is entirely the GitHub-side setup (no
tooling here can do it) and the acceptance criteria that need a real phone, a second device, or a live
Google account — see Notes.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**138/138**, unchanged from 7a — this phase's new
  code is exercised end-to-end live below rather than by new unit tests; nothing here is a pure
  function in the way `merge.ts`/`cascade.ts` are) all clean.
- `npm run build` clean **both with and without `GITHUB_REPOSITORY` set**, confirming the dynamic
  `base` actually lands in the output: unset → `base: './'` (unchanged prior behaviour); set to
  `someuser/atlas` → `dist/index.html`'s script/CSS/manifest links, `manifest.webmanifest`'s
  `start_url`/`scope`, and every icon path all correctly become `/atlas/...`.
  `dist/registerSW.js` (the auto-injected fallback) is confirmed **no longer generated** — `main.tsx`'s
  own `virtual:pwa-register` import suppresses it, exactly as vite-plugin-pwa's `injectRegister: 'auto'`
  documents. `dist/sw.js`'s generated code confirmed `self.skipWaiting()` is called **only** inside the
  `SKIP_WAITING` postMessage handler, never unconditionally at install — i.e. `registerType: 'prompt'`
  produces a worker that genuinely waits, not `autoUpdate` behaviour wearing a different label.
- Browser (Vite dev, 375×812, dark), driven live end-to-end, not just at the function level:
  - **Backup round-trip through the real UI**: added 2 places + 1 trip, clicked **Export backup** —
    fell back to a real browser download (no Web Share API in this headless context) with the correct
    filename and a `2 places · 1 trip · 1 photo`-style notice; fed the downloaded file back through the
    actual hidden file input (a `DataTransfer`-constructed `change` event, not a direct function call)
    — the pending-import card showed the right summary and exported date; **Merge into this device**
    updated the notice and cleared the card.
  - **Merge is additive, replace is destructive — proven, not just read from the code**: added a place
    absent from the backup, merge-imported the backup → union of both (3 places); replace-imported the
    same backup → back down to exactly the backup's 2 places.
  - **Photo blob round-trip, byte-checked**: attached a real photo (canvas-generated JPEG) to a place,
    exported, deleted the local blob only (simulating a device that never had it), merge-imported the
    same backup — the blob came back with a **byte-identical `full`** (770/770 bytes) and a freshly
    regenerated `thumb`, confirming the "keep raw bytes, regenerate only the thumbnail" logic actually
    behaves as documented.
  - **All three format-validation errors**, hand-built with `fflate`: non-zip garbage bytes, a valid
    zip missing `atlas-backup.json`, and a valid zip with `schema: 999` — each produced its exact
    intended `BackupFormatError` message rather than a generic crash.
  - **UpdateBanner**: renders nothing by default; once the store's `needsRefresh` is set, the
    `role="status"` strip appears with the right copy and an **Update** button that calls the stored
    callback. Dev mode has no real service worker to go stale (`devOptions` isn't enabled, same as every
    earlier phase), so this exercised the component/store wiring directly rather than a full
    install→waiting→activate cycle — that needs a real deployed build, see Notes.
  - No console errors anywhere above. App returned to a fully clean state afterward — every test
    entry/trip/photo/blob cleared, `syncState` and `settings` reset to defaults, confirmed via direct
    Dexie counts before a final reload.
- `preview_screenshot` hung once (30 s timeout) right after a synthetic update-banner click — the same
  pre-existing tool flakiness Phases 3/3b/4a already documented, not a new issue: `preview_eval` and
  `preview_console_logs` immediately confirmed the page was fully responsive with zero errors, and a
  subsequent screenshot succeeded normally.

### Notes for the next session

There isn't a next build phase — this finishes everything in `00-PLAN.md` §10. What's left is entirely
outside what an AI in this sandbox can do, the same boundary plan §9 already drew for the Cloud
Console. Full detail is in `docs/OPERATIONS.md` §4; in short:

1. **Create the GitHub repo** (public, needed for free Pages) and push `main` to it — merge
   `phase-7a-sync` and `phase-7b-deploy` into `main` first (both are confirmed trivial fast-forwards).
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables** → add `VITE_GOOGLE_CLIENT_ID` (same value
   as `.env.local`; must be a variable, not a secret — `pull_request` builds can't see secrets).
4. **Cloud Console → the OAuth client → Authorized JavaScript origins** → add
   `https://<your-github-username>.github.io` (origin only — no path, no trailing slash).
5. Also **confirm the rest of the Cloud-Console checklist 7a carried forward** — consent screen
   published to **Production** (else weekly re-auth), Drive API enabled, `drive.appdata` scope present,
   client type **Web application** — none of that could be verified from this sandbox either.
6. Push (or run the workflow manually), then work through `07-sync-and-deploy.md`'s acceptance
   checklist for real: two devices, a live Google account, airplane mode, clearing site data and
   reinstalling. That is the one thing no amount of sandbox testing can substitute for.

## Post-launch stabilization — real-device crash fixes (done)

Phase 7b shipped Drive sync and deployment; this session is the first real-world usage pass against
the deployed PWA on the user's own phone, working through a series of live bug reports rather than a
planned task list. No design doc drove this — each fix started from a symptom report, was reproduced
live where this sandbox allows, and verified before shipping. Eight fixes, eight separate commits, each
pushed and confirmed deployed individually so real usage could validate one before the next shipped.

### What was fixed

1. **Automatic Drive sync attempting a token popup with no user gesture — the likely source of
   repeated "Aw, Snap!" crashes.** [`auth.ts`](atlas/src/sync/auth.ts). Google Identity Services'
   "silent" `prompt: ''` token request still opens a real popup window under the hood (confirmed live:
   `[GSI_LOGGER] Failed to open popup window` fires every time `getAccessToken()` runs outside a user
   gesture). Every automatic sync trigger — app start, foreground, reconnect, the 30 s post-change
   debounce — called it this way. `getAccessToken()` now checks `navigator.userActivation.isActive`
   before attempting a token and throws a new `AuthError` kind (`gesture_required`) instead, routed
   through the existing error display — the always-visible `SyncIndicator`'s Retry button is a real
   click, so reconnecting is one tap instead of a silent failure. Also the root cause of "sign in more
   than once": the reload-triggered "silent" reacquire was never actually silent, it was a doomed popup
   attempt every time.
2. **Dev server running under Node 18, not 20.** [`.claude/launch.json`](.claude/launch.json) pointed
   at system `npm`; this project's PWA tooling needs Node 20 (`docs/OPERATIONS.md`), easy to forget in a
   sandbox with no `nvm` auto-init. Repointed at the Node 20 binary directly.
3. **Reconnect required almost every app open, even seconds after a successful sync.** Same file. The
   access token was deliberately memory-only (a considered Phase 7a security choice) — but mobile
   browsers reload far more often than it looks like from the outside: backgrounding a tab or installed
   PWA commonly gets it silently discarded and reloaded by the OS to reclaim memory, indistinguishable
   from "I did nothing" on the user's side. Confirmed against the real device: reconnect needed again
   about a minute after a successful sync, no action in between. Mirrored the token to `sessionStorage`
   (still never `localStorage`/IndexedDB) — survives any reload within the browser session, clears only
   on a real close, sign-out, or 401. The `gesture_required` guard from fix 1 remains the fallback for
   when there's genuinely no valid token.
4. **Service worker never noticing a new deploy.** [`registerUpdatePrompt.ts`](atlas/src/pwa/registerUpdatePrompt.ts).
   The browser's own navigation-triggered update check is throttled to roughly once per 24 h per spec —
   fine for a tab reloaded often, not for an installed PWA that's mostly resumed. `onRegisteredSW` now
   calls `registration.update()` hourly and on every return to the foreground (mirrors
   `@/sync/useSyncTriggers`'s own foreground trigger). Phase 7b's own notes had flagged this as
   untested against a real deploy; this was its first real-world exercise, and it failed until fixed.
5. **`ConstraintError: Key already exists in the object store` on every online-search add, after one
   crashed mid-add.** [`cityWrites.ts`](atlas/src/geo/cityWrites.ts). `nextSyntheticId()` read "the
   current closest-to-zero row" and used one less — a read-then-write two overlapping inserts (a
   double-tap, or a second tap landing just before the button's `disabled` state re-rendered) could
   race. Reproduced live: 8 concurrent `addOnlineCity()` calls reliably collided. Surprising finding
   along the way, worth remembering — neither an immediate nor a delayed (15–60 ms) retry of the read
   reliably resolved the race; repeated retries kept reading the same stale "current max" even once the
   winning write had genuinely committed, which reads like Dexie's transaction-zone tracking letting
   sibling calls issued in the same batch share a stale read (waiting didn't fix it, so not a plain
   commit-visibility timing issue). Rather than chase the exact mechanism, removed the read entirely:
   the id is now a random draw from a ~4.3-billion-value negative range (still guaranteed disjoint from
   real positive GeoNames ids; confirmed nothing in the app treats it as sequential — see `git grep
   geonameId`), with a small retry-on-collision loop as cheap insurance rather than the primary defence.
   Verified live: 32 concurrent inserts (mixed online/manual), zero collisions.
6. **No way to see what led up to a crash — the user's own request, mid-session.** Added a durable,
   capped (300-entry) breadcrumb log in a new `debugLog` IndexedDB table
   ([`db/schema.ts`](atlas/src/db/schema.ts) version 2, additive-only — verified live it upgrades an
   existing device's database in place, all 170k+ prior rows untouched), written by
   [`debug/log.ts`](atlas/src/debug/log.ts). Paired with two things the app never had: a top-level React
   `ErrorBoundary` ([`debug/ErrorBoundary.tsx`](atlas/src/debug/ErrorBoundary.tsx)) catching render-time
   errors with the full stack and component stack instead of leaving a blank page, and global `window`
   `error`/`unhandledrejection` handlers ([`debug/globalHandlers.ts`](atlas/src/debug/globalHandlers.ts))
   for exceptions outside React's render. Breadcrumbs added at the handful of points real crash reports
   had actually touched: place status changes, trip creation, city inserts, sync start/failure, route
   changes. Settings → Debug log ([`components/debug/DebugLogSettings.tsx`](atlas/src/components/debug/DebugLogSettings.tsx))
   lists entries newest-first with Copy (clipboard, falling back to "select below" if the API is
   unavailable — confirmed live this fallback fires correctly in a document without focus) and Clear.
   Verified live end to end: forced a real render throw (not a simulated event) and confirmed the
   ErrorBoundary caught it, logged the full trace, and showed a recoverable screen; confirmed the
   300-entry cap trims correctly under a 320-entry burst.
7. **Finer sync-phase breadcrumbs.** [`sync.ts`](atlas/src/sync/sync.ts), same feature, next commit. A
   real crash report showed "sync: started" and then nothing — not enough to know how far it got. Added
   a log line after each phase (`pulled`, `photos done`, `merged`, `applied merge locally` — only when a
   merge write actually happens, `pushed` — only when something changed, `ok`). Verified live against
   mocked Drive responses, both the merge-happens and nothing-to-merge branches, that phases fire in the
   right order.
8. **WorldMap recomputing all ~250 countries' SVG paths on every remount.**
   [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx). Diagnosed from a real debug-log report: a
   ~20 s stretch of dozens of rapid nav events cycling through all four tabs, some under 100 ms apart —
   far faster than physically possible tapping. This app has no programmatic navigation anywhere
   (`grep -rn "useNavigate\|navigate("` across `src` returns nothing — every route change is a real
   click or the browser's own history handling), which rules out a self-inflicted loop and points to
   something external: most likely an OS back-gesture misfiring, or mis-taps as the on-screen keyboard
   reshaped the layout during the fast typing the user described doing right before the crash. Not
   something the app can prevent outright — but `countryPaths` (`d3.geoPath` over every country's
   geometry, the genuinely expensive step) was memoized with `useMemo`, whose cache dies with the
   component instance, so every remount of `/` — the most expensive of the four screens — redid the
   full computation from scratch. `decodeLayer` (`@/components/map/topo`) already caches the
   topo→GeoJSON decode step; path generation itself had no equivalent. Moved to a module-level cache
   keyed by viewport size. Verified live: 30 rapid remounts produced 1 cache miss and 22+ hits, versus
   30 full recomputations before. Colors are read fresh from `countryStatus`/`subdivisionStatus` on
   every render regardless — only the static geometry is cached, confirmed visually (a country set to
   visited still rendered green afterward).

### Edge cases / surprises found

- GIS's OAuth **token client** (`initTokenClient`, as opposed to the ID-token/One Tap flow) implements
  "silent" via a real popup attempt, not a same-origin iframe — undocumented enough to be worth
  restating here for the next person who hits it.
- Mobile OS backgrounding a tab or installed PWA and silently discarding-then-reloading it is common
  enough that it should be assumed, not treated as an edge case, when reasoning about anything that
  depends on in-memory state surviving "the user didn't do anything."
- Dexie's transaction-zone tracking can apparently let *sibling* `db.transaction()` calls issued in the
  same batch share a stale read of another sibling's still-in-flight write — confirmed empirically, not
  fully explained. Worth remembering before writing any other "read current max, write max+1" pattern
  anywhere else in this codebase (none currently exist, per a full-codebase check of `.add(` call sites).
- The unauthenticated GitHub REST API's 60-requests/hour rate limit is easy to burn through when polling
  a slow deploy repeatedly in one session; `github.com/<repo>/actions` (the plain HTML page) isn't
  subject to the same limit and is a fine fallback for a status check.
- GitHub Pages deploy times were unusually variable this session (15 s–6 m 51 s on the same "Deploy to
  GitHub Pages" step, no correlation found with payload size) — infrastructure-side, not this app's
  doing.

### Left undone / open questions

- **The exact trigger of the rapid-navigation storm (fix 8) is not identified**, only ruled out as
  self-inflicted app code. A true instant crash leaves no final breadcrumb by definition, so there is no
  way to fully confirm the WorldMap cache was *the* cause rather than *a* contributing factor. The user
  has been asked to keep using the app and report whether crashes continue.
- **One never-explained log entry**: `nav: /config` appeared once, immediately before a crash-adjacent
  gap in an earlier report — not a route this app defines anywhere (confirmed by reading `App.tsx`'s
  full route list and grepping for "config"). Backgrounding was ruled out by the user directly. Best
  guess is the same external navigation-storm mechanism as fix 8, but unconfirmed.
- **No real end-to-end Google OAuth completion was possible in this sandbox for any of these fixes** —
  the same standing limitation as every prior sync-related phase. The gesture guard, sessionStorage
  persistence, and update-check fixes were each verified as thoroughly as a headless environment allows
  (mocked tokens, forced code paths, live DOM/state inspection), but the definitive test is real,
  continued use on the actual device — which is exactly what surfaced fixes 5 through 8 in the first
  place.
- **Sync's write path (`applyMergedSnapshot`) still does a full clear-and-bulk-add of
  `entries`/`tripEntries` on every merge that changes anything, not a targeted diff.** Not identified as
  a proven problem this session, but worth a look if a future crash's debug log shows `sync: applied
  merge locally` as a recurring point of failure, now that it's individually logged.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**138/138**, unchanged — none of this session's fixes
  were pure functions in the way `merge.ts`/`cascade.ts` are, so each was verified live in the browser
  rather than with new unit tests) clean after every single commit, not just at the end.
- Every fix driven live in a real dev-server browser against real IndexedDB/Dexie, not just read from
  the source: the GIS popup-blocked error reproduced and then confirmed gone; the sessionStorage token
  proven to survive a reload and to correctly fall through to the gesture guard once cleared; the
  geonameId race reproduced with up to 32 concurrent inserts and confirmed resolved; the ErrorBoundary
  tested against a real forced `throw`, not a simulated event; the sync phase log tested against mocked
  Drive responses on both the merge and no-op branches; the WorldMap cache tested by direct hit/miss
  counting across 30 rapid remounts.
- Each commit pushed individually and its GitHub Actions deploy confirmed `completed`/`success` before
  moving to the next fix (one, the debug-log commit, additionally verified by diffing the live deployed
  bundle's contents before and after).
- App/database left in a clean state after every verification pass — test entries, trips, cities and
  debug-log rows cleared, `syncState` and `settings` reset — the same convention every prior phase's
  testing has followed.

### Notes for the next session

- **Settings → Debug log is now the first thing to check for any future crash report.** Ask for a copy
  of it before doing anything else — it now captures phase-by-phase sync detail, not just top-level
  outcomes.
- If crashes persist even after fix 8, the WorldMap cache rules out one real hot spot but the *trigger*
  (see Left undone) is still unknown — worth checking whether the same rapid-nav pattern recurs, and if
  so, whether it's reproducible enough to isolate (e.g. specifically during fast typing, specifically
  near the screen edges, specifically on this one device).
- The `/config` mystery is unresolved and low-priority unless it recurs with more surrounding context
  next time.
- Consider whether `applyMergedSnapshot`'s full clear-and-bulk-add is worth narrowing to a targeted diff
  — see Left undone.

## Map resolution polish — higher-fidelity coastlines (done)

Self-directed polish session, not a numbered phase (same category as Phase 3b): the user reported the
world map's country shapes looked bad, Iceland specifically ("looks terrible"), and asked for higher
resolution generally plus better detail when zoomed in.

### Root cause

Two compounding issues in [`build-geo.mjs`](atlas/tools/build-geo.mjs)'s `buildWorldTopo()`, traced by
directly counting vertices in the committed `world.topo.json`:

1. **The world map sourced Natural Earth 1:50m Admin-0 Countries** — a coarse dataset — while admin-1
   (subdivisions) already used the much finer 1:10m. Nobody had revisited the world-layer source after
   Phase 2 picked it.
2. **A flat `-simplify 8%` is a *global* Visvalingam points budget, not a per-country one.** Visvalingam
   weight tracks effective area, so a landmass the size of Russia consumes most of an 8%-of-all-points
   budget on its own, leaving small, intricate coastlines nearly stripped bare. Measured directly:
   Iceland's polygon held just **19 vertices** — recognizable as a landmass, not as Iceland.

Both causes needed fixing together — a finer source alone would still have been gutted by the same flat
global percentage.

### What was built

- **Source swap**: `SOURCES.neCountries` now points at Natural Earth **1:10m** Admin-0 Countries (same
  nvkelso GeoJSON mirror, just the finer layer) instead of 1:50m.
- **Tiered simplification** replacing the flat 8%: `WORLD_SIMPLIFY_DETAILED_EXCEPTIONS` (`build-geo.mjs`)
  names the large/complex-coastline countries (Russia, Canada, US, China, Brazil, Australia, Kazakhstan,
  India, Argentina, Antarctica, Indonesia, Greenland, Chile) that get simplified harder
  (`WORLD_SIMPLIFY_EXCEPTION_PCT`, 5%); everyone else keeps a much higher rate
  (`WORLD_SIMPLIFY_DEFAULT_PCT`, 25%). Implemented with mapshaper's `-simplify variable percentage=<expr>`
  — a per-feature-adaptive threshold within **one** shared-topology dissolve+simplify pass, so adjacent
  countries' borders still align exactly (verified: DE/FR, DE/AT, DE/PL, US/CA and ES/PT each still share
  the same arc index across the border after the pass — no gap or overlap risk from independent
  per-country simplification, which was the rejected alternative).
- **Chosen empirically**, not analytically: prototyped a dozen mapshaper runs outside the repo (flat
  percentages at several rates, fixed `interval=`, several big/rest percentage pairs for `variable`)
  and picked the pair that gave Iceland real, recognizable detail without letting Russia/Canada/Antarctica
  dominate the byte budget. Chosen numbers, measured on the real committed output:

  | | old (1:50m, flat 8%) | new (1:10m, tiered) | |
  |---|---|---|---|
  | Iceland | 19 vertices | 447 | 23.5x |
  | Norway | 89 | 2,994 | 33.6x |
  | Croatia | 33 | 489 | 14.8x |
  | Greece | 44 | 1,323 | 30.1x |
  | UK | 51 | 1,209 | 23.7x |
  | Japan | 85 | 1,780 | 20.9x |
  | Canada (exception tier) | 669 | 2,555 | 3.8x |
  | Russia (exception tier) | 664 | 3,052 | 4.6x |
  | US (exception tier) | 318 | 1,399 | 4.4x |
  | **world.topo.json total** | **96 KB** | **667 KB** | |

  Raised the hard-fail size budget in `build-geo.mjs` from 500 KB to 900 KB to match (with headroom).
- **Fail-loud earned its keep.** The 1:10m layer separates out 10 administrative/disputed micro-entities
  the coarser 1:50m layer never bothered to carve out — Cyprus's two UK Sovereign Base Areas (Akrotiri,
  Dhekelia), the Cyprus UN buffer zone, USNB Guantanamo Bay, the Southern Patagonian Ice Field, Bir Tawil,
  and four disputed reefs/banks (Spratly Is., Scarborough Reef, Bajo Nuevo Bank, Serranilla Bank). The
  build failed loud naming all ten on the first run against the new source, exactly as designed. Added to
  `EXCLUDE_NE` in [`fixups.mjs`](atlas/tools/fixups.mjs) with the same reason-per-entry convention as the
  three that were already there (Somaliland, Northern Cyprus, Siachen Glacier).
- **Free bonus: Gibraltar and the US Minor Outlying Islands now render.** Both were in `KNOWN_NO_POLYGON`
  (omitted at 1:50m); 1:10m has a real polygon for each, so they graduated out for free. Documented no
  longer-polygon-less territories dropped from 13 to 11. Removed their now-dead `TERRITORY_COORDS`
  fallback entries; left `TERRITORY_OF` untouched since it's checked unconditionally regardless of
  polygon availability (zero behavior change for those two codes either way).
- **Docs updated to match**: [`tools/README.md`](atlas/tools/README.md) (sources/outputs tables, the new
  tiered-simplification explanation, the `EXCLUDE_NE`/`KNOWN_NO_POLYGON` fixup descriptions) and
  [`tools/minor_fixes.md`](atlas/tools/minor_fixes.md) §1 (11 territories, not 13; the vertex-starvation
  problem the section used to describe is fixed, not just the 2 graduated codes).

### On "increased resolution when zooming in"

Worth recording the reasoning since it shaped what *wasn't* built. This map is SVG vector geometry, not
raster map tiles — zooming (`d3-zoom`) applies a scale transform over a fixed set of path coordinates, it
doesn't fetch higher-detail tiles the way Google Maps-style raster/vector-tile zoom does. There is no
"zoom level" to hook a level-of-detail swap onto for the base country shape. The only way an SVG country
polygon "gets better resolution when you zoom in" is if its coordinate data already has enough vertices
that zooming reveals a smooth coastline instead of straight-edge facets — which is exactly what raising
the base vertex count (above) delivers at every zoom level simultaneously, including fully zoomed in.
Roughly checked the numbers: Iceland's ~450 vertices over its real coastline length works out to roughly
10–15 screen-px spacing between vertices at the map's 12x `scaleExtent` max on a typical phone width —
should read as a coastline, not a polygon facet.

This is deliberately **separate** from Phase 3's existing `ADMIN1_ZOOM_THRESHOLD` mechanic (admin-1
subdivision boundaries loading on top of the *selected* country once zoomed past 4x) — that's a different
feature (showing regions within a country you've tapped), already working, and untouched this session.

### Left undone (correctly, out of scope)

- **The 11 remaining `KNOWN_NO_POLYGON` territories** (French Guiana, Guadeloupe, Martinique, Réunion,
  Mayotte, Bonaire/St-Eustatius/Saba, Bouvet, Cocos, Christmas Island, Svalbard, Tokelau) are unchanged —
  `minor_fixes.md` §1 still has the graft-it-later recipe, just renumbered to 11.
- **No code changes to `WorldMap.tsx`, the zoom/pan behavior, or `ADMIN1_ZOOM_THRESHOLD`** — this session
  is entirely a data-pipeline change (`tools/`) plus the regenerated `public/geo/world.topo.json` and
  `countries.json` artifacts. Nothing in `src/` was touched.
- **Admin-1 (subdivision) files were not regenerated or touched** — same source (1:10m) and same
  per-country-independent simplify loop as before; this session's vertex-starvation problem was specific
  to the world layer's old flat-global-percentage approach, which admin-1 never had.
- **Found and deliberately did not ship: `subdivisions.json` regenerates with ~593/3865 rows carrying
  tiny (sub-km to a few km) centroid drift** versus the committed copy, even though `buildAdmin1()` and
  its cached inputs (`admin1CodesASCII.txt`, the NE 10m admin-1 shapefile conversion) are both untouched
  this session and reused straight from `tools/.cache/` unmodified. Same row count, same 3865 ids, just
  different `lat`/`lon` on about 15% of rows, spread across unrelated countries (Angola, Argentina,
  Azerbaijan, Belgium, …) — not something this session's changes could plausibly cause, since nothing
  touched by this session feeds `buildAdmin1`. `git checkout HEAD -- atlas/public/geo/subdivisions.json`
  to keep this session's diff scoped to what it actually changed. One real (and negligibly small) side
  effect of that revert: the US Minor Outlying Islands' 9 GeoNames subdivisions keep using UM's *old*
  fallback centroid (from the now-removed `TERRITORY_COORDS` fixup) instead of the new real-polygon one
  — UM has 0 recorded population and is a display-only fallback per `minor_fixes.md` §2, so this doesn't
  matter in practice. **Left for a future session to root-cause** — worth knowing the cache/pipeline can
  drift from what's committed even with zero relevant code or cached-input changes.

### Verified

- `npm run build:geo` (Node 20) passes fail-loud validation end to end: `250 countries reconciled, 11
  documented no-polygon territories`, 239 country polygons (was 237 — +GI +UM), all subdivision/cities
  output byte-identical in approach (only the world-layer inputs changed).
- Adjacent-country shared borders confirmed intact post-simplify by checking arc-index overlap directly
  in the output topology (DE/FR, DE/AT, DE/PL, US/CA, ES/PT all still share at least one arc) — the
  variable-simplify pass still operates on one shared arc pool, so it can't introduce a border gap the
  way independent per-country simplification would have.
- **Visual verification used direct rendering, not the live app**, because this session's browser
  automation tab came up with `document.hidden = true` / not focused from the start — confirmed this is
  an environment characteristic, not a transient glitch, by stopping and restarting the dev server/tab
  and seeing the identical state both times (a stricter variant of the `ResizeObserver`-in-a-backgrounded-
  tab issue Phases 3/3b/4a already documented; that one was recoverable with a reload, this one wasn't).
  Instead, rendered `world.topo.json` (old, via `git show HEAD:...`, vs. new) through the exact same
  `d3-geo` + `topojson-client` libraries `WorldMap.tsx`/`topo.ts` use, to standalone SVG → PNG (via the
  system's ImageMagick, same tool Phase 1 used for icon generation) for Iceland, Norway, Croatia, Canada,
  Russia and the UK. All six showed dramatic, correct improvement with no rendering artifacts — Iceland's
  Westfjords and Reykjanes peninsula, Norway's fjords, Croatia's Istria-to-Dalmatia coastline, and the UK's
  Scottish islands all went from unrecognizable polygons to genuinely legible coastlines. Confirms the
  data is correct; did not re-confirm in-app chrome (grid lines, status colours, pan/zoom feel) since
  those are unchanged code paths this session never touched.
- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**138/138**, unchanged — no `src/` code touched, so no
  new tests were needed) and `npm run build` all clean. PWA precache size unaffected (934.94 KiB, app
  shell only) — `/geo/*` including the now-larger `world.topo.json` is Workbox runtime-cached, not
  precached, so this doesn't change the install-time download.

### Notes for the next session

- **If another country still looks rough, it's a one-line tuning change**: add its code to
  `WORLD_SIMPLIFY_DETAILED_EXCEPTIONS` if it's ballooning the byte budget, or just raise
  `WORLD_SIMPLIFY_DEFAULT_PCT` if detail is the complaint and 900 KB still has headroom, then
  `npm run build:geo` and re-check the size report.
- **This session's browser automation couldn't visually confirm inside the actual running app** (see
  Verified) — if a future session has a working preview tab, worth a real in-app zoom-and-screenshot pass
  on Iceland as a final sanity check, though the underlying data is now verified correct independent of
  that.
- All four changed files (`tools/build-geo.mjs`, `tools/fixups.mjs`, `tools/README.md`,
  `tools/minor_fixes.md`) plus the regenerated `public/geo/world.topo.json` and `public/geo/countries.json`
  are sitting uncommitted in the working tree as of the end of this session — not committed/pushed, per
  the standing "only commit when asked" rule.

## Map polish — country panel is now an in-map sheet, not a full-screen popup (done)

Another self-directed polish session (same category as 3b / the map-resolution one above). The user
disliked that tapping a country opened a full-screen `CountryDetail` popup — they wanted the same
information and editing, but as something that doesn't hide the rest of the map. Asked three scoping
questions before writing code (panel style, whether tapping should auto-zoom, whether this should also
change the Places-list entry point); all three were answered with the recommended option, which is what's
described below.

### What was built

- **`CountrySheet`** [`src/components/map/CountrySheet.tsx`](atlas/src/components/map/CountrySheet.tsx) —
  a new draggable bottom sheet, opened from the Map tab only. Two snap points
  (`COUNTRY_SHEET_PEEK_VH`/`COUNTRY_SHEET_EXPANDED_VH` — 40vh/88vh, in the new
  [`countrySheetLayout.ts`](atlas/src/domain/countrySheetLayout.ts)), dragged via a handle bar using
  `pointermove`/`pointerup` on `window` (not `setPointerCapture` — window-level listeners already track
  the gesture correctly even if the finger leaves the handle element, which is simpler). Releasing below
  `COUNTRY_SHEET_CLOSE_THRESHOLD_VH` (18vh) closes the sheet instead of snapping to peek — a drag-down-to-
  dismiss gesture. Content (status + why, area/population/capital/regions-visited, cities list, photos —
  add/view/caption/delete) is unchanged from `CountryDetail`, with **one deliberate removal**: no more
  embedded `CountryAdmin1Map` mini-map, because the real map now shows the country's regions in place (see
  below) — showing them twice, once small inside a now-partial-height sheet, would have been redundant.
  **Deliberately no backdrop** — unlike every other sheet/overlay in this app
  (`place-sheet-backdrop`/`full-screen-overlay`), the entire point of this one is that the map stays
  visible and interactive around and above it. Dismissal is the close button, drag-down, tapping the
  now-selected country again, or tapping open ocean on the map.
- **`WorldMap` auto-zooms to frame a selected country** [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx) —
  tapping a country now animates the pan/zoom transform (`selection.transition().call(zoomBehavior.transform,
  target)`, the standard d3-zoom pattern for a smooth programmatic transition — needed adding `d3-transition`
  as an explicit dependency, previously only a transitive one, since nothing in this codebase had called
  `.transition()` on a selection before; see Deviations) to fit the country's bounding box into the space
  **above** the sheet's peek height, comfortably padded (`COUNTRY_FIT_FRACTION = 0.55`) so neighbouring
  countries stay visible around it, not just barely peeking in at the edges. The target scale is floored at
  the existing `ADMIN1_ZOOM_THRESHOLD` (4×) so regions are visible immediately — no separate manual pinch-
  zoom needed the way Phase 3 originally required. Deselecting animates back to the whole-world view.
  `prefers-reduced-motion` skips the transition (instant snap), matching every other animated element in
  this app. The geometry (bbox → target scale/translate, given the viewport and how much of it the sheet
  covers) is a pure, exported, **unit-tested** function,
  [`countryFitTransform.ts`](atlas/src/components/map/countryFitTransform.ts) — see Verified for why.
- **Tapping a region now opens the status sheet directly.** WorldMap's admin-1 overlay previously just
  re-selected the parent country on click (a Phase-3 leftover from when the map was read-only). Now that
  regions render on the primary map instead of a separate always-editable mini-map, `onSelectSubdivision`
  routes the tap straight to `usePlaceSheetStore` — the same one-tap-to-edit behaviour `CountryAdmin1Map`
  already had.
- **Tap-empty-ocean-to-deselect.** The outer `<svg>` gained an `onClick={onDeselect}`; country and
  admin-1 paths now `stopPropagation()` so selecting one doesn't immediately trigger the same handler.
- **Shared the country-detail data-fetching** between the old and new surfaces:
  [`useCountryDetailData.ts`](atlas/src/domain/useCountryDetailData.ts) is the exact query `CountryDetail.tsx`
  used to run inline (status, subdivision statuses, cities, the cascade "why" explanation, rolled-up
  photos), now a hook both `CountryDetail` and `CountrySheet` call — avoids the two surfaces silently
  drifting apart later.
- **`CountryDetail` (Places-list entry point) is otherwise untouched** — same full-screen popup, same
  `CountryAdmin1Map` mini-map, same `countryDetailStore`. There's no map on that screen to keep visible
  behind it, so a full-screen detail view still makes sense there; only the Map tab's own tap behaviour
  changed. `CountryAdmin1Map`/`FullScreenOverlay`/`countryDetailStore` are all still live code, still used,
  just by one caller instead of two now.

### Deviations from what was asked, and why

1. **Added `d3-transition` (+ `@types/d3-transition`) as explicit dependencies (asked implicitly by a
   `tsc` failure, not asked by the user).** `d3-zoom` already pulls in `d3-transition` transitively — it's
   what implements `.transition()` on a d3 selection, needed for the animated pan/zoom — but nothing in
   this codebase had ever called `.transition()` before, so neither the runtime patch nor (more
   immediately) the TypeScript module-augmentation that adds `.transition()` to `Selection`'s type were
   ever pulled in. `tsc -b` caught this immediately (`Property 'transition' does not exist on type
   'Selection<...>'`). Installed both explicitly, following the same "explicit direct dependency, not a
   relied-upon hoisted transitive" precedent Phase 3 already set for `d3-geo`/`topojson-client`, plus a
   bare `import 'd3-transition'` side-effect import in `WorldMap.tsx` (needed for both the type
   augmentation and the runtime prototype patch — a type-only import wouldn't have been enough).
2. **`zoom.transform()` does not itself clamp to `translateExtent` the way a real drag/wheel gesture
   does — traced this in `node_modules/d3-zoom/src/zoom.js` rather than assuming.** A hand-built transform
   passed to `zoomBehavior.transform(selection, t)` is applied verbatim; the `constrain()` wrapping that
   keeps pan/pinch from going off-world only happens inside the gesture-specific handlers (wheel, drag,
   touch), not in the public `.transform()` API. Fixed by calling the zoom behaviour's own configured
   `.constrain()` function directly on the hand-built transform, passing it the same `.extent()`/
   `.translateExtent()` the live behaviour is already configured with (`zoomBehavior.constrain()(raw,
   zoomBehavior.extent().call(svgEl, undefined), zoomBehavior.translateExtent())`) — reuses d3's own
   logic exactly rather than re-deriving the clamp math by hand, which would have been easy to get subtly
   wrong in a way this session couldn't visually catch (see Verified).

### Left undone (correctly, per the answered scope questions)

- **The Places-list entry point still opens the old full-screen `CountryDetail`** — by design (see
  Deviations/"What was built" above), not an oversight.
- **No snap-point animation "peek" beyond two fixed heights** (no velocity-based fling physics, no
  intermediate "half" state) — two snap points plus free internal scrolling at either height covers the
  same content reachability with much less code; revisit only if it feels wrong in practice.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**143/143** — 5 new, for
  `countryFitTransform.test.ts`), and `npm run build` all clean.
- **`countryFitTransform.ts`'s geometry is unit-tested** (centering, correctly picking the more
  restrictive of width/height so the bbox never overflows either axis, clamping up to `minScale` for a
  tiny country and down to `maxScale` for a huge one, and that a taller sheet correctly shrinks the framed
  area) — this is the one part of this session's interactive feature that could be verified rigorously
  without a browser.
- **No live in-app interaction was possible this session.** This session's browser automation tab came up
  with `document.hidden = true` / not focused from the very first check, same as the map-resolution
  session earlier — except this time restarting the dev server *and* starting an entirely fresh tab still
  produced the identical state both times, confirming it's this session's environment, not anything
  page- or reload-related. Since `WorldMap`'s `ResizeObserver` never fires in a hidden tab, `size` stays
  `{0,0}` and *nothing* renders (zero `path.world-map__country` elements) — there was no path to a partial
  screenshot-based check the way the geo-resolution session found one (that one didn't need live
  interaction, just static rendering of committed data through the same libraries; this session's feature
  is fundamentally about live drag/tap/animation, which has no equivalent offline substitute). Compensated
  with: (a) the unit-tested geometry above, (b) tracing `d3-zoom`'s actual source in `node_modules` rather
  than assuming API behaviour (see Deviation 2), and (c) a full manual re-read of all three touched/new
  files afterward, specifically checking hook ordering (all hooks run before any early return, in every
  component), prop wiring end-to-end (confirmed `<WorldMap` has exactly one call site via `grep`, so
  `tsc -b`'s clean pass genuinely covers every usage), and CSS class-name cross-references between the
  `.tsx` and `.css` files.

### Bug fix: the auto-zoom centered on a country plus all its scattered territories

Reported by the user immediately after confirming the sheet itself worked: tapping France didn't centre
on France, it centred on some point that also accounted for French Guiana, Guadeloupe, Martinique,
Réunion and Mayotte — because those don't have a separate polygon at this map resolution (§ the
map-resolution session above), so they're literally fused into France's own `MultiPolygon` geometry.
`pathGen.bounds(feature)` was computing a bounding box across *all* of that — mainland Europe to South
America to the Indian Ocean — and framing the midpoint of that box, not France. The user guessed
correctly that the USA had "probably" the same problem, for a related but distinct reason: Alaska and
Hawaii are genuinely, integrally part of the US (no fixup involved), but they blow up the bounding box
the same way.

**Checked how widespread this actually is before fixing it**, rather than special-casing France and the
USA: wrote a one-off script against the real committed `world.topo.json` computing, per country, what
fraction of its total polygon area the single largest piece accounts for. **Over 40 countries** have no
single piece holding a clear majority of their area or are otherwise multi-piece enough to be worth
checking — from obvious cases (France 84.6%, the US 84.0%, the UK 89.8%, Norway, Denmark) down to
genuine multi-island nations with *no* dominant piece at all (Indonesia's largest single island is only
28.6% of its total area; the Bahamas, Solomon Islands, Vanuatu are similar).

**Fix**: [`dominantLandmass.ts`](atlas/src/components/map/dominantLandmass.ts) — if one polygon piece
is a strict majority (>50%) of the country's total area, frame *that piece only*; otherwise (Indonesia
and the other genuine archipelagos) there's no principled "main" piece to prefer, so fall back to the
full geometry exactly as before. One general rule, no per-country list to maintain. Wired into
`WorldMap.tsx`'s auto-zoom effect ahead of the existing bounds/fit calculation.

Unit-tested (`dominantLandmass.test.ts`, 6 cases: isolates a clear majority, returns null for a
genuine near-even split, both trivial single-piece shapes, insensitive to which order the pieces are
listed in, and the exact threshold boundary). **Writing these caught a real bug in the test fixtures,
not the implementation**: `d3-geo`'s `geoArea` is a spherical calculation sensitive to ring winding
order — my first attempt at synthetic test polygons wound them backwards, which `geoArea` interprets as
"the area of everything *except* this ring" (returned ~4π, i.e. almost the whole sphere, for a
deliberately tiny test box) rather than throwing, so the bug silently inverted which piece looked
"biggest" in three of the six tests. Caught by the tests actually failing, not by inspection — verified
the correct winding empirically against real topojson data (every genuine ring in `world.topo.json`
reports a small, sane area) before fixing the fixtures. The production code itself was never affected,
since real topojson/mapshaper output is always correctly wound.

**This time, live browser verification was actually possible** — the tab came up focused
(`document.hidden: false`) partway through this fix, unlike both of the prior sessions above. Clicking
France live: `<g transform>` came back `translate(-2164.41,-2540.13) scale(12)`; hand-checked against
mainland France's real bbox at this exact viewport, the resulting screen position of the bbox centre
matched the target point *exactly* (195.0, 170.7 — screen-centre horizontally, vertically centred in the
space above the sheet, not the full viewport). Screenshot confirmed it visually: France framed with its
own regions visible and Britain/Spain/Italy/Germany still visible around it, sheet showing "13 regions,
547,030 km², Paris" without covering the map. Same live check for the US: framed on the CONUS with
Canada/Mexico visible, no Pacific/Atlantic dead space from Alaska or Hawaii. Also exercised, live, for
the first time: tap-open-ocean correctly deselects and animates back to `translate(0,0) scale(1)`; tap a
region (tested on Washington state) correctly opens the place-status sheet with the right breadcrumb
("United States"), not the old do-nothing re-select. Zero console errors through the whole sequence.

### Notes for the next session

- **The France/USA framing bug is fixed and, unlike the rest of this session's feature, has now actually
  been confirmed live in a browser** — see the bug-fix section just above. The broader drag/snap-point
  feel (handle dragging, drag-to-dismiss) still hasn't been touched by a human or a working browser; try
  that next if a preview tab is available.
- If the drag feels laggy or janky on a real device, the likely first suspect is the `isDragging` ?
  `'none'` : CSS-transition toggle in `CountrySheet.tsx` not actually suppressing the transition during
  active drag (should be instant 1:1 tracking, no easing, while a finger is down).
- `d3-transition` is now a real dependency — if a future session sees an unexpectedly large main bundle
  chunk warning grow further, this plus `d3-transition`'s own dependencies (`d3-timer`, `d3-ease`,
  `d3-interpolate`, `d3-color`) are new weight added this session, on top of the pre-existing >500KB
  warning `npm run build` already prints (unrelated, pre-existing, not investigated either session).

## Map interaction polish — uncapped zoom, no auto-zoom on tap, phone-friendly selection outline (done)

Another self-directed polish session, driven by three specific user complaints rather than a written
brief: the 12× pinch-zoom ceiling felt limiting, the auto-zoom-on-tap added by the previous "in-map
sheet" session was unwanted (the user wants a tap to open the sheet without the map moving under it),
and the tap/hover outline that marks the selected country "doesn't look as good" on a phone as it does
hovering with a mouse. No scoping questions were asked — all three reads were unambiguous enough to
implement directly (see Deviations for the judgment calls made along the way).

### What was built

- **No cap on zooming in** [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx) —
  `d3zoom().scaleExtent([1, 12])` → `scaleExtent([1, Infinity])`. The lower bound (`1`, can't zoom out
  past the whole-world fit) is untouched; only the upper bound was a user complaint.
- **Tapping a country no longer moves the map.** The entire "auto-zoom on select" `useEffect` — added
  by the previous session to animate-and-frame a tapped country above the country sheet — is deleted.
  Tapping a country still does exactly what it did before that effect existed: opens `CountrySheet` and
  (once the current, user-controlled zoom is already past `ADMIN1_ZOOM_THRESHOLD`) loads and colours its
  admin-1 regions. Deselecting (close button, drag-down, tapping the same country again, tapping open
  ocean) likewise no longer animates back to the whole-world view — there is no automatic zoom in either
  direction now, matching "just do everything like now but not the automatic zoom in" literally.
- **A visible, phone-reliable outline for the selected country** [`WorldMap.css`](atlas/src/components/map/WorldMap.css)/[`.tsx`](atlas/src/components/map/WorldMap.tsx) —
  the root cause of "the outline doesn't look as good on phone" is that it was pure `:hover`: a 0.5px
  hairline that flips from `--abyss` to `--haze`, driven by a pseudo-class touchscreens only
  approximate (no real hover state on a finger; browsers simulate "hover until the next tap elsewhere"
  inconsistently, which reads as sticky or missing rather than deliberate). Fixed with two changes
  working together: (1) `:hover` is now gated behind `@media (hover: hover) and (pointer: fine)`, so a
  touch device never relies on the simulated version at all; (2) the tapped/selected country — tracked
  by the existing `selectedCode` React state, not a pointer pseudo-class — now gets an explicit
  `world-map__country--selected` class rendering a `2px` `--chalk` stroke (4× the default width, and the
  brightest colour in the quiet palette), so the "this one is open" signal is deliberate, stable, and
  identical on mouse and touch alike. Written as the compound selector
  `.world-map__country.world-map__country--selected` specifically so it outranks the (still-present, for
  desktop) `:hover` rule on specificity rather than depending on source-order luck for the common desktop
  case of "still hovering the country you just clicked." `fill`'s existing transition grew two siblings
  (`stroke`, `stroke-width`) so the new state eases in instead of popping; the existing
  `prefers-reduced-motion` override (`transition: none`) still blanket-disables all three.

### Deviations from what was asked, and why

1. **Deleted `countryFitTransform.ts`/`.test.ts` and `dominantLandmass.ts`/`.test.ts` outright, plus the
   `d3-transition`/`@types/d3-transition` dependency pair (not asked; a direct consequence of task 2).**
   All four files were purpose-built for the auto-zoom-on-select feature the previous session added
   (confirmed by `grep -rn` across `src/` before deleting — `WorldMap.tsx` was their only caller outside
   their own tests), and `d3-transition` was added to `package.json` by that same session purely to get
   `.transition()` on a d3 selection for the animated pan/zoom. With the feature gone, all four are dead
   code and an unused dependency, not speculative future value — left in place they'd be exactly the kind
   of orphaned code this project's own conventions (see e.g. Phase 4a/4b's "nothing else may write to
   `entries`" and repeated dead-code removals through Phase 7b) argue against keeping. `npx tsc -b`,
   `npx eslint .` and `npx vitest run` were all confirmed clean after the deletions, and `d3-transition`
   remains in `package-lock.json` as a transitive dependency of `d3-zoom` itself (which still needs it
   internally) — only the project's own *direct*, explicit dependency on it was removed.
2. **The stroke colour/width for `--selected` (`--chalk`, 2px) is a judgment call, not specified by the
   user.** Picked from the existing token set (no new colour introduced, per the "no component may
   hardcode a colour" rule in `tokens.css`) as the brightest available option against the dark map, at a
   width clearly distinct from every other stroke on the map (ocean/grid have none, default country
   border is 0.5px, subdivision borders are 0.75px) without introducing a glow/shadow effect that would
   sit oddly against this app's deliberately quiet, hairline/instrument-panel visual language. Easy to
   retune (two CSS values) if it doesn't land right on a real device.
3. **Scope stayed on countries only, not admin-1 subdivisions.** The user's third point named "a
   country" specifically, and unlike `selectedCode`, WorldMap has no persistent "selected region" state
   to hang an equivalent class on — `onSelectSubdivision` fires-and-forgets straight to opening the
   place-status sheet. Adding one would be a bigger, unrequested change; subdivisions keep their existing
   unconditional (ungated) styling, which has no `:hover` rule to begin with.

### Left undone

Nothing from the three requests — all three are implemented as asked. Nothing else on the map was
touched (admin-1 threshold, pan clamping, grid backdrop, ocean fill all untouched).

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**138/138** — down from 149, i.e. exactly the 11 tests
  that belonged to the two deleted test files, nothing else moved), and `npm run build` all clean.
- **Live in-app interaction was blocked again this session** — same `document.hidden: true` /
  `ResizeObserver`-never-fires environment issue the map-resolution and country-sheet sessions both hit
  and documented above. Tried harder than either of those sessions before giving up on it: a full page
  reload (worked for a much earlier session, didn't here), resizing the viewport to force a fresh
  `ResizeObserver` delivery, and directly monkey-patching `document.hidden`/`visibilityState` to `false`
  plus dispatching synthetic `visibilitychange`/`resize`/`focus` events — the tab still reported
  `document.hidden: true` throughout and the map SVG never received a real size (`viewBox` stuck at
  `"0 0 1 1"`). This confirms it as genuine renderer-level backgrounding beneath what page JS can
  override, not something worth chasing further from inside the page.
- **Compensated with direct proof against the live bundle instead of the rendered map**, one level more
  rigorous than a plain code read: confirmed the exact new CSS rules are present in the browser's real
  `document.styleSheets` (not just in the source file), then built a real `<path>` element with
  `class="world-map__country world-map__country--selected"` from scratch (a fresh element, not a mutated
  one — an initial attempt that mutated an existing element's class and re-read `getComputedStyle`
  returned stale values, itself another symptom of the same hidden-tab throttling rather than a real bug,
  confirmed by the fresh-element version giving the correct answer immediately) and read its
  `getComputedStyle` back: `stroke: rgb(233, 238, 240)` (exactly `--chalk`) and `stroke-width: 2px`,
  versus `rgb(12, 18, 22)` (exactly `--abyss`) and `0.5px` for `.world-map__country` alone — proves the
  selector, specificity and token values all resolve exactly as designed. Also confirmed the full,
  correctly-scoped `@media (hover: hover) and (pointer: fine) { .world-map__country:hover { ... } }`
  rule is present verbatim in the live stylesheet.
- Also manually re-read the entire touched file end-to-end afterward (hook ordering, dependency arrays,
  that no reference to the deleted effect/helpers survives anywhere, prop wiring into `MapScreen.tsx`)
  — the same compensating technique the country-sheet session used under the identical blocker.
- **Not independently re-confirmed this session**: that pinching past 12× on a real device actually keeps
  going smoothly (no d3-zoom internal issue with an `Infinity` bound) — reasoned from `d3-zoom`'s source
  (`Math.min`/`Math.max` clamping, which is well-defined for `Infinity`) rather than observed directly,
  since no live gesture could be driven this session either.

### Bug fix: selected country's outline was hidden along shared borders with other countries

Reported by the user immediately after the pass above, with two concrete examples: Morocco's new
outline only showed up against open ocean, not against Algeria or Western Sahara; and of Senegal and
Mauritania, only Mauritania displayed a full outline.

**Root cause**: SVG paints sibling elements strictly in document order, and `countryPaths` is ordered
however the topology's `objects.countries.geometries` happens to list them — arbitrary with respect to
which country is selected. Two adjacent countries' polygons each carry a stroke centered on their shared
border; whichever one paints *later* in that fixed order covers the earlier one's stroke (and a sliver of
its fill) along that edge. The ocean always paints first, so a coastline was always safe — a land border
was only safe if the selected country happened to already sit later than its neighbour in the dataset's
incidental order, exactly matching both reported examples (Mauritania apparently sorts after Senegal in
the source data, so it "worked" by accident; Morocco and Senegal did not).

**Fix** [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx): a new `orderedCountryPaths` memo,
derived from `countryPaths` (which itself stays cache-stable — only the rendering order changes) and
used only for the JSX `.map()`, moves the selected country (if any) to the very end of the paint order
every time selection changes, guaranteeing nothing paints over its outline on any side, coastline or
land border alike. React's keyed reconciliation moves the one affected DOM node rather than remounting
anything, so this is cheap.

**Verified live this time**, unlike the pass above — this session's preview tab came up focused partway
through fixing this (`document.hidden: false`), the same kind of lucky timing the France/USA framing
session (in the original in-map-sheet session, above) had. Selected Morocco, Senegal and Mauritania in
turn and confirmed programmatically that each becomes the last child in paint order (out of 240: ocean +
239 countries) the instant it's selected, then captured real screenshots zoomed on each: Mauritania shows
a complete bright outline against Western Sahara, Algeria, Mali *and* Senegal simultaneously, and Senegal
shows the same including specifically its Mauritania border — the exact pair reported broken. Also
re-ran `npx tsc -b`, `npx eslint .` and `npx vitest run` (138/138) clean after the fix, since the earlier
`orderedCountryPaths` draft (using `.splice()` + array destructuring) failed `tsc` under this project's
`noUncheckedIndexedAccess` — rewritten with `.find()`/`.filter()` instead, which needs no non-null
assertion and reads more plainly as "everything else, then the selected one."

One tooling wrinkle worth recording for the next session, not an app issue: `preview_screenshot` was
flaky again in exactly the way Phase 3b and others already documented (stale/desynced frames), including
one screenshot that showed a *deselected* map while a same-moment direct DOM query confirmed a country
was still genuinely selected — most likely the screenshot tool's own stale-frame recovery mechanism
synthesizing a tap that landed on the map and deselected it, though this wasn't confirmed directly. A
throwaway `1+1` eval between changing state and screenshotting reliably produced a fresh frame, the same
workaround Phase 3b found. Trust a direct DOM/eval query over a screenshot if the two ever disagree.

### Bug fix: the higher-resolution map from an earlier session never reached the user's phone

Reported after committing/pushing/deploying this session's work: the user's installed PWA still showed
the old, coarse country shapes from before the "Map resolution polish" session (above), despite that
session's commit (`b4ec009`) being on `main` and genuinely deployed.

**Checked deployment first, since the user suspected it** — confirmed innocent. `git show --stat
b4ec009` shows `world.topo.json`/`countries.json` were committed; a live `curl -I` against the deployed
`.../geo/world.topo.json` returned `content-length: 682705`, byte-identical to the local, post-upgrade
copy; the GitHub Actions run for the latest push showed `status: completed, conclusion: success`. The
server has always had the right file.

**Root cause is client-side**: [`vite.config.ts`](atlas/vite.config.ts)'s Workbox `runtimeCaching` rule
for `/geo/.*` used `CacheFirst` with a one-year `maxAgeSeconds`. `/geo/*` isn't part of the precached,
content-hashed app shell (`globPatterns` only covers `js,css,html,ico,png,svg,woff2` — deliberate, so a
fresh install doesn't have to pull the full geo payload before showing a screen), so it only ever gets
cached lazily via this runtime rule under a plain, unversioned URL. `CacheFirst` means *never check the
network again once cached* until the entry's own expiration — a device that had already cached the old
`world.topo.json` (any device that had opened the app before the resolution-upgrade deploy) would go on
serving that same stale response forever, through every later app update, since updating the service
worker's precached JS/CSS doesn't touch a separately-named runtime cache at all.

**Fix**: switched the `/geo/*` rule to `StaleWhileRevalidate` (serves the cached copy instantly, same
offline-first behaviour, but also fires a background fetch to refresh the cache for next time — so a
data change now reaches an installed device within one extra app-open instead of never), and bumped the
cache name to `atlas-geo-cache-v2` so devices already carrying the old, permanently-stale `CacheFirst`
entries get a clean cache bucket immediately on their next update rather than needing `Stale...` to
slowly work through data that would otherwise never be revisited. Documented the mechanism and the
"bump the cache name for an instant, not one-open-later, propagation" lever in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md) §3, since this is a general property of how geo-data updates
now reach installed devices, not a one-off.

**Verified**: `npx tsc -b`, `npx eslint .`, `npx vitest run` (138/138) clean; `npm run build` then
grepped the generated `dist/sw.js` directly and confirmed it registers
`new StaleWhileRevalidate({cacheName:"atlas-geo-cache-v2", ...})` for the `/geo/.*` route — the actual
compiled Workbox output, not just the source config. **Not verified**: that this specific fix, once
deployed, actually clears the *user's own phone's* stale cache and shows the sharper coastlines — that
needs the user to update the installed app and check, the same standing limitation every sync/PWA change
in this project has had (no real device reachable from this sandbox).

### Bug fix: two Natural Earth admin-1 polygons could share one GeoNames id, so setting a region's status could colour a second, unrelated shape

Reported with a screenshot: after marking Iceland's Southern Peninsula visited, a small disconnected
green sliver also appeared elsewhere on the island. The user correctly guessed it wasn't one-off — it
also appeared in Norway, and the colour always tracked *whichever region had the highest status rank*
across the country, not a fixed wrong spot.

**Root cause, confirmed against the raw source data, not guessed**: [`tools/build-geo.mjs`](atlas/tools/build-geo.mjs)'s
`buildAdmin1()` derives each admin-1 polygon's id as `p.gn_a1_code || p.iso_3166_2 || p.adm1_code` — but
Natural Earth's *own* `gn_a1_code`/`gn_id` cross-reference to GeoNames occasionally links two genuinely
different polygons to the same GeoNames entry. Checked directly against `tools/.cache/ne_10m_admin_1.geojson`:
Iceland's "Reykjavík" and "Höfuðborgarsvæði" (Capital Region) features both carry `gn_id: 3426182` and
`gn_a1_code: "IS.39"` — a genuine upstream NE data error, not something this build script introduced, but
one it faithfully propagated. Since the app's admin-1 rendering keys everything off that `id`
(`subdivisionStatus.get(p.id)` in [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx)), two
differently-shaped, differently-located polygons ended up reading from the exact same map entry — setting
a status on the one real, selectable subdivision that id represents (`IS.39` = Capital Region) painted
*both* NE shapes, and because it's a live lookup against whatever status that id currently holds, the
wrongly-duplicated shape necessarily tracks the same (highest-rank, cascade-derived) value as the real one,
exactly matching "follows whichever region has the highest rank."

**Confirmed live before writing any fix** — reproduced in this session's browser (not assumed): queried
`db.subdivisions` for Iceland (8 real rows), then decoded the admin-1 topology directly and found **9**
features, with `id: "IS.39"` printed twice (`Reykjavík` and `Höfuðborgarsvæði`). Cross-checked Norway's
admin-1 topology the same way and found **zero** id collisions there (21 unique ids) — the specific
mechanism the user hit doesn't reproduce for Norway with this data, so if Norway shows something similar
it likely has a different cause; not chased further since it couldn't be reproduced.

**Checked how widespread this actually is before fixing it** — the same investigative discipline the
map-resolution session used for the France/USA framing bug. Wrote a one-off script (scratchpad, not
committed) decoding every committed `admin1/<CC>.topo.json` and grouping features by id per country:
**23 countries, 170 duplicated features across 33 id groups** — far beyond an Iceland-only glitch. Two
distinct upstream shapes, both traced to raw NE properties:
- **A literal "no match" sentinel treated as a real id.** NE stores `gn_a1_code: "AI."` (bare
  `{ISO2}.` with nothing after the dot) plus `gn_id: -99` or another negative value when it has *no*
  confident GeoNames link — e.g. all 15 of Anguilla's districts, all 32 of the London boroughs the GB
  regions dissolve absorbed. `p.gn_a1_code || ...` treats that non-empty string as valid and picks it
  first, so every such feature in a country collapses onto the same `"CC."` id. None of these correspond
  to a real row in `subdivisions.json` either way (GeoNames doesn't subdivide that finely), so this class
  was never reachable via a real user-set status — a data-fidelity gap, not the reported correctness bug.
- **A genuine NE cross-reference duplicate onto a valid, real id** — Iceland's case, and the one that
  actually mis-colours a real, user-settable region. Also hit Australia (NSW/Lord Howe Island), the UK
  (Cornwall/Isles of Scilly), Croatia, Hungary (five county/city pairs), Nauru, French Polynesia, the
  Philippines, Mauritius and Barbados.

**Fix** [`tools/build-geo.mjs`](atlas/tools/build-geo.mjs): added `-dissolve id copy-fields=name` to each
country's mapshaper pipeline, immediately before simplification — the same technique `buildWorldTopo`
already uses to merge a country's scattered territories into one feature per `code`. Any features sharing
an id (either root cause above) now merge into one (Multi)Polygon feature, guaranteeing the 1:1
id↔shape correspondence the rest of the app assumes; countries with no collisions are unaffected (a
group of size 1 dissolves to itself). Added a **fail-loud post-check** — decode each country's freshly
written topology and assert no id repeats — so a future re-download that introduces a *new* NE
cross-reference error, or any case this dissolve doesn't actually resolve, breaks the build instead of
silently shipping, matching this project's established convention (Phase 2's join validation, the
map-resolution session's `EXCLUDE_NE` check). The size report now also logs how many groups/features
were merged.

Deliberately **did not** also fix the "bare sentinel" class (falling through to `iso_3166_2`/`adm1_code`
for a real distinct id per feature) — those features can never be individually selected or coloured
either way (no matching `subdivisions.json` row), so it's a detail/fidelity improvement, not a
correctness fix, and expanding scope there risked second-guessing data this session hadn't fully audited.
Left as a candidate for a future session; `dissolve` still fully neutralises the bug for that class today
by merging them into one inert, always-grey shape per country instead of leaving them free to collide.

**Verified**: `npm run build:geo` (Node 20) completed clean — `admin1 id collisions fixed: 33 groups /
170 features` logged, zero fail-loud exits. **Independently re-scanned the regenerated output** with a
fresh copy of the diagnostic script (not the build's own internal check): 240 files, 4,447 total admin-1
features, **zero remaining id collisions anywhere**. Iceland specifically: exactly 8 features now (was
9), each with a distinct id. Reproduced the original bug's exact repro live, post-fix: reloaded the
running app, re-selected Iceland, zoomed past the admin-1 threshold — 8 subdivisions render (not 9),
`Suðurnes` and the merged `IS.39` shape both show `--visited` correctly (both really are visited in the
test data) with no third, disconnected shape anywhere on the island; screenshotted and visually confirmed
clean. `npx tsc -b`, `npx eslint .`, `npx vitest run` (138/138) and `npm run build` all clean afterward
(this fix only touches the Node build tool, no `src/` change, so no test count change).

Also **bumped the geo runtime-cache to `atlas-geo-cache-v3`** (see the fix immediately above this one) so
this reaches the user's phone on the very next open rather than the one after, since they're actively
verifying.

### Bug fix: the selected country's own fill showed through tiny gaps in its admin-1 coverage, coloured by the country's aggregate status

The user came back with photos after the fix above shipped: **this was not what they had originally
reported.** The id-collision bug was real and worth fixing, but a small colour-shifting fleck near
Iceland (and, per the user, scattered "all over" Norway when zoomed in close) was still there. Their own
diagnosis, quoted because it was exactly right: *"this only happens in the spaces that the border of the
country is not inside the country where regions meet, it is in the meet point of the edge of the country
and the regions."*

**First chased a red herring, worth recording so it isn't re-chased.** `elementFromPoint` on the exact
pixel of the stray dot near Iceland in this session's own repro returned a `.world-map__country` element
titled **"Norway"**, not Iceland — decoding `world.topo.json`'s Norway feature directly confirmed it's a
102-piece `MultiPolygon` including a piece at `lon -9.12..-7.96, lat 70.81..71.18`, i.e. **Jan Mayen**
(and, separately, a piece near 54°S that's Bouvet Island) — both real Norwegian territories fused into
Norway's polygon for want of their own, same pattern as France's overseas départements. Confirmed it was
irrelevant to Iceland by changing Iceland's status and checking that exact dot's fill: unchanged, because
it's genuinely Norway's own status, coincidentally near Iceland on the map. Also, separately, unrelated:
the very first re-check after this session's `-dissolve` fix landed briefly stopped rendering the map at
all after a `WorldMap.tsx` edit triggered Vite HMR — the pan/zoom `<g>` element's `transform` attribute
had been set manually (for earlier screenshot framing) rather than through `d3-zoom`'s own API, so d3-zoom's
*internal* tracked transform never matched the DOM, and real wheel events compounded on the stale internal
value instead of the visible one — scale hit **25,531×** and then **96,617×** off what looked like small
wheel batches. Not a product bug (a real pinch gesture always goes through d3-zoom's own state correctly);
just a lesson for hand-testing zoom via injected events — reload rather than mixing manual `setAttribute`
transform hacks with subsequent real gesture events.

**Real root cause, confirmed geometrically before touching any code**: `world.topo.json` (the country
outline) and `admin1/<CC>.topo.json` (that country's regions) are two **independently digitised and
independently simplified** traces of the same real coastline — different Natural Earth layers
(`ne_10m_admin_0_countries` vs `ne_10m_admin_1_states_provinces`), processed in entirely separate
`mapshaper` passes with no shared topology between them. They were always going to disagree by a little;
the "Map resolution polish" session (above) made Iceland and Norway's *world*-layer coastlines dramatically
more detailed (Iceland 19→447 vertices, Norway 89→2,994) without touching the *admin-1* layer at all,
which is exactly what turned a previously-negligible mismatch into something visible. Measured directly:
Iceland's world-layer polygon is only **0.03% larger in area** than the union of its 8 admin-1 regions —
tiny in aggregate, but concentrated into **263 individual pixel-level gap points** along the coastline at
the zoom level tested (a 1px scan over Iceland's ~109×40px bounding box), each one large enough to be its
own visible fleck once zoomed in close. Confirmed live, decisively, that this — not the id collision — is
what the user actually saw: at one fixed such gap point, `elementFromPoint` returned the **Iceland country
path itself** (`.world-map__country`, title "Iceland"), and toggling Southern Peninsula's status between
`lived` and `wishlist` flipped that exact point's fill between `var(--lived)` and `var(--visited)` — i.e.
it tracks Iceland's own cascade-derived aggregate status (plan §5.3's `max` rule), exactly matching
"follows whichever region has the highest rank" from the original report and the green→orange change
between the user's two photos.

**Fix** [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx): rather than reconciling the two layers'
geometry (a much bigger lift — see Left undone), stop the *selected* country's own path from rendering its
status colour at all once its admin-1 regions are actually covering it (`admin1Paths.length > 0`, the same
condition that gates the overlay itself). It renders `UNVISITED_COLOR_VAR` (`--contour`) instead — the same
neutral tone every unmarked area of the map already uses, so a gap now reads as an unremarkable seam
instead of a phantom, rank-following status. Scoped tightly: a country that's merely *selected* but not yet
zoomed past the admin-1 threshold still shows its real status colour exactly as before (verified — see
below), since there's no overlay yet to explain a grey country.

**Verified live**, same rigor as the id-collision fix: reproduced the exact repro (Southern Peninsula
lived, Capital Region visited, zoomed into Iceland past the admin-1 threshold), re-ran the 263-point gap
scan, and confirmed every gap point's resolved fill is now `var(--contour)` — not a status colour, and not
changing as statuses change. Separately confirmed the *unselected-zoom* case is untouched: zoomed back out
below `ADMIN1_ZOOM_THRESHOLD` (subdivisions stop rendering) and confirmed Iceland's own fill reverts to its
real `var(--lived)` status colour, not stuck grey. `npx tsc -b`, `npx eslint .`, `npx vitest run` (138/138)
clean. **`preview_screenshot` was unusable for this whole investigation** — the tab reported
`document.hidden` flipping between `true`/`false` unpredictably across the session (not something this
session's code could influence) and the tool timed out repeatedly once it went hidden again; every claim
above is backed by direct DOM/`getComputedStyle`/`elementFromPoint` queries instead, which stayed reliable
throughout even when screenshots weren't.

### Left undone (correctly, out of scope for this fix)

- **The underlying geometry still doesn't match pixel-for-pixel** — this fix hides the *symptom*
  (misleading colour) completely, but at extreme zoom a keen eye could still see a faint neutral-toned seam
  where a gap is. The root-cause fix would be clipping each country's admin-1 `FeatureCollection` to that
  *same, already-simplified* world-layer polygon at build time (`mapshaper -clip`, reusing
  `buildWorldTopo`'s own per-country output as the clip mask so the two layers are guaranteed to agree
  exactly, not just approximately) — a real build-pipeline project, not a one-line fix: `-clip` alone only
  trims admin-1 where it *overhangs* the country edge, it doesn't extend admin-1 to *fill* a gap, so a
  correct implementation needs `buildWorldTopo` to expose its per-country boundary for `buildAdmin1` to
  consume, which today it doesn't. Worth doing if the neutral-fill workaround ever feels insufficient.
- **Norway's version of this was not separately reproduced this session** (Iceland's repro was decisive
  enough on its own to diagnose and fix the general mechanism), but the same root cause fully explains it —
  Norway's *world*-layer coastline also went through the same detailed-vs-untouched-admin-1 change in the
  "Map resolution polish" session, and it has a far longer, far more fjord-complex coastline than Iceland's,
  so more gap points is exactly what the mismatch mechanism predicts, matching "dots... all over Norway."

### Notes for the next session

- **This session shipped three separate, real fixes for what started as one bug report**: the admin-1
  id-collision (Iceland/Reykjavík+Höfuðborgarsvæði and 22 other countries), the geo-cache staleness that
  was blocking the *previous* session's resolution fix from ever reaching the phone, and this
  gap-shows-through-fill issue — verify all three actually reached the user's device once they've reopened
  the app (the cache fix means this should now be one reopen away, not two).
- **If the neutral-fill workaround ever feels insufficient** (visible seams bother someone at extreme
  zoom), the real fix is clipping admin-1 to the world layer's own per-country boundary at build time — see
  "Left undone" above for exactly what's missing to do that (`buildWorldTopo` doesn't currently expose its
  per-country GeoJSON for `buildAdmin1` to consume as a clip mask).
- **The "bare sentinel" admin-1 id class is a real but lower-priority gap, not chased this session** (see
  the id-collision bug fix above): ~16 of the 23 affected countries have NE features whose `gn_a1_code`
  is a "no GeoNames match" placeholder (`"CC."` + a negative `gn_id`) rather than a real code. They're
  dissolved into one inert per-country blob today rather than colliding, which fixes the correctness bug,
  but a future session could give each a distinct id via the already-present, already-unique
  `iso_3166_2`/`adm1_code` fallback fields (confirmed unique per feature in the Anguilla/GB samples
  checked) for better-looking detail — worthwhile only if someone actually cares about that level of
  admin-1 texture in small territories; functionally inert either way since none of these map to a real,
  status-settable `subdivisions.json` row.
- **The no-auto-zoom-on-tap behaviour and the selected-country outline (with the fix above) are now both
  confirmed live in a real browser**, not just by CSSOM inspection — this session's tab came focused
  partway through. Selecting a country was confirmed, live, to leave the pan/zoom transform completely
  untouched; the outline fix was confirmed against the exact Morocco/Senegal/Mauritania cases reported.
- **The uncapped zoom was, in the end, exercised live via real wheel gestures** (not just reasoned about
  from `d3-zoom`'s source) while chasing the gap-scan repro above — scale was driven past 25,000× through
  ordinary wheel-event batches with no clamping, crashing, or visual corruption observed. Still not a
  literal on-device pinch gesture, but no longer resting purely on reading the clamp math.
- If the 2px `--chalk` outline reads as too subtle or too strong on a real phone screen, it's a two-value
  tweak in [`WorldMap.css`](atlas/src/components/map/WorldMap.css)'s `.world-map__country--selected` rule
  — no other code depends on the exact numbers.
- `dominantLandmass`'s underlying idea (pick the >50%-area piece of a multi-polygon country) might still
  be useful someday for something other than auto-zoom framing — it was deleted rather than kept dormant
  per this project's "don't keep unused code around" convention, but the logic (and its unit tests, which
  caught a real spherical-winding bug in their own fixtures — see the original session above) is sitting
  in git history (`git log --diff-filter=D -- '*dominantLandmass*'`) if a future feature wants it back.

## City labels on the world map (done)

A self-directed polish session, not a numbered phase — the user asked for cities to appear on the map
once zoomed in enough, "first the big cities... capitals and such... then the smaller the more you zoom
in," and to ask if anything was unclear. Two scope questions were asked and answered (both recommended
options) before writing code, since they changed the feature's shape, not just its presentation: (1)
cities are a **reference layer plus your entries** — every real city can appear as you zoom, colour-coded
by status where you've logged one, neutral otherwise, and tappable to open the same status sheet
countries/regions already use; (2) the biggest cities get a **mono-font text label**, not just a dot,
once zoomed in enough.

### What was built

- **`src/geo/mapCities.ts`** — a third small, memoised in-memory index over the ~170k-row `cities` table,
  same "build once, invalidate on reseed" shape `@/geo/search` and `@/geo/nearestCity` already
  established (deliberately not shared with either — each of the three needs a differently-shaped index,
  and that's already how the other two relate to each other). Adds one derived field neither of those
  needed: `isCapital`, a best-effort normalized-name match between a bundled city and its country's
  `capital` string (the data model has no `geonameId` link between the two — plan §4's `Country.capital`
  is a bare name). Wired into [`geo/loader.ts`](atlas/src/geo/loader.ts)'s `ensureReferenceData()`
  alongside the other two index invalidations.
- **`src/components/map/cityLayer.ts`** — the actual selection logic, pure and unit-tested (10 new
  tests, [`cityLayer.test.ts`](atlas/src/components/map/cityLayer.test.ts)), same "logic lives outside
  the component" precedent as the deleted `countryFitTransform.ts`/`dominantLandmass.ts`. Below
  `CITY_MIN_SCALE` (2.5× the whole-world fit) nothing shows at all. Above it, a city is eligible once its
  population clears a floor that relaxes in six steps as you zoom further (`POPULATION_TIERS`), *or*
  unconditionally if it's a capital or a place you've already logged — so a tiny visited village never
  waits behind some unrelated country's population cutoff. Eligible cities are culled to the current
  viewport (`visibleRect`, inverting the live d3-zoom transform back to base-projected bounds, padded
  25%), ranked (your entries beat capitals beat plain population) and capped at `MAX_CITY_MARKERS` (200),
  with the top `MAX_CITY_LABELS` (36) of that ranked list getting a text label.
- **`WorldMap.tsx`/`WorldMap.css`** — city markers render as a new top-most layer inside the existing
  pan/zoom group, loaded lazily (only once the user actually crosses `CITY_MIN_SCALE` once, same
  "don't pay the ~170k-row cost until it's needed" precedent as the admin-1 topology and the search/
  nearest-city indexes). The `scale` state Phase 3 used only for the admin-1 threshold is now a full
  `{k,x,y}` settled-transform state, still only updated on the zoom gesture's `'end'` — recomputing which
  cities to show is a discrete, occasional decision, not a per-frame one, same rationale the original
  scale-only state documented. Each marker is tappable (`stopPropagation` + `onSelectCity`, wired in
  `MapScreen.tsx` to `openPlaceSheet({kind:'city', refId})` — the exact existing pattern
  `onSelectSubdivision` already used), with a ~44px transparent hit-circle around the small visible dot
  per plan §8's tap-target floor, and a `<title>` for every marker regardless of whether it's labeled.
  - **The one genuinely new technique this session**: zoom is uncapped (`scaleExtent([1, Infinity])`,
    per the earlier "map interaction polish" session), so a marker sized in the same local coordinate
    units as country geometry would grow without bound — a `--zoom-k` CSS custom property is now set on
    the pan/zoom group on every `'zoom'` tick (one cheap extra line next to the existing
    `gEl.setAttribute('transform', ...)` write), and every marker counter-scales against it
    (`transform: scale(calc(1 / var(--zoom-k, 1)))`, `transform-box: fill-box`) so dot/label size stays
    constant on screen through an entire gesture, long or short, instead of only being corrected once the
    gesture settles. See Verified below — this was proven with a throwaway probe element, not just
    reasoned about, since it's exactly the kind of thing this project's own history (the paint-order
    outline bug, the admin-1 gap-fill bug) shows is easy to get subtly wrong.
- **`--text-2xs` token** added to [`tokens.css`](atlas/src/styles/tokens.css) (0.625rem) — smaller than
  any existing size in the scale, needed because map labels are denser than any UI text this app has had
  before; follows the same "add the missing token rather than hardcode a value" precedent Phase 1 and 3b
  both set. The label itself reuses the existing shared `.mono` class (uppercase, wide letter-spacing) —
  plan §8 names "map labels" as one of that treatment's own stated purposes, so this is the first place
  in the app that purpose is actually exercised. A thin `--abyss` text-stroke halo (`paint-order: stroke`)
  keeps a label legible over any of the four status colours, unvisited land, or open ocean underneath it.
- **`MapScreen.tsx`** — computes `cityStatus = buildStatusIndex(entries, 'city')` (same one-line pattern
  as the existing country/subdivision indexes) and passes it plus `onSelectCity` down.

### Design decisions worth flagging

1. **Capital matching is best-effort by design, not a data-model change.** Checked against the real
   seeded dataset: 249 of 250 countries' capitals matched by normalized name, including every case that
   actually matters for "capitals and such come first" — a capital that *isn't* its country's biggest
   city (Washington vs. New York City, Ottawa vs. Toronto, Canberra vs. Sydney all confirmed correctly
   flagged, the non-capital megacity confirmed *not* flagged). A miss just means that one capital ranks
   by population like any other city instead of being force-promoted — it can never wrongly promote an
   unrelated city, since the match requires equality. Didn't chase the one remaining miss; not worth a
   data-model change (a real `geonameId` link on `Country`) for one country.
2. **Label priority is global-importance-first, not proximity-aware, and that has a real, self-correcting
   edge case worth recording.** Tested live against the real dataset: zoomed on Iceland at `k=4` (the
   first zoom tier where cities not yet clearing the 2,000,000-population floor start to include lower
   ones), Reykjavík ranked **89th of 200** returned markers and did **not** get a label — buried behind
   every bigger foreign capital (Moscow, Cairo, London, Kinshasa...) also technically in view, because at
   `k=4` the visible area is still roughly a quarter of the globe's width. Re-ran at `k=7/11/16/24`:
   Reykjavík's rank climbed to 29 (labeled), 10, 3, then 2 of 200 as the shrinking viewport dropped
   competing foreign capitals out of view — fully resolved by the very next population tier up. Read as
   an acceptable, self-correcting characteristic of "rank by global importance within whatever's on
   screen" rather than a bug: real atlases also let a big, distant capital outrank a small, nearby one
   when both are genuinely on screen at once. Documented rather than fixed with a proximity-weighted
   score (e.g. population ÷ distance-from-view-centre) — that's a real, testable improvement if a future
   session finds the first-zoom-tier moment feels wrong on a real device, but it's a judgment call the
   plan didn't ask for and the effect fixes itself within one zoom step.
3. **No label-collision avoidance.** `MAX_CITY_LABELS` and the priority ranking keep the *count*
   reasonable, but two labeled cities close together on screen can still overlap. A known, accepted
   cartographic simplification (real maps hit the same problem), not silently shipped — flagging it here
   rather than building real collision detection, which is a meaningfully bigger feature than this pass.
4. **`MAX_CITY_MARKERS` (200), `MAX_CITY_LABELS` (36), `CITY_MIN_SCALE` (2.5) and the six-step
   `POPULATION_TIERS` table are picked constants**, same "documented, easy to retune" precedent
   `ADMIN1_ZOOM_THRESHOLD` set — nothing else depends on their exact values.

### Left undone (correctly, out of scope for this pass)

Proximity-weighted label priority and label-collision avoidance (see Design decisions 2–3 above). Long
city names aren't truncated or wrapped — a very long labeled name can visually extend past its neighbours
at extreme zoom, same "known, not chased" treatment as the two items above.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**148/148**, up from 138 — the 10 new `cityLayer.test.ts`
  cases: scale gating, both population-tier boundaries, capital bypass, entry bypass, viewport culling,
  cap+priority ordering including the entry-beats-capital-beats-population tiebreak, label-count cutoff,
  and `visibleRect`'s geometry both padded and unpadded) all clean. `npm run build` clean under Node 20
  (this sandbox's non-interactive shell still needs `nvm use 20` first — Phase 1's standing note);
  bundle grew by ~1 KB gzip, negligible.
- **This session hit the same backgrounded-tab/`ResizeObserver`-never-fires environment issue documented
  since Phase 3b** — confirmed, not assumed: `document.hidden` was `true` from the start, a reload didn't
  clear it, monkey-patching `document.hidden`/`visibilityState` to `false` plus dispatching synthetic
  `visibilitychange`/`focus`/`resize` events didn't either, and neither did a real `preview_resize` call
  (which normally *does* force a fresh `ResizeObserver` delivery) — `.world-map__svg` stayed at
  `viewBox="0 0 1 1"` throughout. Confirms this as the same "genuine renderer-level backgrounding beneath
  what page JS can override" the map-interaction-polish session already concluded, not a regression from
  this session's changes. **Compensated with the same direct-bundle technique those earlier sessions
  used, pushed further** since this feature has a genuinely novel rendering mechanism to prove out:
  - **The live compiled stylesheet contains every new CSS rule verbatim** (`document.styleSheets`
    inspection), confirming Vite built and served them correctly.
  - **The counter-scale mechanism was proven, not just read** — built a throwaway real `<svg>` (own
    `viewBox`, unrelated to the app's stuck one) with a `.world-map__city` marker nested inside a `<g>`
    whose `transform` attribute and `--zoom-k` property were driven exactly the way `WorldMap.tsx`'s
    `'zoom'` handler drives the real one, and read back `getBoundingClientRect()`. At `k = 1, 5, 20, 0.5`
    (a 40× range) with `--zoom-k` kept in sync, the dot's rendered size was **bit-for-bit identical every
    time** (5.625×5.625px). Re-ran at `k=20` *without* updating `--zoom-k`, confirming the same dot
    renders at exactly **20× that size** (112.5px) — proving both that the technique works and that the
    test actually exercises it (i.e. it isn't just returning a constant regardless of input).
  - **Ran the real selection pipeline against the real, fully-seeded dataset** (250 countries, 3,865
    subdivisions, 170,486 cities — confirmed seeded, `geoDataVersion: 1`) via dynamic `import()` in the
    page: `loadMapCities()` built the full index in ~2.2s cold (one-time, lazy, matches the ~1.2s
    `@/geo/search` precedent for the same table plus this index's extra country join), correctly
    population-sorted, 249/250 capitals matched (see Design decisions 1). Built a real `geoNaturalEarth1`
    projection at a 375×600 fit (matching the app's own projection setup) and ran `selectVisibleCities`
    against it centred on Iceland: a real logged entry (added via the sanctioned `setPlaceStatus`, not a
    raw Dexie write — see below) showed up labeled and correctly coloured regardless of its tiny
    population, Reykjavík showed up as a capital regardless of population, a control city (Tokyo)
    correctly fell outside the culled viewport, and the self-correcting label-priority behaviour in
    Design decision 2 was observed directly, not inferred.
  - **Exercised the real sanctioned write/remove path** end to end: `setPlaceStatus({kind:'city', ...})`
    on Iceland's smallest bundled city (Laugar, pop. 1,001) correctly created the derived subdivision
    (`IS.40`) and country (`IS`) entries alongside the explicit city one; `removePlaceEntry(id)` correctly
    soft-deleted all three, leaving the table exactly as it was before (0 live entries, confirmed).
  - **Exercised the tap→sheet path the SVG `onClick` hands off to**: since the literal marker `<g>` never
    rendered this session, called `usePlaceSheetStore.getState().open({kind:'city', refId})` directly (the
    exact call `onSelectCity` makes) and confirmed via an accessibility-tree snapshot that
    `PlaceStatusSheet` opened correctly for a **city** `PlaceRef` specifically — flag, code, subdivision/
    country breadcrumb ("Northeast, Iceland"), "Currently Lived" (matching the entry just created), and
    all four status buttons all present. The coverage headline also live-updated to 0.4% from the same
    write, with no reload. The one link not literally exercised is the `onClick`/`stopPropagation` on the
    marker `<g>` itself — the same pattern `onSelectSubdivision` already uses in production, so low risk,
    but flagging it as the one piece resting on code-reading rather than a fired event.
  - App confirmed left clean afterward: 0 live entries (matched the fresh-install state found at the
    start of the session).

### Notes for the next session

- **If a real device/focused browser is available, the one thing worth a quick look that this session
  couldn't do**: an actual pinch/wheel gesture watching city dots and labels appear and stay
  constant-sized in the real rendered map, plus a literal tap on a marker. Everything feeding into that
  rendering (the CSS mechanism, the selection logic, the data, the tap target's downstream handler) was
  independently verified for real this session — this would be confirming wiring, not discovering new
  behaviour.
- **`CITY_MIN_SCALE`, `POPULATION_TIERS`, `MAX_CITY_MARKERS` and `MAX_CITY_LABELS`** (all in
  `@/components/map/cityLayer.ts`) are the levers if the reveal feels wrong on a real phone — too sparse,
  too cluttered, capitals appearing too late, etc. — same "picked constant, easy to retune" spirit as
  `ADMIN1_ZOOM_THRESHOLD`.
- If the first-moment-of-reveal label priority (Design decision 2) ever draws a complaint, the fix is a
  proximity term in `cityLayer.ts`'s sort — the viewport rect's centre is already computed by
  `visibleRect`, so the missing piece is just a distance calculation and a decision about how strongly to
  weight it against population, not a data or architecture change.

### Bug fix: city markers rendered thousands of pixels off-screen, invisible

Reported by the user immediately after the session above shipped, on a real `npm run dev` — "I can't see
the cities pop up." Diagnosing this took several rounds specifically *because* this session's own live
verification (above) was done entirely through the sandboxed preview tool, which never once managed to
actually render the map (the standing `ResizeObserver`-never-fires-in-a-backgrounded-tab issue this
project's history keeps hitting), so the mechanism that turned out to be broken was one this session had
proven correct only in isolation, on a synthetic throwaway element — never against a real marker with a
real, non-zero translate.

**Ruled out first, each with real evidence, not assumption**: nothing committed vs. deployed (user
confirmed same `npm run dev`, same checkout); a silent load failure (added a missing `.catch()` this
session found while re-reading the code — genuine gap, fixed, but not the cause: the real dataset loaded
fine, 170,486 cities, no error); not zoomed in far enough (user was zoomed past the point Germany no
longer fits on screen — confirmed via reasoning about the projection that this is *deep*, tens-of-times
zoom, not the ~2.5–4× city-reveal range); the `CountrySheet` covering the lower part of the screen
(plausible but not it); browser/OS zoom instead of the map's own pinch/zoom (the user's most direct
pushback — confirmed wrong with live evidence, see below).

**Found via a live, real-time capture in the user's own browser**, after two rounds of instrumented
console snippets (pasted by the user, output relayed back): a `wheel`-event listener plus a transform
poller showed the user's actual scroll *did* reach the SVG (31 real `wheel` events) and *did* drive the
zoom transform correctly across a huge range (scale 1 → 89× and back), with `maxCitiesSeen: 200` proving
markers were genuinely created in the DOM. So the zoom mechanics, the data layer, and the selection logic
(all independently verified live this session, and reconfirmed here) were never the problem. A follow-up
snapshot of one real marker's `getBoundingClientRect()` nailed it: positioned at roughly
`(-12562, -6613)` — thousands of pixels outside the SVG's actual `(0, 107)`–`(752, 781)` bounds — while
its *size* was exactly right (9×9px, correctly constant regardless of zoom).

**Root cause**: [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx)'s marker `<g>` carried *both* the
per-city `transform="translate(x,y)"` **attribute** (for position) and the `.world-map__city` class's CSS
`transform: scale(calc(1/var(--zoom-k)))` **property** (for the constant-size counter-scale introduced
earlier this session). A CSS `transform` on an SVG element does not compose with a `transform` attribute
on the same element — it replaces it outright. So every marker's translate was silently discarded, and
each one rendered at wherever its group's local `(0,0)` happened to land under the pan/zoom group's own
transform — which is exactly the ballpark the observed `(-12562,-6613)` sits in (close to that group's own
`translate`, since a near-zero local point contributes almost nothing on top of it). This session's
earlier "proof" of the counter-scale technique (see the original entry above) tested only a marker whose
own translate stayed fixed while the *ancestor's* scale varied — it never varied the marker's own
translate away from a value close to its test setup's implicit zero, so this exact failure mode produced
no visible symptom in that test.

**Fix**: split position and scale onto two different, nested elements — an outer `<g>` carrying only the
plain `transform="translate(x,y)"` attribute (now untouched by any CSS `transform` rule), wrapping an
inner `<g className="world-map__city">` carrying only the counter-scale CSS. Also switched
`transform-origin` from `fill-box`/`center` (which pivots around the *content's* bounding box — for a
labeled marker that box is skewed by the label text, so origin drifts depending on how long each city's
name is) to a plain `transform-origin: 0 0` against the element's own local coordinate system, which is
origin- and content-independent.

**Verified two ways.** (1) A corrected, rigorous version of this session's earlier synthetic-probe
technique: built a throwaway marker with a *non-zero* translate this time, computed the mathematically
expected screen position from the outer group's own translate/scale (`tx + k·x`, `ty + k·y` — the same
formula a country path's coordinates resolve through), and compared. The original two-CSS-properties
structure was off by an amount that grew with `k` (confirming the bug); the fixed two-element structure
still showed a small discrepancy in this *particular* sandboxed harness even at `k=1` (a no-op scale,
which cannot legitimately produce any error) — evidence the remaining few pixels there were the harness's
own known measurement flakiness (this project's history has repeatedly documented `preview_screenshot`
and rapid style-mutate-then-immediately-measure patterns behaving inconsistently in this tool), not a
real bug. (2) **Decisive confirmation against the real, live app**: re-ran the same wheel-zoom sequence
against the actual `WorldMap` component (not a probe) and compared one real marker's measured centre to
the expected formula — `observedCx: 236.8` vs `expectedCx: 236.8`, `observedCy: 279.3` vs
`expectedCy: 279.3`, exact to one decimal place, dot width still exactly 9.00003px (correctly constant),
and the marker confirmed within the SVG's visible bounds. `npx tsc -b`, `npx eslint .` and
`npx vitest run` (148/148, unchanged — this fix touches only JSX structure and CSS, no logic) all clean
under Node 20 afterward.

### Left undone

Nothing — the user confirmed on their own device, after this fix, that cities now render and are visible
while zoomed in ("okay it works"). This closes the loop this session's own sandboxed preview tool couldn't:
it never once rendered the map visually end to end, only via DOM/CSSOM queries, so the user's own eyes on
a real browser are the only confirmation this bug (and the original feature) actually works visually, not
just mathematically.

### Notes for the next session

- **The general lesson, worth restating**: this project's sandboxed preview tool cannot be trusted to
  catch bugs in *how multiple transform mechanisms compose* on a real element with real, varying data —
  it proved the counter-scale technique's *size* invariant convincingly (correctly, as it turned out) but
  missed the *position* bug entirely because the original probe never varied the thing that mattered. If a
  future session adds another transform-driven visual mechanic, prefer testing it against a full
  reproduction of the real element structure with genuinely varying inputs (as the fix's verification
  above finally did), not a simplified stand-in — and treat any anomaly that appears even at a
  known-identity transform (`k=1`, `scale(1)`) as a measurement artifact of this specific tool, not a code
  bug, since a true identity transform cannot itself introduce error.
- If the user's re-check finds anything still off, the two live-instrumentation techniques used to
  diagnose this (a temporary `wheel`-event + transform-poll listener, and a `getBoundingClientRect()`/
  `getComputedStyle()` capture of a real marker) are reusable recipes for the next map-rendering report
  that can't be reproduced in-sandbox.

## 3D globe view — toggle, rotate, tap-to-select (done)

A self-directed feature session, not a numbered phase: the user asked for a switch to toggle between
the existing 2D choropleth and a rotatable 3D-look globe, and to flag anything ambiguous first. Three
scope questions were asked and confirmed before writing any code, since each was a real architectural
fork, not a presentation detail:

1. **Rendering approach** — a lightweight d3-geo orthographic projection (reusing the existing SVG/
   d3-geo stack) vs a full WebGL 3D engine (three.js). Confirmed: lightweight.
2. **Feature scope** — country-level status + tap-to-select only, vs full parity with admin-1
   drill-down and city markers. Confirmed: country-level only.
3. **Toggle placement** — an icon button on the Map screen itself vs a Settings entry. Confirmed:
   on the Map screen.

### What was built

- **Settings**: `MapView = 'flat' | 'globe'` type + `Settings.mapView` field
  ([`db/types.ts`](atlas/src/db/types.ts)), device-local — not in `SyncableSettings`/
  `SYNCABLE_SETTING_KEYS`, same as `photoUploadOnCellular`/`driveConnected` — on the reasoning that a
  phone worth spinning a globe on and a laptop you glance at can reasonably differ. Backfilled onto
  existing rows via `SETTINGS_ADDED_DEFAULTS` in [`db/seed.ts`](atlas/src/db/seed.ts), the same
  idempotent pattern every device-local field addition has used since Phase 2 — no Dexie version bump
  needed (not indexed). [`sync/snapshot.ts`](atlas/src/sync/snapshot.ts)'s device-local-fields comment
  extended to name it.
- **[`globeMath.ts`](atlas/src/components/map/globeMath.ts) + `.test.ts`** (15 tests) — pure
  drag-to-rotation math extracted for testability, same "logic lives outside the component" precedent
  as `cityLayer.ts`. `rotateByDrag()` converts a screen-pixel drag into a `[λ,φ,γ]` rotation delta using
  `180/π` (a drag of `scale` px sweeps one radian of arc on a sphere rendered at that scale) rather than
  a picked/tuned constant; `clampLatitude()` stops the globe flipping over a pole, lambda is left free
  to spin unbounded in either direction.
- **[`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx) + `.css`** — the globe itself,
  canvas-rendered (not SVG — see Deviation 1), country-level only per the confirmed scope: status fill
  + tap-to-select opens the same [`CountrySheet`](atlas/src/components/map/CountrySheet.tsx) `WorldMap`
  already uses, completely untouched (it only ever took a bare `code` prop, so nothing about it knows
  or cares which map opened it). Tapping open water or the dead space off the globe deselects.
  Drag-to-rotate and pinch/wheel-to-zoom (bounded 1–6× fit — there's no admin-1 detail to zoom into,
  unlike WorldMap's uncapped `scaleExtent`) via raw Pointer Events rather than `d3-zoom`, which has no
  rotate primitive. Same instrument-panel grid backdrop treatment as WorldMap for the dead space around
  the map — worse here, since a circle inscribed in a rectangle leaves even more of it than the flat
  map's wide projection did.
- **[`MapScreen.tsx`](atlas/src/screens/MapScreen.tsx)** — a new `.map-screen__header` wrapper holds
  `CoverageHeadline` plus a 44×44 icon toggle button (a new globe glyph when flat, `BottomNav`'s
  existing `MapIcon` — now exported — when on the globe), flipping `settings.mapView` on tap.
  Conditionally renders `WorldMap` or `GlobeMap`; `selectedCode`/`CountrySheet` stay shared and
  untouched, so a country selected on one view survives switching to the other.

### Deviations from what was asked, and why

1. **Canvas, not SVG, for the globe itself — not asked, a technical call.** WorldMap's pan/zoom is
   cheap precisely because it's a `<g transform>`: the ~239 country paths are computed once (memoised)
   and never touched again during a gesture. A globe can't do that — rotating changes the actual
   projected geometry of every country on every frame, so "cheap transform, cached paths" isn't
   available regardless of which technology draws it. Recomputing ~239 path `d` strings and writing
   them to real SVG DOM nodes on every `pointermove` (up to 60–120/sec) pays real string-building and
   DOM/React-reconciliation cost that SVG never had to pay when nothing was rotating; canvas's
   `geoPath(projection, ctx)` issues drawing commands directly, no string step, no DOM nodes to diff —
   the standard technique every reference d3 "rotating globe" example uses for exactly this reason.
   - Trade-off, noted rather than solved: canvas has no per-country DOM node, so there's no free
     `<title>` hover tooltip and nothing to keyboard-focus. Checked WorldMap for parity first — it has
     no keyboard country-selection path either (mouse/touch `onClick` only), so this isn't a new
     regression, just not an improvement either.
   - Zoom is baked into the projection's own `.scale()` rather than a `ctx.scale()` transform, so plain
     `ctx.lineWidth` values stay a constant on-screen width through any zoom level for free — the SVG
     equivalent needs an explicit `vector-effect: non-scaling-stroke`; canvas gets the same result here
     as a side effect of *how* zoom is implemented, not a special case that needed its own code.
2. **CSS custom properties resolved to real colours via `getComputedStyle`, once, lazily — not asked,
   forced by canvas.** `ctx.fillStyle` can't parse `var(--x)` the way the CSSOM can.
   [`statusColor.ts`](atlas/src/components/map/statusColor.ts) stays the single source of truth for
   *which* token belongs to which status (`resolveGlobePalette` maps over its own existing
   `STATUS_ORDER`/`colorForStatus`, it doesn't redeclare that mapping) — the new code only adds "and
   here's how to turn a resolved token into a paintable value."
3. **Tap-to-select hit-testing via `projection.invert()` + `d3.geoContains()`, with a hand-rolled
   disk-boundary check in front of it — not asked, forced by canvas having no DOM elements to hang
   `onClick` on.** WorldMap gets hit-testing for free from the browser's own SVG hit-testing; the globe
   has to do the spherical point-in-polygon test itself. Both are existing `d3-geo` primitives, no new
   dependency — but see the bug fix below, this needed more care than it looked like at first.
4. **Resize preserves rotation and zoom-relative-to-fit; it does not reset to the opening view.**
   WorldMap resets pan to identity on every resize (its own comment: a stale transform against a
   re-fitted projection would visibly misalign). Re-centring an orthographic globe on resize doesn't
   have the same failure mode — only the base scale/translate need to change, not the rotation — and
   resetting orientation on every viewport resize/orientation change would be a worse experience for
   something you're actively spinning. `zoomRef` is a multiplier over fit-scale (same convention as
   WorldMap's `transform.k`), so it survives a resize proportionally rather than in absolute pixels.
5. **No momentum/inertia on release.** Matches the leaner "country-level only" scope answer in spirit —
   direct 1:1 drag tracking that stops the instant you release, with nothing to gate behind
   `prefers-reduced-motion` because there's no motion effect beyond the drag itself. Left as a candidate
   polish item, not built.

### Bug found and fixed during verification: tapping outside the globe didn't reliably deselect

`geoOrthographic().invert()` does **not** return `null` for a screen point outside the projected disk —
verified directly against the real projection, not assumed: a tap 5px past the rim and one 1.5 radii
away both inverted to the *identical* coordinate as a tap exactly on the rim (clamping, not the
null-for-invalid-input behaviour the original code assumed). `handleTap`'s `!point`/`NaN` guard
therefore never actually fired for an out-of-disk tap; in practice it would have resolved to whatever
real country or ocean sits at that rim longitude instead of deselecting — not a crash, a wrong result,
the same "subtly wrong, not caught by inspection" shape of bug this project's history keeps flagging as
the ones worth actually testing for rather than reasoning through.

**Fix**: compute disk membership ourselves before ever calling `.invert()` — screen-space distance from
the projection's own `.translate()` compared against its `.scale()` — rather than trusting the library
to answer a question it turns out not to answer. Re-verified with the same live probe technique against
real topology data: a tap dead-centre (rotated to Iceland) selects `IS`; a tap well inside the disk on
open water deselects as open water; taps 5px past the rim, 1.5 radii out, and directly above the globe
in the grid backdrop area all now correctly deselect as outside-the-disk. The `NaN`/null check stays as
a cheap defensive fallback right at the boundary itself, though it's no longer load-bearing for the
outside-disk case.

### Left undone (correctly, out of scope for this pass)

Admin-1 drill-down and city markers/labels on the globe (confirmed scope: country-level only — the flat
map is where that detail lives; see the next-session note below about back-face hiding if this changes).
Momentum/inertia on release. No Settings-screen entry for the toggle (confirmed: Map-screen icon only).

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**163/163**, up from 148 — 15 new `globeMath.test.ts`
  cases) and `npm run build` all clean.
- **This session hit the same backgrounded-tab/`ResizeObserver`-never-fires issue documented since
  Phase 3b** — reconfirmed, not assumed, three ways: `document.hidden` was `true` from the start and
  stayed `true` after a reload; monkey-patching `document.hidden`/`visibilityState` plus dispatching
  synthetic events didn't help (as before); and this time a real `preview_resize` call *also* didn't
  force delivery, unlike the mixed results earlier sessions reported. Both WorldMap's stuck
  `viewBox="0 0 1 1"` and GlobeMap's canvas staying at its default 300×150 backing-store size confirm
  this is the same pre-existing environment limitation affecting both map types identically, not
  something the new component introduced.
  - The preview tool's synthetic `preview_click` also didn't register this session (confirmed by
    checking Dexie state immediately after — no write happened), where a plain
    `element.dispatchEvent(new MouseEvent('click', {bubbles:true}))` reliably did. Worth trying the
    dispatch-based approach first if a future session hits unresponsive `preview_click` clicks again.
- **Compensated with real-data verification, one level more rigorous than reading the code**, per the
  "city markers off-screen" postmortem's own lesson about not trusting a simplified stand-in:
  - Dynamic-imported the real `loadWorldTopology`/`decodeLayer`/`statusColor` modules plus `d3-geo`
    directly into the live page and reproduced `resolveGlobePalette`/`draw`/`handleTap`'s literal logic
    (not a simplified version) against the real 239-feature world topology.
  - Palette resolution: all four status colours plus unvisited/ocean resolved to exact hex values
    matching `tokens.css` (`#5b7c99`/`#6f8f7a`/`#4fc08d`/`#e8a33d`/`#26343c`/`#161f25`) — confirms
    `var(--x)` tokens are genuinely being turned into paintable colours, not passed through literally.
  - Real canvas paint, byte-verified: rotated a real `geoOrthographic` projection to centre Iceland,
    filled it as `visited`, read the centre pixel back via `getImageData` — `rgba(79,192,141,255)`, the
    exact byte value of `--visited`. Proves decode → rotate → project → canvas-fill end to end, not just
    "no exception thrown."
  - Hit-testing, all three branches confirmed against real data: tap on Iceland (rotated to centre) →
    selects `IS`; tap well inside the disk on open ocean → deselects as open water; taps outside the
    disk (just past the rim, far into the dead space, and in the grid backdrop above the globe) →
    deselect as outside-the-disk (see the bug fix above — this is exactly what caught it).
  - Toggle button verified against the real mounted app, not just the probe: clicking
    `.map-screen__view-toggle` correctly writes `settings.mapView` to the real Dexie table,
    `useLiveQuery` reactivity swaps `WorldMap` for `GlobeMap` (and back) with no reload, and the
    button's own icon/label/`aria-label` flip in lockstep (`GlobeIcon`/"Switch to 3D globe" ↔
    `MapIcon`/"Switch to flat map"). Confirmed both directions of the round trip.
  - The real mounted `.globe-map__canvas` carries `role="img"`, the correct `aria-label`,
    `cursor: grab` (→ `grabbing` on `:active`), and lays out at the correct CSS size via flexbox
    regardless of the still-blocked backing-store sizing — only the *backing store* (device-pixel canvas
    resolution) is blocked on `ResizeObserver`, not layout.
  - Zero console errors throughout. No horizontal overflow at 391–400px width.
  - App left clean afterward: `settings.mapView` reset to its default (`'flat'`) after verification,
    matching Phase 3's own precedent of resetting settings touched only for testing.
- **Not verified live**: an actual on-device drag/pinch gesture watching the globe rotate and zoom
  smoothly, and a literal tap dispatched through real pointer events on the real mounted canvas (blocked
  by the same environment issue as everything else this session, and — unlike the hit-testing math or
  the colour pipeline — frame-rate smoothness genuinely can't be probed without a live, focused render
  loop to measure). Worth a real device check if the drag ever feels laggy; `MIN_ZOOM`/`MAX_ZOOM`/
  `CLICK_DISTANCE`/`INITIAL_ROTATION`/`GLOBE_PADDING` (all in `GlobeMap.tsx`) are the levers, same
  "picked constant, easy to retune" precedent as `ADMIN1_ZOOM_THRESHOLD`.

### Notes for the next session

- **The `geoOrthographic().invert()`-doesn't-return-null-outside-the-disk behaviour is worth
  remembering generally**, not just for this bug: anything that inverts a screen point through an
  orthographic projection needs its own explicit disk-membership check first (screen-space distance vs.
  `.scale()`) — the library will not tell you a point is invalid, it clamps.
- If a future session adds admin-1 or city detail to the globe (currently deferred, country-level only
  by design), the back-face-hiding concern is real: `clipAngle(90)` already keeps *drawing* limited to
  the visible hemisphere, but any new per-feature culling logic (the way `cityLayer.ts`'s `visibleRect`
  culls for the flat map) needs to reject points on the far hemisphere too, not just off-screen ones —
  a naive port of `selectVisibleCities` would show cities through the back of the globe.
- `resolveGlobePalette()` resolves tokens once, lazily, on first draw and never again — correct today
  (`tokens.css` has a single static `:root`, no light-theme override actually implemented yet despite
  `Settings.theme` existing), but if a future session adds real light-mode CSS, this needs to also
  re-resolve when `settings.theme` changes, or the globe will keep painting with whichever theme was
  active on its first draw.
- The toggle button's placement/styling (`.map-screen__header`, `.map-screen__view-toggle` in
  `MapScreen.css`) is a first pass, not checked against a real device — the icon-button treatment
  borrows `CountrySheet`'s close-button convention (44px target, `--haze`→`--chalk` on hover) but sits
  over the map rather than on a solid sheet background, so it got its own `--shelf`/`--contour` card
  treatment; worth a look on a real phone alongside the rest of this session's unconfirmed live-gesture
  items.

## Globe view — full parity with the 2D map (done)

Immediate follow-up in the same session: after trying the country-level globe above, the user said *"I
like the globe alot, but on a second thought I want the globe to have all the same abilities/functions
as the 2d map"* — reversing the "country-level only" scope this session had confirmed just beforehand.
The request was unambiguous, so this went straight to implementation rather than asking again; the
first pass's shared building blocks (`CountrySheet`, the cascade/status data, matching prop shapes)
existed largely to make exactly this expansion cheap.

### What was built

- **Admin-1 drill-down**, mirroring [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx) exactly:
  a selected country's subdivisions lazy-load past `ADMIN1_ZOOM_THRESHOLD` — now **exported** from
  WorldMap and imported into GlobeMap rather than duplicated, so the two maps can never drift onto
  different reveal thresholds — coloured via `subdivisionStatus`, drawn through the same
  clipAngle-aware `path()` as everything else (the far-hemisphere portion is hidden automatically, no
  extra code needed). Ported WorldMap's gap-fill trick verbatim: once admin-1 regions are actually
  covering the selected country, its own base fill switches to the neutral unvisited tone instead of
  its real status, for the same reason WorldMap needed it — the world and admin-1 topology layers are
  two independently simplified traces of the same coastline and don't align to the pixel.
- **City markers**, also mirroring WorldMap: lazy-loaded past `CITY_MIN_SCALE`, ranked/capped/labelled
  by the same shared pipeline (see refactor below), rendered as dot + optional mono label with a
  stroke-halo for legibility. Simpler than WorldMap's SVG version in one respect: canvas markers need no
  counter-scale hack (WorldMap's `--zoom-k` CSS trick exists specifically to undo its `<g
  transform="scale(k)">` zoom mechanism, which the globe doesn't use at all — zoom is baked into the
  projection's `.scale()`, so a plain fixed-radius `ctx.arc()` already stays a constant on-screen size).
- **The one genuinely new mechanism this required**: hemisphere visibility for point features.
  `clipAngle(90)` only clips *polygon/line* geometry drawn through the path generator — verified
  directly (not assumed, see below) that a bare `projection([lon, lat])` call for a point and its exact
  antipode collide at the *identical* screen coordinate, so nothing about the raw forward projection
  alone can tell you which hemisphere you actually got. Added `isFrontFacing(rotation, point)` to
  [`globeMath.ts`](atlas/src/components/map/globeMath.ts) (6 new tests) — the point currently centred by
  a rotation is `[-rotation[0], -rotation[1]]` (verified against a live projection), and a target point
  is visible when its great-circle distance from that centre is ≤ 90°. GlobeMap's `project` callback for
  city selection checks this before ever calling the raw projection.
- **Shared-code refactor**: `cityLayer.ts`'s `selectVisibleCities` no longer computes its own viewport
  rect from a d3-zoom-shaped `{k,x,y}` transform (meaningless for a globe — there's no pan, only
  rotate). It now takes a pre-computed `viewRect` directly from the caller: WorldMap computes it via the
  still-exported `visibleRect(transform, ...)` exactly as before (zero behaviour change, confirmed by
  the untouched WorldMap tests all still passing), GlobeMap just passes its own screen bounds (its
  `project` callback already excludes anything not on the visible hemisphere, so no separate rect-based
  culling is needed on top). This is what let both maps share one selection/ranking/capping pipeline
  instead of GlobeMap needing its own copy.
- **Hit-testing precedence**, matching how WorldMap's SVG paint order already implies it (topmost
  element wins the tap): cities first (pixel-radius hit test against the markers actually drawn on the
  last frame — there's no polygon to run `geoContains` against for a point), then admin-1 subdivisions
  (`geoContains`, only checked when currently showing), then countries, then deselect.
- **`GlobeMapProps` now matches `WorldMapProps`** — `subdivisionStatus`, `cityStatus`,
  `onSelectSubdivision`, `onSelectCity` added; [`MapScreen.tsx`](atlas/src/screens/MapScreen.tsx) passes
  the identical prop set to both.

### Deviations from what was asked, and why

1. **`MAX_ZOOM` uncapped (`Infinity`) — not asked, follows directly from the scope change.** The
   previous session's `MAX_ZOOM = 6` was explicitly justified by "there's no admin-1 detail to zoom
   into" — no longer true, so the same reasoning that led WorldMap to uncap its own `scaleExtent` now
   applies here too.
2. **A small new piece of React state, `settledZoom`.** Rotation/zoom otherwise live entirely in refs,
   deliberately outside React, for gesture performance. But "should we fetch this country's admin-1
   topology / the city index yet" is a threshold-crossing check that only needs to happen once per
   completed gesture step (not every drag frame) and needs to compose with `selectedCode` changing — an
   effect dependency is the natural fit for that, the same role WorldMap's own settled `transform.k`
   state already plays for the identical two thresholds. Updated on `pointerup` (gesture fully released)
   and on each `wheel` tick (which, like WorldMap's underlying d3-zoom, treats each wheel event as its
   own complete gesture already) — never on `pointermove`, so dragging still never re-renders.
3. **Admin-1 features and the loaded city index live in refs (`admin1FeaturesRef`, `mapCitiesRef`), not
   React state, unlike WorldMap's `admin1Features`/`mapCities` state.** WorldMap needs them in state
   because it renders JSX `<path>`/`<g>` elements straight from them. GlobeMap's canvas drawing never
   touches JSX for this data at all — updating a ref and calling `draw()` directly after each async load
   is both sufficient and more consistent with the rest of this component's "bypass React, work through
   refs" design than introducing state that exists only to trigger an effect.
4. **Canvas label rendering resolves an actual font string (`getComputedStyle` + hand-computed `rem`→px
   math) rather than trusting CSS.** Same forcing function as the colour tokens in the first pass —
   `ctx.font` needs a concrete size, and a raw `0.625rem` risks the browser resolving it against the
   canvas element's own ambient font context rather than the page root, which the DOM/CSS path never has
   to worry about.
5. **Canvas text baseline is `'middle'`, not a replica of WorldMap's SVG alphabetic-baseline-plus-3px
   offset.** A cosmetic, not functional, difference — canvas and SVG text metrics don't share a baseline
   model, and centring the label vertically against the dot reads cleanly on canvas without trying to
   reverse-engineer SVG-specific tuning that doesn't mean the same thing here.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**169/169** — unchanged from the first globe pass;
  this expansion added rendering/hit-testing logic and one new pure helper (`isFrontFacing`, 6 tests,
  already counted) but no other new pure modules) and `npm run build` all clean.
- **Same environment limitation as the first pass, reconfirmed once more**: `document.hidden` actually
  read `false` partway through this session (unlike the first pass, where it never did), so a real
  render was attempted again — toggled to the globe, checked the canvas — still stuck at its default
  300×150 backing store, confirming this is deeper than the `document.hidden` flag alone (a genuine
  renderer-level throttle, matching what earlier sessions concluded). `preview_screenshot` still timed
  out. Fell back to the same real-data probe technique as the first pass, and hit one new wrinkle this
  time: an early probe threw `Cannot read properties of undefined (reading 'x')` from *inside*
  `visibleRect` — a genuinely confusing error until traced to the browser's ES module cache serving a
  **stale** `cityLayer.ts` from an earlier dynamic `import()` in this same long-lived page session,
  predating this session's refactor of that file. Bare `import()` calls issued by hand like this bypass
  Vite's HMR entirely, so the fix is a manual cache-buster (`import(`/src/foo.ts?t=${Date.now()}`)`) on
  any module re-imported after editing it mid-session — worth remembering for the next probe-based
  verification session.
- **Real-data verification of every genuinely novel piece**, same rigor as the tap-to-select bug catch
  in the first pass:
  - **Hemisphere culling**, the one new mechanism, checked against real, well-known geography: rotated
    to centre Reykjavík, loaded the real 170,486-row city index. Both a direct `isFrontFacing` check and
    the full `selectVisibleCities` pipeline agreed exactly: Reykjavík and London (nearby) visible;
    Wellington and Sydney (the literal opposite side of the planet) excluded. Not a coincidence of the
    test data — these are real antipodal-ish city pairs.
  - **Admin-1 hit-testing**: rotated to centre Munich with Germany's real 16 admin-1 regions loaded —
    a tap dead-centre resolved to `DE.02` / "Bayern" (Bavaria), correctly the specific subdivision, not
    just the country.
  - **Country-level fallback**: a tap on Paris (rotated into view, well outside any of Germany's admin-1
    shapes) correctly fell through the admin-1 check and resolved to `FR`, confirming a tap on a
    *different* country while another's admin-1 is showing still selects the new one.
  - **City-over-admin1-over-country precedence**: a synthetic marker 0.9px from a tap point was
    correctly chosen; the same marker 112px away (outside the 22px hit radius) was correctly missed and
    would fall through to the layers beneath it.
  - **Label font**: resolved `--text-2xs`/`--font-mono` by hand into `"10px 'IBM Plex Mono',
    ui-monospace, monospace"` and fed it to a real `CanvasRenderingContext2D.font` setter — the browser
    accepted and correctly echoed back the same size and family (re-quoted, not substituted), confirming
    it's a valid, correctly-parsed canvas font declaration rather than a silent fallback to some default.
  - Not independently re-verified this round: the admin-1 gap-fill fill-colour swap and the city dot/
    label fill colours, both byte-level in the first pass for country fills. Reasoned rather than
    re-proven: both reuse the exact same `fillFor`/`palette`/`ctx.fill()` mechanism already
    byte-verified against real pixel readback, just fed different feature geometry through the same
    `path()` call already proven correct for country polygons.
  - Toggle round-trip (flat → globe → flat) re-confirmed against the live mounted app after all of the
    above, with the new, larger prop set wired through — no console errors, no crash.
- App left clean afterward: `settings.mapView` reset to `'flat'`.

### Left undone

Nothing from the request — admin-1 and city markers now work identically in spirit on both maps.
Momentum/inertia on release is still not built (not part of either scope conversation). The same
not-verified-live items as the first pass remain open (an actual on-device drag/pinch/tap gesture) —
this session added real-data proof for the new hit-testing/culling *logic*, not a live frame-rate check,
which still needs a real device or a non-backgrounded browser tab.

### Notes for the next session

- **`ADMIN1_ZOOM_THRESHOLD` is now a cross-component import** (`GlobeMap.tsx` imports it from
  `WorldMap.tsx`). A deliberate, minimal choice over introducing a shared-constants file for one value —
  worth revisiting if a third consumer ever needs it.
- **The stale-module-cache lesson above is worth restating**: any future probe-based verification
  session that re-imports a file it (or an earlier session) already dynamically imported once in the
  same long-lived tab needs a cache-busting query param, or it'll silently test old code and produce
  confusing errors that look like a real bug in the new code.
- If admin-1/city detail ever needs to work *simultaneously* with a much wider zoomed-out view (it
  currently doesn't need to — the reveal thresholds are identical to WorldMap's), remember cities are
  the one layer that needed the hand-rolled hemisphere check; any new point-based layer added later
  (as opposed to polygons, which `clipAngle` already handles) will need the same treatment.

## Bug fix: globe wheel/pinch zoom always zoomed toward the centre, not the cursor

Reported by the user testing on a computer, immediately after the full-parity session above shipped:
scrolling to zoom in always zoomed toward the middle of the globe, regardless of where the cursor was —
asked explicitly to fix it so zooming at, say, the top-right corner actually zooms in on that corner, on
both computer (wheel) and phone (pinch).

**Root cause**: `onWheel`/the pinch branch only ever changed `zoomRef.current`, and the projection's
`.translate()` was fixed at the container centre by the resize effect and never touched again. Since
scale change is applied around whatever the projection's translate point is, zooming necessarily always
appeared to happen around the container centre — there was no "zoom toward a point" behaviour at all,
just "zoom, centred."

**Fix** [`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx): the standard "zoom toward cursor/pinch"
technique every map or photo viewer uses — a new `translateRef`, no longer pinned to centre, and a
`zoomAt(localX, localY, targetZoom)` helper that solves for the translate value which keeps the screen
point `(localX, localY)` fixed as scale changes: `translate' = anchor + k·(translate − anchor)` where
`k` is the ratio of new to old zoom. `draw()` now applies `translateRef.current` every frame (previously
only ever set once, in the resize effect). Wired into both gesture paths — `onWheel` anchors at the
cursor position, the pinch branch anchors at the midpoint between the two touch points (a new
`pointerMidpoint()`, alongside the existing `pointerDistance()`). Rotation (drag) is untouched — this is
purely a scale/translate concern.

One deliberate invariant added on top of the raw formula: **zooming all the way back out to `MIN_ZOOM`
always recentres**, regardless of how much translate has drifted from off-centre zooming at higher zoom
levels. Without this, repeatedly zooming in/out anchored at different points could leave the globe
permanently off-centre even at minimum zoom — WorldMap gets the equivalent guarantee for free from
`translateExtent` clamping its own transform back to `(0,0)` at `scale 1`; the globe has no such
built-in clamp, so this is done by hand (`if (clamped <= MIN_ZOOM) translateRef.current = [container
centre]`).

**Caught a bug in my own verification, not the fix, worth recording**: the first live-data check of this
formula showed real drift (~120–150px) and looked like the fix was wrong. Traced it back to the test
itself, not the code — it used `.invert()` to find "the point currently under an anchor at (350, 100)",
but that screen point was actually *outside* the visible disk at the starting zoom level (whole-globe
fit), which triggers the exact `.invert()`-clamps-to-the-rim behaviour discovered and documented earlier
this session — the "point" the test then tracked through subsequent zoom steps was never real to begin
with, so of course re-projecting it didn't land back where expected. This is unrelated to the shipped
`zoomAt` code, which never calls `.invert()` at all (it's a pure screen-space affine update, well-defined
regardless of whether the anchor happens to sit over real globe content or the empty dead space around
it). Rewrote the check to track a known, genuinely-visible lon/lat point end to end instead — see
Verified below.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**169/169**, unchanged — this fix touches only
  gesture-handling logic, no new pure/testable module) all clean.
- **Real-data proof of the actual invariant**, corrected per the false start above: tracked a genuine,
  currently-visible lon/lat point's screen position through a 1×→4×→10× zoom sequence, re-anchoring at
  that same point's *current* screen position at each step (exactly what a continuous scroll gesture
  does). Drift after both steps: `[0, -5.68×10⁻¹⁴]` — floating-point noise, not a real discrepancy.
  Separately re-confirmed the MIN_ZOOM recentre invariant: zooming back down to exactly `1` always
  produces `translate = [width/2, height/2]` regardless of prior off-centre drift.
- Re-ran the live mounted app: toggled to the globe, dispatched a real `wheel` event (via
  `canvas.dispatchEvent(new WheelEvent(...))`, `deltaY: -200`) at a point 85%/15% across the canvas
  (a genuine top-right-corner position, matching the user's own example) — no console errors, no crash.
  The same standing `ResizeObserver`-in-hidden-tab limitation (reconfirmed once more this session) means
  the canvas never got a real backing-store size in this environment, so `zoomAt`'s own `baseScaleRef.current
  === 0` guard made this particular dispatched event a no-op internally — still useful as confirmation
  that firing the real listener path in an "not fully laid out yet" state doesn't throw or produce NaN
  garbage, but the actual visual "does it zoom toward the corner on screen" effect could not be watched
  directly and rests on the algebraic proof above instead.
- App left clean afterward: `settings.mapView` reset to `'flat'`.

### Left undone

Not confirmed on a real phone/computer with an actual scroll wheel or pinch gesture — the algebraic proof
is solid (the formula is the well-known, standard one, and drift measured at 10⁻¹⁴ across a real
projection) but nothing in this sandboxed session could watch pixels move in response to a real gesture.

## Polish: city markers were too dense and the flat map got laggy once they appeared

Reported by the user after living with the city layer for a while: too many cities on screen at once
(the reveal hierarchy needed retuning), and the flat `WorldMap` got noticeably laggy once cities were
showing. Asked clarifying questions before touching anything, since both the "how many is right" question
and the performance root cause were genuinely open — see answers below.

**Density/hierarchy** ([`cityLayer.ts`](atlas/src/components/map/cityLayer.ts)), per the user's own worked
example (zoom into Iceland: capital only → then Kópavogur/Garðabær-tier towns → then everything, capped
around 20–30 on screen ever):
- `CITY_MIN_SCALE` 2.5 → **3.5** — delays the whole city layer (capitals included) a bit later into the
  zoom, per explicit ask ("keep capitals always visible but make them appear a bit later").
- `MAX_CITY_MARKERS` 200 → **25**, `MAX_CITY_LABELS` 36 → **20** — the user was explicit: never more than
  20–30 cities on screen at once. This is the real backstop; population tiers alone can't guarantee an
  exact per-country count (density varies too much country to country), but combined with the existing
  viewport culling, capping globally is equivalent to "top ~25 in view" whenever the view is roughly one
  country, which is the realistic case this matters for.
- `POPULATION_TIERS` rescaled to `[3.5, 2M] → [5, 500k] → [7, 150k] → [10, 40k] → [14, 10k] → [20, 0]` —
  shifted later and slightly compressed versus the old table, so the "top handful of a country's biggest
  cities" tier lands earlier than full granularity, matching the requested capital → top-N → everything
  progression.
- Kept the existing design (unchanged): a capital or an already-logged entry always qualifies as a
  candidate regardless of population — confirmed wanted in the clarifying round, just later in the zoom
  (see `CITY_MIN_SCALE` above).
- [`cityLayer.test.ts`](atlas/src/components/map/cityLayer.test.ts): one test hardcoded the old tier
  table's scale-4 checkpoint (`500,000` floor used to kick in at scale 4) — updated to scale 5, matching
  the new table. No other test depended on exact tier/cap numbers.

**Performance** ([`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx)): the flat map's live zoom
handler writes `gEl.setAttribute('transform', ...)` and `gEl.style.setProperty('--zoom-k', ...)` directly
to the DOM on every `'zoom'` tick — deliberately outside React for drag/pinch smoothness (see the comment
above it), but the raw tick rate is the input event rate (wheel/pointermove), not the paint rate, and a
fast trackpad or mouse can fire wheel deltas well above 60/sec. Every tick's `--zoom-k` write cascades a
style recalc through every currently-rendered `.world-map__city` marker (each counter-scales against it —
see `WorldMap.css`), so with markers on screen this was doing more DOM work per second than the browser
could ever paint. User explicitly asked for this to be fixed too, not just the marker count reduction.

**Fix**: rAF-throttled the handler. A new `pendingZoomTransformRef` stores the latest transform from every
raw `'zoom'` tick; a `zoomRafIdRef` guard ensures at most one `requestAnimationFrame` is in flight at a
time, and the scheduled callback always reads whatever the *latest* pending transform is (never a stale
one) before doing the actual `setAttribute`/`setProperty` writes and clearing the in-flight flag. Net
effect: DOM writes are capped at one per painted frame regardless of how many raw events arrive between
frames, with **no visual change** — same transform, same counter-scale, just coalesced. Cleanup cancels
any in-flight rAF and clears both refs, so a resize-triggered re-bind or unmount can't leave a stray
callback trying to write to a stale `gEl`.

Considered and rejected: only updating `--zoom-k` at gesture `'end'` instead of continuously. That would
have been a bigger win per-frame, but markers are sized in local (pre-zoom) SVG units and the ancestor
`<g>`'s scale transform is what makes them balloon visually as `k` grows without the live counter-scale —
deferring the counter-scale to gesture-end would reintroduce that ballooning for the whole gesture, a
regression the original mechanism exists specifically to prevent. rAF-throttling gets the perf win with
zero visual trade-off instead.

`GlobeMap.tsx` needed no equivalent change — its canvas redraw is already funneled through its own
`scheduleDraw()`/`requestAnimationFrame` pattern (confirmed by reading it, not assumed), so it was never
doing more than one draw per frame to begin with. It picks up the new density/hierarchy constants for free
since both maps share `cityLayer.ts`.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**169/169**, one test's hardcoded checkpoint updated to
  match the retuned tier table, no new tests needed — no new pure logic, just constant/handler changes)
  all clean.
- **Real-data proof of the actual density/hierarchy change**, run against the live 170,486-row bundled
  city index via a cache-busted dynamic import (`import('/src/geo/mapCities.ts?t=...')`, per the
  stale-module-cache lesson from the earlier globe session) and the real `selectVisibleCities` pipeline,
  viewport fixed to Iceland's bounding box:
  - Scale 3.5 (first reveal) and scale 7: **only Reykjavík** — exactly "only the capital is shown" from
    the user's own example.
  - Scale 14: **8 cities** — Reykjavík, Kópavogur, Hafnarfjörður, Reykjanesbær, Akureyri, Keflavík,
    Mosfellsbær, Garðabær — a direct hit on the user's own named examples (Kópavogur, Garðabær) at
    exactly the tier meant to represent "top cities in the country."
  - Scale 20 (whole country in view): capped at exactly **25** results, first 20 labelled, last 5 not —
    the `MAX_CITY_MARKERS`/`MAX_CITY_LABELS` backstop working as designed even though far more than 25
    Icelandic settlements clear the scale-20 population floor of 0.
  - Noticed in passing, not caused by this change and not fixed here: "Borgarnes" appears twice in that
    last result, back-to-back, identical population — looks like a pre-existing duplicate in the bundled
    city data (possibly a bundled + online-cached duplicate) rather than anything in the selection logic.
    Worth a look if it turns out to be more than a one-off.
- **The rAF-throttle logic was code-reviewed, not exercised live** — attempted a real dispatched-`WheelEvent`
  burst-of-6 test (matching a fast trackpad between two frames) with a `MutationObserver` on the `<g>`'s
  `transform` attribute to count actual DOM writes, but hit the same standing `ResizeObserver`-in-hidden-tab
  limitation this repo's sessions keep running into: `size.width`/`size.height` never leave their initial
  `{0,0}` state because the `ResizeObserver` callback that would set them never fires while this sandbox's
  tab is backgrounded, so the zoom-binding effect's own `size.width === 0` guard bails out before ever
  calling `selection.call(zoomBehavior)` — there is no `'zoom'` listener attached at all to dispatch events
  at. Confirmed this diagnosis directly (`rafCallCount` stayed `0` across a 6-event burst) rather than
  assuming it. Fell back to reasoning about the code directly: it's the standard "coalesce to one
  `requestAnimationFrame` per burst, always read the latest pending value" pattern, and `tsc`/`eslint`
  confirm it type-checks and has no unused-ref or stale-closure issues.
- App state left clean: only read-only probes this session (`loadMapCities()`, the pure
  `selectVisibleCities()`), no Dexie writes, no settings changes.

### Left undone

The rAF-throttle's actual frame-rate impact is not confirmed on a real device — same class of gap as the
two prior globe sessions (both hit the identical `ResizeObserver`-in-hidden-tab wall). Worth a real-device
check next time someone's on a phone or a computer with a trackpad: pinch/scroll-zoom the flat map with
cities showing and see whether it now feels smooth. The Iceland-specific population/scale numbers above are
empirical, same as the rest of `POPULATION_TIERS` — reasonable starting points, not laws of nature, and
worth retuning again if a much bigger or much smaller country reveals the tiers feel off at some other
scale.
Worth a quick real-world check now that it's shipped.

## Polish, round two: city markers still weren't right — switched to "marked cities only"

The density/hierarchy retuning above wasn't enough — user reported it "still isn't as good as I want it to
be" and asked for a much simpler rule instead: **only show cities that have actually been marked** (any
status — wishlist through lived), nothing population- or capital-driven at all.

**[`cityLayer.ts`](atlas/src/components/map/cityLayer.ts)** — this removes an entire subsystem rather than
retuning it:
- Deleted `POPULATION_TIERS` and `populationFloor()` outright, and the "unconditional if capital" branch of
  the old inclusion check. The only inclusion test now is `cityStatus.get(city.refId) !== undefined` — a
  city with no logged entry never appears, regardless of size or capital status.
- `CITY_MIN_SCALE` 3.5 → **2**: the old value was raised specifically to delay the capitals-always-show
  clutter; that reason is gone entirely now, so it's back down near its original value. Kept *some*
  nonzero gate rather than removing it, because it still serves a different, still-real purpose: it's what
  delays the lazy-load of the ~170k-row bundled city index (see `@/geo/mapCities`) until the user actually
  starts zooming into the map, rather than paying that cost on every mount.
- `MAX_CITY_MARKERS` 25 → **150**, `MAX_CITY_LABELS` 20 → **60**: with population-driven candidates gone,
  the candidate pool is now inherently bounded by how many places the user has actually logged — for any
  realistic amount of travel history that's well under the old tight cap. The cap is now a generous
  backstop against a pathological case (hundreds of entries visible in one view), not a routine limiter,
  so tightening it further would only ever cost the user their own marked pins for no clutter benefit.
- `priority()` simplified from `(hasEntry, isCapital)` to just `isCapital` — `hasEntry` was the *only*
  inclusion criterion now, so keeping it as a separate ranking dimension on top of that was redundant;
  capital status is the only thing left to break ties among cities that are all already marked.
- `CityMarker.status` tightened from `Status | null` to `Status` — every marker returned by
  `selectVisibleCities` now provably has a real status by construction (it's the filter condition), so the
  type now reflects that invariant instead of allowing a case that can't happen.

**Call-site cleanup**, both now dead code following the type tightening above:
- [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx): `c.status ? colorForStatus(c.status) :
  'var(--haze)'` → `colorForStatus(c.status)`. The `'var(--haze)'` fallback existed for the
  no-status-yet case, which can no longer occur.
- [`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx): same shape, `m.status ? fillFor(m.status,
  palette) : palette.cityDot` → `fillFor(m.status, palette)`. Also removed the now-fully-unused
  `cityDot` field from `GlobePalette` (both the interface and its `resolveGlobePalette()` assignment) —
  it had no other reader, so leaving it in would've been a dead token resolved out of CSS every draw for
  nothing.

[`cityLayer.test.ts`](atlas/src/components/map/cityLayer.test.ts): rewrote the population-tier describe
block into an "only marked cities appear" block (excludes a 30M-population marked-nowhere capital;
includes a population-1 unmarked-as-capital village once it has *any* logged status). Cap/priority and
viewport-culling tests updated so every candidate city carries a status in `cityStatus` (previously some
relied on the population/capital branches to qualify without one — that path no longer exists). Net one
fewer test than before (168 vs. 169) from merging what used to be two separate "capital" / "logged entry"
inclusion tests into one "marked" concept — nothing lost, the distinction they were testing no longer
exists in the code.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**168/168**) all clean.
- Manually re-read the `CityMarker.status` consumers in both map components after the type change from
  `Status | null` to `Status` — confirmed by `tsc` passing clean (a stale null-check left behind would
  have been a type error, not a silent bug, given the tightened type) rather than assumed.
- Grepped the two map components and `CountrySheet.tsx` for stale comments/copy referencing the removed
  population/capital-driven reveal behavior — none found needing an update.
- **Could not get a live browser preview this round** — `preview_start` hit the exact same
  `EMFILE: too many open files` inotify-exhaustion error flagged to the user earlier this session (see the
  chat, not this file: their machine has dozens of concurrent Claude Code processes holding inotify
  instances well past the OS's `max_user_instances` default of 128). Suggested fixes (closing the leftover
  dev-server instance I'd started, raising `fs.inotify.max_user_instances` via sysctl) hadn't been applied
  yet by the time this round of changes was verified. Verification therefore rests on `tsc`/`eslint`/
  `vitest` plus direct code review, not an actual rendered map — a smaller gap than usual for this file's
  track record, since the change is a straightforward filter tightening plus two mechanical call-site
  simplifications, not new geometry/projection logic.

### Left undone

**Not visually confirmed against the live app** — see the EMFILE note above. Worth a real check once the
inotify limit is sorted: mark a handful of cities across a couple of countries, load the map, and confirm
(a) unmarked cities — including capitals — no longer appear at all, (b) marked ones still show, correctly
coloured by status, once zoomed in past the new lower `CITY_MIN_SCALE`. `MAX_CITY_MARKERS`/`MAX_CITY_LABELS`
raised to generous-backstop values are, like the rest of this file's constants, empirical guesses — fine
unless someone's logged an unusually large number of cities packed into one small viewport, in which case
they're trivial to retune further.

## Polish, round three: country outlines look blocky once you zoom in

User: "I don't like how it looks zoomed in, maybe it can be done dynamically?" — about the country
shapes/coastlines, not the city layer. Diagnosed before writing any code, per how the last couple of rounds
went: rendered Iceland's coastline from the real committed `world.topo.json` at the same zoom level the app
would show (via a standalone Node script using the project's own `d3-geo`, converted to PNG with
ImageMagick since the browser preview couldn't render — see Verified) and it was genuinely bad: a handful
of sharp straight-line facets, obviously polygonal, nothing like a coastline.

**Root cause, found by reading [`tools/build-geo.mjs`](atlas/tools/build-geo.mjs) rather than guessing**:
`world.topo.json` is built from Natural Earth's 1:10m Admin-0 source (already the detailed dataset — the
`00-PLAN.md` §6 table saying "1:50m" is stale/aspirational, not what the pipeline actually fetches), but
`buildWorldTopo` simplifies it against one shared byte budget for the whole world (900 KB target, `-simplify
variable` keeping 25% of points per country by default, 5% for the handful of huge/complex countries in
`WORLD_SIMPLIFY_DETAILED_EXCEPTIONS`). Measured directly: Iceland's raw source has 3,117 points; only 447
survive into `world.topo.json` — about 14%. Fine for a whole-world silhouette; visibly faceted once the app
lets you zoom in arbitrarily close on one country (`MAX_ZOOM` is uncapped, per the globe session earlier in
this file). Confirmed the fix would actually help *before* building it: re-rendered the same Iceland
close-up straight from the raw, already-locally-cached NE source (`tools/.cache/ne_10m_admin_0_countries.geojson`,
13 MB, no network fetch needed) and it looked genuinely like a coastline — fjords, inlets, real texture — at
the identical zoom and centre point.

**The fix, matching the user's own "dynamically" framing and mirroring a pattern the codebase already has**:
admin-1 already lazy-loads a separate, per-country, higher-detail file once you've selected a country and
zoomed in past `ADMIN1_ZOOM_THRESHOLD` — country outlines now get the identical treatment.

- [`tools/build-geo.mjs`](atlas/tools/build-geo.mjs): new `buildCountryDetail(neByA2)`, writing
  `public/geo/countryDetail/<CC>.topo.json` — one file per country, same raw NE 1:10m source and the same
  `neByA2` grouping `buildWorldTopo` already builds (reused, not recomputed), but simplified against a
  150 KB *per-file* budget instead of one 900 KB *whole-world* budget, starting from 65% and only backing
  off (same iterative back-off loop `buildAdmin1` already uses) for the handful of countries complex enough
  to still bust it. Ran the real pipeline end to end (`npm run build:geo`, fully offline — every source was
  already cached from the last real run): 239 files, 2.7 MB total, largest is Canada at 140 KB. Iceland's
  file alone: 2,030 points (vs. 447 in `world.topo.json`) at 20 KB.
  - **Reverted two incidental, unrelated changes from that same build run** before committing anything:
    re-running the full pipeline regenerates every artefact, and `cities.json.gz` / `subdivisions.json` both
    came out different from what's currently committed. Checked both before touching anything: `cities.json.gz`'s
    decompressed bytes were byte-identical (only the gzip header's embedded timestamp differed — not a real
    change); `subdivisions.json` had genuine small coordinate drift in a handful of rows (e.g. Anguilla
    admin-1 rows moved from `18.224,-63.065` to `18.2301,-63.0592`), almost certainly from a dependency
    version difference in this environment versus whenever that file was last generated — unrelated to this
    task, so `git checkout --` on both rather than folding unrelated drift into this change.
- [`src/geo/loader.ts`](atlas/src/geo/loader.ts): `loadCountryDetailTopology(code)`, byte-for-byte the same
  shape as the existing `loadCountryTopology` (memoised per code, resolves `null` on a missing/failed
  fetch) — inherits whatever caching/versioning strategy already covers `/geo/*` broadly, nothing new to
  wire up there.
- [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx): new `countryDetailFeature` state, loaded by an
  effect that's a close mirror of the existing admin-1 one (same `overThreshold` gate, same cancelled-flag
  cleanup). Rendered as one additional `<path>`, painted directly on top of the existing coarse selected-country
  path — same `world-map__country--selected` class, same fill/stroke/gap-fill logic, same click handler,
  just sharper `d`. Deliberately *additive*: nothing removed from the existing `orderedCountryPaths`
  render, so there's no flash of missing geometry while the detail file is in flight — the coarse shape
  stays visible underneath until the sharper one paints over it.
- [`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx): identical shape, adapted to the ref-based/canvas
  pattern this component already uses for admin-1 (`countryDetailFeatureRef`, loaded by an effect mirroring
  the existing admin-1 one exactly, calling `draw()` on resolution). In `draw()`, the selected-country block
  now paints `(countryDetailFeatureRef.current ?? selectedFeature).feature` instead of always
  `selectedFeature.feature` — one-line change, everything else (status colour, gap-fill, stroke) untouched.
  Country-level hit-testing (`geoContains` against `featuresRef.current`) deliberately left alone — it
  doesn't need pixel-perfect coastline matching, and the coarse shape is entirely sufficient for "which
  country did they tap."

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**168/168**, unchanged — no new pure/testable logic, this
  is a rendering-source swap, not new selection/ranking behaviour) all clean.
- **Diagnosed with a real rendered image before writing any fix code**, since `preview_screenshot` was
  (once again) unable to render — wrote a standalone script using the project's own installed `d3-geo`/
  `topojson-client`, fed it the real committed `world.topo.json`, reproduced the app's own
  `geoNaturalEarth1().fitSize(...)` + zoom-toward-a-point math, rendered Iceland's Reykjavík-area coastline
  at 8x and 20x zoom to SVG, converted to PNG with ImageMagick (`convert`, confirmed present), and actually
  looked at it — genuinely a small number of sharp straight facets, not a coastline. Then re-rendered the
  same close-up from the raw, unsimplified NE source to confirm the fix's premise *before* building it: it
  looked like an actual coastline at the identical zoom/centre. Both images are what motivated the specific
  numbers chosen above (150 KB per-file budget, 65% starting simplification), not guesswork.
- **Real end-to-end runtime check of the new code path**, against the actual dev server and the actual
  built artefact (cache-busted dynamic imports, per the stale-module-cache lesson from the first globe
  session): called the real `loadCountryDetailTopology('IS')` — fetched `countryDetail/IS.topo.json` over
  the real server, resolved non-null. Fed the result through the real `decodeLayer(topo, 'countries',
  'code')` — exactly one feature, `id === 'IS'`, `name === 'Iceland'`. Fed *that* feature through the exact
  same `geoNaturalEarth1()`/`geoPath()` combination `WorldMap.tsx` itself uses — produced a well-formed SVG
  path string, 2,030 `L`/`M` commands, matching the point count measured directly from the topology file.
  This proves the fetch → decode → project chain is correct end to end through the real component-facing
  API, independent of whether the live DOM could be observed.
- **Could not observe the live DOM/React effect wiring itself** — same standing `ResizeObserver`-in-hidden-tab
  limitation every session touching these two map components has hit: `size.width`/`size.height` never
  leave `{0,0}` in this sandboxed tab (confirmed again directly: the SVG's own `<g>` had no `transform`
  attribute at all, meaning the zoom-binding effect's `size.width === 0` guard never even let it bind), so
  there's no way here to actually zoom past `ADMIN1_ZOOM_THRESHOLD` and watch the new `<path>` appear.
  What's verified above (the runtime data path) is everything that could be checked without that; the
  effect wiring itself is a straightforward, close copy of the admin-1 effect immediately above it in both
  files, which *is* already proven-live code.
- App/build state left clean: `public/geo/countryDetail/` is new and intentional (239 files, 2.7 MB,
  correctly un-gitignored — `atlas/.gitignore` only excludes `tools/.cache`); `cities.json.gz` and
  `subdivisions.json` reverted to their committed versions per the note above; nothing else in `public/geo/`
  changed (`world.topo.json`, `admin1/*`, `countries.json` came out byte-identical from the same build run,
  confirming this addition didn't disturb anything already there).

### Left undone

**Not confirmed against the live, rendered app** — see the `ResizeObserver` note above; same class of gap
as every prior session touching `WorldMap.tsx`/`GlobeMap.tsx`. Worth a real check once there's a working
browser session (or a real device): select a country, zoom in past the admin-1 threshold, and confirm the
coastline visibly sharpens rather than just trusting the two rendered comparison images and the runtime
data-path check above. Also worth a glance at a genuinely complex coastline once it's easy to look at live —
Norway or Indonesia, not just Iceland — to see whether 150 KB/65%-start is generous enough there too, or
whether those specific countries need their own tuning the way `WORLD_SIMPLIFY_DETAILED_EXCEPTIONS` already
carves out exceptions for `world.topo.json`.

The new `public/geo/countryDetail/` files are **generated but not committed** — this session only ran
`npm run build:geo` and wired up the app to use the output; committing is left for whenever the user
reviews and commits the rest of this round's changes, consistent with not committing anything unless
asked.

## Bug fix: the sharper country outline made colour fills visibly stop following the coastline

User tested the round above and reported: "I see changes when I click on the country but then the coloured
in regions don't follow the same path and the graphic is not as good. I want it to be kind of similar to
google maps." So the outline swap *was* rendering — the bug was elsewhere.

**Root cause, confirmed by rendering both layers overlaid** (same script-plus-ImageMagick technique as the
diagnosis in the round above, this time drawing `admin1/IS.topo.json`'s boundary in green on top of the new
`countryDetail/IS.topo.json` outline in white): the two layers now visibly diverged, badly — the green
admin-1 line cut straight across real bays and missed entire peninsulas the white detail line traced
correctly. This was always a latent risk (the existing gap-fill comment already called world.topo.json and
admin1 "two independently simplified traces of the same coastline" that "don't align to the pixel"), but it
was invisible before because both layers were comparably coarse (447 vs. 573 points for Iceland — close
enough that any gap was small and covered by the neutral-tone gap-fill trick). Pushing just the country
outline up to 2,030 points without touching admin-1 broke that balance: now one layer traces the real
coastline closely and the other doesn't, so the gap-fill trick just makes the *size* of the now-much-bigger
mismatch obvious instead of hiding it — a fringe of neutral-toned "land" outside every admin-1 region's own
cruder edge, tracing real coastal detail the colour fill doesn't reach.

**Fix**: raise admin-1's own simplification budget to match, in
[`tools/build-geo.mjs`](atlas/tools/build-geo.mjs)'s `buildAdmin1` — starting simplification `15%`/`8%`
(small/big countries) → `65%`/`25%`, byte budget `150 KB` → `500 KB` per country. Same reasoning as
`buildCountryDetail` above: these numbers were tuned back when this file only had to look reasonable next
to `world.topo.json`'s own coarse country shape, not next to a genuinely detailed one. Re-ran
`npm run build:geo`: all 240 admin-1 files changed (intentional — bigger, more detailed), largest is now
Russia at 206 KB (was 76 KB), total 4.9 MB (was 1.8 MB) — still comfortably lazy-loaded per country, same
order of magnitude as a single photo attachment, not something that affects initial load. Reverted the same
incidental `cities.json.gz`/`subdivisions.json` drift as the round above (identical cause: re-running the
full pipeline regenerates everything; checked both, unrelated, reverted).

No component code changed for this fix — `WorldMap.tsx`/`GlobeMap.tsx` already just render whatever
`admin1/<CC>.topo.json` contains; feeding them a more detailed file was the entire fix.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**168/168**, unchanged — no code changed, only build
  output) all clean.
- **Visual proof, before and after, same technique as the diagnosis**: rendered Iceland's admin-1 boundary
  (green) overlaid on the country-detail outline (white) at two zoom levels (6x and 15x on the Reykjavík
  peninsula, the same detailed/complex stretch of coastline used in the prior round's diagnosis).
  - Before this fix: green line cut straight across multiple real bays and missed a peninsula entirely —
    exactly what the user described as "colour doesn't follow the same path."
  - After: at both zoom levels the two lines track each other closely along the actual coastline; the only
    remaining green lines running through the interior are genuine internal admin-1 borders (between two
    Icelandic regions), which is correct — those were never supposed to follow the coastline.
  - Sent both images to the user for direct comparison rather than describing the fix in text.
- Confirmed via `git status` that only `admin1/*.topo.json` (240 files, all intentional) and
  `countryDetail/` changed, `cities.json.gz`/`subdivisions.json` reverted per the note above,
  `world.topo.json`/`countries.json` untouched.

### Left undone

Same live-app gap as every round in this file's recent history — couldn't watch this in an actual rendered
browser, verification rests on the rendered-overlay comparison and the fact that no component code changed
(only the data file being loaded got bigger/more precise, through already-proven-live loading code). Also
still worth checking a genuinely complex coastline (Norway's fjords, Indonesia's islands) live once that's
possible — Iceland was the only country actually spot-checked for the admin-1/outline alignment fix, same
as the round above.

## Bug fix: raising admin-1's own detail wasn't enough — reverted to one coastline at a time

The fix above (raise admin-1's simplification budget) turned out to be treating the wrong layer. User
tested it and sent a screenshot: the coloured-in Capital Region still didn't follow the sharp white
coastline at all — cutting well inside a peninsula the outline clearly showed. Diagnosed properly this time
*before* proposing another simplification-percentage tweak, since the previous round's fix had already
failed once.

**Root cause, confirmed directly, not guessed**: checked the *raw*, pre-simplification point counts in
`tools/.cache/ne_10m_admin_1.geojson` for the two Natural Earth features that dissolve into Iceland's
`IS.39` ("Reykjavík" and "Höfuðborgarsvæði", merged per the existing dupe-id fixup) — **81 and 56 points**,
combined, for that entire admin-1 region's boundary. The country-level coastline in that same area has on
the order of 2,000+ points. No amount of raising the simplification *percentage* can fix this: there's
no extra detail in the source to keep. Percentage-of-what-exists was never the bottleneck for this region —
what exists is just sparse. This is a genuine Natural Earth data-quality gap between their admin-0 (country)
and admin-1 (state/province) products for at least this one country, likely others.

**A real fix would be polygon conflation** — clip or snap admin-1's boundaries to the authoritative,
higher-detail country outline. Prototyped this with mapshaper's `-clip` (feeding the country-detail polygon
in as a second named layer, clipping admin-1's target against it) and checked the output *before* wiring it
into the build — good instinct, because it was badly broken: one region's clipped polygon covered the
*entire* country (a topology error somewhere in the dissolve/clip/simplify sequence, not investigated
further). Real conflation is a legitimate technique but not one to ship on a rushed retry after already
getting the previous fix wrong once.

**Fix actually shipped**: never draw two independently-traced coastlines for the same country at the same
time. [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx)'s country-detail `<path>` now only renders
when `!showingAdmin1` (previously it rendered whenever loaded, just switching its *fill* to the neutral
gap-tone once admin-1 showed — but its sharp *stroke* kept drawing regardless, which was the actual visible
seam: a crisp white selection-outline the coloured admin-1 fill never matched). Same change in
[`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx)'s `draw()`: `path((detailFeature && !showingAdmin1
? detailFeature : selectedFeature).feature)` instead of always preferring `detailFeature` when loaded.

Net effect: the country-detail improvement from two rounds ago now only applies where it can't conflict
with anything — a selected-but-not-yet-admin1-loaded country, or a country with no admin-1 data at all.
Once admin-1 takes over, rendering falls back to exactly the pre-this-session behaviour (coarse
`world.topo.json` outline as an invisible-ish backdrop, admin-1's own boundaries as the only visible
coastline) — the same level of coastline/fill imprecision that existed before any of this work and was
never complained about, rather than the much-more-jarring version this session temporarily introduced.

### Verified

- `npx tsc -b` (one real type error caught and fixed along the way: `countryDetailFeatureRef.current &&
  !showingAdmin1` doesn't let TS narrow the ref's null-ness inside a later ternary branch — rewrote as
  `const detailFeature = countryDetailFeatureRef.current; detailFeature && !showingAdmin1 ? detailFeature :
  ...` so the narrowing happens within one expression), `npx eslint .`, `npx vitest run` (**168/168**) all
  clean.
- **Confirmed the root cause with real numbers before proposing a fix**: printed raw point counts for
  `IS.39`'s two source features directly from the cached Natural Earth file (81 + 56), not inferred from
  simplified output — ruling out "not simplified gently enough" definitively before it could lead to a
  second failed attempt.
- **Caught the conflation prototype's bug before it shipped**: rendered all of clipped Iceland's admin-1
  regions in distinct semi-transparent colours over the country outline — one region filled the entire
  1000×1000 frame solid, an obvious topology failure. Discarded the approach rather than debugging
  mapshaper's multi-layer clip semantics under time pressure after already shipping one bad fix this
  session.
- **Rendered exactly what the shipped fix produces**, same overlay technique as both prior rounds: the
  *coarse* `world.topo.json` outline (not the detail layer — matching what actually draws once admin-1
  shows, post-fix) with Iceland's Capital Region filled green, at the same Reykjavík-peninsula 6x crop used
  throughout this investigation. Result: fill and outline track each other along the overall peninsula
  shape, with only the kind of small, subtle gaps the original gap-fill mechanism was always designed to
  paper over — a real, confirmed improvement over the screenshot the user sent, not just an assumption that
  reverting would help.

### Left undone

Still not confirmed in an actual live browser session — same standing limitation. The underlying Natural
Earth admin-1 data-sparsity issue for regions like Iceland's Capital Region is **not fixed**, only no longer
made *worse*-looking than it already was; a real fix would need either better source data for admin-1 or a
correctly-implemented conflation pipeline, neither attempted here. Worth flagging if it comes up again.

## Follow-up requested, not yet built: zoom-driven detail without selecting a country first

Same message also asked for the detail-loading trigger to change from "click a country, then zoom" to
"resolution just increases as you zoom in," matching how Google Maps and other slippy maps behave —
whichever countries are actually in view sharpen with zoom, with no tap required. Not implemented yet.

This is a materially bigger change than anything else in this session: it needs a notion of "which
countries currently intersect the viewport" (not just "the one selected country"), fetching/rendering
detail for potentially several of them at once as you pan, and correctly discarding ones that scroll back
out of view — for both the flat map's rectangular viewport and the globe's rotating hemisphere. Given this
session already shipped one regression by moving to implementation before fully checking the previous fix,
the plan is to confirm the approach with the user before building this one, rather than repeat that
mistake on a larger, higher-risk change.

## Bug fix: reverting the country-outline mismatch swung the mismatch the other way

User tested the "hide the detail outline once admin-1 shows" fix and reported it was **worse than before any
of this session's work**, specifically: "the regions have a higher resolution than the country now." Right
diagnosis on their part.

**Root cause**: the earlier "raise admin-1's own detail" round (two rounds ago) bumped admin-1's
simplification from `15%/8%`/`150 KB` to `65%/25%`/`500 KB`, reasoning that it needed to keep pace with the
new, much-sharper `countryDetail` outline. Then the *next* round decided `countryDetail` and admin-1 should
never actually be shown together at all (see above) — which quietly invalidated that reasoning, but the
admin-1 percentage bump never got reverted alongside it. End state: whenever admin-1 shows, it's now
compared against the *coarse* `world.topo.json` country outline (unchanged this whole time, ~447 points for
Iceland) — but admin-1 itself got 3–4x more detailed. Confirmed live before touching anything (this file's
now-established pattern after getting it wrong twice): rendered all of Iceland with the boosted admin-1
boundaries over the coarse country outline — small green admin-1-boundary artifacts poking past the smooth
white silhouette all around the coast, exactly matching "higher resolution than the country."

**Fix**: reverted `buildAdmin1`'s simplification back to its original `15%/8%` starting percentage and
`150 KB` budget in [`tools/build-geo.mjs`](atlas/tools/build-geo.mjs) — undoing that one round precisely,
now that the premise it was based on (matching `countryDetail`'s fidelity) no longer applies to anything
admin-1 actually gets shown next to. Re-ran `npm run build:geo`: admin-1 back to 1.78 MB total (was 4.9 MB),
Russia back to 76 KB (was 206 KB) — byte-for-byte the same numbers as the very first build this session,
before either detour. Reverted the same incidental `cities.json.gz`/`subdivisions.json` drift as every prior
round in this file (identical cause, same fix).

Net result of these last three rounds combined: **`WorldMap.tsx`/`GlobeMap.tsx` code is now net-changed**
(country-detail loads and shows, but only when admin-1 isn't), while **all of `public/geo/admin1/`
is back to byte-identical with where this session started** — the two detours cancelled out completely,
leaving only the code-level "never show two coastlines at once" guard as this arc's actual net change.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**168/168**, unchanged — build output only) all clean.
- **Re-rendered the same whole-Iceland overlay, before and after this specific revert**: before, small green
  overshoot artifacts visible all around the coastline where boosted admin-1 traced detail the coarse
  country outline doesn't have; after, none — only the legitimate internal borders between Icelandic
  regions remain visible, no coastal artifacts.
- Confirmed via file size that admin-1 output now exactly matches the very first build of this session
  (same 76.4 KB for Russia, same 1,777.9 KB total) — not just "looks better" but byte-verified as a clean,
  complete revert of that one specific change.

### Left undone / to reckon with

**The net practical value of the whole `countryDetail` feature is now small for most countries.** Since it
only ever renders when admin-1 *isn't* showing, and ~240 of 250 countries have admin-1 data that loads at
the same zoom threshold, the sharper outline is now visible mainly for the ~10 countries with no admin-1
file at all, or briefly before admin-1's own fetch resolves elsewhere. This wasn't the original goal (a
generally sharper coastline once zoomed in) — it's what "never compete with admin-1" costs once admin-1 is
almost always available.

This makes the user's separately-requested "sharpen as you zoom, no click needed" idea (see the entry above)
look less like a nice-to-have and more like the actually-correct design: tying detail to *viewport zoom*
rather than to *country selection* would show the sharper outline for whichever countries are simply in
view — including, most of the time, before/without ever selecting one — which is arguably what the original
"I don't like how it looks zoomed in" complaint was about in the first place (just looking at the map,
not necessarily a drilled-into, admin-1-showing country). It would still need the same "don't compete with
admin-1" guard for whichever country is actively selected, but every *other* visible country would get to
use it freely.

Not built this round. After shipping two regressions in a row this session from moving to implementation
too quickly, the plan going into the next round is to confirm this redesign with the user explicitly before
writing code, rather than a third attempt at guessing right.

---

## Session wrap-up — map polish (city markers, then country/admin-1 detail)

User ended the session here and asked for everything logged before stopping. This ties together the whole
arc above (five separate `##` entries, chronological) into one place, and records exact current state for
whoever picks this up next.

### What this session was, in order

1. **City marker density/hierarchy + a real performance bug.** Asked clarifying questions first (density
   preference, whether capitals should stay unconditional, whether to fix the perf root cause or just
   reduce count) since these were genuine taste/scope calls, not obvious ones. Retuned
   `POPULATION_TIERS`/`CITY_MIN_SCALE`/caps in [`cityLayer.ts`](atlas/src/components/map/cityLayer.ts), and
   rAF-throttled `WorldMap.tsx`'s zoom handler (city markers were recalculating their counter-scale on every
   raw pointer/wheel event, not just every painted frame).
2. **Superseded by a simpler request**: "only show cities that have been marked." Ripped out the
   population-tier/capital-unconditional system entirely — the only inclusion rule now is "has a logged
   entry." Net simplification: less code, and the count is now inherently bounded by the user's own travel
   history instead of needing tuned caps.
3. **A real, unrelated infra issue surfaced along the way**: `EMFILE: too many open files` running
   `npm run dev` locally. Diagnosed as this machine's `fs.inotify.max_user_instances` (128, the low Linux
   default) being exhausted by ~45 concurrent Claude Code processes, not a project problem. Gave the user
   both an immediate step (closed a leftover preview server of my own) and the permanent fix (a `sysctl`
   command to raise the limit) — not applied by me, needs the user's `sudo`.
4. **Country coastline detail, three rounds, two of them fixing regressions from the round before**:
   - Round 1: diagnosed (with actual rendered-image proof, not assumption) that `world.topo.json` throws
     away ~86% of Iceland's real coastline detail to fit a whole-world byte budget. Built a new
     per-country `countryDetail/<CC>.topo.json` layer from the same already-cached Natural Earth source,
     lazy-loaded like admin-1 already is. Looked great in isolation.
   - Round 2 (user: "the coloured regions don't follow the same path"): the new sharp country outline and
     admin-1's boundaries are two independently-traced coastlines that were never guaranteed to agree —
     raised admin-1's own detail budget to compensate. Looked better in the one spot checked (Iceland's
     Reykjavík peninsula).
   - Round 3 (user, with a screenshot: still wrong): the real problem was structural, not a percentage —
     Natural Earth's raw source for Iceland's Capital Region admin-1 boundary only has 81+56 points, so no
     simplification setting could ever match it to a ~2,000-point coastline. Prototyped a proper fix
     (polygon clipping) and caught it producing broken output *before* shipping it. Shipped the safer fix
     instead: never render the sharp country outline and admin-1 at the same time — admin-1's own boundary
     is always the coastline once admin-1 is showing.
   - Round 4 (user: now *admin-1* looks too detailed next to the country): round 2's admin-1 budget increase
     had no reason to exist anymore once round 3 stopped showing the two layers together, but it was never
     reverted. Reverted it — confirmed byte-identical to this session's very first build.
   - **Net effect of all four rounds**: `public/geo/admin1/*` ends the session byte-identical to how it
     started (the detour fully cancelled out). The only surviving change is the new `countryDetail` layer
     plus the "never show two coastlines at once" rule in both map components — which, honestly assessed at
     the end, only visibly helps ~10 countries with no admin-1 data, since the other ~240 hit their admin-1
     threshold at the same zoom and hide it again immediately.

### Current file state (nothing committed — see below)

- **Modified, not committed**: [`atlas/src/components/map/cityLayer.ts`](atlas/src/components/map/cityLayer.ts),
  [`cityLayer.test.ts`](atlas/src/components/map/cityLayer.test.ts),
  [`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx), [`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx),
  [`atlas/src/geo/loader.ts`](atlas/src/geo/loader.ts), [`atlas/tools/build-geo.mjs`](atlas/tools/build-geo.mjs).
- **New, untracked**: `atlas/public/geo/countryDetail/` (239 files, 3.3 MB) — generated by this session's
  `npm run build:geo` runs, correctly excluded from `.gitignore`'s `tools/.cache` rule so it's visible to
  `git add`.
- **Untouched, confirmed byte-identical to session start**: `atlas/public/geo/admin1/*` (240 files),
  `atlas/public/geo/world.topo.json`, `atlas/public/geo/countries.json`.
- **Deliberately reverted, twice**: `atlas/public/geo/cities.json.gz`, `atlas/public/geo/subdivisions.json`
  — every `npm run build:geo` run in this session incidentally regenerated these two with unrelated drift
  (a gzip timestamp, and some small coordinate jitter likely from a dependency version difference in this
  environment); checked both times, confirmed unrelated to this session's actual work, `git checkout --`'d
  back to committed each time rather than folding drift into this change.
- `npx tsc -b`, `npx eslint .`, `npx vitest run` (168/168) all clean as of the last edit.
- Nothing in this session has been committed — the user did not ask for a commit, per this project's
  standing instruction to only commit when explicitly asked.

### Left for next session

1. **The open design question from the end of the country-detail arc**: whether to redo the zoom-driven
   ("no click needed") detail loading discussed above, which would make the `countryDetail` work actually
   pay off for the ~240 countries it currently doesn't help. Was about to be discussed with the user when
   the session ended — pick that conversation back up rather than assuming an answer.
2. **The inotify `sysctl` fix** is still unapplied (needs the user's `sudo`) — worth checking whether
   `npm run dev` is still flaky before assuming it's resolved.
3. **Not fixed, only avoided**: Natural Earth's admin-1 data is genuinely sparse for at least Iceland's
   Capital Region (and plausibly other small/less-prominent subdivisions elsewhere) — a real conflation fix
   or better source data would still be a legitimate improvement, just not one this session got right on a
   rushed attempt. The clipping prototype that broke is not saved anywhere; it would need rebuilding from
   scratch if revisited.
4. **Never confirmed live in a real browser** — every verification this session (city hierarchy, rAF
   throttling, coastline overlays) was done via rendering the real data through the app's own code paths
   outside the browser (standalone Node scripts using the project's own `d3-geo`/`topojson-client`, or
   cache-busted dynamic imports against the dev server), because `preview_screenshot`/live gesture dispatch
   hit the same `ResizeObserver`-in-hidden-tab sandbox limitation this repo's sessions keep running into.
   Worth a real device/browser pass before trusting this further.
5. **A spawned background task is still open**: investigate the duplicate "Borgarnes" city entry noticed
   while testing the city-marker work (task flagged mid-session, not yet acted on).
6. The separately-noted `MAX_CITY_MARKERS`/`MAX_CITY_LABELS`/zoom-threshold constants throughout this file
   are, as documented at each step, empirical starting points — expect to retune them the first time real
   usage (not just Iceland) puts pressure on them.

## Crash diagnostics — durable heap/memory instrumentation (done)

Intermittent Chrome "Aw snap!" crashes were reported, correlated with a Google Drive sync pull. The sync
path itself ([`src/sync/*`](atlas/src/sync)) is robust and fully tested; no deterministic crash was found,
and the photo path (a common OOM vector — but its object-URLs are correctly revoked anyway) was ruled out
by the user. The leading hypothesis is a **renderer out-of-memory**: a large steady-state JS heap (the
in-memory indexes over the ~170k-row `cities` table — map, search, nearest-city — plus never-evicted
topology caches, now including the per-country `countryDetail` files) plus a sync pull's transient
main-thread spike (parse the remote doc, snapshot the local tables, merge, canonicalize). A renderer OOM
kills the tab with no catchable JS error, so neither the [`ErrorBoundary`](atlas/src/debug/ErrorBoundary.tsx)
nor the [`unhandledrejection` handler](atlas/src/debug/globalHandlers.ts) ever sees it — the only trace it
can leave is a record of the heap climbing beforehand. That is what this adds.

- [`src/debug/memory.ts`](atlas/src/debug/memory.ts) — `readHeap()`/`heapSummary()` over Chromium's
  non-standard `performance.memory` (the engine that shows the crash page), degrading to `null`/`''`
  anywhere the API is absent, so callers never have to guard.
- [`src/debug/memoryWatch.ts`](atlas/src/debug/memoryWatch.ts) — samples heap on a 15 s timer and on
  return-to-foreground, writing a breadcrumb **only** when heap pressure crosses 70/85/93%
  (edge-triggered). A healthy session logs essentially nothing; a session walking into an OOM leaves a
  clear rising trail as its final entries. Mounted from `main.tsx` next to `installGlobalErrorLogging`.
- [`src/sync/sync.ts`](atlas/src/sync/sync.ts) — every `sync:` breadcrumb now carries the heap summary
  and per-table payload sizes (the remote doc's byte size comes free from the Drive metadata `findFile`
  already fetches). Also computes `canonicalize(merged)` once instead of letting `snapshotsEqual`
  re-serialise the merged snapshot for both the local- and remote-changed checks — trims the pull's peak
  main-thread allocation. Behaviour-identical (all 168 tests still pass).

Everything lands in the existing device-only debug log (**Settings → Debug log**). After a crash: reload,
copy the log, read the tail. A renderer OOM shows as the log *stopping* after a `sync:`/`memory:` line with
**no `ERROR` entry** and heap % climbing in the lines before the gap; a JS exception instead leaves an
`ERROR` entry (different fix). Crash is reported on a **phone**, whose heap ceiling is far lower than the
4 GB seen on desktop, which makes the OOM hypothesis more likely.

### Verified

`npx tsc -b`, `npx eslint .`, `npx vitest run` (168/168), and `npm run build` all clean. Ran the production
build in a real browser and confirmed the baseline breadcrumb writes:
`memory: baseline :: heap 54MB/59MB · limit 4096MB · 1%`, with heap visibly spiking to ~80 MB during the
170k-city seed and falling back after — i.e. the watchdog tracks real movement. Grepped the built bundle
to confirm the breadcrumb strings survive minification. **Not verified:** the live *sync* breadcrumbs need
Google Drive OAuth, not reachable from the sandbox — they rest on the tests plus the bundle grep.

### Still open

The instrumentation confirms nothing on its own — it makes the *next* crash readable. Once a real-device
debug log is captured, the last breadcrumb localizes the phase and the heap trend confirms or refutes OOM,
at which point the targeted fix follows: move the merge/canonicalize off the main thread, evict topology
caches, or bound the in-memory city indexes.

## Root cause found & fixed — online cities didn't sync, and the failure ran the heap away (done)

The heap-stamped breadcrumbs caught it exactly. Setting German regions: heap flat at ~82 MB. Then a sync
pulled 38 entries from the user's other device and **failed**:
`ERROR sync: failed — cascade: 2 city entries have no cities row: -2787656489, -2194089822`. From that
instant the heap ran away — 82 MB → 1.4 GB over ~90 s, climbing even in the gaps between clicks (the
`memory: climbing` breadcrumbs) — and region taps stopped opening the sheet (the main thread was buried in
GC). It did not always crash (the heap ceiling on that device was 2989 MB), but it made the app unusable.

**Two stacked bugs:**

1. **Online/manual cities never synced.** [`buildLocalSnapshot`](atlas/src/sync/snapshot.ts) carried
   entries/trips/tripEntries/photos/settings but **not** the `cities` reference rows. An 'online' (Photon)
   or 'manual' city creates *both* a `cities` row (device-local, negative geonameId) and an `entries` row.
   The entry synced; the row didn't. So device B pulled device A's city *entry* with no matching row —
   `-2787656489`/`-2194089822` are the "Skorki"/"Vik" cities added on the user's computer.

2. **That dangling reference hard-failed the whole sync — and wedged the app.** `loadCascadeState`
   ([`cascadeRepo.ts`](atlas/src/domain/cascadeRepo.ts)) threw `UnknownCityError` for *any* city entry with
   no row. Inside `applyMergedSnapshot`'s transaction (via `rebuildDerivedEntries`) that aborted the merge,
   failed the sync, and left the app in a state that leaked continuously. (The exact runaway loop wasn't
   isolated — preventing the failure removes the trigger, and the earlier auth/network sync errors never
   leaked, so the throw-inside-the-merge-transaction path is the distinguishing factor.)

**The fix (make it work as intended):**

- **Sync the non-bundled cities.** `SyncSnapshot` gained a `cities` field (only `source !== 'bundled'` —
  never the 170k bundled rows). `buildLocalSnapshot` includes them, `mergeSnapshots` unions them by
  geonameId (immutable once created, so a plain convergent union — [`merge.ts`](atlas/src/sync/merge.ts)),
  `canonicalize` sorts them by geonameId, and `applyMergedSnapshot` writes them **before** the cascade
  rebuild so a freshly-pulled city entry resolves. `SYNC_SCHEMA_VERSION` bumped **1 → 2**: a v1 client
  can't produce `cities`, so letting it keep pushing would rewrite the doc *without* them and re-orphan
  every online place — the existing `schema > SYNC_SCHEMA_VERSION` guard makes a v1 client refuse a v2 doc
  until it updates instead. Reading a v1 doc from a v2 client is tolerated (`cities ?? []`).
- **Never let a dangling reference crash the app again.** `loadCascadeState` now throws only for a city the
  caller *explicitly targets* (setPlaceStatus's own refId — a genuine local bug); any *other* unresolvable
  city entry (pulled from another device, its row a sync behind) is skipped-with-a-log for that pass and
  derives itself once the row lands. Crucial because the merge now *persists* pulled entries, so without
  this the throw would just move from sync to the next setPlaceStatus.

**Self-healing for the already-broken data:** on deploy, both devices update to v2; the one holding the
orphaned `cities` rows (the computer) pushes them into the doc, and the dangling entries on the phone
resolve on the next pull. Until then the phone simply skips them instead of failing.

**Verified:** `npx tsc -b`, `npx eslint .`, `npx vitest run` (196/196, +6 new city-sync/merge tests),
`npm run build` all clean. **Not verified in-sandbox:** the end-to-end cross-device sync (needs Drive OAuth
+ two devices; the merge logic is covered by the new unit tests instead).

## Long-form date entry, chronological trip ordering, and small-town region resolution (done)

Three independent polish items, all shipped and deployed in one commit
([`96d5e8c`](https://github.com/Bjartthor/Traveling-Salesman/commit/96d5e8c)):

1. **Date entry.** [`src/domain/dateFormat.ts`](atlas/src/domain/dateFormat.ts) — the single
   Icelandic month table (`ICELANDIC_MONTHS`) plus `formatLongDate`/`parseFlexibleDate`/`todayISO`.
   Storage stays ISO `YYYY-MM-DD` everywhere (sort/compare/Drive sync untouched); only display
   changed. New shared [`DateField`](atlas/src/components/shared/DateField.tsx) — a text field
   showing the long-form date, with a paired native `<input type="date">` opened via
   `showPicker()`/`.focus()` on **click only** (not `focus`, so keyboard-tabbing in doesn't ambush
   the user with a picker), so typing `14.3.2026` or `14 mars 2026` directly still works. Wired
   into `PlaceStatusSheet` (already the one shared sheet for country/subdivision/city — no
   duplication needed) and `TripForm`. New device-local `Settings.defaultDateToToday` (default
   `true`, toggle in Settings → Preferences) gates whether a brand-new place's date pre-fills to
   today; only applies when the place has no existing entry yet, so reopening an already-logged,
   still-undated place doesn't suddenly get stamped with today's date.
2. **Trip ordering.** [`src/domain/tripPlaces.ts`](atlas/src/domain/tripPlaces.ts) — a trip's
   countries/subdivisions/cities now sort oldest-visit-first (previously alphabetical), same-date
   ties broken by `entry.createdAt` (add order), undated entries pushed to the end and alphabetized
   there. A group's date is the earliest found anywhere in its own subtree (own row folded with
   every child's own earliest date), computed once per node and reused for the tie-break —
   mirrors the existing `recency`/`maxRecency` pattern in `placesList.ts` but ascending instead of
   descending, and *not* applied there (the full Places-tab list stays alphabetical, per the ask).
3. **Small-town region resolution — root cause found, not assumed.** Reported bug: adding
   Vík í Mýrdal (Iceland, pop. ~600) never colours in Suðurland. Decoded the real bundled
   `public/geo/admin1/IS.topo.json` and ran `d3-geo`'s `geoContains` against real coordinates before
   writing any fix: Vík, Höfn and Grindavík all miss direct point-in-polygon containment by
   1.7–5.3 km, while the next-nearest *wrong* region is 15–90 km away in every case (a bundled
   control town, Selfoss, matches directly). So `resolveSubdivisionByPoint`
   ([`src/geo/photon.ts`](atlas/src/geo/photon.ts)) already existed and was already being called —
   it just silently lost on any coastal town whose point fell just outside the *simplified* admin-1
   boundary (`tools/build-geo.mjs`'s per-country size budget rounds coastlines inward). Fix: on a
   point-in-polygon miss, fall back to the nearest polygon by minimum vertex distance (provably ≥
   true edge distance, so it can only under-, never over-, accept) within a new `SUBDIVISION_SNAP_KM`
   (25 km — comfortably covers the observed gaps, far under every observed wrong-answer distance).
   Extracted as a pure, tested `nearestAdmin1Id` helper. New
   [`src/geo/regionBackfill.ts`](atlas/src/geo/regionBackfill.ts) re-resolves any already-saved city
   (any source, not just online — a bundled row's GeoNames admin1Code can independently mismatch)
   still missing a `subdivisionId`, then calls `rebuildDerivedEntries()` so the newly-known ancestor
   actually gets its derived entry. Runs once per device, gated by a new device-local
   `Settings.regionBackfillDone`, triggered from `geoStore.ts` right after `ensureReferenceData`
   resolves (fire-and-forget, doesn't block first paint).

**Verified live, not just unit-tested:** ran the actual app in a real browser session (this
sandbox's existing local IndexedDB, not a fresh install) — searched and added Vík í Mýrdal via
Photon, confirmed its `subdivisionId` resolved to `IS.42` and a derived subdivision entry appeared
(Iceland's "Regions visited" went 0/8 → 1/8), confirmed the date field pre-filled with today's date
in long form, confirmed the Settings toggle empties the field when off, and built a two-city test
trip confirming oldest-first ordering with correct nesting under a shared subdivision. The one-time
backfill also ran unprompted against this session's pre-existing local data and logged
`geo: region backfill resolved 360/383 orphaned cities` — strong incidental confirmation at real
scale, not just the three towns checked by hand.

`npx tsc -b`, `npx eslint .`, `npx vitest run` (219/219, +23 new tests across `dateFormat.test.ts`,
`photon.test.ts`, and extended `tripPlaces.test.ts`) all clean. `npm run build` fails locally in
this sandbox with `ReferenceError: crypto is not defined` inside `vite-plugin-pwa`'s workbox step —
confirmed this reproduces identically on unmodified `main` (`git stash` and rebuilt), and under the
project's mandated Node 20.20.2 binary directly (not just whatever's on `PATH`), so it's a sandbox-
local anomaly, not a regression. Confirmed harmless: pushed to `main` and the GitHub Actions
`deploy.yml` pipeline (fresh `ubuntu-latest` runner) ran lint → test → build → deploy end-to-end
successfully — [run 31696627739](https://github.com/Bjartthor/Traveling-Salesman/actions/runs/31696627739),
all green, deployed to GitHub Pages.

**Also resolved this session, closing out an item from "Left for next session" above:** the user
applied the `fs.inotify.max_user_instances` sysctl fix themselves (128 → 1024), so the `EMFILE`
`npm run dev` flakiness noted earlier should no longer recur.

## Bug fix: globe region selection — silent misses on tap, blank names on the sheet (done)

Reported by the user: selecting regions on the globe "doesn't work for every region," names
sometimes don't come through, and tapping some regions does nothing — while the flat map "works
perfectly." Treated the two symptoms (blank name vs. no response at all) as probably two different
bugs rather than hunting for one root cause, since they don't obviously share a mechanism. That
turned out right: one is a GlobeMap-only hit-testing bug, the other is a pre-existing data-layer
gap that affects both maps equally but is severe enough (see the numbers below) that the user was
always going to run into it eventually, and apparently did so via the globe first.

### Bug 1 — GlobeMap's tap hit-test could disagree with its own rendering

**Root cause, measured, not assumed.** [`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx)'s
`handleTap` inverted the tapped screen point to a lon/lat coordinate and ran d3-geo's `geoContains`
against each feature's polygon independently — a completely separate code path from `draw()`, which
paints those same features to the canvas. For the *selected* country, once zoomed in past
`ADMIN1_ZOOM_THRESHOLD`, `draw()` swaps to a higher-resolution per-country outline
(`countryDetailFeatureRef`, see the earlier "higher-fidelity coastlines" session) for the visible
shape — but `handleTap` kept testing taps against the coarser world-topology shape underneath it.
Two different polygons; only one was ever actually on screen. WorldMap has no equivalent bug: its
hit-testing *is* the rendered SVG `<path>`'s own `onClick`, so whatever's drawn is by definition
what gets clicked. A canvas has no such guarantee for free.

Measured the gap directly against the real bundled Iceland topology rather than guessing: walked
every vertex of the higher-resolution `countryDetail` polygon for `IS` and checked each one against
the coarse world-topology polygon with `geoContains` — **824 of 2,030 vertices (40.6%) fall outside
the coarse shape**. Rasterized both polygons at a real projection/zoom centred on one such
divergent stretch of coastline and sampled pixels solidly inside the detail shape but outside the
coarse one: **5 of 6 real tap points landing on visibly-rendered Icelandic coastline would have
been silently rejected** by the old check (falls through to `onDeselectRef.current()` —
indistinguishable from "nothing happens").

Before concluding this was the mechanism, first ruled out a broader "geoContains just disagrees
with the canvas renderer sometimes" theory (winding order, holes, antimeridian) — rasterized ~20
countries (including archipelagos, Lesotho-as-a-hole-in-South-Africa, antimeridian-adjacent Fiji)
plus their admin-1 subdivisions and compared every solidly-interior pixel against `geoContains` on
whatever feature actually rendered there: mismatch rate was ~0 everywhere except this one specific,
structural coarse/detail split. Worth remembering if a similar report ever comes up again —
`geoContains` itself is trustworthy against this project's real topology; the bug was a
render/hit-test *shape* mismatch, not the point-in-polygon math.

**Fix**: replaced the analytical `geoContains` check (for countries and admin-1 — city
hit-testing, a simple pixel-radius check against the last-drawn markers, was never geometry-based
and left untouched) with an offscreen "pick buffer": a throwaway canvas painted with one flat,
unique colour per feature, in the *exact same shapes and paint order* `draw()` itself just used —
including preferring `countryDetailFeatureRef` for the selected country under the identical
condition `draw()` checks, and admin-1 painted on top of countries, matching draw order elsewhere.
Reading back the single tapped pixel and decoding its colour to a feature id makes the render/
hit-test mismatch structurally impossible: whatever is on screen is, by construction, what gets
tapped — the same guarantee WorldMap already gets for free from the DOM. This is the standard
"colour/GPU picking" technique for canvas hit-testing. Built lazily inside `handleTap` itself (one
throwaway canvas, reused across taps via a closure variable) rather than maintained per-frame —
hit-testing is only ever needed at the moment of a tap, so this adds zero cost to the drag/zoom
gesture path, unlike the persistent visible canvas.

### Bug 2 — admin-1 ids often aren't in the GeoNames namespace `db.subdivisions` uses, so the place sheet showed a blank title

**Root cause** (predates this session and affects WorldMap too — the user just hadn't hit it there
yet). Each per-country admin-1 topology file's feature `id` is assigned at build time as
`p.gn_a1_code || p.iso_3166_2 || p.adm1_code` ([`tools/build-geo.mjs:436`](tools/build-geo.mjs)).
Only the `gn_a1_code` branch lands in the GeoNames `CC.NN` namespace that `subdivisions.json` (and
therefore `db.subdivisions`) is keyed by — when Natural Earth has no GeoNames cross-reference for a
region, its id falls back to a foreign namespace that never appears in `db.subdivisions`. Tapping
such a region (either map) correctly calls `onSelectSubdivision(id)`, and status-setting works fine
(entries are keyed directly by this same id, no foreign-key dependency on `db.subdivisions`) — but
[`resolvePlaceInfo`](atlas/src/domain/placeInfo.ts) → `db.subdivisions.get(id)` misses, returns
`null`, and `PlaceStatusSheet` renders `<h2>…</h2>` with a blank flag and breadcrumb.

**Measured the real scope**, not just the one report: walked every bundled admin-1 topology and
checked its ids against `db.subdivisions`. **1,239 of 4,447 admin-1 regions worldwide (27.9%) are
orphaned this way, across 100 countries** — several are *completely* affected (United Kingdom
199/199, Uganda 112/112, Italy 110/110, Ireland 34/34, Kosovo 30/30, Malawi 28/28, Sri Lanka 25/25,
Serbia 25/25, Burkina Faso 45/45, and more). A much bigger gap than the single report suggested.

**Fix**: rather than touch the build pipeline or reseed committed geo data — a much larger, riskier
change than this report warrants — added an optional `fallback` parameter to `resolvePlaceInfo`
([`src/domain/placeInfo.ts`](atlas/src/domain/placeInfo.ts)) and optional `fallbackName`/
`fallbackCountryCode` fields to `PlaceRef` ([`src/domain/cascade.ts`](atlas/src/domain/cascade.ts) —
harmless additions every other caller simply doesn't set). Both `WorldMap` and `GlobeMap` already
decode a real `name` for every feature they draw (`decodeLayer`) — `onSelectSubdivision`'s signature
grew from `(subdivisionId) => void` to `(subdivisionId, name) => void` on both, and
[`MapScreen.tsx`](atlas/src/screens/MapScreen.tsx)'s new `selectSubdivision` helper forwards that
name plus the already-known `selectedCode` as the fallback. When `db.subdivisions` misses,
`resolvePlaceInfo` now falls back to that name/country (and still looks up the country's own name
for the breadcrumb, so the fallback path reaches full parity with the normal one) instead of
returning `null`. Fixed for both maps at once, since the underlying data gap is identical on both.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**196/196** — this session's actual baseline;
  `PROGRESS.md`'s previous "219/219" figure did not reproduce even on a clean `git stash` of this
  session's changes, so that was a stale/mismeasured figure from an earlier point, not a regression
  introduced here) all clean. No new pure/testable module — both fixes are either an interaction
  handler or a thin data-fallback path.
- **Same standing environment limitation every prior globe session has hit, reconfirmed once
  more, with a new wrinkle**: `document.hidden` read `false` this session (unlike most prior globe
  sessions) and a real `preview_screenshot`/DOM check of the *flat* map worked cleanly after a
  reload. But the globe canvas's backing store still stuck at its default 300×150 even though
  `canvas.getBoundingClientRect()` reported a correct, real, laid-out size (505×675) — meaning
  `size` (the React state fed by `ResizeObserver`) never updated, so `projectionRef.current` never
  initializes and `handleTap`'s first line (`if (!proj) return`) makes a real dispatched tap a
  guaranteed no-op regardless of any fix. Confirmed this is layout-vs-backing-store, not
  layout-not-happening, ruling out a simpler explanation before falling back to logic-level
  verification. `preview_click` on the flat/globe toggle button also silently failed to register
  (confirmed by reading `settings.mapView` back from Dexie afterward showing no change); a raw
  `element.dispatchEvent(new MouseEvent('click', {bubbles:true}))` worked, matching the exact
  workaround the previous globe session recorded.
- **Compensated with real-data verification**, same standard this project's map work has held
  throughout:
  - Bug 1: the 824/2,030-vertex and 5/6-tap-point figures above are computed directly against the
    real bundled `IS` world and country-detail topologies via the actual `loadWorldTopology`/
    `loadCountryDetailTopology` loaders, not synthetic geometry. The "old vs. new" comparison ran
    the literal old `geoContains`-against-coarse-shape check side by side with the new pick-buffer
    paint-and-readback logic (transcribed faithfully from the shipped code) against the same real
    gap coordinates in the same probe.
  - Bug 2: found a real orphaned id in the bundled data (`AE.` / "Neutral Zone" in the UAE's
    admin-1 topology) and called the actual, imported `resolvePlaceInfo` with and without the new
    fallback — confirmed `null` without it, confirmed
    `{name: "Neutral Zone", countryCode: "AE", breadcrumb: ["United Arab Emirates"]}` with it.
  - All of the above ran against the real shipped code (dynamic-imported from the live dev server
    via cache-busted `?t=` URLs, per the stale-module-cache lesson from the first globe session),
    not a simplified stand-in.
- **Not verified live**: an actual on-device tap on the globe, watching a region highlight and the
  sheet open with the right name — blocked by the `ResizeObserver` issue above, the same gap every
  globe session to date has recorded. Both fixes are real-data-proven at the logic level (see
  above), not felt on a real screen yet.

### Left undone / worth a look next session

- Bug 2's fix is a **display-layer** patch, not a data one — `db.subdivisions` itself still has no
  row for those 1,239 regions, so anything else that ever keys off that table for one of them
  (nothing currently does, beyond display) would still miss. A proper fix would cross-reference
  Natural Earth's `iso_3166_2`/`adm1_code` fallback against GeoNames at build time in
  `tools/build-geo.mjs` — the same class of fix the previous session already applied to city→
  subdivision resolution (`nearestAdmin1Id`/`SUBDIVISION_SNAP_KM`). Not attempted here since it
  means regenerating and re-committing geo data, a bigger and riskier change than this report
  called for.
- Real on-device confirmation that taps now land correctly and feel responsive — blocked in this
  sandbox the same way every prior globe-interaction session has been blocked.

## Globe zoom now turns to face what you're zooming into, instead of just magnifying it at an angle (done)

Reported immediately after the tap/name fixes above shipped: "if I zoom in on a country in the
right top corner... then when I am zoomed in on that country it isn't seen on an angle rather it
is seen like it is vertical" — zooming toward an off-centre point (the earlier "wheel/pinch zoom
always zoomed toward the centre" fix) kept it pinned to the same screen position while scaling up,
but never turned the sphere to face it, so it stayed visibly foreshortened the whole time, just
bigger. Went straight to implementation — the ask was unambiguous, a direct continuation of the
zoom-toward-cursor feature two sessions ago.

**Why scale alone can't fix this**: an orthographic projection foreshortens everything away from
its own centre — the same reason the limb of a real globe or planet looks "on a slant" no matter
how much you magnify it. Only *rotating* the sphere to bring a point toward the projection's centre
makes it render face-on; zoom level has nothing to do with it.

### What was built

- **[`rotationTowardPoint(rotation, target, t)`](atlas/src/components/map/globeMath.ts)`** — new
  pure helper (6 tests), same "logic lives outside the component" precedent as the rest of this
  file. Uses `d3.geoInterpolate` to slide `t` of the way along the great circle from the currently-
  centred point toward `target`, preserving roll. Confirmed directly from `d3-geo`'s own source
  (not assumed) that `geoInterpolate` degrades to a constant when the two points already coincide,
  so re-zooming on an already-centred point is a safe no-op, not a divide-by-zero.
- **[`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx)'s `zoomAt`** rewritten around rotation
  instead of translate. On every zoom-*in* tick it rotates a fraction of the remaining great-circle
  distance toward a target point — `t = 1 - oldZoom/newZoom`, so a doubling always rotates the same
  fraction of what's left regardless of the zoom level it starts from, and a sustained scroll/pinch
  converges smoothly rather than snapping straight to centred on the first tick. Zooming out is
  untouched (scale only, no rotation) — foreshortening at the edges is the normal, expected look of
  being zoomed out.
- **The zoom target is locked once per zoom-in sequence, not re-sampled every tick** — this was the
  one piece that needed a real second pass (see the bug caught during verification below).
  `zoomTarget`/`zoomTargetAnchor` (plain closure variables, same "gesture state doesn't need to be
  React-visible" precedent as `drag`/`pinchStart`) hold the locked lon/lat and the screen position it
  was captured at. A new zoom-in re-samples only when there's no current lock, the anchor has
  drifted more than `ZOOM_TARGET_DRIFT_PX` (32px, generous enough for natural cursor/pinch-midpoint
  jitter) from where the lock was taken, or a manual drag-rotate happened in between (which changes
  `rotationRef.current` without going through `zoomAt` at all, silently invalidating any promise the
  lock made). Zooming back out clears the lock outright, so the next zoom-in anywhere starts fresh.
- **Simplification that fell out of this for free**: since turning to face a point is now this
  component's entire mechanism for "zoom toward a point," `translateRef` (the off-centre screen
  offset the previous session's fix introduced) is gone entirely — `draw()` now always centres the
  projection in its container as a plain function of the current canvas size, recomputed fresh every
  frame. That also deletes the old `zoomAt`'s explicit "recentre at MIN_ZOOM" special case (translate
  can no longer drift in the first place, so there's nothing left to recentre).

### Bug caught during verification, not assumed to be right the first time

The first version re-sampled `proj.invert([localX, localY])` fresh on *every* tick rather than
locking it once. Real-data check (see below) showed it converging to *something* centred, but not
reliably the country the gesture actually started on. Root cause: a centred scale change alone —
before rotation has caught up at all — already pulls whatever's at a fixed screen pixel toward
whichever point is *currently* centred (the same way zooming into a photo without panning reveals
more of what was already in the middle). Re-inverting the same pixel after every tick's scale bump
therefore chases a target that's itself drifting toward the old centre, not the place the user
actually pointed at. Concretely: a real corner tap that inverted to China, run through 12 simulated
wheel ticks, ended up centring **Russia**. Locking the target once (see above) and confirming with
the same simulation fixed it — the same corner, same 12 ticks, correctly converges on and *stays*
on the country actually under the cursor when zooming started (Kazakhstan, in the corrected test —
see below for why the country differed between the two checks).

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**202/202**, +6 for `rotationTowardPoint`) and the
  full app all clean.
- **Same standing `ResizeObserver`-in-this-sandbox limitation as every globe session before this
  one** — reconfirmed once more, with the added wrinkle that `document.hidden` flipped between
  `false` and `true` *within this single session* (unlike most prior sessions, where it was
  consistently one or the other throughout) — the globe canvas mounted, and the flat-map SVG
  rendered and screenshot correctly once, but the globe canvas's backing store never got a real
  size, so a live dispatched wheel/pinch gesture still couldn't be watched end-to-end. Fell back to
  the same real-topology-simulation technique prior sessions used for the same reason.
- **Real-data verification, the same standard this project's map work has held throughout** — all
  run against the actual shipped `rotationTowardPoint`/`clampScale` and a faithful transcription of
  the shipped `zoomAt`, against the real bundled world topology, not synthetic geometry or a
  simplified stand-in:
  - The bug above, caught and then confirmed fixed, as described.
  - A realistic sustained zoom-in (20 simulated wheel ticks) at a screen point actually on the
    visible globe at the starting zoom level: the angular offset of whatever's under the fixed
    cursor position from the view's centre shrinks smoothly and monotonically, tick by tick, from
    ~43° down to ~0.4° — i.e., the corner country visibly turns to face the camera as zooming
    continues, not just grows.
  - Zoom-in → zoom-out → zoom-in-elsewhere: confirmed the lock correctly clears on zoom-out
    (`zoomTarget === null`) and a subsequent zoom-in at a new corner correctly converges to *that*
    corner's actual country (Iran), not the first corner's (Kazakhstan) — ruling out a stuck/stale
    lock.
  - Continuing to zoom in while the cursor jumps 594px to the opposite corner (no intervening
    zoom-out, exercising the `ZOOM_TARGET_DRIFT_PX` path specifically rather than the zoom-out-clears
    path): confirmed the lock re-targets to whatever's actually at the new position, converging
    there (angular offset ~15° → ~0.5° over the following ticks) rather than continuing to chase the
    old corner.
- **Not verified live**: an actual on-device wheel-scroll or pinch, watching the globe visibly turn
  to face a corner country as it's zoomed — blocked by the environment limitation above, the same
  gap every globe-interaction session to date has recorded. The convergence math itself is now
  proven against real topology (see above), including the specific failure mode a first attempt
  actually had, not just reasoned through.

### Left undone

Not confirmed on a real device with an actual scroll wheel or pinch gesture, for the reason above.
`ZOOM_TARGET_DRIFT_PX` (32px) is a reasoned-but-picked constant, same "easy to retune" status as
`CLICK_DISTANCE`/`CITY_HIT_RADIUS` — worth a look if a real trackpad's pinch-midpoint jitter turns
out to exceed it (would cause spurious re-targeting mid-gesture) or if it feels too sticky (targeting
a deliberately different nearby spot doesn't re-lock quickly enough).

## Zoomed-in region taps silently deselecting the whole country on a real phone (done)

Reported after the pick-buffer fix above shipped and went live on GitHub Pages: "it only works now
on computer not on the phone" for selecting regions in the globe view. First checked the deploy
itself — commit 812e0cd was on `origin/main` and its GitHub Actions run had completed successfully,
so the fix was genuinely live; this wasn't a stale-service-worker report (Atlas's `registerType:
'prompt'` PWA update flow was double-checked and is a real possibility for "works on computer, not
phone" reports in general, but the user confirmed they were on the latest version).

Narrowed down over several rounds of clarifying questions: **only** when zoomed into a country to
see its admin-1 regions (never at the world view), on Android Chrome, failing on taps "not at all
far from" centre, **every single time**.

**Reproducing it**: this sandbox's standing `ResizeObserver`-never-sizes-the-canvas limitation
didn't reproduce this session (`document.hidden` read `false`, same intermittent wrinkle noted in
the last few globe sessions) — the globe canvas actually laid out and painted correctly under
`preview_*`, and dispatched `PointerEvent`s (`pointerdown`/`pointerup` with real `pointerType:
'touch'`) drove `handleTap` end-to-end for the first time in this project's history. Real
`getImageData` reads against the live canvas (not assumed) confirmed exactly what was under each
synthetic tap before trusting the result.

First swept taps across the *entire* vertical range of the unzoomed globe (top to bottom, real land
pixels only) — every one correctly selected the right country. Then swept a zoomed-in admin-1 view
(Canada, then a tight grid within 70px of dead-centre on Libya) the same way — the overwhelming
majority succeeded, with only the odd isolated miss at small admin-1 polygons no bigger than the
sampling grid (unrelated noise, not the reported bug). Position on screen was a dead end.

The actual reproduction came from timing, not geometry: zoom a country in past `ADMIN1_ZOOM_THRESHOLD`
and tap the same spot **immediately**, with no wait for the per-country `loadCountryTopology` fetch
to resolve (previous rounds of this same test had, without thinking about it, always waited ~1s
after zooming "to let things settle" before tapping — exactly the gap a real mobile network fills
with actual latency that this project's localhost dev server never has). Confirmed: the country
sheet **closed** — the already-selected country got silently deselected — both immediately and a
full second later (the tap had already fired and resolved before any data arrived; nothing about
it self-heals once the fetch does complete).

**Root cause**: while `admin1FeaturesRef.current` is still empty (fetch in flight), `showingAdmin1`
is `false`, so `handleTap`'s pick-buffer paints only the selected country's own coarse/detail
shape — a tap anywhere on that country's body resolves to `{kind:'country', id: selectedCode}`.
That's the *same* id as the already-selected country, and `MapScreen.selectCountry`'s toggle
(`prev === code ? null : code`) treats re-tapping an already-selected country as "back out to the
world view." A tap meant for a region instead silently zoomed the user back out from under their
own thumb — with no loading indicator anywhere to suggest waiting a moment would help. Fully
explains every detail of the report: only reachable while zoomed in (the world view has no lazy
per-country fetch to race), fails "near centre" (centre is reliably still on the country's own
landmass, not any specific region), Android Chrome (real network latency makes the race trivial to
hit), and "every time" (deterministic once the tap wins the race, which it almost always will on a
real connection).

**Same bug, same fix, also found in WorldMap**: the flat map shares the identical
`MapScreen.selectCountry` toggle semantics, and its own selected-country `<path>` (and the
higher-res `countryDetailPath` painted on top of it, same reveal condition) has an unconditional
`onClick={() => onSelectCountry(p.id)}` with nothing guarding the "admin-1 hasn't loaded yet, or a
tap landed in the coastline gap between the two independently-simplified layers" case either — the
admin-1 `<g>` only intercepts the click once it actually has paths to render. Not reported yet, but
structurally the same defect, so fixed alongside rather than left for a second report.

### What was built

- **[`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx)'s `handleTap`**: after decoding the
  pick-buffer pixel, a pick that resolves to the country kind *and* matches `selectedCode` while
  `zoomRef.current >= ADMIN1_ZOOM_THRESHOLD` is now treated as a miss (no-op) instead of forwarded
  to `onSelectCountryRef`. Covers both the fetch-in-flight race and the rarer coastline-gap case
  (a tap landing between the country's own outline and an admin-1 polygon that doesn't quite reach
  the edge) with the same one-line rule, since both are "zoomed in and the tap didn't land on a
  specific region" — the toggle-to-deselect gesture only makes sense at the world-view granularity,
  before drilling into a country's regions. Tapping elsewhere (dead space, another country) still
  deselects exactly as before; the country sheet's own close button remains the reliable way to
  back out once zoomed in, including for the (legitimate) countries with no admin-1 file at all.
- **[`WorldMap.tsx`](atlas/src/components/map/WorldMap.tsx)**: identical `p.id === selectedCode &&
  overThreshold` guard added to both the plain country path's `onClick` and the `countryDetailPath`
  overlay's (the higher-res twin painted on top while admin-1 is loading) — `overThreshold` already
  existed as the component's own `transform.k >= ADMIN1_ZOOM_THRESHOLD`, no new state needed.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**202/202**, unchanged — this is a control-flow
  fix with no new pure logic to unit-test) all clean.
- **Live, on this session's cooperating sandbox** (not just simulated against real topology, for
  once): reproduced the exact failure end-to-end against the pre-fix code (zoom a real country past
  threshold, tap dead-centre immediately, watch the country sheet close), then re-ran the identical
  script against the fix — the country now stays selected through the same immediate tap, and a
  second tap at the same spot once the fetch has actually resolved correctly opens the real
  subdivision there (confirmed by name, e.g. Libya's "Murzuq District"). Re-verified the *legitimate*
  toggle-to-deselect still works untouched at the world-view zoom level, on both maps, so this isn't
  a regression dressed as a fix.
- Root-caused via real interaction, not inferred from reading the code alone: the first several
  rounds of testing (full-vertical-range sweeps, near-centre grids, a two-pointer pinch simulation)
  all failed to reproduce anything resembling the report — worth recording that "position on screen"
  was a red herring the user's own phrasing pointed at, and the real variable was timing, found only
  by removing an assumption (the settle-wait between zooming and tapping) that every earlier test,
  including this session's own first few attempts, had been quietly making.

### Left undone

No loading affordance while a zoomed-in country's admin-1/detail data is still fetching — a tap
during that window is now a harmless no-op instead of a silent deselect, but it still gives the user
no feedback that waiting a moment (rather than tapping again right away) is what's needed. Worth a
follow-up if premature taps turn out to be common enough in practice to be worth an explicit
loading state.

## A real touchscreen's own trailing click was closing the place sheet a tap had just opened (done)

The deselect-race fix above didn't fully close the report — back on a real phone (Android Chrome),
selecting a country's regions was still failing, but differently than any theory so far: "only
bavaria, baden-württemberg, rheinland-pfalz, hesse, thuringia (lower parts) and saxony (lower parts)
opened, the regions north of them didn't" — and separately, dragging the globe so a failing spot
moved lower on the screen made it work. A real, clean, position-dependent split, reported after
confirming the update banner had been accepted — not a stale build.

Extensive same-session testing (full-vertical-range sweeps, near-centre grids, a two-pointer pinch
simulation, all against real topology through a live dispatched-`PointerEvent` harness) had already
failed to find any such correlation. Rather than keep guessing, shipped a build that logged every
tap's full numbers — screen/local coordinates, canvas CSS vs backing-store size, the projection's
own translate/scale, `visualViewport` vs `innerHeight` — to Atlas's existing on-device debug log
(the same one from the OOM investigation), and asked for a real capture. It came back decisive but
not in the expected shape: **every single logged tap resolved to the correct pick** — Niedersachsen
and Nordrhein-Westfalen (both "regions north" the user said hadn't opened) show up in the log as
correctly identified, `onSelectSubdivisionRef` and all. Hit-testing was never the bug, on a real
device or otherwise — something downstream of a correct pick was undoing it.

**Root cause**: real touchscreens synthesize a trailing compatibility `mousedown`/`mouseup`/`click`
sequence after a tap, dispatched to *whatever element the browser hit-tests at that point when the
synthesis fires* — which, by then, is not necessarily what was there when the tap started. GlobeMap
never called `preventDefault()` on its pointer events, so this fired after every tap. A tap that
correctly opened `PlaceStatusSheet` for a subdivision (via `onPointerUp` → `handleTap`, synchronously)
was then immediately re-hit by that trailing click — landing on `.place-sheet-backdrop`
(`onClick={onClose}`) if the tap's screen position was above the sheet panel's own top edge, since
the panel only covers the bottom portion of the screen and stops propagation for anything landing on
it. Confirmed directly, independent of the map entirely: opened the sheet via the store, then
dispatched a real `click` (via `document.elementFromPoint`, mirroring how the browser retargets the
synthesized event) at a point above the panel — sheet closed; at a point on the panel itself — sheet
stayed open. That is exactly "lower parts work, higher parts don't, and dragging a spot lower makes
it work" — the *position* was real, but it was about where the tap landed relative to the sheet's own
layout, not about anything the globe's projection or hit-testing was doing.

### What was built (round 1 — necessary but not sufficient)

- **[`GlobeMap.tsx`](atlas/src/components/map/GlobeMap.tsx)'s `onPointerDown`** now calls
  `e.preventDefault()` first thing — the standard, spec-documented way to opt an element out of the
  browser's touch-to-mouse-event compatibility synthesis entirely, same as calling it on `touchstart`
  would. Left in place (still correct practice for a canvas-driven custom gesture handler), but see
  below — on the user's actual phone, this alone did not stop the trailing click.
- Not applied to `WorldMap.tsx`: its country/subdivision selection is a plain `onClick` on each SVG
  path, not a custom pointerdown/pointerup scheme running ahead of the native click — there's no
  second, later event to race against the first, so this specific failure mode doesn't apply there.

Reproduced and confirmed the *mechanism* directly and independently of the map (opened
`PlaceStatusSheet` via its store, dispatched a synthetic click above vs. on the panel — closed vs.
stayed open, matching the report) — but real on-device confirmation of the *fix* was still
outstanding, and this session's standing sandbox canvas-sizing limitation meant a live end-to-end
retest wasn't possible here either.

### Round 2 — the real device said otherwise

Shipped with the `preventDefault()` fix live, the user tried again: "didn't quite work... there is a
very short pop up (like 1 frame)". Progress (the close was no longer instant/invisible, it was now
visibly happening a beat later), but not fixed. Rather than guess again, instrumented every path that
can close the sheet — backdrop click, header close button, Escape key, a status getting picked, an
entry getting removed — each tagged with a reason and a millisecond timestamp since open, logged to
the same on-device debug log. A real capture across Germany and Poland came back completely
unambiguous: sheets closed by `close-button` at 600-1100ms (the user deliberately looking, then
dismissing — the regions that "worked") and sheets closed by **`backdrop-click` at 70-77ms, almost
every single time**, timing far too consistent to be an accidental second tap. `preventDefault()` on
`pointerdown` had not, in fact, stopped the browser from producing that click on this real device.

Rather than keep chasing exactly which browser-internal mechanism was still producing it, fixed the
measured symptom directly: no genuine, deliberate "tap outside to dismiss" happens in under 300ms of
a sheet opening, so the backdrop's click handler now simply ignores anything faster than that.

### What was built (round 2 — the actual fix)

- **[`PlaceStatusSheet.tsx`](atlas/src/components/places/PlaceStatusSheet.tsx)**: a
  `SPURIOUS_BACKDROP_CLICK_GUARD_MS = 300` guard on the backdrop's click handler — a click within
  300ms of the sheet mounting (tracked via a plain `openedAtRef`, no state) is ignored; anything later
  closes normally, same as always. Doesn't touch the close button, Escape, or the status/remove
  actions — those are deliberate taps on small, specific targets, not a broad catch-all area a phantom
  click could land on by chance, and the real capture never showed a phantom hitting them either.
- Removed the round-1 and round-2 diagnostic logging once the fix was confirmed — both did their job
  (proved hit-testing was never the bug, then pinned the exact timing/source of what was) and were
  always meant to come back out again afterward.

### Verified

- `npx tsc -b`, `npx eslint .`, `npx vitest run` (**202/202**, unchanged) clean after both rounds.
- Round 2's guard was verified live and directly against the real store/DOM (same technique as
  round 1, still not dependent on this sandbox's canvas limitation): a synthetic click ~30ms after
  open is ignored and the sheet stays open; a later click (past the guard) still closes it normally —
  confirmed via the debug log showing `ignored early backdrop click` then, later, a genuine
  `close reason=backdrop-click`.
- **Confirmed fixed on the user's real device** (Android Chrome) after round 2 shipped — region
  selection across multiple countries works normally. This is the one that needed a real phone to
  actually confirm, and now has that confirmation.

### Left undone

- The exact browser-internal mechanism still producing that ~70-77ms trailing click, even past
  `preventDefault()` on `pointerdown`, was never identified — the guard fixes the symptom
  unconditionally rather than requiring that understanding, but if a similar phantom-click pattern
  ever shows up somewhere `preventDefault()` was expected to be sufficient, this is a data point that
  it isn't always, at least on Android Chrome.
- The same class of stray click could in principle land on one of the sheet's status buttons instead
  of the backdrop, silently recording a status the user never chose — flagged as a risk in round 1,
  never actually observed in either round's real captures (every phantom in the data hit the backdrop
  specifically), and the 300ms guard only protects the backdrop, not the status buttons. Worth
  watching for a "status changed to something I didn't pick" report specifically; if one shows up, the
  same guard technique applied to `pick()`/`remove()` would be the fix.
