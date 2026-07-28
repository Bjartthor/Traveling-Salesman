import { describe, expect, it } from 'vitest'
import type { Trip } from '@/db/types'
import { computeTripStats, newCountriesByTrip, tripDurationDays } from '@/domain/tripStats'

let idCounter = 0
function mkTrip(o: { name: string; startDate: string | null; endDate?: string | null; createdAt?: number; isActive?: boolean }): Trip {
  idCounter += 1
  const endDate = o.endDate ?? null
  return {
    id: `t${idCounter}`,
    name: o.name,
    startDate: o.startDate,
    endDate,
    isActive: o.isActive ?? endDate === null,
    notes: '',
    coverPhotoId: null,
    createdAt: o.createdAt ?? 0,
    updatedAt: 0,
    deletedAt: null,
  }
}

describe('tripDurationDays', () => {
  it('counts inclusively — same start/end is 1 day', () => {
    expect(tripDurationDays({ startDate: '2024-01-01', endDate: '2024-01-01' })).toBe(1)
  })

  it('counts a closed multi-day trip correctly', () => {
    expect(tripDurationDays({ startDate: '2024-01-01', endDate: '2024-01-10' })).toBe(10)
  })

  it('uses `today` as a stand-in end date for an open trip', () => {
    expect(tripDurationDays({ startDate: '2024-01-01', endDate: null }, '2024-01-05')).toBe(5)
  })

  it('is null when there is no start date at all', () => {
    expect(tripDurationDays({ startDate: null, endDate: '2024-01-10' })).toBeNull()
  })
})

describe('computeTripStats', () => {
  // Closed 5-day Germany trip (2 countries), closed 3-day Iceland trip (1 country),
  // and an open Japan trip still running as of "today" — 4 days so far, 1 country.
  const trips = [
    mkTrip({ name: 'Germany', startDate: '2023-06-01', endDate: '2023-06-05' }),
    mkTrip({ name: 'Iceland', startDate: '2024-02-01', endDate: '2024-02-03' }),
    mkTrip({ name: 'Japan', startDate: '2024-03-01', endDate: null }),
  ]
  const countriesByTrip = new Map([
    [trips[0]!.id, ['DE', 'FR']],
    [trips[1]!.id, ['IS']],
    [trips[2]!.id, ['JP']],
  ])

  it('includes the open trip in every stat, using today as its provisional end (confirmed with the user)', () => {
    const stats = computeTripStats({ trips, countriesByTrip }, '2024-03-04')
    expect(stats.totalTrips).toBe(3)
    expect(stats.longestTripDays).toBe(5) // Germany, still the longest
    expect(stats.longestTripName).toBe('Germany')
    expect(stats.mostCountriesInOneTrip).toBe(2)
    expect(stats.mostCountriesTripName).toBe('Germany')
    // durations: 5, 3, 4 (Japan so far) -> average 4
    expect(stats.averageTripLengthDays).toBe(4)
  })

  it('lets the open trip take over "longest" once it runs long enough', () => {
    const stats = computeTripStats({ trips, countriesByTrip }, '2024-03-20')
    expect(stats.longestTripName).toBe('Japan')
    expect(stats.longestTripDays).toBe(20)
  })

  it('is all zero/null for no trips', () => {
    const stats = computeTripStats({ trips: [], countriesByTrip: new Map() })
    expect(stats).toEqual({
      totalTrips: 0,
      longestTripDays: null,
      longestTripName: null,
      mostCountriesInOneTrip: 0,
      mostCountriesTripName: null,
      averageTripLengthDays: null,
    })
  })
})

describe('newCountriesByTrip', () => {
  it('credits a country to the earliest trip that touched it, not a later revisit', () => {
    const first = mkTrip({ name: 'First Europe trip', startDate: '2022-01-01', endDate: '2022-01-10' })
    const second = mkTrip({ name: 'Second Europe trip', startDate: '2023-01-01', endDate: '2023-01-10' })
    const countriesByTrip = new Map([
      [first.id, ['DE', 'FR']],
      [second.id, ['DE', 'IT']], // DE revisited, IT new
    ])
    const result = newCountriesByTrip({ trips: [first, second], countriesByTrip })
    expect(result.get(first.id)).toEqual(['DE', 'FR'])
    expect(result.get(second.id)).toEqual(['IT'])
  })

  it('breaks ties on createdAt when two trips share a start date', () => {
    const older = mkTrip({ name: 'Logged first', startDate: '2022-01-01', endDate: '2022-01-05', createdAt: 100 })
    const newer = mkTrip({ name: 'Logged later', startDate: '2022-01-01', endDate: '2022-01-05', createdAt: 200 })
    const countriesByTrip = new Map([
      [older.id, ['ES']],
      [newer.id, ['ES']],
    ])
    const result = newCountriesByTrip({ trips: [newer, older], countriesByTrip })
    expect(result.get(older.id)).toEqual(['ES'])
    expect(result.get(newer.id)).toEqual([])
  })

  it('disqualifies a trip when a non-trip record shows an even earlier visit', () => {
    const trip = mkTrip({ name: 'Trip', startDate: '2023-01-01', endDate: '2023-01-10' })
    const countriesByTrip = new Map([[trip.id, ['ES']]])
    const priorFirstVisited = new Map([['ES', '2010-05-01']]) // visited long before any trip was ever logged
    const result = newCountriesByTrip({ trips: [trip], countriesByTrip, priorFirstVisited })
    expect(result.get(trip.id)).toEqual([])
  })
})
