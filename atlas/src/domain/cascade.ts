// The status cascade — 00-PLAN.md §5, implemented as pure functions over plain
// data. No Dexie, no React: everything here is a total function of the state it
// is handed, which is what makes it testable in isolation (see cascade.test.ts).
// `cascadeRepo.ts` is the only thing that turns these mutations into writes.
//
// The model in one paragraph. **The explicit entries are the only truth.** A row
// is explicit when the user set its status directly (`explicit`, with the chosen
// value in `explicitStatus`); every other row exists only because something
// underneath it does, and its status is a function of that subtree:
//
//     desired(place) = max( explicitStatus(place), max desired(child) )
//
// A place should have a row exactly when that expression is non-null. So
// `setStatus`, `removeEntry` and `rebuildAllDerived` are all the same operation
// — recompute `desired` and diff it against the rows that exist — differing only
// in how they perturb the explicit set first and how much of the tree they diff.
//
// Two fields, not one: `status` holds the *effective* status (what the map
// paints, so the Phase-3 read path stays a plain field read) while
// `explicitStatus` remembers what the user actually chose. Keeping both is what
// lets an explicitly-*visited* Germany show as *lived* while you have a lived
// city in it, and drop back to *visited* — not stay stuck on lived — when that
// city is downgraded. One field cannot express both. This is the one documented
// addition to plan §4's `entries` shape; it is not indexed, so it needs no
// Dexie migration.

import type { Entry, EntryKind, Status } from '@/db/types'

// --- the ladder (the domain's copy; @/stats/coverage imports it from here) ---

export const STATUS_ORDER: readonly Status[] = ['wishlist', 'transit', 'visited', 'lived']

const STATUS_RANK: Record<Status, number> = { wishlist: 0, transit: 1, visited: 2, lived: 3 }

export function statusRank(status: Status): number {
  return STATUS_RANK[status]
}

/** Higher of two statuses. `null` means "no status at all", not "lowest". */
export function maxStatus(a: Status | null, b: Status | null): Status | null {
  if (a === null) return b
  if (b === null) return a
  return statusRank(a) >= statusRank(b) ? a : b
}

// --- state --------------------------------------------------------------------

/** The reference facts the cascade needs about one city: who its parents are. */
export interface CityPlace {
  refId: string // String(geonameId) — matches Entry.refId
  countryCode: string
  subdivisionId: string | null
}

export interface PlaceIndex {
  /** Must contain every city that has an entry, plus any city being added. */
  cities: ReadonlyMap<string, CityPlace>
}

export interface CascadeState {
  /**
   * Every entry row **including soft-deleted ones**. A deleted row still holds
   * its slot in the unique `[kind+refId]` index, so re-adding a place has to
   * restore that row rather than insert a second one.
   */
  entries: readonly Entry[]
  places: PlaceIndex
}

export interface PlaceRef {
  kind: EntryKind
  refId: string
}

export interface SetStatusRequest extends PlaceRef {
  status: Status
  /** Omitted means "leave whatever is there"; explicit `null` clears it. */
  firstVisited?: string | null
  lastVisited?: string | null
}

// --- mutations ----------------------------------------------------------------

/** The cascade-managed fields of an entry. `notes` is never touched here. */
export interface EntryFields {
  status: Status
  explicit: boolean
  explicitStatus: Status | null
  firstVisited: string | null
  lastVisited: string | null
}

export type EntryChanges = Partial<EntryFields>

/**
 * A write to be applied by `cascadeRepo.ts`. `kind`/`refId` are carried on every
 * mutation purely so callers and tests can read them without a second lookup;
 * the applier addresses rows by `id`. `remove` is always a soft delete.
 */
export type Mutation =
  | { op: 'create'; kind: EntryKind; refId: string; fields: EntryFields }
  | { op: 'restore'; kind: EntryKind; refId: string; id: string; fields: EntryFields }
  | { op: 'update'; kind: EntryKind; refId: string; id: string; changes: EntryChanges }
  | { op: 'remove'; kind: EntryKind; refId: string; id: string }

// --- parentage ----------------------------------------------------------------

export function entryKey(kind: EntryKind, refId: string): string {
  return `${kind}:${refId}`
}

function splitKey(key: string): PlaceRef {
  const i = key.indexOf(':')
  return { kind: key.slice(0, i) as EntryKind, refId: key.slice(i + 1) }
}

const KIND_RANK: Record<EntryKind, number> = { country: 0, subdivision: 1, city: 2 }

/**
 * A subdivision id is `${countryCode}.${geonamesAdmin1}` by construction
 * (plan §4, built that way in tools/build-geo.mjs) — the same convention
 * `countrySubdivisionsVisited` in @/stats/coverage already relies on. That makes
 * a subdivision's country derivable from its id, so the state needs no
 * subdivision lookup table.
 */
function countryOfSubdivision(id: string): string {
  const dot = id.indexOf('.')
  if (dot <= 0) throw new Error(`cascade: malformed subdivision id "${id}" (expected "CC.admin1")`)
  return id.slice(0, dot)
}

/** The one place directly above this one, or null for a country. */
export function parentOf(state: CascadeState, ref: PlaceRef): PlaceRef | null {
  if (ref.kind === 'country') return null
  if (ref.kind === 'subdivision') return { kind: 'country', refId: countryOfSubdivision(ref.refId) }

  const city = state.places.cities.get(ref.refId)
  if (!city) throw new Error(`cascade: unknown city "${ref.refId}" — no reference row was loaded for it`)
  return city.subdivisionId
    ? { kind: 'subdivision', refId: city.subdivisionId }
    : { kind: 'country', refId: city.countryCode }
}

/** Nearest first: a city gives [subdivision, country], or just [country]. */
export function ancestorsOf(state: CascadeState, ref: PlaceRef): PlaceRef[] {
  const out: PlaceRef[] = []
  let current: PlaceRef | null = parentOf(state, ref)
  while (current) {
    out.push(current)
    current = parentOf(state, current)
  }
  return out
}

export function findEntry(state: CascadeState, kind: EntryKind, refId: string): Entry | undefined {
  return state.entries.find((e) => e.kind === kind && e.refId === refId && e.deletedAt === null)
}

// --- the resolver -------------------------------------------------------------

interface VirtualNode {
  kind: EntryKind
  refId: string
  explicitStatus: Status | null
}

/**
 * The user's choice for this row, or null if the row is derived. Tolerates a row
 * written before `explicitStatus` existed by falling back to its stored status.
 */
function ownExplicitStatus(entry: Entry): Status | null {
  return entry.explicit ? (entry.explicitStatus ?? entry.status) : null
}

/** Active rows only, reduced to what the cascade actually reasons about. */
function virtualise(state: CascadeState): Map<string, VirtualNode> {
  const virtual = new Map<string, VirtualNode>()
  for (const entry of state.entries) {
    if (entry.deletedAt !== null) continue
    virtual.set(entryKey(entry.kind, entry.refId), {
      kind: entry.kind,
      refId: entry.refId,
      explicitStatus: ownExplicitStatus(entry),
    })
  }
  return virtual
}

interface Resolver {
  /** parent key -> child keys. Includes links through places that have no row. */
  children: Map<string, Set<string>>
  desired: (key: string) => Status | null
}

function makeResolver(state: CascadeState, virtual: ReadonlyMap<string, VirtualNode>): Resolver {
  // Link every node to its *whole* ancestor chain, not just its immediate
  // parent — a city can imply a country whose subdivision has no row of its own
  // (nothing has been added at that level yet), and that intermediate still has
  // to conduct the status upward.
  const children = new Map<string, Set<string>>()
  for (const node of virtual.values()) {
    let childKey = entryKey(node.kind, node.refId)
    for (const ancestor of ancestorsOf(state, node)) {
      const parentKey = entryKey(ancestor.kind, ancestor.refId)
      const set = children.get(parentKey)
      if (set) set.add(childKey)
      else children.set(parentKey, new Set([childKey]))
      childKey = parentKey
    }
  }

  const memo = new Map<string, Status | null>()
  function desired(key: string): Status | null {
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    let best = virtual.get(key)?.explicitStatus ?? null
    for (const child of children.get(key) ?? []) best = maxStatus(best, desired(child))
    memo.set(key, best)
    return best
  }

  return { children, desired }
}

/** One row per `[kind+refId]` (the index is unique); an active row wins over a deleted one. */
function rowIndex(state: CascadeState): Map<string, Entry> {
  const rows = new Map<string, Entry>()
  for (const entry of state.entries) {
    const key = entryKey(entry.kind, entry.refId)
    const existing = rows.get(key)
    if (!existing || (existing.deletedAt !== null && entry.deletedAt === null)) rows.set(key, entry)
  }
  return rows
}

// --- the diff -----------------------------------------------------------------

interface DatePatch {
  key: string
  firstVisited?: string | null
  lastVisited?: string | null
}

/**
 * Turn "what these places should be" into the smallest set of writes that gets
 * them there. Only the listed keys are considered, which is what keeps
 * `setStatus`/`removeEntry` surgical (plan §5's `recomputeAncestors`) while
 * `rebuildAllDerived` passes in the whole world.
 */
function toMutations(
  state: CascadeState,
  virtual: ReadonlyMap<string, VirtualNode>,
  desired: (key: string) => Status | null,
  keys: readonly string[],
  dates: DatePatch | null,
): Mutation[] {
  const rows = rowIndex(state)
  const mutations: Mutation[] = []

  for (const key of keys) {
    const { kind, refId } = splitKey(key)
    const want = desired(key)
    const row = rows.get(key)
    const datePatch = dates && dates.key === key ? dates : null

    if (want === null) {
      if (row && row.deletedAt === null) mutations.push({ op: 'remove', kind, refId, id: row.id })
      continue
    }

    const explicitStatus = virtual.get(key)?.explicitStatus ?? null

    if (!row || row.deletedAt !== null) {
      const fields: EntryFields = {
        status: want,
        explicit: explicitStatus !== null,
        explicitStatus,
        firstVisited: datePatch?.firstVisited ?? null,
        lastVisited: datePatch?.lastVisited ?? null,
      }
      // A restored row keeps its `notes` — the cascade never manages prose —
      // but takes fresh dates, since re-adding a place is a fresh visit record.
      mutations.push(row ? { op: 'restore', kind, refId, id: row.id, fields } : { op: 'create', kind, refId, fields })
      continue
    }

    // Key insertion order here is the order the fields appear in EntryFields,
    // which keeps emitted `changes` objects stable and readable.
    const changes: EntryChanges = {}
    if (row.status !== want) changes.status = want
    if (row.explicit !== (explicitStatus !== null)) changes.explicit = explicitStatus !== null
    if ((row.explicitStatus ?? null) !== explicitStatus) changes.explicitStatus = explicitStatus
    if (datePatch?.firstVisited !== undefined && row.firstVisited !== datePatch.firstVisited) {
      changes.firstVisited = datePatch.firstVisited
    }
    if (datePatch?.lastVisited !== undefined && row.lastVisited !== datePatch.lastVisited) {
      changes.lastVisited = datePatch.lastVisited
    }
    if (Object.keys(changes).length > 0) mutations.push({ op: 'update', kind, refId, id: row.id, changes })
  }

  return mutations
}

// --- the four public operations ----------------------------------------------

/**
 * Set a place's status explicitly, creating whatever ancestors it needs (§5.1)
 * as derived entries and recomputing them (§5.3). Mutations come back target
 * first, then ancestors nearest first.
 */
export function setStatus(state: CascadeState, request: SetStatusRequest): Mutation[] {
  const target: PlaceRef = { kind: request.kind, refId: request.refId }
  const ancestors = ancestorsOf(state, target) // throws early if the city is unknown
  const key = entryKey(target.kind, target.refId)

  const virtual = virtualise(state)
  virtual.set(key, { ...target, explicitStatus: request.status })
  const { desired } = makeResolver(state, virtual)

  return toMutations(state, virtual, desired, [key, ...ancestors.map((a) => entryKey(a.kind, a.refId))], {
    key,
    firstVisited: request.firstVisited,
    lastVisited: request.lastVisited,
  })
}

/**
 * Remove one entry and settle the consequences upward (§5.5): derived ancestors
 * that nothing justifies any more go too, explicit ones stay and recompute.
 *
 * Removing a place that still has children under it **demotes** it to derived
 * rather than deleting it — deleting would orphan those children and break §5.1's
 * guarantee that a city's ancestors exist. A UI that means "erase everything
 * here" should walk the descendants itself.
 */
export function removeEntry(state: CascadeState, entryId: string): Mutation[] {
  const row = state.entries.find((e) => e.id === entryId)
  if (!row || row.deletedAt !== null) return []

  const key = entryKey(row.kind, row.refId)
  const virtual = virtualise(state)

  const before = makeResolver(state, virtual)
  const hasChildren = (before.children.get(key)?.size ?? 0) > 0
  if (hasChildren) virtual.set(key, { kind: row.kind, refId: row.refId, explicitStatus: null })
  else virtual.delete(key)

  const { desired } = makeResolver(state, virtual)
  const ancestors = ancestorsOf(state, row)
  return toMutations(state, virtual, desired, [key, ...ancestors.map((a) => entryKey(a.kind, a.refId))], null)
}

/**
 * What this place's status *should* be, computed from the explicit entries
 * beneath and at it — deliberately not a read of the stored `status`, so it
 * stays correct over a state whose derived rows have drifted. Returns null when
 * nothing at or under this place has been recorded.
 */
export function effectiveStatus(state: CascadeState, kind: EntryKind, refId: string): Status | null {
  const virtual = virtualise(state)
  const { desired } = makeResolver(state, virtual)
  return desired(entryKey(kind, refId))
}

export interface StatusCause {
  status: Status
  because: PlaceRef
}

/**
 * Why does a place show a status that isn't (fully) its own choice? Walks down
 * through purely-derived intermediates — rows that exist only to carry a link,
 * with no explicit choice of their own — to the nearest place whose own
 * explicit choice actually accounts for the target's status. This is how the
 * status sheet can say "showing lived because you lived in Berlin" for a
 * country explicitly set to visited but sitting under a lived city, rather
 * than naming the (also derived, also just "lived") subdivision in between.
 *
 * Returns null when the place's own explicit choice already accounts for its
 * status, or when it has no status at all.
 */
export function explainStatus(state: CascadeState, kind: EntryKind, refId: string): StatusCause | null {
  const virtual = virtualise(state)
  const key = entryKey(kind, refId)
  const { children, desired } = makeResolver(state, virtual)

  const effective = desired(key)
  if (effective === null) return null

  const own = virtual.get(key)?.explicitStatus ?? null
  if (own !== null && statusRank(own) >= statusRank(effective)) return null

  const cause = findExplicitCause(children, virtual, key, statusRank(effective))
  return cause ? { status: effective, because: { kind: cause.kind, refId: cause.refId } } : null
}

/** First node at any depth below `key` whose *own* explicit choice matches `targetRank`. */
function findExplicitCause(
  children: ReadonlyMap<string, Set<string>>,
  virtual: ReadonlyMap<string, VirtualNode>,
  key: string,
  targetRank: number,
): VirtualNode | null {
  for (const childKey of children.get(key) ?? []) {
    const node = virtual.get(childKey)
    if (node?.explicitStatus && statusRank(node.explicitStatus) === targetRank) return node
    const deeper = findExplicitCause(children, virtual, childKey, targetRank)
    if (deeper) return deeper
  }
  return null
}

/**
 * Recompute every derived row from scratch — used after a sync merge (plan §7.3),
 * where derived rows are never merged, and as the repair path for any state that
 * has drifted. Explicit rows keep their `explicitStatus`; only what was derived
 * from them is rewritten. Output is sorted country → subdivision → city, then by
 * refId, so it is deterministic.
 */
export function rebuildAllDerived(state: CascadeState): Mutation[] {
  const virtual = virtualise(state)
  const { desired } = makeResolver(state, virtual)

  const keys = new Set<string>()
  for (const entry of state.entries) {
    keys.add(entryKey(entry.kind, entry.refId))
    if (entry.deletedAt !== null) continue // a dead row's parents are only implied by live ones
    for (const ancestor of ancestorsOf(state, entry)) keys.add(entryKey(ancestor.kind, ancestor.refId))
  }

  const sorted = [...keys].sort((a, b) => {
    const ka = splitKey(a)
    const kb = splitKey(b)
    return KIND_RANK[ka.kind] - KIND_RANK[kb.kind] || ka.refId.localeCompare(kb.refId)
  })

  return toMutations(state, virtual, desired, sorted, null)
}
