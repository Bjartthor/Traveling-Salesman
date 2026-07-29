import { describe, expect, it } from 'vitest'
import { clusterTrips, groupByProposedPlace, type ImportCandidate } from '@/domain/exifImport'

const DAY = 24 * 60 * 60 * 1000

describe('groupByProposedPlace', () => {
  it('groups confident and uncertain matches to the same city into one group, flagged uncertain', () => {
    const candidates: ImportCandidate[] = [
      { id: 'a', takenAt: 1000, match: { tier: 'city', refId: '100', countryCode: 'IS', subdivisionId: null, distanceKm: 5, confidence: 'confident' } },
      { id: 'b', takenAt: 2000, match: { tier: 'city', refId: '100', countryCode: 'IS', subdivisionId: null, distanceKm: 80, confidence: 'uncertain' } },
    ]
    const groups = groupByProposedPlace(candidates)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.photoIds).toEqual(['a', 'b'])
    expect(groups[0]?.confidence).toBe('uncertain')
  })

  it('keeps distinct cities in distinct groups and tracks each group\'s date range', () => {
    const candidates: ImportCandidate[] = [
      { id: 'a', takenAt: 1000, match: { tier: 'city', refId: '100', countryCode: 'IS', subdivisionId: null, distanceKm: 1, confidence: 'confident' } },
      { id: 'b', takenAt: 5000, match: { tier: 'city', refId: '100', countryCode: 'IS', subdivisionId: null, distanceKm: 1, confidence: 'confident' } },
      { id: 'c', takenAt: 3000, match: { tier: 'city', refId: '200', countryCode: 'NO', subdivisionId: null, distanceKm: 1, confidence: 'confident' } },
    ]
    const groups = groupByProposedPlace(candidates)
    expect(groups.map((g) => g.key)).toEqual([
      { kind: 'city', refId: '100' },
      { kind: 'city', refId: '200' },
    ])
    expect(groups[0]?.earliestTakenAt).toBe(1000)
    expect(groups[0]?.latestTakenAt).toBe(5000)
  })

  it('buckets country-only and no-match photos separately, city groups first', () => {
    const candidates: ImportCandidate[] = [
      { id: 'a', takenAt: null, match: { tier: 'none' } },
      { id: 'b', takenAt: null, match: { tier: 'country', countryCode: 'FR' } },
      { id: 'c', takenAt: null, match: { tier: 'city', refId: '1', countryCode: 'FR', subdivisionId: null, distanceKm: 2, confidence: 'confident' } },
    ]
    const groups = groupByProposedPlace(candidates)
    expect(groups.map((g) => g.key.kind)).toEqual(['city', 'country', 'none'])
    expect(groups.find((g) => g.key.kind === 'country')?.confidence).toBeNull()
    expect(groups.find((g) => g.key.kind === 'none')?.confidence).toBeNull()
  })

  it('leaves earliest/latestTakenAt null for a group whose photos all lack a capture date', () => {
    const candidates: ImportCandidate[] = [{ id: 'a', takenAt: null, match: { tier: 'country', countryCode: 'FR' } }]
    const groups = groupByProposedPlace(candidates)
    expect(groups[0]?.earliestTakenAt).toBeNull()
    expect(groups[0]?.latestTakenAt).toBeNull()
  })
})

describe('clusterTrips', () => {
  it('keeps photos within the gap in one trip', () => {
    const photos = [
      { id: 'a', takenAt: 0 },
      { id: 'b', takenAt: 1 * DAY },
      { id: 'c', takenAt: 2 * DAY },
    ]
    const { clusters, undated } = clusterTrips(photos)
    expect(clusters).toHaveLength(1)
    expect(clusters[0]?.photoIds).toEqual(['a', 'b', 'c'])
    expect(undated).toEqual([])
  })

  it('starts a new trip after a gap of more than 4 days', () => {
    const photos = [
      { id: 'a', takenAt: 0 },
      { id: 'b', takenAt: 1 * DAY },
      { id: 'c', takenAt: 10 * DAY }, // 9-day gap from b
    ]
    const { clusters } = clusterTrips(photos)
    expect(clusters).toHaveLength(2)
    expect(clusters[0]?.photoIds).toEqual(['a', 'b'])
    expect(clusters[1]?.photoIds).toEqual(['c'])
  })

  it('does not split a gap of exactly 4 days', () => {
    const photos = [
      { id: 'a', takenAt: 0 },
      { id: 'b', takenAt: 4 * DAY },
    ]
    const { clusters } = clusterTrips(photos)
    expect(clusters).toHaveLength(1)
  })

  it('sorts out-of-order input chronologically before clustering', () => {
    const photos = [
      { id: 'b', takenAt: 2 * DAY },
      { id: 'a', takenAt: 0 },
    ]
    const { clusters } = clusterTrips(photos)
    expect(clusters[0]?.photoIds).toEqual(['a', 'b'])
  })

  it('sets start/end dates from the earliest/latest photo in the cluster', () => {
    const photos = [
      { id: 'a', takenAt: Date.UTC(2024, 5, 1) },
      { id: 'b', takenAt: Date.UTC(2024, 5, 3) },
    ]
    const { clusters } = clusterTrips(photos)
    expect(clusters[0]?.startDate).toBe('2024-06-01')
    expect(clusters[0]?.endDate).toBe('2024-06-03')
  })

  it('separates undated photos out rather than dropping or misplacing them', () => {
    const photos = [
      { id: 'a', takenAt: 0 },
      { id: 'b', takenAt: null },
    ]
    const { clusters, undated } = clusterTrips(photos)
    expect(clusters[0]?.photoIds).toEqual(['a'])
    expect(undated).toEqual(['b'])
  })

  it('returns no clusters when every photo is undated', () => {
    const { clusters, undated } = clusterTrips([{ id: 'a', takenAt: null }])
    expect(clusters).toEqual([])
    expect(undated).toEqual(['a'])
  })
})
