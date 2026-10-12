import { describe, expect, it } from 'vitest'
import { cityFitBox } from '@/components/trips/tripMapFit'

const corners = (points: { lat: number; lon: number }[], minSpanDeg?: number) => {
  const coords = cityFitBox(points, minSpanDeg).geometry.coordinates
  const lons = coords.map(([lon]) => lon!)
  const lats = coords.map(([, lat]) => lat!)
  return { west: Math.min(...lons), east: Math.max(...lons), south: Math.min(...lats), north: Math.max(...lats) }
}

const LA = { lat: 34.05, lon: -118.24 }
const SAN_DIEGO = { lat: 32.72, lon: -117.16 }
const TAHOE = { lat: 38.93, lon: -119.98 }

describe('cityFitBox', () => {
  it('covers every city, with a margin around them', () => {
    const b = corners([LA, SAN_DIEGO, TAHOE])
    expect(b.west).toBeLessThan(TAHOE.lon)
    expect(b.east).toBeGreaterThan(SAN_DIEGO.lon)
    expect(b.south).toBeLessThan(SAN_DIEGO.lat)
    expect(b.north).toBeGreaterThan(TAHOE.lat)
  })

  it('stays centred on the cities', () => {
    const b = corners([LA, TAHOE])
    expect((b.west + b.east) / 2).toBeCloseTo((LA.lon + TAHOE.lon) / 2)
    expect((b.south + b.north) / 2).toBeCloseTo((LA.lat + TAHOE.lat) / 2)
  })

  it('never shrinks below the minimum span — one city still shows its surroundings', () => {
    const b = corners([LA], 1.5)
    expect(b.east - b.west).toBeCloseTo(1.5)
    expect(b.north - b.south).toBeCloseTo(1.5)
    expect((b.west + b.east) / 2).toBeCloseTo(LA.lon)
  })

  it('widens only the axis that is too narrow', () => {
    // Two cities on the same parallel: plenty of longitude, no latitude span at all.
    const b = corners([{ lat: 40, lon: -100 }, { lat: 40, lon: -80 }], 1.5)
    expect(b.east - b.west).toBeGreaterThan(20)
    expect(b.north - b.south).toBeCloseTo(1.5)
  })

  it('keeps the box off the poles', () => {
    const b = corners([{ lat: 89.5, lon: 0 }], 4)
    expect(b.north).toBeLessThanOrEqual(85)
  })
})
