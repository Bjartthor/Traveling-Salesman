// Pure grouping/clustering logic for the "Import from photos" flow
// (06-photos.md task 3). No Dexie, no React, no worker — everything here is a
// total function of plain data handed to it, same shape as @/domain/placesList
// and @/domain/bulkResolve. @/components/photos/PhotoImportFlow is the only
// caller, and nothing here writes anything: grouping/clustering only produce
// *proposals* for the review screen to accept, correct or skip.

import type { LocationMatch } from '@/geo/nearestCity'

export interface ImportCandidate {
  id: string // temporary, per-batch id (not a persisted Photo id yet)
  takenAt: number | null
  match: LocationMatch
}

export type ProposalKey = { kind: 'city'; refId: string } | { kind: 'country'; refId: string } | { kind: 'none' }

export interface ProposalGroup {
  key: ProposalKey
  photoIds: string[]
  /** 'uncertain' if any photo in the group matched in the 30-150 km band; null for country/none groups, which carry no distance at all. */
  confidence: 'confident' | 'uncertain' | null
  earliestTakenAt: number | null
  latestTakenAt: number | null
}

function keyString(key: ProposalKey): string {
  return key.kind === 'none' ? 'none' : `${key.kind}:${key.refId}`
}

const KIND_RANK: Record<ProposalKey['kind'], number> = { city: 0, country: 1, none: 2 }

/**
 * One group per resolved place (06-photos.md task 3 step 5: "grouped by
 * proposed place, with photo counts and dates"). Deterministically ordered —
 * city groups first, then country, then the no-match bucket, each sorted by
 * refId — so the review screen's layout doesn't reshuffle between renders.
 */
export function groupByProposedPlace(candidates: readonly ImportCandidate[]): ProposalGroup[] {
  const groups = new Map<string, ProposalGroup>()

  for (const candidate of candidates) {
    const key: ProposalKey =
      candidate.match.tier === 'city'
        ? { kind: 'city', refId: candidate.match.refId }
        : candidate.match.tier === 'country'
          ? { kind: 'country', refId: candidate.match.countryCode }
          : { kind: 'none' }

    const k = keyString(key)
    let group = groups.get(k)
    if (!group) {
      group = { key, photoIds: [], confidence: key.kind === 'city' ? 'confident' : null, earliestTakenAt: null, latestTakenAt: null }
      groups.set(k, group)
    }
    group.photoIds.push(candidate.id)
    if (candidate.match.tier === 'city' && candidate.match.confidence === 'uncertain') group.confidence = 'uncertain'
    if (candidate.takenAt !== null) {
      group.earliestTakenAt = group.earliestTakenAt === null ? candidate.takenAt : Math.min(group.earliestTakenAt, candidate.takenAt)
      group.latestTakenAt = group.latestTakenAt === null ? candidate.takenAt : Math.max(group.latestTakenAt, candidate.takenAt)
    }
  }

  return [...groups.values()].sort((a, b) => KIND_RANK[a.key.kind] - KIND_RANK[b.key.kind] || keyString(a.key).localeCompare(keyString(b.key)))
}

export interface TripCluster {
  photoIds: string[]
  startDate: string // YYYY-MM-DD
  endDate: string
}

function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/**
 * Group photos into candidate trips by date gap (06-photos.md task 3 step 7):
 * sorted chronologically, a gap of more than `gapDays` starts a new trip.
 * Photos with no capture date can't be placed in a timeline and come back
 * separately — the caller (review screen) offers them for manual trip
 * assignment or leaves them untripped.
 */
export function clusterTrips(
  photos: readonly { id: string; takenAt: number | null }[],
  gapDays = 4,
): { clusters: TripCluster[]; undated: string[] } {
  const gapMs = gapDays * 24 * 60 * 60 * 1000
  const undated = photos.filter((p) => p.takenAt === null).map((p) => p.id)
  const dated = photos.filter((p): p is { id: string; takenAt: number } => p.takenAt !== null).slice().sort((a, b) => a.takenAt - b.takenAt)

  const clusters: TripCluster[] = []
  let current: { id: string; takenAt: number }[] = []

  for (const photo of dated) {
    const prev = current[current.length - 1]
    if (prev && photo.takenAt - prev.takenAt > gapMs) {
      clusters.push(finishCluster(current))
      current = []
    }
    current.push(photo)
  }
  if (current.length > 0) clusters.push(finishCluster(current))

  return { clusters, undated }
}

function finishCluster(photos: readonly { id: string; takenAt: number }[]): TripCluster {
  const times = photos.map((p) => p.takenAt)
  return {
    photoIds: photos.map((p) => p.id),
    startDate: toDateString(Math.min(...times)),
    endDate: toDateString(Math.max(...times)),
  }
}
