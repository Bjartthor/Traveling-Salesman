import { describe, expect, it } from 'vitest'
import { toIndexRow, topMatches, type IndexRow } from '@/geo/search'

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
