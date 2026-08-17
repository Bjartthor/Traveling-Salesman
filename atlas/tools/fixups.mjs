// Explicit override tables for the geo build pipeline (see 02-geo-data.md §2).
//
// The golden rule of this file: NOTHING here is silent. Every entity that the
// build script would otherwise drop, mis-code, or fail to join is listed below
// with a reason. `build-geo.mjs` fails loudly (exit 1) if it meets a country it
// cannot resolve that is NOT accounted for here — so this table is the single
// place to look when a future Natural Earth / GeoNames refresh breaks a join.
//
// Terminology: "A2" = ISO 3166-1 alpha-2 (the app's primary country key).

// ---------------------------------------------------------------------------
// 1. Natural Earth ISO-code fixes
// ---------------------------------------------------------------------------
// Natural Earth stores `-99` in ISO_A2 for many entities. For most of them the
// correct code sits in ISO_A2_EH ("EH" = "with de-facto disputed areas coded"),
// so the build script tries ISO_A2, then ISO_A2_EH, then this table (keyed by
// the stable ADM0_A3 identifier) as a last resort. France, Norway and Kosovo
// are all recovered by the ISO_A2_EH fallback and need no entry here.

// Keyed by Natural Earth ADM0_A3 -> correct ISO 3166-1 alpha-2.
export const CODE_OVERRIDES = {
  // Taiwan: NE codes it ISO_A2 = -99 and ISO_A2_EH = "CN-TW" (a non-ISO string),
  // so neither the raw field nor the EH fallback yields a usable A2. GeoNames
  // lists Taiwan as its own country "TW"; map the polygon onto it.
  TWN: 'TW',
}

// ---------------------------------------------------------------------------
// 2. Natural Earth features to EXCLUDE (polygon has no GeoNames country row)
// ---------------------------------------------------------------------------
// These are de-facto / disputed entities that are not ISO 3166-1 countries and
// have no row in GeoNames countryInfo.txt. We drop their polygons rather than
// invent codes. The land simply renders unshaded (Phase 3 concern). Keyed by
// ADM0_A3 with the reason.
//
// The list grew a lot when the map source moved from 1:50m to 1:10m Admin-0
// (see PROGRESS.md): the finer layer separates out administrative/disputed
// micro-entities the 1:50m layer didn't bother to carve out at all (military
// bases, buffer zones, disputed reefs).
export const EXCLUDE_NE = {
  SOL: 'Somaliland — self-declared, no ISO code, folded under Somalia (SO) in ISO/GeoNames.',
  CYN: 'Northern Cyprus — recognised only by Turkey, no ISO code; territory is CY in ISO.',
  KAS: 'Siachen Glacier — disputed India/Pakistan military zone, not a country.',
  ESB: 'Dhekelia — UK Sovereign Base Area on Cyprus, no ISO code; territory is CY in ISO.',
  WSB: 'Akrotiri — UK Sovereign Base Area on Cyprus, no ISO code; territory is CY in ISO.',
  USG: 'US Naval Station Guantanamo Bay — leased US base on Cuban soil, no separate ISO code.',
  CNM: "Cyprus U.N. Buffer Zone — demilitarised zone between Cyprus and Northern Cyprus, not a country.",
  SPI: 'Southern Patagonian Ice Field — unresolved Chile/Argentina border area, no ISO code.',
  BRT: 'Bir Tawil — unclaimed land between Egypt and Sudan, no ISO code.',
  PGA: 'Spratly Islands — disputed South China Sea islets claimed by several states, no ISO code.',
  BJN: 'Bajo Nuevo Bank — disputed Caribbean reef/bank, no ISO code.',
  SER: 'Serranilla Bank — disputed Caribbean reef/bank, no ISO code.',
  SCR: 'Scarborough Reef — disputed South China Sea shoal, no ISO code.',
}

// ---------------------------------------------------------------------------
// 3. GeoNames rows to EXCLUDE (deprecated / withdrawn ISO codes)
// ---------------------------------------------------------------------------
// GeoNames countryInfo.txt still carries a few historic codes. They are not
// current ISO 3166-1 countries, so we drop them from countries.json.
export const EXCLUDE_GEONAMES = {
  AN: 'Netherlands Antilles — dissolved 2010, ISO code withdrawn; superseded by CW, SX, BQ.',
  CS: 'Serbia and Montenegro — split 2006, ISO code withdrawn; superseded by RS, ME.',
}

// ---------------------------------------------------------------------------
// 4. Territories with NO polygon of their own in NE 1:10m "Countries"
// ---------------------------------------------------------------------------
// The 1:10m Admin-0 *Countries* layer draws no separate polygon for a handful
// of ISO territories: it either fuses them into a parent (the French DOMs into
// France, Christmas/Cocos into Australia, Svalbard into Norway) or omits them
// entirely (Bonaire, Bouvet, Tokelau). They still get a countries.json row
// (territories count as their own entries per plan §2), but used to have no
// distinct, clickable landmass on the world map — so painting the parent's
// status painted them too. See tools/minor_fixes.md §1.
//
// That is now resolved at build time: `addTerritoryShapes()` in build-geo.mjs
// *carves* the fused ones out of their parent's (multi)polygon (TERRITORY_CARVE
// below) and *grafts* the omitted ones from the admin-1 layer
// (TERRITORY_GRAFT_ADMIN1), so every one of them ends up in `neByA2` with a real
// shape. This set is therefore now EMPTY: the fail-loud validator requires every
// GeoNames country to have a polygon, so if a future data refresh drops one of
// these shapes the build stops instead of silently regressing. Add a code here
// only to intentionally exempt a country from that requirement again.
export const KNOWN_NO_POLYGON = new Set([])

// ---------------------------------------------------------------------------
// 5. Sovereign parent of a territory (territoryOf)
// ---------------------------------------------------------------------------
// The build derives territoryOf from Natural Earth's SOVEREIGNT for territories
// that HAVE a polygon. This table supplies it for the KNOWN_NO_POLYGON set
// above (no polygon = no NE sovereignty to read) and overrides any NE oddities.
// A2 -> sovereign A2.
export const TERRITORY_OF = {
  GF: 'FR', GP: 'FR', MQ: 'FR', RE: 'FR', YT: 'FR',
  GI: 'GB',
  BQ: 'NL',
  BV: 'NO', SJ: 'NO',
  TK: 'NZ',
  CC: 'AU', CX: 'AU',
  UM: 'US',
}

// ---------------------------------------------------------------------------
// 6. Representative coordinates — now only a fallback
// ---------------------------------------------------------------------------
// countries.lat/lon comes from the spherical centroid of the NE polygon. These
// were the hand-supplied coordinates for the territories back when they had no
// polygon; now that `addTerritoryShapes()` gives every one a real shape (§§6b–d),
// their centroid is computed like everyone else's and this table is an unused
// fallback for the `!ne` branch. Kept as a safety net (and documentation of each
// territory's rough location). A2 -> [lat, lon].
export const TERRITORY_COORDS = {
  GF: [3.93, -53.13],
  GP: [16.24, -61.55],
  MQ: [14.64, -61.02],
  RE: [-21.13, 55.53],
  YT: [-12.82, 45.17],
  BQ: [12.18, -68.25],
  BV: [-54.42, 3.36],
  SJ: [78.0, 20.0],
  TK: [-9.2, -171.85],
  CC: [-12.17, 96.83],
  CX: [-10.49, 105.62],
}

// ---------------------------------------------------------------------------
// 6b. Carving fused territories out of a parent's world-map polygon
// ---------------------------------------------------------------------------
// NE 1:10m "Countries" fuses these territories into their sovereign parent's
// (multi)polygon as separate, disconnected sub-polygons (French Guiana is its
// own landmass across the Atlantic, Svalbard is its own islands far to the
// north, etc. — they are never geometrically joined to the metropole). So
// `addTerritoryShapes()` in build-geo.mjs explodes the parent into individual
// polygons and *moves* the ones whose centroid falls inside a box below into a
// new neByA2 entry for that territory; the parent keeps the rest. This is exact
// (whole sub-polygons reassigned — no clipping, no slivers, no overlap) and the
// shapes stay at the same fidelity as the rest of the world map.
//
// Keyed by parent A2 -> { territory A2 -> [ [minLon, minLat, maxLon, maxLat], ... ] }.
// A territory may need more than one box (Svalbard proper AND Jan Mayen). The
// build fails loud if any listed box captures zero sub-polygons — so a future NE
// refresh that moves a coastline can't silently drop a territory.
export const TERRITORY_CARVE = {
  FR: {
    GF: [[-55, 2, -51, 6]], // French Guiana (South America)
    GP: [[-62, 15.7, -60.8, 16.6]], // Guadeloupe + its islets
    MQ: [[-61.3, 14.3, -60.7, 14.95]], // Martinique
    RE: [[55.1, -21.5, 55.95, -20.8]], // Réunion (Indian Ocean)
    YT: [[44.9, -13.1, 45.35, -12.55]], // Mayotte (Comoros archipelago)
  },
  NO: {
    // Svalbard archipelago (incl. Bjørnøya at ~74.5°N) AND Jan Mayen. Mainland
    // Norway tops out at ~71.2°N, so the 74°N floor separates cleanly; Jan
    // Mayen sits far west of the mainland's longitudes.
    SJ: [[8, 74, 40, 81], [-9.5, 70.5, -7, 71.5]],
  },
  AU: {
    CC: [[96.5, -12.4, 97.1, -11.7]], // Cocos (Keeling) Islands
    CX: [[105.4, -10.6, 105.9, -10.35]], // Christmas Island
  },
}

// ---------------------------------------------------------------------------
// 6c. Grafting omitted territories from the admin-1 layer
// ---------------------------------------------------------------------------
// These three have no polygon in Admin-0 *Countries* at all (not fused into a
// parent — genuinely absent), but the Admin-1 states/provinces layer the build
// already loads for subdivisions does carry them. `addTerritoryShapes()` copies
// the matching admin-1 feature(s) straight into neByA2. Keyed by A2 -> matcher;
// `gnA1` matches NE `gn_a1_code`, `names` matches NE `name` (Bonaire is three
// separate island features). The build fails loud if a matcher hits nothing.
export const TERRITORY_GRAFT_ADMIN1 = {
  BQ: { names: ['Bonaire', 'St. Eustatius', 'Saba'] },
  BV: { gnA1: ['NO.00'] }, // Bouvet Island
  TK: { names: ['Tokelau'] },
}

// ---------------------------------------------------------------------------
// 6d. Region (UN M49 subregion) for the no-Admin-0-polygon territories
// ---------------------------------------------------------------------------
// countries.json's `region` normally comes from NE's SUBREGION field, which the
// carved/grafted territories don't carry (Admin-1 has no SUBREGION, and a carved
// sub-polygon would wrongly inherit the parent's — French Guiana is not "Western
// Europe"). Supply it explicitly here so the field isn't left blank. A2 -> region.
export const TERRITORY_REGION = {
  GF: 'South America',
  GP: 'Caribbean',
  MQ: 'Caribbean',
  RE: 'Eastern Africa',
  YT: 'Eastern Africa',
  SJ: 'Northern Europe',
  BQ: 'Caribbean',
  TK: 'Polynesia',
  CC: 'Australia and New Zealand', // Australian external territory
  CX: 'Australia and New Zealand', // Australian external territory
  BV: 'Seven seas (open ocean)', // sub-Antarctic, no UN subregion
}

// ---------------------------------------------------------------------------
// 7. UN membership
// ---------------------------------------------------------------------------
// GeoNames countryInfo.txt has no UN-membership flag, and NE has none either.
// Rather than hand-maintain a 193-entry list (error-prone), we derive it:
//   unMember = (territoryOf === null) && !NON_UN_SOVEREIGN.has(code)
// i.e. every sovereign entry is a UN member EXCEPT the short, stable list of
// sovereign/quasi-sovereign non-members below. This yields the 193 members and
// is trivial to audit. Update this set, not a giant allow-list, if it changes.
export const NON_UN_SOVEREIGN = new Set([
  'VA', // Vatican City / Holy See — permanent observer, not a member
  'PS', // State of Palestine — non-member observer state
  'XK', // Kosovo — not a UN member
  'TW', // Taiwan — not a UN member
  'CK', // Cook Islands — non-member state in free association with NZ
  'NU', // Niue — non-member state in free association with NZ
  'EH', // Western Sahara — disputed, not a UN member
  'AQ', // Antarctica — no sovereign (Antarctic Treaty), so territoryOf is null but it is not a member
])

// ---------------------------------------------------------------------------
// 8. Continent-code -> display name (GeoNames uses 2-letter continent codes)
// ---------------------------------------------------------------------------
// Used only as a fallback for the no-polygon territories, whose continent/region
// otherwise comes from NE's richer CONTINENT / SUBREGION fields.
export const CONTINENT_NAMES = {
  AF: 'Africa',
  AS: 'Asia',
  EU: 'Europe',
  NA: 'North America',
  SA: 'South America',
  OC: 'Oceania',
  AN: 'Antarctica',
}
