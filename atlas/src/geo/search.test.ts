import { describe, expect, it } from 'vitest'
import { rankRegions, toIndexRow, topMatches, type IndexRow } from '@/geo/search'

function city(id: number, name: string, population: number, asciiName = name): IndexRow {
  return toIndexRow({ geonameId: id, name, asciiName, countryCode: 'XX', subdivisionId: null, population, lat: 0, lon: 0 })
}

// The reference: score every row, stable-sort, slice — what search did before the early exit.
function bruteForce(rows: readonly IndexRow[], q: string, limit: number): number[] {
  const weight = (hay: string): number => {
    if (hay.startsWith(q)) return 3
    const pos = hay.indexOf(q)
    if (pos === -1) return 0
    const prev = hay[pos - 1]
    return prev === '\u0000' ? 3 : prev === ' ' ? 2 : 1
  }
  return rows
    .map((row) => ({ row, score: (row.pop + 1) * weight(row.hay) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.row.id)
}

describe('topMatches', () => {
  const rows = [
    city(1, 'Reykjavík', 120000),
    city(2, 'Vikersund', 3000),
    city(3, 'Keflavík', 2000),
    city(4, 'Vik', 1500),
    city(5, 'Vík í Mýrdal', 300),
    city(6, 'Old Vikton', 300),
    city(7, 'Zero', 0),
  ]

  it('promotes prefix matches but still surfaces big interior matches', () => {
    expect(topMatches(rows, 'vik', 3).map((r) => r.id)).toEqual(bruteForce(rows, 'vik', 3))
    expect(topMatches(rows, 'reykja', 5).map((r) => r.id)).toEqual([1])
  })

  it('matches the exhaustive ranking for every limit, ties included', () => {
    for (const q of ['vik', 'ik', 'e', 'zero', 'old v', 'nope']) {
      for (let limit = 1; limit <= rows.length + 1; limit++) {
        expect(topMatches(rows, q, limit).map((r) => r.id)).toEqual(bruteForce(rows, q, limit))
      }
    }
  })

  it('matches the exhaustive ranking on a large population-sorted set', () => {
    const syllables = ['an', 'ber', 'vik', 'os', 'la', 'ton', 'ka', 'mar']
    const big: IndexRow[] = []
    let seed = 7
    const rand = () => (seed = (seed * 48271) % 2147483647) / 2147483647
    for (let i = 0; i < 3000; i++) {
      const name = Array.from({ length: 2 + Math.floor(rand() * 2) }, () => syllables[Math.floor(rand() * syllables.length)]).join(rand() < 0.3 ? ' ' : '')
      big.push(city(i + 1, name, Math.floor(rand() * 1_000_000)))
    }
    big.sort((a, b) => b.pop - a.pop)
    for (const q of ['an', 'vik', 'ton', 'la k', 'osber']) {
      expect(topMatches(big, q, 20).map((r) => r.id)).toEqual(bruteForce(big, q, 20))
    }
  })
})

describe('rankRegions', () => {
  const input = {
    countries: [
      { code: 'JP', code3: 'JPN', name: 'Japan', population: 125_000_000 },
      { code: 'US', code3: 'USA', name: 'United States', population: 330_000_000 },
      { code: 'GB', code3: 'GBR', name: 'United Kingdom', population: 67_000_000 },
      { code: 'IS', code3: 'ISL', name: 'Iceland', population: 370_000 },
    ],
    subdivisions: [
      { id: 'DE.02', countryCode: 'DE', name: 'Bavaria', type: 'State' },
      { id: 'JP.40', countryCode: 'JP', name: 'Tokyo', type: '' },
      { id: 'US.CA', countryCode: 'US', name: 'California', type: 'State' },
      { id: 'IT.03', countryCode: 'IT', name: 'Lower Bavaria Lookalike', type: '' },
    ],
    countryNames: new Map([
      ['DE', 'Germany'],
      ['JP', 'Japan'],
      ['US', 'United States'],
    ]),
  }

  it('finds a country by name and by ISO code', () => {
    expect(rankRegions('japan', input).map((r) => r.refId)).toEqual(['JP'])
    expect(rankRegions('usa', input).map((r) => r.refId)).toEqual(['US'])
    expect(rankRegions('gb', input).map((r) => r.refId)).toEqual(['GB'])
  })

  it('ranks countries by match quality, then population', () => {
    expect(rankRegions('united', input).map((r) => r.refId)).toEqual(['US', 'GB'])
  })

  it('finds subdivisions with their type and country as meta, prefix matches first', () => {
    const results = rankRegions('bavaria', input)
    expect(results.map((r) => r.refId)).toEqual(['DE.02', 'IT.03'])
    expect(results[0]).toMatchObject({ kind: 'subdivision', name: 'Bavaria', countryCode: 'DE', meta: 'State · Germany' })
  })

  it('needs at least two characters', () => {
    expect(rankRegions('j', input)).toEqual([])
  })
})
