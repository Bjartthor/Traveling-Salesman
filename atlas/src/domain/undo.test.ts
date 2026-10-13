import { describe, expect, it } from 'vitest'
import { diffRows } from '@/domain/undo'

interface Row {
  id: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
  status: string
}

const row = (id: string, updatedAt: number, status = 'visited', deletedAt: number | null = null): Row => ({ id, createdAt: 1, updatedAt, deletedAt, status })

describe('diffRows', () => {
  it('returns nothing for identical snapshots', () => {
    const rows = [row('a', 1), row('b', 2)]
    expect(diffRows(rows, rows.map((r) => ({ ...r })))).toEqual({ restore: [], created: [] })
  })

  it('keeps the before-version of every modified row', () => {
    const before = [row('a', 1, 'wishlist'), row('b', 2)]
    const after = [row('a', 5, 'visited'), row('b', 2)]
    expect(diffRows(before, after)).toEqual({ restore: [before[0]], created: [] })
  })

  it('catches a soft delete and a change made within the same millisecond', () => {
    const before = [row('a', 1), row('b', 2, 'visited')]
    const after = [row('a', 1, 'visited', 1), row('b', 2, 'lived')]
    expect(diffRows(before, after).restore.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('lists rows that did not exist before as created', () => {
    expect(diffRows([row('a', 1)], [row('a', 1), row('new', 3)])).toEqual({ restore: [], created: ['new'] })
  })
})
