import { describe, expect, it } from 'vitest'
import type { City, Entry, Photo, Trip, TripEntry } from '@/db/types'
import type { SyncableSettings, SyncSnapshot } from '@/sync/types'
import { canonicalize, mergeSettings, mergeSnapshots, snapshotsEqual } from '@/sync/merge'

// --- fixture builders (only the fields a test cares about need passing) ---

let seq = 0
const uid = () => `id-${++seq}`

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: over.id ?? uid(),
    kind: 'country',
    refId: 'DE',
    status: 'visited',
    explicit: true,
    explicitStatus: 'visited',
    firstVisited: null,
    lastVisited: null,
    notes: '',
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...over,
  }
}

function trip(over: Partial<Trip> = {}): Trip {
  return {
    id: over.id ?? uid(),
    name: 'Trip',
    startDate: null,
    endDate: null,
    isActive: false,
    notes: '',
    coverPhotoId: null,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...over,
  }
}

function tripEntry(over: Partial<TripEntry> = {}): TripEntry {
  return {
    id: over.id ?? uid(),
    tripId: 't1',
    entryId: 'e1',
    addedAt: 1000,
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...over,
  }
}

function photo(over: Partial<Photo> = {}): Photo {
  return {
    id: over.id ?? uid(),
    entryId: null,
    tripId: null,
    caption: '',
    takenAt: null,
    lat: null,
    lon: null,
    width: 100,
    height: 100,
    bytes: 1000,
    driveFileId: null,
    uploadState: 'pending',
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    ...over,
  }
}

function city(over: Partial<City> = {}): City {
  return {
    geonameId: over.geonameId ?? -1,
    name: 'Vík',
    asciiName: 'Vik',
    countryCode: 'IS',
    subdivisionId: null,
    lat: 63.4,
    lon: -19,
    population: 0,
    source: 'online',
    searchTokens: [],
    ...over,
  }
}

const settings = (over: Partial<SyncableSettings> = {}): SyncableSettings => ({
  statMode: 'countries',
  countryDenominator: 'all',
  theme: 'dark',
  ...over,
})

function snapshot(over: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return { entries: [], trips: [], tripEntries: [], photos: [], cities: [], settings: settings(), ...over }
}

const merge = (local: SyncSnapshot, remote: SyncSnapshot, settingsBase: SyncableSettings | null = null) =>
  mergeSnapshots({ local, remote, settingsBase })

const byKey = (e: Entry) => `${e.kind}:${e.refId}`
const active = <T extends { deletedAt: number | null }>(rows: T[]): T[] => rows.filter((r) => r.deletedAt === null)

// --- the five scenarios the brief names ---

describe('the five brief scenarios', () => {
  it('two devices add different cities offline → both survive', () => {
    const local = snapshot({ entries: [entry({ kind: 'city', refId: '100' })] })
    const remote = snapshot({ entries: [entry({ kind: 'city', refId: '200' })] })

    const merged = merge(local, remote)

    expect(merged.entries.map(byKey).sort()).toEqual(['city:100', 'city:200'])
  })

  it('two devices change the same city status → later timestamp wins', () => {
    const older = entry({ id: 'a', kind: 'city', refId: '100', status: 'visited', updatedAt: 100 })
    const newer = entry({ id: 'b', kind: 'city', refId: '100', status: 'lived', updatedAt: 200 })

    const merged = merge(snapshot({ entries: [older] }), snapshot({ entries: [newer] }))

    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]!.status).toBe('lived')
  })

  it('one device deletes a trip, the other edits it → deletion wins if later', () => {
    const edited = trip({ id: 't1', name: 'Edited', updatedAt: 100 })
    const deleted = trip({ id: 't1', name: 'Old', updatedAt: 300, deletedAt: 300 })

    const merged = merge(snapshot({ trips: [edited] }), snapshot({ trips: [deleted] }))

    expect(merged.trips).toHaveLength(1)
    expect(merged.trips[0]!.deletedAt).toBe(300)
  })

  it('one device deletes a trip, the other edits it → edit wins if later', () => {
    const deleted = trip({ id: 't1', name: 'Old', updatedAt: 100, deletedAt: 100 })
    const edited = trip({ id: 't1', name: 'Edited', updatedAt: 300 })

    const merged = merge(snapshot({ trips: [deleted] }), snapshot({ trips: [edited] }))

    expect(merged.trips).toHaveLength(1)
    expect(merged.trips[0]!.deletedAt).toBeNull()
    expect(merged.trips[0]!.name).toBe('Edited')
  })

  it('a device offline for a month syncs without losing anything', () => {
    // Remote moved on a lot; local kept one private edit the remote never saw.
    const remoteEntries = Array.from({ length: 30 }, (_, i) => entry({ kind: 'city', refId: `${i}`, updatedAt: 5000 }))
    const localOnly = entry({ kind: 'city', refId: 'local-only', updatedAt: 10 })
    const localEditedCommon = entry({ id: 'x', kind: 'country', refId: 'FR', status: 'lived', updatedAt: 9999 })
    const remoteCommonStale = entry({ id: 'y', kind: 'country', refId: 'FR', status: 'visited', updatedAt: 4000 })

    const local = snapshot({ entries: [localOnly, localEditedCommon] })
    const remote = snapshot({ entries: [...remoteEntries, remoteCommonStale] })

    const merged = merge(local, remote)

    // 30 remote cities + local-only city + the shared FR country = 32 keys.
    expect(new Set(merged.entries.map(byKey)).size).toBe(32)
    // Nothing dropped: the local-only entry survived, and the local newer FR edit won.
    expect(merged.entries.find((e) => e.refId === 'local-only')).toBeDefined()
    expect(merged.entries.find((e) => e.refId === 'FR')!.status).toBe('lived')
  })

  it('merging the same payload twice changes nothing', () => {
    const local = snapshot({
      entries: [entry({ kind: 'city', refId: '100', updatedAt: 1 }), entry({ kind: 'country', refId: 'DE', updatedAt: 2 })],
      trips: [trip({ id: 't1', updatedAt: 3 })],
    })
    const remote = snapshot({ entries: [entry({ kind: 'city', refId: '200', updatedAt: 4 })] })

    const once = merge(local, remote)
    // Re-merging the result against either side, and against itself, is stable.
    expect(snapshotsEqual(merge(once, remote, once.settings), once)).toBe(true)
    expect(snapshotsEqual(merge(local, once, once.settings), once)).toBe(true)
    expect(snapshotsEqual(merge(once, once, once.settings), once)).toBe(true)
  })
})

// --- the natural-key collision the [kind+refId] unique index forces us to handle ---

describe('entry natural-key collision (two devices add the SAME place offline)', () => {
  it('collapses two ids for one place into a single row, deterministically', () => {
    const a = entry({ id: 'aaa', kind: 'country', refId: 'JP', status: 'visited', updatedAt: 500 })
    const b = entry({ id: 'bbb', kind: 'country', refId: 'JP', status: 'lived', updatedAt: 900 })

    const ab = merge(snapshot({ entries: [a] }), snapshot({ entries: [b] }))
    const ba = merge(snapshot({ entries: [b] }), snapshot({ entries: [a] }))

    // Exactly one row for the key, and both merge directions agree (convergent).
    expect(ab.entries).toHaveLength(1)
    expect(ab.entries[0]!.id).toBe('bbb') // later updatedAt won
    expect(ab.entries[0]!.status).toBe('lived')
    expect(canonicalize(ab)).toBe(canonicalize(ba))
  })

  it('re-points a tripEntry and a photo from the dropped id to the survivor', () => {
    const loser = entry({ id: 'loser', kind: 'country', refId: 'JP', updatedAt: 100 })
    const winner = entry({ id: 'winner', kind: 'country', refId: 'JP', updatedAt: 200 })

    const local = snapshot({
      entries: [loser],
      tripEntries: [tripEntry({ id: 'te1', tripId: 't1', entryId: 'loser' })],
      photos: [photo({ id: 'p1', entryId: 'loser' })],
    })
    const remote = snapshot({ entries: [winner] })

    const merged = merge(local, remote)

    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]!.id).toBe('winner')
    expect(merged.tripEntries[0]!.entryId).toBe('winner')
    expect(merged.photos[0]!.entryId).toBe('winner')
  })

  it('dedupes tripEntries that collide on [tripId, entryId] after re-pointing', () => {
    const loser = entry({ id: 'loser', kind: 'country', refId: 'JP', updatedAt: 100 })
    const winner = entry({ id: 'winner', kind: 'country', refId: 'JP', updatedAt: 200 })

    // Each device linked its own duplicate JP entry to the same trip.
    const local = snapshot({
      entries: [loser],
      tripEntries: [tripEntry({ id: 'te-loser', tripId: 't1', entryId: 'loser', updatedAt: 100 })],
    })
    const remote = snapshot({
      entries: [winner],
      tripEntries: [tripEntry({ id: 'te-winner', tripId: 't1', entryId: 'winner', updatedAt: 150 })],
    })

    const merged = merge(local, remote)

    expect(active(merged.tripEntries)).toHaveLength(1)
    expect(active(merged.tripEntries)[0]!.entryId).toBe('winner')
  })

  it('a deletion of one duplicate does not resurrect the place via the other id', () => {
    // Remote dropped its JP id entirely (it lost a prior collision); local still
    // has a *tombstoned* JP. The place should stay gone, one row, no crash.
    const localDeleted = entry({ id: 'old', kind: 'country', refId: 'JP', updatedAt: 300, deletedAt: 300 })
    const remoteActiveButOlder = entry({ id: 'new', kind: 'country', refId: 'JP', status: 'visited', updatedAt: 100 })

    const merged = merge(snapshot({ entries: [localDeleted] }), snapshot({ entries: [remoteActiveButOlder] }))

    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]!.deletedAt).toBe(300) // the later delete wins over the older add
  })
})

// --- tombstone edge cases ---

describe('tombstone comparison', () => {
  it('a tombstone whose deletedAt beats the other side updatedAt wins even on equal updatedAt', () => {
    // Same updatedAt, but one carries a strictly later deletedAt.
    const activeRow = entry({ id: 'a', kind: 'city', refId: '1', updatedAt: 100, deletedAt: null })
    const tombstone = entry({ id: 'b', kind: 'city', refId: '1', updatedAt: 100, deletedAt: 150 })

    const merged = merge(snapshot({ entries: [activeRow] }), snapshot({ entries: [tombstone] }))

    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]!.deletedAt).toBe(150)
  })

  it('a one-sided tombstone is kept (deletes propagate)', () => {
    const tombstone = entry({ kind: 'city', refId: '1', updatedAt: 100, deletedAt: 100 })

    const merged = merge(snapshot({ entries: [tombstone] }), snapshot())

    expect(merged.entries).toHaveLength(1)
    expect(merged.entries[0]!.deletedAt).toBe(100)
  })
})

// --- settings field-by-field ---

describe('settings three-way merge', () => {
  it('keeps two independent field changes instead of clobbering wholesale', () => {
    const base = settings({ statMode: 'countries', theme: 'dark' })
    const local = settings({ statMode: 'area', theme: 'dark' }) // this device changed statMode
    const remote = settings({ statMode: 'countries', theme: 'light' }) // other changed theme

    const merged = mergeSettings(base, local, remote)

    expect(merged.statMode).toBe('area')
    expect(merged.theme).toBe('light')
  })

  it('remote wins when both changed the same field differently', () => {
    const base = settings({ theme: 'dark' })
    const merged = mergeSettings(base, settings({ theme: 'dark' }), settings({ theme: 'light' }))
    // local kept base, remote changed → remote.
    expect(merged.theme).toBe('light')

    const bothChanged = mergeSettings(settings({ theme: 'dark' }), settings({ theme: 'dark' }), settings({ theme: 'light' }))
    expect(bothChanged.theme).toBe('light')
  })

  it('with no baseline, the shared Drive value wins (new device adopts account prefs)', () => {
    const merged = mergeSettings(null, settings({ statMode: 'area' }), settings({ statMode: 'population' }))
    expect(merged.statMode).toBe('population')
  })

  it('is convergent across a push/pull cycle with no baseline', () => {
    // Device A pushed its prefs first (Drive = A). Device B connects, base=null.
    const drive = settings({ theme: 'light' })
    const bLocal = settings({ theme: 'dark' })
    const bMerged = mergeSettings(null, bLocal, drive)
    expect(bMerged.theme).toBe('light') // B adopts the shared value; no ping-pong
  })
})

// --- immutability / idempotency guarantees ---

describe('purity', () => {
  it('does not mutate either input snapshot', () => {
    const local = snapshot({ entries: [entry({ id: 'x', kind: 'country', refId: 'JP', updatedAt: 100 })] })
    const remote = snapshot({ entries: [entry({ id: 'y', kind: 'country', refId: 'JP', updatedAt: 200 })] })
    const localCopy = canonicalize(local)
    const remoteCopy = canonicalize(remote)

    merge(local, remote)

    expect(canonicalize(local)).toBe(localCopy)
    expect(canonicalize(remote)).toBe(remoteCopy)
  })
})

// --- non-bundled (online/manual) cities travel with the doc (cross-device fix) ---

describe('non-bundled city sync', () => {
  it('a city added on one device rides along so its entry can resolve on the other', () => {
    // Device A added an online city and logged it; the row must reach B, or B's
    // cascade throws UnknownCityError on the dangling entry and the sync fails.
    const local = snapshot({
      entries: [entry({ kind: 'city', refId: '-42' })],
      cities: [city({ geonameId: -42 })],
    })
    const merged = merge(local, snapshot())

    expect(merged.cities.map((c) => c.geonameId)).toEqual([-42])
  })

  it('two devices add different online cities → both survive', () => {
    const a = snapshot({ cities: [city({ geonameId: -1, name: 'Vík' })] })
    const b = snapshot({ cities: [city({ geonameId: -2, name: 'Skorki' })] })

    expect(merge(a, b).cities.map((c) => c.geonameId).sort((x, y) => x - y)).toEqual([-2, -1])
  })

  it('the same city from both sides collapses to one row', () => {
    const shared = city({ geonameId: -7 })
    const merged = merge(snapshot({ cities: [shared] }), snapshot({ cities: [{ ...shared }] }))

    expect(merged.cities).toHaveLength(1)
  })

  it('city merging is convergent and stable across a re-merge', () => {
    const a = snapshot({ cities: [city({ geonameId: -1 })] })
    const b = snapshot({ cities: [city({ geonameId: -2 })] })
    const ab = merge(a, b)
    const ba = merge(b, a)

    expect(canonicalize(ab)).toBe(canonicalize(ba)) // order-independent
    expect(snapshotsEqual(merge(ab, ab, ab.settings), ab)).toBe(true) // idempotent
  })

  it('canonicalize distinguishes snapshots that differ only in cities', () => {
    expect(snapshotsEqual(snapshot({ cities: [city()] }), snapshot())).toBe(false)
  })

  it('tolerates a v1 remote snapshot with no cities field', () => {
    const legacyRemote = { ...snapshot(), cities: undefined } as unknown as SyncSnapshot
    const local = snapshot({ cities: [city({ geonameId: -5 })] })

    expect(merge(local, legacyRemote).cities.map((c) => c.geonameId)).toEqual([-5])
  })
})
