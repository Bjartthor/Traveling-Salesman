// Geo build pipeline — turns public datasets into small, committed artefacts.
//
//   npm run build:geo
//
// Downloads sources into tools/.cache/ (gitignored, so reruns are fast) and
// writes artefacts into public/geo/. Run manually and commit the results; the
// app never touches a third party at runtime. See 00-PLAN.md §6 and
// 02-geo-data.md, and tools/README.md for the human-facing overview.
//
// Node 20+ required (global fetch, top-level await, DecompressionStream parity).

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'
import mapshaper from 'mapshaper'
import { geoCentroid } from 'd3-geo'
import { feature } from 'topojson-client'
import {
  CODE_OVERRIDES,
  EXCLUDE_NE,
  EXCLUDE_GEONAMES,
  KNOWN_NO_POLYGON,
  TERRITORY_OF,
  TERRITORY_COORDS,
  NON_UN_SOVEREIGN,
  CONTINENT_NAMES,
} from './fixups.mjs'

// Run everything relative to the app root (atlas/), so mapshaper command
// strings use short, space-free relative paths regardless of where the repo
// lives on disk.
const ROOT = fileURLToPath(new URL('..', import.meta.url))
process.chdir(ROOT)

const CACHE = 'tools/.cache'
const OUT = 'public/geo'
const ADMIN1_OUT = path.join(OUT, 'admin1')
const COUNTRY_DETAIL_OUT = path.join(OUT, 'countryDetail')

const SOURCES = {
  countryInfo: {
    file: 'countryInfo.txt',
    url: 'https://download.geonames.org/export/dump/countryInfo.txt',
  },
  admin1Codes: {
    file: 'admin1CodesASCII.txt',
    url: 'https://download.geonames.org/export/dump/admin1CodesASCII.txt',
  },
  cities1000: {
    file: 'cities1000.zip',
    url: 'https://download.geonames.org/export/dump/cities1000.zip',
    binary: true,
  },
  neCountries: {
    file: 'ne_10m_admin_0_countries.geojson',
    url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries.geojson',
  },
  neAdmin1: {
    file: 'ne_10m_admin_1_states_provinces.zip',
    url: 'https://naturalearth.s3.amazonaws.com/10m_cultural/ne_10m_admin_1_states_provinces.zip',
    binary: true,
  },
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const errors = []
const fail = (msg) => errors.push(msg)
const log = (...a) => console.log(...a)
const round4 = (n) => Math.round(n * 1e4) / 1e4
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

async function ensureCached({ file, url, binary }) {
  const dest = path.join(CACHE, file)
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    log(`  cached  ${file}`)
    return dest
  }
  log(`  fetch   ${file}  <-  ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'atlas-travel-tracker/1.0 (geo build script)' } })
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(dest, buf)
  if (binary) return dest
  return dest
}

// mapshaper 0.6 returns a promise from applyCommands; wrap defensively so we
// work whether it resolves or uses the legacy callback.
function runMapshaper(commands, input) {
  const maybe = mapshaper.applyCommands(commands, input)
  if (maybe && typeof maybe.then === 'function') return maybe
  return new Promise((resolve, reject) => {
    mapshaper.applyCommands(commands, input, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

// GeoNames countryInfo.txt columns (tab-separated, '#' comment lines):
// 0 ISO 1 ISO3 2 ISO-Numeric 3 fips 4 Country 5 Capital 6 Area 7 Population
// 8 Continent 9 tld 10 CurrencyCode 11 CurrencyName 12 Phone 13 PostalFmt
// 14 PostalRegex 15 Languages 16 geonameid 17 neighbours 18 EquivFips
function parseCountryInfo(text) {
  const map = new Map()
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue
    const c = line.split('\t')
    const a2 = c[0]
    if (!a2 || a2.length !== 2) continue
    if (EXCLUDE_GEONAMES[a2]) continue
    map.set(a2, {
      code: a2,
      code3: c[1] || '',
      name: c[4] || '',
      capital: c[5] || '',
      areaKm2: Number(c[6]) || 0,
      population: Number(c[7]) || 0,
      continentCode: c[8] || '',
      geonameId: Number(c[16]) || 0,
    })
  }
  return map
}

// admin1CodesASCII.txt: `CC.code \t name \t asciiName \t geonameId`
function parseAdmin1Codes(text) {
  const rows = []
  for (const line of text.split('\n')) {
    if (!line) continue
    const [id, name, asciiName, geonameId] = line.split('\t')
    if (!id || !id.includes('.')) continue
    const [countryCode, ...rest] = id.split('.')
    rows.push({
      id,
      countryCode,
      geonamesAdmin1: rest.join('.'),
      name: name || '',
      asciiName: asciiName || '',
      geonameId: Number(geonameId) || 0,
    })
  }
  return rows
}

// Resolve a Natural Earth country feature to a clean ISO alpha-2, or null.
function resolveA2(props) {
  const adm0 = props.ADM0_A3
  if (EXCLUDE_NE[adm0]) return null
  const clean = (v) => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : null)
  return clean(props.ISO_A2) || clean(props.ISO_A2_EH) || CODE_OVERRIDES[adm0] || null
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  fs.mkdirSync(ADMIN1_OUT, { recursive: true })
  fs.mkdirSync(COUNTRY_DETAIL_OUT, { recursive: true })

  log('\n[1/6] Fetching sources')
  for (const src of Object.values(SOURCES)) await ensureCached(src)

  log('\n[2/6] Parsing reference tables')
  const gnCountries = parseCountryInfo(fs.readFileSync(path.join(CACHE, SOURCES.countryInfo.file), 'utf8'))
  const admin1Rows = parseAdmin1Codes(fs.readFileSync(path.join(CACHE, SOURCES.admin1Codes.file), 'utf8'))
  log(`  GeoNames countries: ${gnCountries.size}  |  admin-1 codes: ${admin1Rows.length}`)

  // Natural Earth countries -> features grouped by resolved A2.
  const neGeo = JSON.parse(fs.readFileSync(path.join(CACHE, SOURCES.neCountries.file), 'utf8'))
  const neByA2 = new Map() // A2 -> { features[], props(first) }
  const droppedNE = []
  for (const f of neGeo.features) {
    const a2 = resolveA2(f.properties)
    if (a2 === null) {
      if (EXCLUDE_NE[f.properties.ADM0_A3]) droppedNE.push(`${f.properties.NAME} (${f.properties.ADM0_A3})`)
      else fail(`Natural Earth feature "${f.properties.NAME}" (ADM0_A3=${f.properties.ADM0_A3}) has no resolvable ISO alpha-2 and is not in EXCLUDE_NE — add a fixup.`)
      continue
    }
    if (!neByA2.has(a2)) neByA2.set(a2, { features: [], props: f.properties })
    neByA2.get(a2).features.push(f)
  }
  log(`  Natural Earth polygons: ${neByA2.size} countries  |  dropped by fixup: ${droppedNE.length} (${droppedNE.join(', ')})`)

  log('\n[3/6] Validating the country join (fail-loud)')
  // Every GeoNames country must have a polygon OR be an intentional exception.
  for (const a2 of gnCountries.keys()) {
    if (!neByA2.has(a2) && !KNOWN_NO_POLYGON.has(a2)) {
      fail(`GeoNames country ${a2} (${gnCountries.get(a2).name}) has no Natural Earth polygon and is not in KNOWN_NO_POLYGON — add a fixup or graft a shape.`)
    }
  }
  // Every polygon must map to a GeoNames country row.
  for (const a2 of neByA2.keys()) {
    if (!gnCountries.has(a2)) {
      fail(`Natural Earth polygon ${a2} (${neByA2.get(a2).props.NAME}) has no GeoNames country row — add a fixup or an exclusion.`)
    }
  }
  if (errors.length) {
    console.error('\n*** BUILD FAILED — unresolved entities:\n')
    for (const e of errors) console.error('  - ' + e)
    process.exit(1)
  }
  log(`  OK — ${gnCountries.size} countries reconciled; ${KNOWN_NO_POLYGON.size} documented no-polygon territories.`)

  // Sovereign-name -> A2, for deriving territoryOf from NE SOVEREIGNT.
  const sovNameToA2 = new Map()
  for (const c of gnCountries.values()) sovNameToA2.set(c.name.toLowerCase(), c.code)
  Object.entries({
    'united states of america': 'US',
    'united states': 'US',
    'united kingdom': 'GB',
    'the netherlands': 'NL', // GeoNames names NL "The Netherlands"...
    netherlands: 'NL', // ...but NE's SOVEREIGNT is plain "Netherlands" (Aruba, Curaçao, Sint Maarten)
    'republic of korea': 'KR',
    'south korea': 'KR',
    'north korea': 'KP',
    "people's republic of china": 'CN',
    china: 'CN',
    'russian federation': 'RU',
    russia: 'RU',
    'czech republic': 'CZ',
    czechia: 'CZ',
    denmark: 'DK',
    france: 'FR',
    norway: 'NO',
    'new zealand': 'NZ',
    australia: 'AU',
  }).forEach(([name, a2]) => sovNameToA2.set(name, a2))

  log('\n[4/6] Writing countries.json')
  const countries = []
  for (const a2 of [...gnCountries.keys()].sort()) {
    const gn = gnCountries.get(a2)
    const ne = neByA2.get(a2)

    // territoryOf: explicit fixup wins; else derive from NE sovereign name.
    let territoryOf = null
    if (a2 in TERRITORY_OF) {
      territoryOf = TERRITORY_OF[a2]
    } else if (ne) {
      const sovName = ne.props.SOVEREIGNT ? ne.props.SOVEREIGNT.toLowerCase() : ''
      const sovA2 = sovNameToA2.get(sovName)
      if (sovA2 && sovA2 !== a2) territoryOf = sovA2
    }

    // centroid: spherical centroid of the NE polygon(s), else fixup coords.
    let lat, lon
    if (ne) {
      const [cx, cy] = geoCentroid({ type: 'FeatureCollection', features: ne.features })
      lat = round4(cy)
      lon = round4(cx)
    } else {
      const coords = TERRITORY_COORDS[a2] || [0, 0]
      lat = coords[0]
      lon = coords[1]
    }

    countries.push({
      code: a2,
      code3: gn.code3,
      name: gn.name,
      unMember: territoryOf === null && !NON_UN_SOVEREIGN.has(a2),
      territoryOf,
      continent: ne ? ne.props.CONTINENT : CONTINENT_NAMES[gn.continentCode] || gn.continentCode,
      region: ne ? ne.props.SUBREGION || '' : '',
      areaKm2: gn.areaKm2,
      population: gn.population,
      capital: gn.capital || null,
      lat,
      lon,
    })
  }
  fs.writeFileSync(path.join(OUT, 'countries.json'), JSON.stringify(countries))
  const unMemberCount = countries.filter((c) => c.unMember).length
  log(`  ${countries.length} countries  |  ${unMemberCount} UN members  |  ${countries.length - unMemberCount} non-members/territories`)

  log('\n[5/6] Building topology (world + admin-1 + per-country detail)')
  await buildWorldTopo(neByA2)
  const { subdivisions, admin1Report } = await buildAdmin1(admin1Rows, countries)
  fs.writeFileSync(path.join(OUT, 'subdivisions.json'), JSON.stringify(subdivisions))
  log(`  subdivisions.json: ${subdivisions.length} rows (${admin1Report.enriched} enriched with NE centroid/ISO, ${subdivisions.length - admin1Report.enriched} from GeoNames only)`)
  log(`  admin1 files: ${admin1Report.files} written; largest ${admin1Report.largestName} @ ${kb(admin1Report.largestBytes)}`)
  const countryDetailReport = await buildCountryDetail(neByA2)
  log(
    `  countryDetail files: ${countryDetailReport.files} written, ${kb(countryDetailReport.totalBytes)} total; largest ${countryDetailReport.largestName} @ ${kb(countryDetailReport.largestBytes)}`,
  )

  log('\n[6/6] Building cities.json.gz')
  const cityReport = buildCities(subdivisions)

  // -------- size report + assertions --------
  log('\n=== Artefact size report ===')
  const worldBytes = fs.statSync(path.join(OUT, 'world.topo.json')).size
  const citiesBytes = fs.statSync(path.join(OUT, 'cities.json.gz')).size
  const countriesBytes = fs.statSync(path.join(OUT, 'countries.json')).size
  const subsBytes = fs.statSync(path.join(OUT, 'subdivisions.json')).size
  log(`  world.topo.json     ${kb(worldBytes)}`)
  log(`  countries.json      ${kb(countriesBytes)}`)
  log(`  subdivisions.json   ${kb(subsBytes)}`)
  log(`  cities.json.gz      ${kb(citiesBytes)}  (${cityReport.count} cities, ${cityReport.resolved} resolve to a subdivision, ${cityReport.count - cityReport.resolved} -> null)`)
  log(`  admin1/*.topo.json  ${admin1Report.files} files, ${kb(admin1Report.totalBytes)} total`)
  if (admin1Report.dupeGroupsMerged > 0) {
    log(
      `  admin1 id collisions fixed: ${admin1Report.dupeGroupsMerged} groups / ${admin1Report.dupeFeaturesMerged} features (Natural Earth linked two+ distinct polygons to one GeoNames admin1 id — see PROGRESS.md)`,
    )
  }

  if (worldBytes > 900 * 1024) {
    console.error(`\n*** world.topo.json is ${kb(worldBytes)} — over the 900 KB budget. Lower WORLD_SIMPLIFY_DEFAULT_PCT / WORLD_SIMPLIFY_EXCEPTION_PCT.`)
    process.exit(1)
  }
  log('\nDone. Commit public/geo/.\n')
}

// A flat simplify percentage is a *global* Visvalingam budget: mapshaper keeps
// the N% highest-weight points across every country combined. Weight tracks
// effective area, so a landmass the size of Russia soaks up most of that
// budget and a small, intricate coastline like Iceland's is left with almost
// nothing (measured: 8% flat -> Iceland kept just 19 points). These are the
// large/complex-coastline countries where that's worth capping harder so the
// budget goes to everyone else instead. Picked empirically by comparing
// per-country vertex counts across candidate settings — see PROGRESS.md.
const WORLD_SIMPLIFY_DETAILED_EXCEPTIONS = new Set([
  'RU', 'CA', 'US', 'CN', 'BR', 'AU', 'KZ', 'IN', 'AR', 'AQ', 'ID', 'GL', 'CL',
])
const WORLD_SIMPLIFY_EXCEPTION_PCT = 0.05
const WORLD_SIMPLIFY_DEFAULT_PCT = 0.25

// world.topo.json: dissolve to one (multi)polygon per country, simplify, keep
// only { code, name } per feature. One shared-topology pass (so adjacent
// countries' borders still align exactly) with a per-country simplification
// rate via mapshaper's `-simplify variable`, rather than one flat percentage —
// see WORLD_SIMPLIFY_DETAILED_EXCEPTIONS above for why. Target < 900 KB.
async function buildWorldTopo(neByA2) {
  const features = []
  for (const [a2, entry] of neByA2) {
    for (const f of entry.features) {
      features.push({ type: 'Feature', properties: { code: a2, name: entry.props.NAME }, geometry: f.geometry })
    }
  }
  const fc = { type: 'FeatureCollection', features }
  const exceptionList = [...WORLD_SIMPLIFY_DETAILED_EXCEPTIONS].map((c) => `'${c}'`).join(',')
  const percentExpr = `[${exceptionList}].includes(code) ? ${WORLD_SIMPLIFY_EXCEPTION_PCT} : ${WORLD_SIMPLIFY_DEFAULT_PCT}`
  const out = await runMapshaper(
    [
      '-i input.geojson',
      '-dissolve code copy-fields=name',
      `-simplify variable percentage="${percentExpr}" keep-shapes`,
      '-rename-layers countries',
      '-o format=topojson world.topo.json',
    ].join(' '),
    { 'input.geojson': JSON.stringify(fc) },
  )
  fs.writeFileSync(path.join(OUT, 'world.topo.json'), out['world.topo.json'])
}

// countryDetail/<CC>.topo.json: same source features as world.topo.json (NE
// 1:10m Admin 0), but simplified per country instead of against one shared
// whole-world budget. world.topo.json has to keep ~250 countries under
// 900 KB combined, so most countries lose the majority of their real detail
// (measured: Iceland kept 447 of its 3,117 raw points, ~14%) — fine for a
// whole-world silhouette, but visibly blocky once the app zooms in on one
// country (00-PLAN.md's per-country zoom). Each file here only has to carry
// one country, so it can start from much gentler simplification and only
// back off for the handful of countries complex enough (fjords, archipelagos)
// to still bust the budget. Lazy-loaded by the app the same way admin1/ is —
// see COUNTRY_DETAIL_ZOOM_THRESHOLD in WorldMap.tsx.
async function buildCountryDetail(neByA2) {
  let files = 0
  let totalBytes = 0
  let largestBytes = 0
  let largestName = ''
  for (const [a2, entry] of neByA2) {
    const fc = {
      type: 'FeatureCollection',
      features: entry.features.map((f) => ({ type: 'Feature', properties: { code: a2, name: entry.props.NAME }, geometry: f.geometry })),
    }
    let pct = 65
    let buf
    for (;;) {
      const out = await runMapshaper(
        [
          '-i input.geojson',
          '-dissolve code copy-fields=name',
          `-simplify ${pct}% keep-shapes`,
          '-rename-layers countries',
          '-o format=topojson out.topo.json',
        ].join(' '),
        { 'input.geojson': JSON.stringify(fc) },
      )
      buf = Buffer.from(out['out.topo.json'])
      if (buf.length <= 150 * 1024 || pct <= 4) break
      pct = Math.max(4, Math.round(pct * 0.7))
    }
    fs.writeFileSync(path.join(COUNTRY_DETAIL_OUT, `${a2}.topo.json`), buf)
    files++
    totalBytes += buf.length
    if (buf.length > largestBytes) {
      largestBytes = buf.length
      largestName = `${a2}.topo.json`
    }
  }
  return { files, totalBytes, largestBytes, largestName }
}

// admin-1: convert NE 10m shapefile to geojson once, group by country, simplify
// per country to < 150 KB, write admin1/<CC>.topo.json. Also enriches the
// subdivisions rows with NE ISO-2 code, type, and label-point centroid.
async function buildAdmin1(admin1Rows, countries) {
  const shp = path.join(CACHE, 'ne_10m_admin_1', 'ne_10m_admin_1_states_provinces.shp')
  const geojsonPath = path.join(CACHE, 'ne_10m_admin_1.geojson')
  if (!fs.existsSync(geojsonPath)) {
    await mapshaper.runCommands(`-i "${shp}" -o format=geojson "${geojsonPath}"`)
  }
  const neAdmin1 = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'))

  // enrichment lookups
  const byGnA1 = new Map() // "CC.code" -> props
  const byGnId = new Map() // geonameId -> props
  const byCountry = new Map() // CC -> features[]
  for (const f of neAdmin1.features) {
    const p = f.properties
    const cc = p.iso_a2 && /^[A-Z]{2}$/.test(p.iso_a2) ? p.iso_a2 : null
    if (p.gn_a1_code) byGnA1.set(p.gn_a1_code, p)
    if (p.gn_id) byGnId.set(Number(p.gn_id), p)
    if (cc) {
      const id = p.gn_a1_code || p.iso_3166_2 || p.adm1_code
      if (!byCountry.has(cc)) byCountry.set(cc, [])
      byCountry.get(cc).push({
        type: 'Feature',
        properties: { id, name: p.name || p.gn_name || '' },
        geometry: f.geometry,
      })
    }
  }

  const countryCentroid = new Map(countries.map((c) => [c.code, [c.lat, c.lon]]))

  // subdivisions.json (authoritative list from GeoNames, enriched from NE)
  const subdivisions = []
  let enriched = 0
  for (const r of admin1Rows) {
    const ne = byGnA1.get(r.id) || byGnId.get(r.geonameId)
    if (ne) enriched++
    const centroid = ne ? [ne.latitude, ne.longitude] : countryCentroid.get(r.countryCode) || [0, 0]
    subdivisions.push({
      id: r.id,
      countryCode: r.countryCode,
      name: r.name,
      type: ne ? ne.type_en || '' : '',
      geonamesAdmin1: r.geonamesAdmin1,
      iso3166_2: ne ? ne.iso_3166_2 || null : null,
      lat: round4(centroid[0]),
      lon: round4(centroid[1]),
    })
  }

  // per-country admin1 topojson
  const bigCountries = new Set(['RU', 'CA', 'US', 'CN', 'BR', 'AU', 'KZ', 'IN', 'AR'])
  let files = 0
  let totalBytes = 0
  let largestBytes = 0
  let largestName = ''
  let dupeGroupsMerged = 0
  let dupeFeaturesMerged = 0
  for (const [cc, feats] of byCountry) {
    if (!feats.length) continue

    // Natural Earth's own gn_a1_code/gn_id cross-reference occasionally links
    // two distinct polygons to the same GeoNames admin1 entry — verified
    // directly against the raw NE properties, not assumed: Iceland's
    // "Reykjavík" and "Höfuðborgarsvæði" both carry gn_id 3426182 and
    // gn_a1_code "IS.39". Left alone, both features render under the same
    // `id`, so the app's Map<id, Status> lookup can't tell them apart —
    // setting the one real, selectable subdivision that id represents paints
    // *both* shapes, and the wrongly-duplicated one can end up anywhere on
    // the country's coastline. `-dissolve id` (the same technique
    // buildWorldTopo already uses for multi-piece countries) merges any
    // same-id features into one, guaranteeing the 1:1 id<->shape
    // correspondence the rest of the app assumes — a no-op for the (usual)
    // case where every feature already has a distinct id.
    const idCounts = new Map()
    for (const f of feats) idCounts.set(f.properties.id, (idCounts.get(f.properties.id) ?? 0) + 1)
    for (const [, count] of idCounts) {
      if (count > 1) {
        dupeGroupsMerged++
        dupeFeaturesMerged += count
      }
    }

    const fc = { type: 'FeatureCollection', features: feats }
    // Back to the original starting point/budget. A brief detour tried
    // raising this to match buildCountryDetail's own fidelity, on the theory
    // that admin-1 needed to keep pace with a much more detailed country
    // outline — wrong turn out: the country's own outline is deliberately
    // *never* shown at the same time as admin-1 (see WorldMap.tsx/GlobeMap.tsx
    // — admin-1's own boundaries are always the visible coastline once admin-1
    // is loaded, precisely because two independently-traced coastlines at
    // mismatched fidelity look worse than either alone). What admin-1 is
    // actually compared against once it's showing is the *coarse*
    // `world.topo.json` outline underneath it, which never changed — raising
    // admin-1 past that just moved the mismatch to the opposite direction
    // (confirmed live: admin-1's boundary visibly overshot the coarse
    // country silhouette all along the coast once boosted). Big countries
    // still start lower since they combine many regions' borders into one
    // file, not just one outline.
    let pct = bigCountries.has(cc) ? 8 : 15
    let buf
    for (;;) {
      const out = await runMapshaper(
        `-i input.geojson -dissolve id copy-fields=name -simplify ${pct}% keep-shapes -rename-layers admin1 -o format=topojson out.topo.json`,
        { 'input.geojson': JSON.stringify(fc) },
      )
      buf = Buffer.from(out['out.topo.json'])
      if (buf.length <= 150 * 1024 || pct <= 4) break
      pct = Math.max(4, Math.round(pct * 0.7))
    }

    // Fail loud rather than silently ship a repeat of the bug this just
    // fixed — confirm the dissolve actually left one feature per id.
    const outTopo = JSON.parse(buf.toString('utf8'))
    const seenIds = new Set()
    for (const f of feature(outTopo, outTopo.objects.admin1).features) {
      const id = f.properties.id
      if (seenIds.has(id)) {
        console.error(`\n*** ${cc}.topo.json still has more than one feature with id "${id}" after dissolving.`)
        process.exit(1)
      }
      seenIds.add(id)
    }

    fs.writeFileSync(path.join(ADMIN1_OUT, `${cc}.topo.json`), buf)
    files++
    totalBytes += buf.length
    if (buf.length > largestBytes) {
      largestBytes = buf.length
      largestName = `${cc}.topo.json`
    }
  }

  return { subdivisions, admin1Report: { enriched, files, totalBytes, largestBytes, largestName, dupeGroupsMerged, dupeFeaturesMerged } }
}

// cities.json.gz: trimmed cities1000, sorted by population desc, gzipped.
// Stored column-wise as { fields, rows } — row arrays instead of per-row
// objects, so the eight field names are not repeated 170k times. This roughly
// halves the payload (the plan's 2–3 MB target); the loader maps rows back to
// City objects by field index. CITY_FIELDS is the contract with the loader.
const CITY_FIELDS = ['geonameId', 'name', 'asciiName', 'countryCode', 'admin1Code', 'lat', 'lon', 'population']

function buildCities(subdivisions) {
  const subIds = new Set(subdivisions.map((s) => s.id))
  const zip = new AdmZip(path.join(CACHE, SOURCES.cities1000.file))
  const text = zip.readAsText('cities1000.txt')

  const rows = []
  let resolved = 0
  for (const line of text.split('\n')) {
    if (!line) continue
    const c = line.split('\t')
    const countryCode = c[8]
    if (!countryCode) continue
    const admin1Code = c[10] || ''
    // Report how many will resolve to a subdivision at seed time (the loader
    // does the same derivation: `${cc}.${admin1}` if that id exists, else null).
    if (admin1Code && subIds.has(`${countryCode}.${admin1Code}`)) resolved++
    const name = c[1] || ''
    const asciiName = c[2] || ''
    rows.push([
      Number(c[0]), // geonameId
      name,
      // Store asciiName only when it differs from name (loader falls back to
      // name). Saves the whole column for plain-ASCII cities; still carries the
      // essential romanisation for diacritic / non-Latin names (北京 -> Beijing).
      asciiName === name ? '' : asciiName,
      countryCode,
      admin1Code,
      round4(Number(c[4])), // lat
      round4(Number(c[5])), // lon
      Number(c[14]) || 0, // population
    ])
  }
  rows.sort((a, b) => b[7] - a[7]) // population desc

  const gz = zlib.gzipSync(Buffer.from(JSON.stringify({ fields: CITY_FIELDS, rows })), { level: 9 })
  fs.writeFileSync(path.join(OUT, 'cities.json.gz'), gz)
  return { count: rows.length, resolved }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
