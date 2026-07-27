// The cascade is the piece 00-PLAN.md §5 flags as "most likely to go subtly
// wrong", so these tests were written before the implementation and every rule
// in §5 has at least one test naming it.
//
// Fixture world (small on purpose, so every expectation is checkable by eye):
//
//   DE ─┬─ DE.02 ─┬─ '1'  Munich
//       │         └─ '2'  Nuremberg
//       ├─ DE.04 ─── '3'  Hamburg
//       └─ DE.16 ─── '4'  Berlin
//   FO ─── '9'  Tórshavn          (territory: its own country, never under DK)
//   MC ─── '20' Monaco-Ville      (no subdivision — cascades straight to country)

import { describe, expect, it } from 'vitest'
import type { Entry, EntryKind, Status } from '@/db/types'
import {
  ancestorsOf,
  effectiveStatus,
  maxStatus,
  rebuildAllDerived,
  removeEntry,
  setStatus,
  statusRank,
  type CascadeState,
  type Mutation,
} from '@/domain/cascade'

// --- fixture helpers ---------------------------------------------------------

/** Deterministic ids (`kind:refId`) so assertions read as places, not UUIDs. */
function mkEntry(o: Partial<Entry> & { kind: EntryKind; refId: string; status: Status }): Entry {
  const explicit = o.explicit ?? true
  return {
    id: `${o.kind}:${o.refId}`,
    explicit,
    explicitStatus: explicit ? o.status : null,
    firstVisited: null,
    lastVisited: null,
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...o,
  }
}

/** Shorthand for a derived (not user-set) row. */
function derived(kind: EntryKind, refId: string, status: Status, extra: Partial<Entry> = {}): Entry {
  return mkEntry({ kind, refId, status, explicit: false, explicitStatus: null, ...extra })
}

// refId -> [countryCode, subdivisionId]
const CITIES: Record<string, [string, string | null]> = {
  '1': ['DE', 'DE.02'],
  '2': ['DE', 'DE.02'],
  '3': ['DE', 'DE.04'],
  '4': ['DE', 'DE.16'],
  '9': ['FO', null],
  '20': ['MC', null],
}

function mkState(entries: Entry[]): CascadeState {
  return {
    entries,
    places: {
      cities: new Map(
        Object.entries(CITIES).map(([refId, [countryCode, subdivisionId]]) => [
          refId,
          { refId, countryCode, subdivisionId },
        ]),
      ),
    },
  }
}

/** Mutations minus the bookkeeping, for compact assertions. */
function summarise(mutations: Mutation[]): string[] {
  return mutations.map((m) => {
    const where = `${m.kind}:${m.refId}`
    if (m.op === 'remove') return `remove ${where}`
    if (m.op === 'update') return `update ${where} ${JSON.stringify(m.changes)}`
    return `${m.op} ${where} ${m.fields.status}${m.fields.explicit ? ' explicit' : ' derived'}`
  })
}

// --- the ladder --------------------------------------------------------------

describe('status ladder', () => {
  it('orders wishlist < transit < visited < lived', () => {
    expect(statusRank('wishlist')).toBeLessThan(statusRank('transit'))
    expect(statusRank('transit')).toBeLessThan(statusRank('visited'))
    expect(statusRank('visited')).toBeLessThan(statusRank('lived'))
  })

  it('maxStatus treats null as "nothing" rather than as the lowest status', () => {
    expect(maxStatus('wishlist', 'lived')).toBe('lived')
    expect(maxStatus('transit', 'wishlist')).toBe('transit')
    expect(maxStatus(null, 'wishlist')).toBe('wishlist')
    expect(maxStatus('wishlist', null)).toBe('wishlist')
    expect(maxStatus(null, null)).toBeNull()
  })
})

// --- parentage ---------------------------------------------------------------

describe('ancestorsOf', () => {
  it('walks city -> subdivision -> country', () => {
    expect(ancestorsOf(mkState([]), { kind: 'city', refId: '1' })).toEqual([
      { kind: 'subdivision', refId: 'DE.02' },
      { kind: 'country', refId: 'DE' },
    ])
  })

  it('skips the subdivision for a city that has none', () => {
    expect(ancestorsOf(mkState([]), { kind: 'city', refId: '20' })).toEqual([{ kind: 'country', refId: 'MC' }])
  })

  it('derives a subdivision’s country from its `CC.admin1` id (plan §4)', () => {
    expect(ancestorsOf(mkState([]), { kind: 'subdivision', refId: 'DE.02' })).toEqual([
      { kind: 'country', refId: 'DE' },
    ])
  })

  it('gives a country no ancestors', () => {
    expect(ancestorsOf(mkState([]), { kind: 'country', refId: 'DE' })).toEqual([])
  })

  it('throws on a city the reference data does not know', () => {
    expect(() => ancestorsOf(mkState([]), { kind: 'city', refId: '404' })).toThrow(/unknown city/i)
  })
})

// --- §5.1 / §5.2: adding a city creates its ancestors as derived entries ------

describe('setStatus — adding a city', () => {
  it('creates its subdivision and country as derived entries', () => {
    const mutations = setStatus(mkState([]), { kind: 'city', refId: '1', status: 'visited' })

    expect(summarise(mutations)).toEqual([
      'create city:1 visited explicit',
      'create subdivision:DE.02 visited derived',
      'create country:DE visited derived',
    ])
    // The derived rows carry no explicit status of their own — that is what
    // makes them removable again when the last child goes (§5.5).
    for (const m of mutations.slice(1)) {
      expect(m.op === 'create' && m.fields.explicitStatus).toBeNull()
    }
  })

  it('cascades straight to the country when the city has no subdivision', () => {
    const mutations = setStatus(mkState([]), { kind: 'city', refId: '20', status: 'visited' })

    expect(summarise(mutations)).toEqual(['create city:20 visited explicit', 'create country:MC visited derived'])
  })

  it('files a territory under its own country, never its parent state', () => {
    const mutations = setStatus(mkState([]), { kind: 'city', refId: '9', status: 'visited' })

    expect(summarise(mutations)).toEqual(['create city:9 visited explicit', 'create country:FO visited derived'])
    expect(mutations.some((m) => m.refId === 'DK')).toBe(false)
  })

  it('stores the optional visit dates on the entry the user set, not on the derived parents', () => {
    const mutations = setStatus(mkState([]), {
      kind: 'city',
      refId: '1',
      status: 'visited',
      firstVisited: '2019-06-01',
      lastVisited: '2019-06-08',
    })

    expect(mutations[0]).toMatchObject({ op: 'create', fields: { firstVisited: '2019-06-01', lastVisited: '2019-06-08' } })
    expect(mutations[1]).toMatchObject({ op: 'create', fields: { firstVisited: null, lastVisited: null } })
  })
})

// --- §5.3 / §5.4: a child never lowers a parent ------------------------------

describe('setStatus — parent and child interaction', () => {
  it('leaves a country explicitly marked lived alone when a visited city is added', () => {
    const state = mkState([mkEntry({ kind: 'country', refId: 'DE', status: 'lived' })])

    const mutations = setStatus(state, { kind: 'city', refId: '1', status: 'visited' })

    expect(summarise(mutations)).toEqual(['create city:1 visited explicit', 'create subdivision:DE.02 visited derived'])
    expect(mutations.some((m) => m.refId === 'DE')).toBe(false)
  })

  it('raises a derived country to lived when a lived city is added', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
      derived('country', 'DE', 'visited'),
    ])

    const mutations = setStatus(state, { kind: 'city', refId: '2', status: 'lived' })

    expect(summarise(mutations)).toEqual([
      'create city:2 lived explicit',
      'update subdivision:DE.02 {"status":"lived"}',
      'update country:DE {"status":"lived"}',
    ])
  })

  it('never lets a wishlist city produce a visited country (§5.6)', () => {
    const mutations = setStatus(mkState([]), { kind: 'city', refId: '1', status: 'wishlist' })

    expect(summarise(mutations)).toEqual([
      'create city:1 wishlist explicit',
      'create subdivision:DE.02 wishlist derived',
      'create country:DE wishlist derived',
    ])
  })

  it('does not lower a child when a parent is set explicitly lower (§5.4)', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'lived' }),
      derived('subdivision', 'DE.02', 'lived'),
      derived('country', 'DE', 'lived'),
    ])

    const mutations = setStatus(state, { kind: 'country', refId: 'DE', status: 'visited' })

    // DE records the user's choice, but keeps showing `lived` because Munich is.
    expect(summarise(mutations)).toEqual(['update country:DE {"explicit":true,"explicitStatus":"visited"}'])
    expect(effectiveStatus(applyToFixture(state, mutations), 'city', '1')).toBe('lived')
    expect(effectiveStatus(applyToFixture(state, mutations), 'country', 'DE')).toBe('lived')
  })

  it('recomputes the parent to the next-highest remaining child when a city is downgraded', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'lived' }),
      mkEntry({ kind: 'city', refId: '2', status: 'visited' }),
      derived('subdivision', 'DE.02', 'lived'),
      derived('country', 'DE', 'lived'),
    ])

    const mutations = setStatus(state, { kind: 'city', refId: '1', status: 'transit' })

    expect(summarise(mutations)).toEqual([
      'update city:1 {"status":"transit","explicitStatus":"transit"}',
      'update subdivision:DE.02 {"status":"visited"}',
      'update country:DE {"status":"visited"}',
    ])
  })

  it('falls back to the country’s own explicit status when the child that raised it is downgraded', () => {
    // The rule the user asked for: Germany visited -> Berlin lived raises it to
    // lived -> Berlin downgraded drops Germany back to visited, not stuck at lived.
    let state = mkState([mkEntry({ kind: 'country', refId: 'DE', status: 'visited' })])

    state = applyToFixture(state, setStatus(state, { kind: 'city', refId: '4', status: 'lived' }))
    expect(effectiveStatus(state, 'country', 'DE')).toBe('lived')

    const mutations = setStatus(state, { kind: 'city', refId: '4', status: 'visited' })
    expect(summarise(mutations)).toEqual([
      'update city:4 {"status":"visited","explicitStatus":"visited"}',
      'update subdivision:DE.16 {"status":"visited"}',
      'update country:DE {"status":"visited"}',
    ])

    state = applyToFixture(state, mutations)
    expect(effectiveStatus(state, 'country', 'DE')).toBe('visited')
  })

  it('takes the highest of several sibling subtrees', () => {
    let state = mkState([])
    state = applyToFixture(state, setStatus(state, { kind: 'city', refId: '1', status: 'wishlist' }))
    state = applyToFixture(state, setStatus(state, { kind: 'city', refId: '3', status: 'visited' }))

    expect(effectiveStatus(state, 'subdivision', 'DE.02')).toBe('wishlist')
    expect(effectiveStatus(state, 'subdivision', 'DE.04')).toBe('visited')
    expect(effectiveStatus(state, 'country', 'DE')).toBe('visited')
  })

  it('emits nothing when the requested status is already in place', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
      derived('country', 'DE', 'visited'),
    ])

    expect(setStatus(state, { kind: 'city', refId: '1', status: 'visited' })).toEqual([])
  })
})

// --- §5.5: removal -----------------------------------------------------------

describe('removeEntry', () => {
  it('removes the derived subdivision and country when the only city goes', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
      derived('country', 'DE', 'visited'),
    ])

    expect(summarise(removeEntry(state, 'city:1'))).toEqual([
      'remove city:1',
      'remove subdivision:DE.02',
      'remove country:DE',
    ])
  })

  it('leaves an explicitly set country alone when its only city goes', () => {
    const state = mkState([
      mkEntry({ kind: 'country', refId: 'DE', status: 'visited' }),
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
    ])

    expect(summarise(removeEntry(state, 'city:1'))).toEqual(['remove city:1', 'remove subdivision:DE.02'])
  })

  it('keeps a parent that still has another child', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'lived' }),
      mkEntry({ kind: 'city', refId: '2', status: 'transit' }),
      derived('subdivision', 'DE.02', 'lived'),
      derived('country', 'DE', 'lived'),
    ])

    expect(summarise(removeEntry(state, 'city:1'))).toEqual([
      'remove city:1',
      'update subdivision:DE.02 {"status":"transit"}',
      'update country:DE {"status":"transit"}',
    ])
  })

  it('demotes an explicit parent that still has children instead of orphaning them', () => {
    const state = mkState([
      mkEntry({ kind: 'country', refId: 'DE', status: 'lived' }),
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
    ])

    // Germany stops being a place the user set, and falls back to what Munich implies.
    expect(summarise(removeEntry(state, 'country:DE'))).toEqual([
      'update country:DE {"status":"visited","explicit":false,"explicitStatus":null}',
    ])
  })

  it('is a no-op for an unknown or already-removed entry', () => {
    const state = mkState([mkEntry({ kind: 'city', refId: '1', status: 'visited', deletedAt: 5 })])

    expect(removeEntry(state, 'city:1')).toEqual([])
    expect(removeEntry(state, 'nope')).toEqual([])
  })
})

// --- soft delete and the unique [kind+refId] index ---------------------------

describe('soft-deleted rows', () => {
  it('ignores them when computing status', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'lived', deletedAt: 5 }),
      mkEntry({ kind: 'city', refId: '2', status: 'transit' }),
      derived('subdivision', 'DE.02', 'transit'),
      derived('country', 'DE', 'transit'),
    ])

    expect(effectiveStatus(state, 'subdivision', 'DE.02')).toBe('transit')
  })

  it('restores the existing row rather than inserting a second one', () => {
    // A soft-deleted row still occupies its unique [kind+refId] slot, so a
    // `create` here would fail with a ConstraintError.
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited', deletedAt: 5 }),
      derived('subdivision', 'DE.02', 'visited', { deletedAt: 5 }),
      derived('country', 'DE', 'visited', { deletedAt: 5 }),
    ])

    const mutations = setStatus(state, { kind: 'city', refId: '1', status: 'lived' })

    expect(summarise(mutations)).toEqual([
      'restore city:1 lived explicit',
      'restore subdivision:DE.02 lived derived',
      'restore country:DE lived derived',
    ])
    expect(mutations.every((m) => m.op === 'restore' && m.id.length > 0)).toBe(true)
  })
})

// --- effectiveStatus ---------------------------------------------------------

describe('effectiveStatus', () => {
  it('returns null for a place with no entry and no children', () => {
    expect(effectiveStatus(mkState([]), 'country', 'DE')).toBeNull()
  })

  it('reports what the children imply even when the derived row is missing', () => {
    const state = mkState([mkEntry({ kind: 'city', refId: '1', status: 'visited' })])

    expect(effectiveStatus(state, 'country', 'DE')).toBe('visited')
  })

  it('recomputes rather than trusting a derived row that has drifted', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'transit' }),
      derived('subdivision', 'DE.02', 'lived'), // corrupted
      derived('country', 'DE', 'lived'), // corrupted
    ])

    expect(effectiveStatus(state, 'country', 'DE')).toBe('transit')
  })
})

// --- rebuildAllDerived -------------------------------------------------------

describe('rebuildAllDerived', () => {
  it('emits nothing for a state that is already consistent', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
      derived('country', 'DE', 'visited'),
      mkEntry({ kind: 'country', refId: 'FR', status: 'wishlist' }),
    ])

    expect(rebuildAllDerived(state)).toEqual([])
  })

  it('repairs wrong statuses, missing parents and stray derived rows in one pass', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'lived'), // wrong status
      // country:DE missing entirely
      derived('subdivision', 'FR.11', 'visited'), // stray: no child justifies it
      derived('country', 'FR', 'visited'), // stray, via FR.11
    ])

    expect(summarise(rebuildAllDerived(state))).toEqual([
      'create country:DE visited derived',
      'remove country:FR',
      'update subdivision:DE.02 {"status":"visited"}',
      'remove subdivision:FR.11',
    ])
  })

  it('never rewrites what the user set explicitly, only what was derived from it', () => {
    const state = mkState([
      mkEntry({ kind: 'country', refId: 'DE', status: 'wishlist' }),
      mkEntry({ kind: 'city', refId: '1', status: 'lived' }),
    ])

    const mutations = rebuildAllDerived(state)

    // DE's *displayed* status is repaired to lived (Munich), but the user's own
    // choice of wishlist is preserved underneath it.
    expect(summarise(mutations)).toEqual([
      'update country:DE {"status":"lived"}',
      'create subdivision:DE.02 lived derived',
    ])
    const after = applyToFixture(state, mutations)
    expect(after.entries.find((e) => e.refId === 'DE')?.explicitStatus).toBe('wishlist')
  })

  it('restores a needed row that was soft-deleted, and is idempotent afterwards', () => {
    const state = mkState([
      mkEntry({ kind: 'city', refId: '1', status: 'visited' }),
      derived('subdivision', 'DE.02', 'visited'),
      derived('country', 'DE', 'visited', { deletedAt: 5 }),
    ])

    const mutations = rebuildAllDerived(state)
    expect(summarise(mutations)).toEqual(['restore country:DE visited derived'])
    expect(rebuildAllDerived(applyToFixture(state, mutations))).toEqual([])
  })

  it('leaves a soft-deleted row that nothing needs alone', () => {
    const state = mkState([derived('country', 'DE', 'visited', { deletedAt: 5 })])

    expect(rebuildAllDerived(state)).toEqual([])
  })
})

// --- test-only mutation applier ---------------------------------------------

/**
 * Applies mutations to a fixture state so multi-step scenarios can be written
 * without Dexie. Deliberately dumb — the real applier is `cascadeRepo.ts`.
 */
function applyToFixture(state: CascadeState, mutations: Mutation[]): CascadeState {
  const entries = state.entries.map((e) => ({ ...e }))
  for (const m of mutations) {
    if (m.op === 'create') {
      entries.push(mkEntry({ kind: m.kind, refId: m.refId, ...m.fields }))
      continue
    }
    const row = entries.find((e) => e.id === m.id)
    if (!row) throw new Error(`fixture: no entry ${m.id}`)
    if (m.op === 'remove') row.deletedAt = 1
    else if (m.op === 'restore') Object.assign(row, m.fields, { deletedAt: null })
    else Object.assign(row, m.changes)
  }
  return { ...state, entries }
}
