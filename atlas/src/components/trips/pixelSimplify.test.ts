import { describe, expect, it } from 'vitest'
import { geoEquirectangular, geoPath } from 'd3-geo'
import type { Feature, Polygon } from 'geojson'
import { pixelSimplified } from '@/components/trips/pixelSimplify'

// A dense square ring: 400 points per side, 0.01° apart.
function denseSquare(): Feature<Polygon> {
  const ring: [number, number][] = []
  for (let i = 0; i < 400; i++) ring.push([i * 0.01, 0])
  for (let i = 0; i < 400; i++) ring.push([4, i * 0.01])
  for (let i = 400; i > 0; i--) ring.push([i * 0.01, 4])
  for (let i = 400; i > 0; i--) ring.push([0, i * 0.01])
  ring.push([0, 0])
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring.reverse()] } }
}

const countPoints = (d: string) => (d.match(/[ML]/g) ?? []).length

describe('pixelSimplified', () => {
  it('drops sub-pixel vertices but keeps the shape and its bounds', () => {
    const projection = geoEquirectangular().fitSize([100, 100], denseSquare())
    const full = geoPath(projection)(denseSquare())!
    const simplified = geoPath(pixelSimplified(projection))(denseSquare())!
    // Points sit 0.25px apart here, so at the default 0.75px only every third survives.
    expect(countPoints(simplified)).toBeLessThan(countPoints(full) / 2.5)
    expect(geoPath(pixelSimplified(projection)).bounds(denseSquare())).toEqual(geoPath(projection).bounds(denseSquare()))
  })

  it('keeps every vertex when they are already far apart on screen', () => {
    const projection = geoEquirectangular().fitSize([10000, 10000], denseSquare())
    const full = geoPath(projection)(denseSquare())!
    const simplified = geoPath(pixelSimplified(projection))(denseSquare())!
    expect(countPoints(simplified)).toBe(countPoints(full))
  })
})
