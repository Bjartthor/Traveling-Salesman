import { describe, expect, it } from 'vitest'
import { geoDistance } from 'd3-geo'
import { clampLatitude, clampScale, isFrontFacing, rotateByDrag, rotationTowardPoint, type Rotation } from '@/components/map/globeMath'

// Chosen so DEGREES_PER_RADIAN / scale === 1 exactly (IEEE-754 self-division
// is exact), making every expected delta hand-checkable to the pixel/degree.
const UNIT_SCALE = 180 / Math.PI

describe('clampLatitude', () => {
  it('passes values inside [-90, 90] through unchanged', () => {
    expect(clampLatitude(0)).toBe(0)
    expect(clampLatitude(45.5)).toBe(45.5)
    expect(clampLatitude(-45.5)).toBe(-45.5)
  })

  it('clamps at the exact boundary', () => {
    expect(clampLatitude(90)).toBe(90)
    expect(clampLatitude(-90)).toBe(-90)
  })

  it('clamps beyond the boundary', () => {
    expect(clampLatitude(100)).toBe(90)
    expect(clampLatitude(-100)).toBe(-90)
  })
})

describe('rotateByDrag', () => {
  it('drags right increases lambda 1:1 at unit scale', () => {
    expect(rotateByDrag([0, 0, 0], 30, 0, UNIT_SCALE)).toEqual([30, 0, 0])
  })

  it('drags down decreases phi 1:1 at unit scale', () => {
    expect(rotateByDrag([0, 0, 0], 0, 30, UNIT_SCALE)).toEqual([0, -30, 0])
  })

  it('drags up increases phi', () => {
    expect(rotateByDrag([0, 0, 0], 0, -30, UNIT_SCALE)).toEqual([0, 30, 0])
  })

  it('lambda is left to spin unbounded, never wrapped', () => {
    expect(rotateByDrag([350, 0, 0], 30, 0, UNIT_SCALE)).toEqual([380, 0, 0])
  })

  it('clamps phi at the north pole instead of flipping over it', () => {
    expect(rotateByDrag([10, 80, 5], 0, -20, UNIT_SCALE)).toEqual([10, 90, 5])
  })

  it('clamps phi at the south pole instead of flipping under it', () => {
    expect(rotateByDrag([350, -85, 0], 0, 30, UNIT_SCALE)).toEqual([350, -90, 0])
  })

  it('preserves gamma untouched (no tilt gesture)', () => {
    const [, , gamma] = rotateByDrag([0, 0, 17], 5, 5, UNIT_SCALE)
    expect(gamma).toBe(17)
  })

  it('a larger rendered scale makes the same drag turn the globe less', () => {
    const wide = rotateByDrag([0, 0, 0], 30, 0, UNIT_SCALE * 2)
    expect(wide[0]).toBeCloseTo(15, 10)
  })
})

describe('clampScale', () => {
  it('passes values inside the range unchanged', () => {
    expect(clampScale(5, 1, 10)).toBe(5)
  })

  it('clamps below the minimum', () => {
    expect(clampScale(0.2, 1, 10)).toBe(1)
  })

  it('clamps above the maximum', () => {
    expect(clampScale(50, 1, 10)).toBe(10)
  })

  it('clamps at the exact boundaries', () => {
    expect(clampScale(1, 1, 10)).toBe(1)
    expect(clampScale(10, 1, 10)).toBe(10)
  })
})

describe('isFrontFacing', () => {
  it('the point centred by rotation [0,0,0] is (0,0), which is visible', () => {
    expect(isFrontFacing([0, 0, 0], [0, 0])).toBe(true)
  })

  it('the antipode of the centred point is not visible', () => {
    expect(isFrontFacing([0, 0, 0], [180, 0])).toBe(false)
  })

  it('tracks whatever the rotation currently centres, not just [0,0]', () => {
    // rotate=[-lon,-lat,0] centres (lon,lat) — verified against a live projection.
    expect(isFrontFacing([19.02, -64.96, 0], [-19.02, 64.96])).toBe(true)
    expect(isFrontFacing([19.02, -64.96, 0], [-19.02 + 180, -64.96])).toBe(false)
  })

  it('is inclusive at the exact 90-degree clip boundary', () => {
    expect(isFrontFacing([0, 0, 0], [90, 0])).toBe(true)
  })

  it('rejects a point just past the boundary', () => {
    expect(isFrontFacing([0, 0, 0], [90.001, 0])).toBe(false)
  })

  it('a point 45 degrees off centre is visible', () => {
    expect(isFrontFacing([0, 0, 0], [45, 0])).toBe(true)
  })
})

describe('rotationTowardPoint', () => {
  it('t=0 leaves the rotation unchanged', () => {
    expect(rotationTowardPoint([12, -34, 5], [100, 20], 0)).toEqual([12, -34, 5])
  })

  it('t=1 centres the target exactly', () => {
    const result = rotationTowardPoint([0, 0, 0], [40, 30], 1)
    expect(result[0]).toBeCloseTo(-40, 9)
    expect(result[1]).toBeCloseTo(-30, 9)
  })

  it('preserves gamma (roll) throughout', () => {
    const result = rotationTowardPoint([0, 0, 17], [40, 30], 0.5)
    expect(result[2]).toBe(17)
  })

  it('t=0.5 lands equidistant (great-circle) from the old and new centres', () => {
    const rotation: Rotation = [0, 0, 0]
    const target: [number, number] = [90, 0]
    const result = rotationTowardPoint(rotation, target, 0.5)
    const newCenter: [number, number] = [-result[0], -result[1]]
    expect(geoDistance(newCenter, [0, 0])).toBeCloseTo(geoDistance(newCenter, target), 9)
  })

  it('an already-centred target is a no-op regardless of t (no divide-by-zero)', () => {
    expect(rotationTowardPoint([0, 0, 0], [0, 0], 0.7)).toEqual([0, 0, 0])
  })

  it('a target 90 degrees from centre, t=1, lands the centre exactly on it', () => {
    // rotate=[-lon,-lat,0] centres (lon,lat) — same convention isFrontFacing relies on.
    const result = rotationTowardPoint([0, 0, 0], [-19.02, 64.96], 1)
    expect(isFrontFacing(result, [-19.02, 64.96])).toBe(true)
    expect(geoDistance([-result[0], -result[1]], [-19.02, 64.96])).toBeCloseTo(0, 9)
  })
})
