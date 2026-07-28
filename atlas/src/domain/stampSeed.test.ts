import { describe, expect, it } from 'vitest'
import { stampInkSeed, stampRotationDeg } from '@/domain/stampSeed'

describe('stampRotationDeg', () => {
  it('is stable for the same trip id', () => {
    expect(stampRotationDeg('trip-1')).toBe(stampRotationDeg('trip-1'))
  })

  it('stays within -2..2 degrees', () => {
    for (const id of ['a', 'b', 'trip-123', '', 'x'.repeat(50)]) {
      const deg = stampRotationDeg(id)
      expect(deg).toBeGreaterThanOrEqual(-2)
      expect(deg).toBeLessThanOrEqual(2)
    }
  })

  it('differs across different ids — not a constant', () => {
    const values = new Set(['t1', 't2', 't3', 't4', 't5'].map(stampRotationDeg))
    expect(values.size).toBeGreaterThan(1)
  })
})

describe('stampInkSeed', () => {
  it('is stable for the same trip id and stays in range', () => {
    expect(stampInkSeed('trip-1')).toBe(stampInkSeed('trip-1'))
    expect(stampInkSeed('trip-1')).toBeGreaterThanOrEqual(0)
    expect(stampInkSeed('trip-1')).toBeLessThan(100)
  })
})
