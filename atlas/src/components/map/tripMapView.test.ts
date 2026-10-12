import { describe, expect, it } from 'vitest'
import { flatFitTransform, globeFitView } from '@/components/map/tripMapView'

const SIZE = { width: 400, height: 800 }

describe('flatFitTransform', () => {
  const box: [[number, number], [number, number]] = [
    [100, 300],
    [140, 340],
  ]

  it('centres the box in the viewport', () => {
    const t = flatFitTransform(box, SIZE, 40)
    expect(t.x + t.k * 120).toBeCloseTo(200)
    expect(t.y + t.k * 320).toBeCloseTo(400)
  })

  it('scales the box to fill the padded viewport along its tighter axis', () => {
    const t = flatFitTransform(box, SIZE, 40)
    // 40 px wide box, 400 px viewport, 40 px padding each side → 320 / 40 = 8.
    expect(t.k).toBeCloseTo(8)
    expect(t.k * 40).toBeLessThanOrEqual(SIZE.height - 80)
  })

  it('never zooms out past the whole-world view', () => {
    const t = flatFitTransform(
      [
        [-500, -500],
        [900, 1300],
      ],
      SIZE,
      40,
    )
    expect(t.k).toBe(1)
  })
})

describe('globeFitView', () => {
  const california = [
    { lat: 34.05, lon: -118.24 },
    { lat: 32.72, lon: -117.16 },
    { lat: 38.93, lon: -119.98 },
  ]

  it('turns to face the middle of the trip', () => {
    const { rotation } = globeFitView(california)
    // Centre of the westmost/eastmost cities (Tahoe, San Diego), not their average.
    expect(-rotation[0]).toBeCloseTo((-119.98 + -117.16) / 2, 5)
    expect(-rotation[1]).toBeGreaterThan(32.72)
    expect(-rotation[1]).toBeLessThan(38.93)
    expect(rotation[2]).toBe(0)
  })

  it('zooms further in for a smaller trip', () => {
    const wide = globeFitView([
      { lat: 34, lon: -118 },
      { lat: 40.7, lon: -74 },
    ])
    expect(globeFitView(california).zoom).toBeGreaterThan(wide.zoom)
    expect(wide.zoom).toBeGreaterThan(1)
  })

  it('shows the whole globe for a trip spanning a hemisphere or more', () => {
    expect(
      globeFitView([
        { lat: 0, lon: -100 },
        { lat: 0, lon: 100 },
      ]).zoom,
    ).toBe(1)
  })
})
