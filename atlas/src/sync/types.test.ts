import { describe, expect, it } from 'vitest'
import { changesSyncedSettings } from '@/sync/types'

const current = { statMode: 'countries', countryDenominator: 'all', theme: 'dark' } as const

describe('changesSyncedSettings', () => {
  it('is true when a synced field gets a new value', () => {
    expect(changesSyncedSettings(current, { statMode: 'area' })).toBe(true)
    expect(changesSyncedSettings(current, { theme: 'light' })).toBe(true)
  })

  it('is false when a synced field is set to the value it already has', () => {
    expect(changesSyncedSettings(current, { statMode: 'countries', theme: 'dark' })).toBe(false)
  })

  it('ignores device-local fields', () => {
    expect(changesSyncedSettings(current, { mapView: 'globe', lastSyncAt: 5 })).toBe(false)
  })

  it('treats a missing current row as changed', () => {
    expect(changesSyncedSettings(undefined, { statMode: 'countries' })).toBe(true)
  })
})
