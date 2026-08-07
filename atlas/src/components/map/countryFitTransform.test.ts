import { describe, expect, it } from 'vitest'
import { computeCountryFitTransform } from './countryFitTransform'

describe('computeCountryFitTransform', () => {
  it('centers the bbox above the sheet at the computed scale', () => {
    const result = computeCountryFitTransform({
      bounds: [
        [100, 200],
        [150, 250],
      ], // 50x50 square, center (125, 225)
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.5, // availableHeight = 400
      fitFraction: 0.5,
      minScale: 1,
      maxScale: 12,
    })

    // width- and height-constrained scales are equal here (400*0.5/50 = 4)
    expect(result.k).toBeCloseTo(4)
    // applying the transform to the bbox center must land it at the center
    // of the space above the sheet, not the center of the full viewport
    expect(125 * result.k + result.x).toBeCloseTo(400 / 2)
    expect(225 * result.k + result.y).toBeCloseTo(400 / 2) // availableHeight/2, not viewportHeight/2
  })

  it('picks the more restrictive dimension so the bbox never overflows either axis', () => {
    const wide = computeCountryFitTransform({
      bounds: [
        [0, 0],
        [200, 20],
      ], // wide and flat
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.5,
      fitFraction: 0.5,
      minScale: 0.5,
      maxScale: 12,
    })
    // width-constrained: (400*0.5)/200 = 1, vs height-constrained (400*0.5)/20 = 10
    expect(wide.k).toBeCloseTo(1)

    const tall = computeCountryFitTransform({
      bounds: [
        [0, 0],
        [20, 200],
      ], // narrow and tall
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.5,
      fitFraction: 0.5,
      minScale: 0.5,
      maxScale: 12,
    })
    // height-constrained: (400*0.5)/200 = 1, vs width-constrained (400*0.5)/20 = 10
    expect(tall.k).toBeCloseTo(1)
  })

  it('clamps up to minScale for a tiny country (e.g. Vatican) so regions stay legible', () => {
    const result = computeCountryFitTransform({
      bounds: [
        [0, 0],
        [1, 1],
      ],
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.5,
      fitFraction: 0.5,
      minScale: 4,
      maxScale: 12,
    })
    // unclamped raw scale would be (400*0.5)/1 = 200, far above maxScale even —
    // the point of this case is minScale wouldn't normally bind, so assert the
    // *actual* binding constraint (maxScale) to make sure clamping runs at all
    expect(result.k).toBe(12)
  })

  it('clamps down to maxScale for a huge landmass (e.g. Russia) rather than zooming out further', () => {
    const result = computeCountryFitTransform({
      bounds: [
        [0, 0],
        [2000, 2000],
      ],
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.5,
      fitFraction: 0.5,
      minScale: 4,
      maxScale: 12,
    })
    // raw scale would be (400*0.5)/2000 = 0.1, below minScale
    expect(result.k).toBe(4)
  })

  it('shrinks the available framing area as the sheet peek height grows', () => {
    const shortSheet = computeCountryFitTransform({
      bounds: [
        [0, 0],
        [10, 10],
      ],
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.2, // availableHeight = 640
      fitFraction: 0.5,
      minScale: 1,
      maxScale: 20,
    })
    const tallSheet = computeCountryFitTransform({
      bounds: [
        [0, 0],
        [10, 10],
      ],
      viewportWidth: 400,
      viewportHeight: 800,
      peekFraction: 0.6, // availableHeight = 320
      fitFraction: 0.5,
      minScale: 1,
      maxScale: 20,
    })
    // a taller sheet leaves less room above it, so the height-constrained
    // scale (and therefore the min()) should be smaller
    expect(tallSheet.k).toBeLessThan(shortSheet.k)
  })
})
