# Minor fixes — deferred, non-blocking

Known-but-deliberately-postponed data issues from the geo pipeline. None of these
block the app; each has a documented workaround in place. Pick them up when the
map work (Phase 3+) makes them worth the effort.

---

## 1. Territories with no world-map polygon at 1:10m  ⭐ (the big one)

**Status:** deferred by explicit decision (see the Phase-2 session); source layer
upgraded from 1:50m to 1:10m in a later polish pass (see PROGRESS.md), which
resolved 2 of the original 13 for free (Gibraltar, US Minor Outlying) and also
fixed the much bigger problem this section used to describe — 1:50m simplified at
a flat 8% left small/detailed coastlines like Iceland's at ~19 vertices. Iceland
is now ~450. The 11 remaining no-polygon territories below are a separate,
smaller, genuinely deferred issue.

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
entries per plan §2), so they are searchable and trackable. They simply are not
distinct clickable landmasses on the world map. They are listed in
`KNOWN_NO_POLYGON` in [`fixups.mjs`](fixups.mjs); the build's fail-loud validator
treats them as expected, so anything *else* missing still fails the build.

The reverse direction is clean: every polygon in `world.topo.json` maps to a real
country row.

**How to fix later (additive, low-risk).** Graft the missing shapes from a finer
Natural Earth layer and merge them into `world.topo.json`:

1. Download `ne_10m_admin_0_map_subunits` (S3, same pattern as the other sources).
   It separates the French DOMs, etc. as individual subunits with ISO codes.
2. For each code in `KNOWN_NO_POLYGON`, pull its subunit feature, simplify it to
   match the world map's non-exception rate (currently `WORLD_SIMPLIFY_DEFAULT_PCT`,
   25%), tag it `{ code, name }`, and append it to the FeatureCollection in
   `buildWorldTopo()` before the dissolve.
3. Remove the grafted codes from `KNOWN_NO_POLYGON`. The validator then *requires*
   them to have a polygon, guaranteeing you did not miss any.

The truly tiny/uninhabited specks (Bouvet) can stay as exceptions if they are not
worth the vertices — decide per code.

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
