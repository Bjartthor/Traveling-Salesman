import { describe, expect, it } from 'vitest'
import type { TripPlaceRow } from '@/domain/tripPlaces'
import { tripRoute } from '@/domain/tripRoute'

function mkRow(o: {
  name: string
  visitedDate?: string | null
  addedAt?: number
  visits?: TripPlaceRow['visits']
  lat?: number | null
  lon?: number | null
}): TripPlaceRow {
  const visitedDate = o.visitedDate === undefined ? '2025-01-01' : o.visitedDate
  const addedAt = o.addedAt ?? 0
  return {
    entryId: o.name,
    refId: o.name,
    name: o.name,
    status: 'visited',
    visitedDate,
    lat: o.lat === undefined ? 1 : o.lat,
    lon: o.lon === undefined ? 1 : o.lon,
    createdAt: 0,
    addedAt,
    visits: o.visits ?? [{ visitedDate, addedAt }],
  }
}

const names = (rows: TripPlaceRow[]) => tripRoute(rows).map((s) => s.name)

describe('tripRoute', () => {
  it('orders stops by this trip\'s visit date, oldest first', () => {
    const rows = [mkRow({ name: 'C', visitedDate: '2025-03-03' }), mkRow({ name: 'A', visitedDate: '2025-03-01' }), mkRow({ name: 'B', visitedDate: '2025-03-02' })]
    expect(names(rows)).toEqual(['A', 'B', 'C'])
  })

  it('breaks same-day ties by when the place was added to the trip', () => {
    const rows = [mkRow({ name: 'Second', addedAt: 20 }), mkRow({ name: 'First', addedAt: 10 })]
    expect(names(rows)).toEqual(['First', 'Second'])
  })

  it('leaves undated places out of the route rather than guessing where they go', () => {
    const rows = [mkRow({ name: 'A', visitedDate: '2025-03-01' }), mkRow({ name: 'Undated', visitedDate: null }), mkRow({ name: 'B', visitedDate: '2025-03-02' })]
    expect(names(rows)).toEqual(['A', 'B'])
  })

  it('leaves places without coordinates out of the route', () => {
    const rows = [mkRow({ name: 'A' }), mkRow({ name: 'NoLat', lat: null }), mkRow({ name: 'NoLon', lon: null })]
    expect(names(rows)).toEqual(['A'])
  })

  it('passes through a place once per visit — LA, San Diego, back to LA, then Tahoe', () => {
    const rows = [
      mkRow({
        name: 'LA',
        visits: [
          { visitedDate: '2025-06-01', addedAt: 1 },
          { visitedDate: '2025-06-16', addedAt: 3 },
        ],
      }),
      mkRow({ name: 'San Diego', visits: [{ visitedDate: '2025-06-14', addedAt: 2 }] }),
      mkRow({ name: 'South Lake Tahoe', visits: [{ visitedDate: '2025-07-10', addedAt: 4 }] }),
    ]
    expect(names(rows)).toEqual(['LA', 'San Diego', 'LA', 'South Lake Tahoe'])
  })

  it('skips just the undated visit of a place that also has a dated one', () => {
    const rows = [
      mkRow({ name: 'A', visits: [{ visitedDate: null, addedAt: 1 }, { visitedDate: '2025-03-02', addedAt: 2 }] }),
      mkRow({ name: 'B', visits: [{ visitedDate: '2025-03-01', addedAt: 3 }] }),
    ]
    expect(names(rows)).toEqual(['B', 'A'])
  })

  it('carries each stop\'s coordinates through', () => {
    expect(tripRoute([mkRow({ name: 'A', lat: 48.1, lon: 11.5 })])).toEqual([{ name: 'A', lat: 48.1, lon: 11.5 }])
  })
})
