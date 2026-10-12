import { describe, expect, it } from 'vitest'
import type { Entry, Trip, TripEntry } from '@/db/types'
import { withTripVisitDates } from '@/domain/visitDates'

function entry(over: Partial<Entry> = {}): Entry {
  return {
    id: 'reykjavik',
    kind: 'city',
    refId: '3413829',
    status: 'lived',
    explicit: true,
    explicitStatus: 'lived',
    firstVisited: '2005-04-03',
    lastVisited: '2005-04-03',
    notes: '',
    createdAt: 0,
    updatedAt: 0,
    deletedAt: null,
    ...over,
  }
}

function trip(over: Partial<Trip> = {}): Trip {
  return { id: 't1', name: 'Test', startDate: null, endDate: null, isActive: false, isBackfilling: false, notes: '', createdAt: 0, updatedAt: 0, deletedAt: null, ...over }
}

function link(over: Partial<TripEntry> = {}): TripEntry {
  return { id: 'te1', tripId: 't1', entryId: 'reykjavik', addedAt: 0, visitedDate: '2026-10-01', createdAt: 0, updatedAt: 0, deletedAt: null, ...over }
}

const dates = (e: Entry) => [e.firstVisited, e.lastVisited]

describe('withTripVisitDates', () => {
  it("widens a place's span with a live trip's date for it", () => {
    const [out] = withTripVisitDates([entry()], [link()], [trip()])
    expect(dates(out!)).toEqual(['2005-04-03', '2026-10-01'])
  })

  it('drops a deleted trip — its date no longer counts', () => {
    const [out] = withTripVisitDates([entry()], [link()], [trip({ deletedAt: 5 })])
    expect(dates(out!)).toEqual(['2005-04-03', '2005-04-03'])
  })

  it('drops a detached attachment the same way', () => {
    const [out] = withTripVisitDates([entry()], [link({ deletedAt: 5 })], [trip()])
    expect(dates(out!)).toEqual(['2005-04-03', '2005-04-03'])
  })

  it('an earlier trip pulls firstVisited back', () => {
    const [out] = withTripVisitDates([entry()], [link({ visitedDate: '2001-07-14' })], [trip()])
    expect(dates(out!)).toEqual(['2001-07-14', '2005-04-03'])
  })

  it('folds every trip in, and gives an undated place its trips’ span', () => {
    const links = [link({ id: 'a', tripId: 't1', visitedDate: '2019-01-01' }), link({ id: 'b', tripId: 't2', visitedDate: '2023-06-01' })]
    const [out] = withTripVisitDates([entry({ firstVisited: null, lastVisited: null })], links, [trip({ id: 't1' }), trip({ id: 't2' })])
    expect(dates(out!)).toEqual(['2019-01-01', '2023-06-01'])
  })

  it('ignores an attachment with no date', () => {
    const [out] = withTripVisitDates([entry()], [link({ visitedDate: null })], [trip()])
    expect(dates(out!)).toEqual(['2005-04-03', '2005-04-03'])
  })

  it('returns an untouched entry as the very same object', () => {
    const e = entry({ id: 'other' })
    expect(withTripVisitDates([e], [link()], [trip()])[0]).toBe(e)
  })
})
