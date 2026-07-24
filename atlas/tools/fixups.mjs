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
export const EXCLUDE_NE = {
  SOL: 'Somaliland — self-declared, no ISO code, folded under Somalia (SO) in ISO/GeoNames.',
  CYN: 'Northern Cyprus — recognised only by Turkey, no ISO code; territory is CY in ISO.',
  KAS: 'Siachen Glacier — disputed India/Pakistan military zone, not a country.',
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
// 4. Territories with NO polygon in Natural Earth 1:50m "Countries"
// ---------------------------------------------------------------------------
// These ARE current ISO countries and DO get a countries.json row (territories
// count as their own entries per plan §2), but the 1:50m Admin-0 *Countries*
// layer either fuses them into a parent polygon (the French DOMs into France,
// Christmas/Cocos into Australia) or omits them at this resolution. They are
// therefore trackable rows without a distinct clickable landmass on the world
// map in v1. This set tells the validator "these missing polygons are expected"
// so it does not fail the build — anything missing that is NOT listed here is a
// real error and stops the build.
//
// >>> This is the documented consequence of the Phase-2 map-source decision.
// >>> See tools/minor_fixes.md for how to graft these shapes in later. <<<
export const KNOWN_NO_POLYGON = new Set([
  'GF', // French Guiana      — fused into France's polygon
  'GP', // Guadeloupe         — fused into France's polygon
  'MQ', // Martinique         — fused into France's polygon
  'RE', // Réunion            — fused into France's polygon
  'YT', // Mayotte            — fused into France's polygon
  'GI', // Gibraltar          — omitted at 1:50m (tiny)
  'BQ', // Bonaire, St Eustatius and Saba — omitted at 1:50m
  'BV', // Bouvet Island      — omitted at 1:50m (uninhabited)
  'CC', // Cocos (Keeling) Islands — fused into NE "Indian Ocean Ter." (AU)
  'CX', // Christmas Island   — fused into NE "Indian Ocean Ter." (AU)
  'SJ', // Svalbard and Jan Mayen — drawn within Norway's polygon
  'TK', // Tokelau            — omitted at 1:50m (uninhabited by cities1000 scale)
  'UM', // US Minor Outlying Islands — scattered specks, omitted at 1:50m
])

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
// 6. Representative coordinates for the no-polygon territories
// ---------------------------------------------------------------------------
// countries.lat/lon normally comes from the spherical centroid of the NE
// polygon. The KNOWN_NO_POLYGON territories have no polygon to average, so we
// supply well-known public coordinates here (used later for map centring and
// labels). A2 -> [lat, lon].
export const TERRITORY_COORDS = {
  GF: [3.93, -53.13],
  GP: [16.24, -61.55],
  MQ: [14.64, -61.02],
  RE: [-21.13, 55.53],
  YT: [-12.82, 45.17],
  GI: [36.14, -5.35],
  BQ: [12.18, -68.25],
  BV: [-54.42, 3.36],
  SJ: [78.0, 20.0],
  TK: [-9.2, -171.85],
  CC: [-12.17, 96.83],
  CX: [-10.49, 105.62],
  UM: [19.28, 166.6], // Wake Island, the largest of the group
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
