import { describe, expect, it } from 'vitest'
import { nextCountryRowDate, type TripCountryRow } from '@/domain/tripCountryDefaults'

describe('nextCountryRowDate', () => {
  it('defaults to the trip start date when no countries have been added yet', () => {
    expect(nextCountryRowDate([], '2019-03-01')).toBe('2019-03-01')
  })

  it("defaults to the previous row's date once at least one country is added", () => {
    const rows: TripCountryRow[] = [
      { code: 'FR', status: 'visited', date: '2019-03-01' },
      { code: 'DE', status: 'visited', date: '2019-03-05' },
    ]
    expect(nextCountryRowDate(rows, '2019-03-01')).toBe('2019-03-05')
  })

  it("falls back to the start date if the previous row's date was cleared", () => {
    const rows: TripCountryRow[] = [{ code: 'FR', status: 'visited', date: null }]
    expect(nextCountryRowDate(rows, '2019-03-01')).toBe('2019-03-01')
  })
})
