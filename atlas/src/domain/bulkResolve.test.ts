import { describe, expect, it } from 'vitest'
import { classifyLine, defaultPick, splitLines } from '@/domain/bulkResolve'
import type { CityResult } from '@/geo/search'

let nextId = 1
function mkResult(name: string, population: number): CityResult {
  nextId += 1
  return {
    geonameId: nextId,
    name,
    asciiName: name,
    countryCode: 'XX',
    countryName: 'Testland',
    subdivisionId: null,
    subdivisionName: null,
    lat: 0,
    lon: 0,
    population,
  }
}

describe('splitLines', () => {
  it('splits on newlines, trims, and drops blank lines', () => {
    expect(splitLines('Paris\n  Tokyo  \n\nBerlin\n')).toEqual(['Paris', 'Tokyo', 'Berlin'])
  })

  it('returns an empty array for blank input', () => {
    expect(splitLines('   \n\n  ')).toEqual([])
  })
})

describe('classifyLine', () => {
  it('reports notFound for zero results', () => {
    expect(classifyLine('Nowhereville', [])).toEqual({ line: 'Nowhereville', status: 'notFound' })
  })

  it('auto-matches a single result, however small', () => {
    const only = mkResult('Garmisch-Partenkirchen', 26000)
    expect(classifyLine('garmisch', [only])).toEqual({ line: 'garmisch', status: 'matched', pick: only })
  })

  it('auto-matches when the top result dominates the runner-up (>= 3x population)', () => {
    const paris = mkResult('Paris', 2_100_000)
    const parisTexas = mkResult('Paris', 25_000)
    expect(classifyLine('Paris', [paris, parisTexas])).toEqual({ line: 'Paris', status: 'matched', pick: paris })
  })

  it('is ambiguous when candidates are within the dominance ratio of each other', () => {
    const springfieldMO = mkResult('Springfield', 169_000)
    const springfieldMA = mkResult('Springfield', 155_000)
    const result = classifyLine('Springfield', [springfieldMO, springfieldMA])
    expect(result.status).toBe('ambiguous')
    expect(result.status === 'ambiguous' && result.candidates).toEqual([springfieldMO, springfieldMA])
  })

  it('treats exactly 3x population as still dominant (boundary is inclusive)', () => {
    const top = mkResult('Big', 300)
    const second = mkResult('Small', 100)
    expect(classifyLine('x', [top, second])).toEqual({ line: 'x', status: 'matched', pick: top })
  })

  it('caps ambiguous candidates at 5 even with more results', () => {
    const results = Array.from({ length: 8 }, (_, i) => mkResult(`Place${i}`, 100)) // equal population -> ambiguous
    const result = classifyLine('place', results)
    expect(result.status).toBe('ambiguous')
    expect(result.status === 'ambiguous' && result.candidates).toHaveLength(5)
  })
})

describe('defaultPick', () => {
  it('picks the match for a matched line', () => {
    const only = mkResult('Garmisch-Partenkirchen', 26000)
    expect(defaultPick({ line: 'garmisch', status: 'matched', pick: only })).toBe(only)
  })

  it('picks the top candidate for an ambiguous line', () => {
    const top = mkResult('Springfield', 169_000)
    const second = mkResult('Springfield', 155_000)
    expect(defaultPick({ line: 'Springfield', status: 'ambiguous', candidates: [top, second] })).toBe(top)
  })

  it('picks nothing for a miss', () => {
    expect(defaultPick({ line: 'Nowhereville', status: 'notFound' })).toBeNull()
  })
})
