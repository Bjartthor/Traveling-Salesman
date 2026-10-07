import { describe, expect, it } from 'vitest'
import { routeLeg } from '@/components/trips/routeGeometry'

describe('routeLeg', () => {
  it('bows the curve to the left of travel direction (screen y points down)', () => {
    // Heading east: left is up, i.e. negative y. Bow = 20% of the 100 px leg.
    const leg = routeLeg([0, 0], [100, 0])!
    expect(leg.control[0]).toBeCloseTo(50)
    expect(leg.control[1]).toBeCloseTo(-20)
  })

  it('bows a reversed leg to the other side, so A→B and B→A never overlap', () => {
    const leg = routeLeg([100, 0], [0, 0])!
    expect(leg.control[1]).toBeCloseTo(20)
  })

  it('puts the chevron tip on the curve\'s midpoint, pointing along the direction of travel', () => {
    const { chevron } = routeLeg([0, 0], [100, 0])!
    const [armA, tip, armB] = chevron!
    expect(tip[0]).toBeCloseTo(50) // 0.25·0 + 0.5·50 + 0.25·100
    expect(tip[1]).toBeCloseTo(-10) // 0.5·-20
    // Both arms trail behind the tip (pointing east) and mirror each other across the tangent.
    expect(armA[0]).toBeLessThan(tip[0])
    expect(armB[0]).toBeCloseTo(armA[0])
    expect(armA[1] - tip[1]).toBeCloseTo(-(armB[1] - tip[1]))
  })

  it('draws nothing for a leg too short to see', () => {
    expect(routeLeg([0, 0], [3, 0])).toBeNull()
  })

  it('draws a short leg without a chevron, which would swamp it', () => {
    const leg = routeLeg([0, 0], [10, 0])
    expect(leg).not.toBeNull()
    expect(leg!.chevron).toBeNull()
  })
})
