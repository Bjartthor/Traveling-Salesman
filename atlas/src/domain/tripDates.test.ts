import { describe, expect, it } from 'vitest'
import { stretchTripDates } from '@/domain/tripDates'

const june = { startDate: '2025-06-01', endDate: '2025-07-10' }

describe('stretchTripDates', () => {
  it('changes nothing for a visit inside the trip — a mid-trip insert keeps the trip as it is', () => {
    expect(stretchTripDates(june, '2025-06-16')).toBeNull()
    expect(stretchTripDates(june, '2025-06-01')).toBeNull()
    expect(stretchTripDates(june, '2025-07-10')).toBeNull()
  })

  it('moves the start earlier for a visit before it', () => {
    expect(stretchTripDates(june, '2025-05-28')).toEqual({ startDate: '2025-05-28' })
  })

  it('moves the end later for a visit after it', () => {
    expect(stretchTripDates(june, '2025-07-20')).toEqual({ endDate: '2025-07-20' })
  })

  it('leaves an open trip open — no end date is invented', () => {
    expect(stretchTripDates({ startDate: '2025-06-01', endDate: null }, '2025-08-01')).toBeNull()
    expect(stretchTripDates({ startDate: '2025-06-01', endDate: null }, '2025-05-01')).toEqual({ startDate: '2025-05-01' })
  })

  it('gives a trip with no start date this one', () => {
    expect(stretchTripDates({ startDate: null, endDate: null }, '2025-06-01')).toEqual({ startDate: '2025-06-01' })
  })
})
