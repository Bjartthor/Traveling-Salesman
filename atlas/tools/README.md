# Geo data pipeline

Turns public geographic datasets into small, committed artefacts under
`../public/geo/`. The app never contacts a third party for geo data at runtime —
these files are the source of truth and are committed to the repo.

## Regenerate

```bash
cd atlas
npm run build:geo
```

**Requires Node 20+** (global `fetch`, top-level `await`). This sandbox's default
shell has Node 18; select 20 first:

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20
```

The script downloads sources into `tools/.cache/` (gitignored) on first run, so
subsequent runs are fast and offline. Delete `.cache/` to force a fresh download.
It prints a per-artefact size report and **exits non-zero, naming the entity**, if
any country fails to reconcile between Natural Earth and GeoNames.

## Files

| File | What |
|---|---|
| `build-geo.mjs` | The pipeline. Fetch → parse → validate (fail-loud) → write. |
| `fixups.mjs` | Explicit override tables. The one place to look when a data refresh breaks a join. |
| `minor_fixes.md` | Deferred, non-blocking data issues and how to resolve them later. |

## Sources (all free)

| Source | Used for | Licence |
|---|---|---|
| Natural Earth 1:10m Admin 0 – Countries (nvkelso GeoJSON mirror) | World map shapes, ISO codes | Public domain |
| Natural Earth 1:10m Admin 1 – States/Provinces (S3 shapefile) | Subdivision shapes, ISO-2, type, centroids | Public domain |
| GeoNames `countryInfo.txt` | Area, population, capital, continent, ISO3 | CC BY 4.0 |
| GeoNames `admin1CodesASCII.txt` | Canonical subdivision list + names | CC BY 4.0 |
| GeoNames `cities1000.zip` | ~170k cities over 1,000 people | CC BY 4.0 |

**GeoNames is CC BY 4.0 — the app shows the attribution line (About screen, Phase 7).**

The world map used to source from 1:50m Admin-0; a later polish pass (see PROGRESS.md)
upgraded it to 1:10m — the same resolution admin-1 already used — because 1:50m simplified
small/detailed coastlines (Iceland, Norway's fjords) down to near-nothing. See "Outputs" below.

## Outputs (`../public/geo/`)

| Artefact | ~Size | Notes |
|---|---|---|
| `world.topo.json` | 671 KB | All 250 countries/territories, dissolved per ISO code. Object `countries`, props `{code,name}`. Budget < 900 KB. |
| `admin1/<CC>.topo.json` | ≤ 76 KB | One per country with subdivisions (240 files). Object `admin1`, props `{id,name}`. Big countries simplified harder to fit < 150 KB. Features sharing an `id` are dissolved into one before writing — see below. |
| `countries.json` | 53 KB | 250 reference rows. |
| `subdivisions.json` | 540 KB | 3865 rows, GeoNames-authoritative, NE-enriched. |
| `cities.json.gz` | 4.2 MB | 170k cities, columnar `{fields, rows}`, gzipped. |

`world.topo.json`'s simplification is **not** a single flat percentage. A flat percentage is a
*global* Visvalingam points budget, and weight tracks effective area — so a landmass the size of
Russia soaks up most of the budget and small, intricate coastlines (Iceland, Croatia, Greece's
islands) are left nearly vertex-free. `WORLD_SIMPLIFY_DETAILED_EXCEPTIONS` in `build-geo.mjs`
names the large/complex-coastline countries that get simplified harder
(`WORLD_SIMPLIFY_EXCEPTION_PCT`, currently 5%) so the rest of the world can keep a much higher
rate (`WORLD_SIMPLIFY_DEFAULT_PCT`, currently 25%) — via mapshaper's `-simplify variable`, still
one shared-topology pass so adjacent countries' borders align exactly. Iceland went from 19
vertices (old flat 8% of 1:50m) to 447; Russia, despite the much bigger source data, actually
*dropped* from its old vertex count because it's now deliberately capped. Tune the two constants
and re-run if a specific country still looks wrong.

## The join, in one paragraph

Countries key on **ISO 3166-1 alpha-2**. Subdivisions key on
**`<CC>.<geonamesAdmin1>`** (GeoNames admin-1 codes, *not* ISO 3166-2 — the cities
file uses the GeoNames codes, so they are canonical; ISO 3166-2 is stored as a
secondary display field where NE provides it). Cities carry `admin1Code`; the
runtime loader derives `subdivisionId = <CC>.<admin1Code>` when that subdivision
exists, else `null`. NE 10m admin-1 joins to GeoNames via its `gn_a1_code` field
(already in `<CC>.<code>` form), which is what makes subdivision enrichment and the
per-country admin-1 shapes line up with everything else.

**That NE→GeoNames join is occasionally many-to-one, not one-to-one** — NE's own
`gn_a1_code`/`gn_id` cross-reference sometimes tags two distinct polygons with the
same GeoNames id (confirmed directly in `ne_10m_admin_1.geojson`: Iceland's
"Reykjavík" and "Höfuðborgarsvæði" both carry `gn_id: 3426182`), and separately, NE
uses a literal `"<CC>."` placeholder (paired with a negative `gn_id`) for polygons it
can't confidently link to GeoNames at all, which every such feature in a country
would otherwise share. Left alone, either case means two differently-shaped map
regions read from the same `Map<id, Status>` entry — setting a status on one paints
both. `buildAdmin1()` runs `-dissolve id copy-fields=name` per country before
simplifying (same technique `buildWorldTopo` uses for multi-piece countries) so this
can't happen, and fails loud if a country's output still has a repeated id after
that. See PROGRESS.md's admin-1 id-collision bug fix for the full investigation.

## What each fixup is for (`fixups.mjs`)

- **`CODE_OVERRIDES`** — Natural Earth stores `-99` in `ISO_A2` for many entities.
  The script tries `ISO_A2`, then `ISO_A2_EH` (recovers France, Norway, Kosovo),
  then this table. Only entry today: `TWN → TW` (NE codes Taiwan `CN-TW`, unusable).
- **`EXCLUDE_NE`** — polygons that are not ISO countries and have no GeoNames row,
  dropped with a reason: Somaliland, Northern Cyprus, Siachen Glacier, plus (since
  the 1:10m upgrade) Cyprus's two UK Sovereign Base Areas, the Cyprus UN buffer
  zone, Guantanamo Bay, a handful of disputed reefs/banks, Bir Tawil and the
  Southern Patagonian Ice Field — administrative/disputed micro-entities the
  coarser 1:50m layer never separated out.
- **`EXCLUDE_GEONAMES`** — withdrawn ISO codes GeoNames still lists: `AN`
  (Netherlands Antilles), `CS` (Serbia & Montenegro).
- **`KNOWN_NO_POLYGON`** — now **empty**. It used to list 11 territories that got
  a country row but no separate world-map polygon at 1:10m (the French DOMs,
  Christmas/Cocos and Svalbard fused into their parent; Bonaire/Bouvet/Tokelau
  omitted). `addTerritoryShapes()` now synthesises a shape for each — see
  `minor_fixes.md` §1 and the `TERRITORY_CARVE` / `TERRITORY_GRAFT_ADMIN1` /
  `TERRITORY_REGION` tables — so the validator now *requires* every GeoNames
  country to have a polygon. Add a code back here only to intentionally exempt one.
- **`TERRITORY_CARVE`** — for territories NE fuses into a parent (`FR`/`NO`/`AU`):
  bounding boxes that tell `addTerritoryShapes()` which of the parent's
  sub-polygons to reassign to the territory. Fails loud if a box matches nothing.
- **`TERRITORY_GRAFT_ADMIN1`** — for territories NE omits from Admin-0 entirely
  (`BQ`/`BV`/`TK`): how to match their shape in the admin-1 layer instead.
- **`TERRITORY_REGION`** — UN M49 subregion for those 11, since a carved/grafted
  shape carries no NE `SUBREGION` to fill `countries.json`'s `region` from.
- **`TERRITORY_OF`** — sovereign parent for the no-polygon territories (no NE
  polygon = no NE sovereignty to read) plus overrides.
- **`TERRITORY_COORDS`** — representative lat/lon for those same territories (no
  polygon = no centroid to compute).
- **`NON_UN_SOVEREIGN`** — the short list of sovereign/parentless entries that are
  *not* UN members (Vatican, Palestine, Kosovo, Taiwan, Cook Is., Niue, Western
  Sahara, Antarctica). `unMember` is derived as
  `territoryOf === null && !NON_UN_SOVEREIGN.has(code)` → exactly 193 members.
- **`CONTINENT_NAMES`** — GeoNames 2-letter continent code → name, used only as a
  fallback for the no-polygon territories (others take NE's richer
  `CONTINENT`/`SUBREGION`).
