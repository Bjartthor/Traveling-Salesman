import { describe, expect, it } from 'vitest'
import type { TripPlaceRow } from '@/domain/tripPlaces'
import { tripRoute } from '@/domain/tripRoute'

function mkRow(o: { name: string; visitedDate?: string | null; addedAt?: number; lat?: number | null; lon?: number | null }): TripPlaceRow {
  return {
    entryId: o.name,
    refId: o.name,
    name: o.name,
    status: 'visited',
    visitedDate: o.visitedDate === undefined ? '2025-01-01' : o.visitedDate,
    lat: o.lat === undefined ? 1 : o.lat,
    lon: o.lon === undefined ? 1 : o.lon,
    createdAt: 0,
    addedAt: o.addedAt ?? 0,
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

  it('carries each stop\'s coordinates through', () => {
    expect(tripRoute([mkRow({ name: 'A', lat: 48.1, lon: 11.5 })])).toEqual([{ name: 'A', lat: 48.1, lon: 11.5 }])
  })
})
