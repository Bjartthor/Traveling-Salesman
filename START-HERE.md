
## Project Structure (from graphify)

See interactive graph: ./graphify-out/graph.html

Key components:
# Graph Report - /home/bjartthor/BSA/Traveling_Salesman  (2026-07-27)

## Corpus Check
- cluster-only mode — file stats not available

## Summary
- 458 nodes · 526 edges · 58 communities (39 shown, 19 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `eb3c7891`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- devDependencies
- cascade.ts
- build-geo.mjs
- compilerOptions
- dependencies
- coverage.ts
- compilerOptions
- types.ts
- placesList.ts
- package.json
- repo.ts
- loader.ts
- search.ts
- placesList.test.ts
- cascadeRepo.ts
- photon.ts
- BottomNav.tsx
- cascade.test.ts
- cityWrites.ts
- CoverageStrip.tsx
- statusColor.ts
- bulkResolve.ts
- WorldMap.tsx
- BulkAddScreen.tsx
- CountryDetail.tsx
- coverage.test.ts
- CoverageHeadline.tsx
- useTweenedNumber.ts
- CountryAdmin1Map.tsx
- ManualPlaceForm.tsx
- PlaceStatusSheet.tsx
- schema.ts
- PlacesScreen.tsx
- EmptyState.tsx
- FullScreenOverlay.tsx
- topo.ts
- countryDetailStore.ts
- placeInfo.ts
- placeSheetStore.ts
- GeoGate.tsx
- geoStore.ts
- tsconfig.json
- STATUSES

## God Nodes (most connected - your core abstractions)
1. `compilerOptions` - 22 edges
2. `compilerOptions` - 18 edges
3. `main()` - 14 edges
4. `entryKey()` - 9 edges
5. `virtualise()` - 8 edges
6. `makeResolver()` - 8 edges
7. `buildPlacesTree()` - 8 edges
8. `scripts` - 7 edges
9. `rebuildAllDerived()` - 7 edges
10. `ancestorsOf()` - 6 edges

## Surprising Connections (you probably didn't know these)
- `buildPlacesTree()` --references--> `CONTINENTS`  [EXTRACTED]
  atlas/src/domain/placesList.ts → atlas/src/stats/coverage.ts
- `buildCities()` --references--> `adm-zip`  [EXTRACTED]
  atlas/tools/build-geo.mjs → atlas/package.json
- `main()` --references--> `KNOWN_NO_POLYGON`  [EXTRACTED]
  atlas/tools/build-geo.mjs → atlas/tools/fixups.mjs
- `main()` --references--> `NON_UN_SOVEREIGN`  [EXTRACTED]
  atlas/tools/build-geo.mjs → atlas/tools/fixups.mjs

## Import Cycles
- None detected.

## Communities (58 total, 19 thin omitted)

### Community 0 - "devDependencies"
Cohesion: 0.05
Nodes (41): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals, mapshaper, @types/d3-geo (+33 more)

### Community 1 - "cascade.ts"
Cohesion: 0.12
Nodes (33): ancestorsOf(), CascadeState, CityPlace, countryOfSubdivision(), DatePatch, effectiveStatus(), EntryChanges, EntryFields (+25 more)

### Community 2 - "build-geo.mjs"
Cohesion: 0.13
Nodes (28): adm-zip, adm-zip, ADMIN1_OUT, buildAdmin1(), buildCities(), buildWorldTopo(), CITY_FIELDS, ensureCached() (+20 more)

### Community 3 - "compilerOptions"
Cohesion: 0.07
Nodes (27): compilerOptions, allowImportingTsExtensions, baseUrl, erasableSyntaxOnly, jsx, lib, module, moduleDetection (+19 more)

### Community 4 - "dependencies"
Cohesion: 0.09
Nodes (23): dependencies, d3-geo, d3-selection, d3-zoom, dexie, dexie-react-hooks, react, react-dom (+15 more)

### Community 5 - "coverage.ts"
Cohesion: 0.17
Nodes (22): buildStatusIndex(), CONTINENTS, continentsTouched(), countCitiesVisited(), countryCoverage(), countrySubdivisionsVisited(), countsAsCoverage(), countVisited() (+14 more)

### Community 6 - "compilerOptions"
Cohesion: 0.09
Nodes (22): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+14 more)

### Community 7 - "types.ts"
Cohesion: 0.13
Nodes (18): City, CitySource, Country, CountryDenominator, Entry, EntryKind, Photo, PhotoBlob (+10 more)

### Community 8 - "placesList.ts"
Cohesion: 0.18
Nodes (16): buildPlacesTree(), BuildPlacesTreeInput, CityLookup, ContinentGroup, CountryGroup, matchesFilter(), maxRecency(), PlaceRow (+8 more)

### Community 9 - "package.json"
Cohesion: 0.17
Nodes (11): name, private, scripts, build, build:geo, dev, lint, preview (+3 more)

### Community 10 - "repo.ts"
Cohesion: 0.17
Nodes (9): Draft, entriesRepo, Patch, photoBlobsRepo, photosRepo, settingsRepo, syncStateRepo, tripEntriesRepo (+1 more)

### Community 11 - "loader.ts"
Cohesion: 0.24
Nodes (11): CitiesFile, countryTopoPromises, decodeCitiesPayload(), ensureReferenceData(), GeoLoadPhase, GeoProgress, geoUrl(), isReferenceDataReady() (+3 more)

### Community 12 - "search.ts"
Cohesion: 0.26
Nodes (10): buildIndex(), CityResult, countryNames, getIndex(), IndexRow, matchWeight(), normalize(), searchCities() (+2 more)

### Community 13 - "placesList.test.ts"
Cohesion: 0.20
Nodes (4): CITIES, COUNTRIES, ENTRIES, SUBDIVISIONS

### Community 14 - "cascadeRepo.ts"
Cohesion: 0.46
Nodes (6): applyMutations(), loadCascadeState(), rebuildDerivedEntries(), removePlaceEntry(), setPlaceStatus(), UnknownCityError

### Community 15 - "photon.ts"
Cohesion: 0.29
Nodes (6): commitPhotonResult(), PhotonFeature, PhotonProps, PhotonResult, resolveSubdivisionByPoint(), SETTLEMENT_LAYERS

### Community 17 - "cascade.test.ts"
Cohesion: 0.38
Nodes (4): applyToFixture(), CITIES, derived(), mkEntry()

### Community 18 - "cityWrites.ts"
Cohesion: 0.43
Nodes (6): addManualCity(), addOnlineCity(), insertCity(), ManualCityInput, nextSyntheticId(), OnlineCityInput

### Community 19 - "CoverageStrip.tsx"
Cohesion: 0.40
Nodes (5): compact, CoverageStrip(), CoverageStripProps, formatTotal(), nf

### Community 20 - "statusColor.ts"
Cohesion: 0.33
Nodes (4): STATUS_COLOR_VAR, STATUS_DESCRIPTION, STATUS_LABEL, STATUS_ORDER

### Community 21 - "bulkResolve.ts"
Cohesion: 0.40
Nodes (3): classifyLine(), LineResolution, resolveLines()

### Community 22 - "WorldMap.tsx"
Cohesion: 0.40
Nodes (3): Size, SPHERE, WorldMapProps

### Community 28 - "useTweenedNumber.ts"
Cohesion: 0.83
Nodes (3): easeOutCubic(), prefersReducedMotion(), useTweenedNumber()

### Community 33 - "PlacesScreen.tsx"
Cohesion: 0.67
Nodes (3): FILTERS, PlacesScreen(), SORTS

## Knowledge Gaps
- **196 isolated node(s):** `name`, `private`, `version`, `type`, `dev` (+191 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `devDependencies` connect `devDependencies` to `package.json`, `build-geo.mjs`?**
  _High betweenness centrality (0.042) - this node is a cross-community bridge._
- **Why does `adm-zip` connect `build-geo.mjs` to `devDependencies`?**
  _High betweenness centrality (0.021) - this node is a cross-community bridge._
- **What connects `name`, `private`, `version` to the rest of the system?**
  _196 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `devDependencies` be split into smaller, more focused modules?**
  _Cohesion score 0.04878048780487805 - nodes in this community are weakly interconnected._
- **Should `cascade.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._
- **Should `build-geo.mjs` be split into smaller, more focused modules?**
  _Cohesion score 0.12643678160919541 - nodes in this community are weakly interconnected._
- **Should `compilerOptions` be split into smaller, more focused modules?**
  _Cohesion score 0.07142857142857142 - nodes in this community are weakly interconnected._