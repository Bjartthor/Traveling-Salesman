# Minor fixes — deferred, non-blocking

Known-but-deliberately-postponed data issues from the geo pipeline. None of these
block the app; each has a documented workaround in place. Pick them up when the
map work (Phase 3+) makes them worth the effort.

---

## 1. Territories with no world-map polygon at 1:10m  ⭐ (the big one)

**Status: RESOLVED.** All 11 territories below now get their own world-map shape
at build time — see "How it was fixed" at the end of this section. The historical
context is kept because it explains *why* the shapes have to be synthesised.

Earlier history: the source layer was upgraded from 1:50m to 1:10m in a polish
pass (see PROGRESS.md), which resolved 2 of the original 13 for free (Gibraltar,
US Minor Outlying) and also fixed the much bigger problem this section used to
describe — 1:50m simplified at a flat 8% left small/detailed coastlines like
Iceland's at ~19 vertices (Iceland is now ~450). The 11 that remained after that
are what this section is about.

**What/why.** *Natural Earth 1:10m Admin 0 – Countries* does not draw a
**separate** polygon for 11 GeoNames territories — it either fuses them into a
parent (the French overseas départements into France; Christmas & Cocos into
Australia; Svalbard into Norway) or omits them even at this resolution (Bonaire,
Bouvet, Tokelau):

```
GF French Guiana   GP Guadeloupe   MQ Martinique   RE Réunion   YT Mayotte   (→ France)
CC Cocos Islands   CX Christmas Island                                       (→ Australia)
SJ Svalbard & Jan Mayen                                                      (→ Norway)
BQ Bonaire/St-Eustatius/Saba   BV Bouvet   TK Tokelau
```

These **do** get full `countries.json` rows (territories count as their own
entries per plan §2), so they were always searchable and trackable. The problem
was purely on the map: they were not distinct clickable landmasses, so painting
the parent's visit status painted them too, and a tap on them selected the parent.

**How it was fixed.** `addTerritoryShapes()` in [`build-geo.mjs`](build-geo.mjs)
gives each of the 11 its own `neByA2` entry *before* the validator and the
country/topology writers run, so from that point on every one is treated like any
other country (own world-map feature, own `countryDetail/<CC>.topo.json`, own
computed centroid, `region` filled from `TERRITORY_REGION`). Two mechanisms, both
driven by explicit fixup tables so nothing is silent:

1. **Carve** (the 8 fused ones — French DOMs, Christmas/Cocos, Svalbard+Jan
   Mayen). The parent's (multi)polygon is exploded into single polygons and the
   ones whose centroid falls inside a `TERRITORY_CARVE` box are *moved* to the
   territory; the parent keeps the rest. Whole sub-polygons are reassigned, so the
   parent literally stops containing them — no clipping, no slivers, no overlap,
   and the shapes stay at the same fidelity as the rest of the world map. (This is
   why a finer `ne_10m_admin_0_map_subunits` download turned out to be
   unnecessary: the shapes are already present, just fused into the parent.)
2. **Graft** (the 3 omitted ones — Bonaire, Bouvet, Tokelau). Copied straight from
   the admin-1 layer the build already loads, matched by `TERRITORY_GRAFT_ADMIN1`.

`KNOWN_NO_POLYGON` is now empty, so the fail-loud validator *requires* every
GeoNames country to have a polygon — if a future NE refresh drops one of these
shapes the build stops instead of silently regressing. The reverse direction is
still clean: every polygon in `world.topo.json` maps to a real country row.

---

## 2. Subdivision enrichment is ~84% (3247 / 3865)

**Status:** acceptable; best-effort by design.

`subdivisions.json` is built authoritatively from GeoNames `admin1CodesASCII.txt`
(so **every** city resolves to a real subdivision id or explicit `null`). Each row
is then *enriched* — ISO 3166-2 code, type label, centroid — by joining to Natural
Earth 10m admin-1 on `gn_a1_code` (falling back to `gn_id`). ~618 subdivisions have
no NE match and fall back to `iso3166_2: null`, `type: ''`, and the **country**
centroid instead of their own. This only affects display niceties, never the
join. To improve: add a spatial fallback (point-in-polygon of the admin-1 seat) or
a per-country override table.

---

## 3. `cities.json.gz` is ~4.2 MB, not the plan's "2–3 MB"

**Status:** acceptable; documented.

The plan estimated 2–3 MB for "~150k" cities; the real `cities1000` set is **170k**
rows, and the plan mandates 4-decimal coordinates. Columnar `{fields, rows}`
encoding + dropping `asciiName` when equal to `name` already took it from 5.2 MB →
4.2 MB. Further shrinking would mean dropping coordinate precision (against the
plan) or the `geonameId` (needed as the key). It is a one-time download, cached by
the service worker and IndexedDB, so this was left as-is.

---

## 4. `territoryOf` is best-effort for obscure territories

**Status:** acceptable.

Derived from Natural Earth `SOVEREIGNT` (name → A2), with explicit overrides in
`TERRITORY_OF` for the no-polygon territories and known NE quirks (e.g. NE spells
the Dutch sovereign "Netherlands" while GeoNames says "The Netherlands"). All the
headline territories are correct (Greenland→DK, Puerto Rico→US, Hong Kong→CN, …).
A very obscure dependency whose NE sovereign name fails to match may end up
`territoryOf: null`; it is not acceptance-tested and easy to patch in `TERRITORY_OF`.

---

## 5. Multi-tab first-run seed race (theoretical)

**Status:** out of scope for Phase 2.

If a user opens two tabs during the very first seed, both may see `geoDataVersion`
unset and seed concurrently. Within a tab the load is idempotent; across tabs the
`clear()` + `bulkAdd()` could in principle race. Harmless in the normal single-tab
case. Proper cross-tab coordination (BroadcastChannel / a seeding lock) belongs
with the Phase-7 sync work.

---

## 6. ~16 countries' admin-1 sets include NE polygons with no GeoNames match, merged into one inert shape instead of kept distinct

**Status:** acceptable; correctness bug already fixed, this is a detail improvement.

Natural Earth marks an admin-1 polygon it couldn't confidently link to GeoNames with a literal
`"<CC>."` placeholder in `gn_a1_code` (paired with a negative `gn_id`) rather than leaving the field
empty — e.g. all 15 of Anguilla's districts, all 32 of the London boroughs. `buildAdmin1()`'s id
selection (`gn_a1_code || iso_3166_2 || adm1_code`) picks that placeholder up as if it were a real id,
so every such feature in a country collapses onto the same key — fixed from becoming a *colouring* bug
(see PROGRESS.md's admin-1 id-collision session) by dissolving same-id features together, but that
also means these particular features render as one undifferentiated blob per country rather than as
individually-shaped districts. Harmless in practice: none of them correspond to a real row in
`subdivisions.json` either way (GeoNames doesn't subdivide that finely), so a user could never
individually select or colour one regardless. To improve: when `gn_a1_code` matches `/^[A-Z]{2}\.$/`
(placeholder, no real code), fall through to `iso_3166_2`/`adm1_code` instead — both are confirmed
unique per feature in the Anguilla/GB samples checked — so each gets its own distinct id and renders as
its real shape, still uncoloured, just with more coastline/border detail than one merged blob.

---

## 7. `world.topo.json` and `admin1/<CC>.topo.json` trace the same coastline independently, so they don't line up pixel-for-pixel

**Status:** acceptable; correctness bug already fixed at the rendering layer, this is the geometric root cause.

The world layer (`ne_10m_admin_0_countries`) and the admin-1 layer (`ne_10m_admin_1_states_provinces`)
are two separate Natural Earth datasets, digitised independently and simplified in two entirely separate
`mapshaper` passes with no shared topology between them (`buildWorldTopo` and `buildAdmin1` never see
each other's output). They were always going to disagree by a little; that only became visible once the
"Map resolution polish" session made the *world*-layer coastline for detail-heavy countries (Iceland,
Norway, etc. — see `WORLD_SIMPLIFY_DETAILED_EXCEPTIONS`) dramatically finer without touching the
admin-1 layer at all. Measured directly for Iceland: only **0.03%** area difference in aggregate, but
concentrated into **263 individual pixel-level gap points** along the coastline at a typical zoomed-in
scale — small in total, but each one a visible fleck once you're zoomed in close on a real device. Fixed
at the *rendering* layer (see PROGRESS.md's "the selected country's own fill showed through tiny gaps"
session) by not drawing the selected country's own status colour once its admin-1 overlay is actually
covering it, so a gap now shows the same neutral tone every unmarked area uses instead of a misleading
status colour — but the underlying geometry still doesn't match exactly, so a sufficiently close zoom
could still show a faint neutral-toned seam. To fix at the root: have `buildWorldTopo` export its
per-country, already-simplified boundary (not just write it into `world.topo.json`), then have
`buildAdmin1` `-clip` each country's admin-1 `FeatureCollection` to that exact boundary before
simplifying. `-clip` alone only trims *overhang* (admin-1 extending past the country edge) — it doesn't
extend admin-1 to *fill* a gap — so getting this fully right needs more thought than a one-line change,
which is why it wasn't attempted in the session that found it.
