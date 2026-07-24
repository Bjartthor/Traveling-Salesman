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
| Natural Earth 1:50m Admin 0 – Countries (nvkelso GeoJSON mirror) | World map shapes, ISO codes | Public domain |
| Natural Earth 1:10m Admin 1 – States/Provinces (S3 shapefile) | Subdivision shapes, ISO-2, type, centroids | Public domain |
| GeoNames `countryInfo.txt` | Area, population, capital, continent, ISO3 | CC BY 4.0 |
| GeoNames `admin1CodesASCII.txt` | Canonical subdivision list + names | CC BY 4.0 |
| GeoNames `cities1000.zip` | ~170k cities over 1,000 people | CC BY 4.0 |

**GeoNames is CC BY 4.0 — the app shows the attribution line (About screen, Phase 7).**

## Outputs (`../public/geo/`)

| Artefact | ~Size | Notes |
|---|---|---|
| `world.topo.json` | 96 KB | All countries, dissolved per ISO code, simplified 8%. Object `countries`, props `{code,name}`. Budget < 500 KB. |
| `admin1/<CC>.topo.json` | ≤ 76 KB | One per country with subdivisions (240 files). Object `admin1`, props `{id,name}`. Big countries simplified harder to fit < 150 KB. |
| `countries.json` | 53 KB | 250 reference rows. |
| `subdivisions.json` | 540 KB | 3865 rows, GeoNames-authoritative, NE-enriched. |
| `cities.json.gz` | 4.2 MB | 170k cities, columnar `{fields, rows}`, gzipped. |

## The join, in one paragraph

Countries key on **ISO 3166-1 alpha-2**. Subdivisions key on
**`<CC>.<geonamesAdmin1>`** (GeoNames admin-1 codes, *not* ISO 3166-2 — the cities
file uses the GeoNames codes, so they are canonical; ISO 3166-2 is stored as a
secondary display field where NE provides it). Cities carry `admin1Code`; the
runtime loader derives `subdivisionId = <CC>.<admin1Code>` when that subdivision
exists, else `null`. NE 10m admin-1 joins to GeoNames via its `gn_a1_code` field
(already in `<CC>.<code>` form), which is what makes subdivision enrichment and the
per-country admin-1 shapes line up with everything else.

## What each fixup is for (`fixups.mjs`)

- **`CODE_OVERRIDES`** — Natural Earth stores `-99` in `ISO_A2` for many entities.
  The script tries `ISO_A2`, then `ISO_A2_EH` (recovers France, Norway, Kosovo),
  then this table. Only entry today: `TWN → TW` (NE codes Taiwan `CN-TW`, unusable).
- **`EXCLUDE_NE`** — polygons that are not ISO countries and have no GeoNames row,
  dropped with a reason: Somaliland, Northern Cyprus, Siachen Glacier.
- **`EXCLUDE_GEONAMES`** — withdrawn ISO codes GeoNames still lists: `AN`
  (Netherlands Antilles), `CS` (Serbia & Montenegro).
- **`KNOWN_NO_POLYGON`** — 13 territories that get a country row but no separate
  polygon at 1:50m. Lets the validator pass while flagging anything *else* missing.
  **This is the documented consequence of using the 1:50m Countries layer — see
  `minor_fixes.md` §1 to graft the shapes in later.**
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
