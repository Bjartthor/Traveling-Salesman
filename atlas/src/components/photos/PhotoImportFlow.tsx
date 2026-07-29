// "Import from photos" (06-photos.md task 3) — the You tab flow that looks at
// an old photo library and works out where you have been. Nothing is written
// to `entries`/`trips`/`photos` until the very last "Import" tap: everything
// before that (decoded/resized images, matched places, edited trip names)
// lives only in this component's React state.
//
// Steps: select -> processing (worker, progress + cancel) -> review (grouped
// by proposed place, accept/correct/skip) -> trips (cluster by date gap,
// editable names) -> confirm (the one write) -> done.

import { useEffect, useMemo, useRef, useState } from 'react'
import { db } from '@/db/schema'
import type { Country } from '@/db/types'
import { processBatch, type ProcessedImage } from '@/photos/processImage'
import { matchPhotoLocation, type LocationMatch } from '@/geo/nearestCity'
import { clusterTrips, groupByProposedPlace, type ProposalGroup, type ProposalKey } from '@/domain/exifImport'
import { statusRank } from '@/domain/cascade'
import { setPlaceStatus } from '@/domain/cascadeRepo'
import { createTrip } from '@/domain/tripRepo'
import { attachPhoto } from '@/domain/photoRepo'
import { flagEmoji } from '@/geo/flags'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import { PlacePicker, type PickedPlace } from '@/components/photos/PlacePicker'
import './PhotoImportFlow.css'

interface Candidate {
  id: string
  processed: ProcessedImage
  match: LocationMatch
}

type Decision = { kind: 'accept' } | { kind: 'skip' } | { kind: 'correct'; place: PickedPlace }

function groupKeyStr(key: ProposalKey): string {
  return key.kind === 'none' ? 'none' : `${key.kind}:${key.refId}`
}

function dateStr(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toLocaleDateString()
}

function useObjectUrl(blob: Blob | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])
  return url
}

interface ResolvedTarget {
  kind: 'city' | 'country'
  refId: string
}

interface ResolvedCandidate {
  id: string
  takenAt: number | null
  target: ResolvedTarget
}

/** Which group a photo lands in after accept/correct/skip decisions, flattened for clustering and the final write. Undecided groups default to accepted (except the no-match bucket, which has no target to default to). */
function resolveTargets(groups: readonly ProposalGroup[], decisions: ReadonlyMap<string, Decision>): ResolvedCandidate[] {
  const out: ResolvedCandidate[] = []
  for (const group of groups) {
    const decision: Decision = decisions.get(groupKeyStr(group.key)) ?? (group.key.kind === 'none' ? { kind: 'skip' } : { kind: 'accept' })
    if (decision.kind === 'skip') continue

    let target: ResolvedTarget
    if (decision.kind === 'correct') {
      target = { kind: decision.place.kind, refId: decision.place.refId }
    } else if (group.key.kind !== 'none') {
      target = { kind: group.key.kind, refId: group.key.refId }
    } else {
      continue // 'accept' with nothing to accept — shouldn't happen given the default above, but keeps this total
    }
    for (const id of group.photoIds) out.push({ id, takenAt: null, target })
  }
  return out
}

export function PhotoImportFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<'select' | 'processing' | 'review' | 'trips' | 'done'>('select')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const cancelRef = useRef(false)
  const [decisions, setDecisions] = useState<Map<string, Decision>>(new Map())
  const [correctingKey, setCorrectingKey] = useState<string | null>(null)
  const [countries, setCountries] = useState<Country[]>([])
  const [cityNames, setCityNames] = useState<Map<string, { name: string; countryCode: string }>>(new Map())
  const [clusters, setClusters] = useState<{ id: string; name: string; startDate: string; endDate: string; photoIds: string[]; included: boolean }[]>([])
  const [writing, setWriting] = useState(false)
  const [result, setResult] = useState<{ photos: number; places: number; trips: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void db.countries.toArray().then(setCountries)
  }, [])
  const countryNames = useMemo(() => new Map(countries.map((c) => [c.code, c.name])), [countries])

  const groups = useMemo(() => groupByProposedPlace(candidates.map((c) => ({ id: c.id, takenAt: c.processed.takenAt, match: c.match }))), [candidates])
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates])

  // Resolve display names for every city referenced by a group, once per distinct set of groups.
  const cityRefIds = useMemo(() => groups.flatMap((g) => (g.key.kind === 'city' ? [g.key.refId] : [])), [groups])
  useEffect(() => {
    if (cityRefIds.length === 0) return
    let cancelledEffect = false
    void db.cities.bulkGet(cityRefIds.map(Number)).then((rows) => {
      if (cancelledEffect) return
      setCityNames((prev) => {
        const next = new Map(prev)
        rows.forEach((row, i) => {
          if (row) next.set(cityRefIds[i]!, { name: row.name, countryCode: row.countryCode })
        })
        return next
      })
    })
    return () => {
      cancelledEffect = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the *set* of city refIds changes, not on every candidates re-render
  }, [cityRefIds.join(',')])

  async function handleFilesSelected(files: FileList) {
    const list = Array.from(files)
    if (list.length === 0) return
    setStep('processing')
    setCancelled(false)
    cancelRef.current = false
    setProgress({ processed: 0, total: list.length })
    setError(null)

    const results = await processBatch(
      list,
      (p) => setProgress(p),
      () => cancelRef.current,
    )

    const built: Candidate[] = []
    for (const r of results) {
      if (!r.result) continue
      const match: LocationMatch = r.result.lat !== null && r.result.lon !== null ? await matchPhotoLocation(r.result.lat, r.result.lon) : { tier: 'none' }
      built.push({ id: crypto.randomUUID(), processed: r.result, match })
    }
    setCandidates(built)
    setProgress(null)
    setStep('review')
  }

  function setDecision(key: string, decision: Decision) {
    setDecisions((prev) => new Map(prev).set(key, decision))
  }

  function groupLabel(group: ProposalGroup): { name: string; flag: string | null } {
    if (group.key.kind === 'country') return { name: countryNames.get(group.key.refId) ?? group.key.refId, flag: group.key.refId }
    if (group.key.kind === 'city') {
      const info = cityNames.get(group.key.refId)
      return { name: info ? `${info.name}, ${countryNames.get(info.countryCode) ?? info.countryCode}` : 'Loading…', flag: info?.countryCode ?? null }
    }
    return { name: 'No location detected', flag: null }
  }

  function proceedToTrips() {
    const resolved = resolveTargets(groups, decisions)
    const datedForClustering = candidates
      .filter((c) => resolved.some((r) => r.id === c.id))
      .map((c) => ({ id: c.id, takenAt: c.processed.takenAt }))
    const { clusters: built } = clusterTrips(datedForClustering)
    setClusters(
      built.map((cl, i) => ({
        id: `cluster-${i}`,
        name: defaultTripName(cl.photoIds),
        startDate: cl.startDate,
        endDate: cl.endDate,
        photoIds: cl.photoIds,
        included: true,
      })),
    )
    setStep('trips')
  }

  function defaultTripName(photoIds: string[]): string {
    const codes = new Set<string>()
    for (const id of photoIds) {
      const c = byId.get(id)
      if (c?.match.tier === 'city') codes.add(c.match.countryCode)
      else if (c?.match.tier === 'country') codes.add(c.match.countryCode)
    }
    const names = [...codes].map((c) => countryNames.get(c) ?? c)
    if (names.length === 0) return 'Trip'
    if (names.length <= 3) return `${names.join(' & ')} trip`
    return 'Trip'
  }

  async function ensureVisitedEntry(kind: 'city' | 'country', refId: string, earliestDate: string | null): Promise<string> {
    const existing = await db.entries.where('[kind+refId]').equals([kind, refId]).first()
    const active = existing && existing.deletedAt === null ? existing : null
    if (!active) {
      await setPlaceStatus({ kind, refId, status: 'visited', firstVisited: earliestDate })
    } else if (statusRank(active.status) < statusRank('visited')) {
      await setPlaceStatus({ kind, refId, status: 'visited' })
    }
    const row = await db.entries.where('[kind+refId]').equals([kind, refId]).first()
    if (!row) throw new Error(`Could not resolve an entry for ${kind}:${refId} after setting its status`)
    return row.id
  }

  async function runImport() {
    setWriting(true)
    setError(null)
    try {
      const resolved = resolveTargets(groups, decisions).map((r) => ({ ...r, takenAt: byId.get(r.id)?.processed.takenAt ?? null }))

      const tripIdByPhotoId = new Map<string, string>()
      let tripsCreated = 0
      for (const cluster of clusters) {
        if (!cluster.included) continue
        const trip = await createTrip({ name: cluster.name.trim() || 'Trip', startDate: cluster.startDate, endDate: cluster.endDate })
        tripsCreated++
        for (const id of cluster.photoIds) tripIdByPhotoId.set(id, trip.id)
      }

      const earliestByTarget = new Map<string, string>()
      for (const rc of resolved) {
        if (rc.takenAt === null) continue
        const key = `${rc.target.kind}:${rc.target.refId}`
        const iso = new Date(rc.takenAt).toISOString().slice(0, 10)
        const current = earliestByTarget.get(key)
        if (!current || iso < current) earliestByTarget.set(key, iso)
      }

      const entryIdByTarget = new Map<string, string>()
      let placesTouched = 0
      let photosWritten = 0
      for (const rc of resolved) {
        const targetKey = `${rc.target.kind}:${rc.target.refId}`
        let entryId = entryIdByTarget.get(targetKey)
        if (!entryId) {
          entryId = await ensureVisitedEntry(rc.target.kind, rc.target.refId, earliestByTarget.get(targetKey) ?? null)
          entryIdByTarget.set(targetKey, entryId)
          placesTouched++
        }
        const candidate = byId.get(rc.id)
        if (!candidate) continue
        await attachPhoto({ entryId, tripId: tripIdByPhotoId.get(rc.id) ?? null, image: candidate.processed })
        photosWritten++
      }

      setResult({ photos: photosWritten, places: placesTouched, trips: tripsCreated })
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setWriting(false)
    }
  }

  function requestClose() {
    if ((step === 'review' || step === 'trips') && !window.confirm('Discard this import? Nothing has been saved yet.')) return
    onClose()
  }

  const title =
    step === 'select'
      ? 'Import from photos'
      : step === 'processing'
        ? 'Processing photos'
        : step === 'review'
          ? 'Review matches'
          : step === 'trips'
            ? 'Group into trips'
            : 'Import complete'

  return (
    <FullScreenOverlay title={title} onClose={requestClose}>
      <div className="photo-import">
        {step === 'select' && (
          <div className="photo-import__select">
            <p className="photo-import__hint">
              Pick any number of photos from your library. Ones with GPS data get matched to a place; the rest can be assigned by hand.
            </p>
            <label className="photo-import__select-trigger">
              Select photos
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  const files = e.target.files
                  e.target.value = ''
                  if (files) void handleFilesSelected(files)
                }}
              />
            </label>
          </div>
        )}

        {step === 'processing' && progress && (
          <div className="photo-import__processing">
            <p className="photo-import__hint">
              Processing {progress.processed} / {progress.total}…
            </p>
            <div className="photo-import__progress-track">
              <div className="photo-import__progress-fill" style={{ width: `${(100 * progress.processed) / progress.total}%` }} />
            </div>
            <button
              type="button"
              className="photo-import__cancel"
              onClick={() => {
                cancelRef.current = true
                setCancelled(true)
              }}
              disabled={cancelled}
            >
              {cancelled ? 'Finishing current photo…' : 'Cancel'}
            </button>
          </div>
        )}

        {step === 'review' && (
          <div className="photo-import__review">
            {groups.map((group) => {
              const key = groupKeyStr(group.key)
              const decision = decisions.get(key) ?? (group.key.kind === 'none' ? { kind: 'skip' as const } : { kind: 'accept' as const })
              const label = decision.kind === 'correct' ? { name: decision.place.label, flag: decision.place.kind === 'city' ? decision.place.countryCode : decision.place.refId } : groupLabel(group)
              return (
                <div key={key} className="photo-import__group">
                  <div className="photo-import__group-thumbs">
                    {group.photoIds.slice(0, 6).map((id) => (
                      <CandidateThumb key={id} blob={byId.get(id)?.processed.thumb} />
                    ))}
                    {group.photoIds.length > 6 && <span className="photo-import__group-more mono">+{group.photoIds.length - 6}</span>}
                  </div>
                  <div className="photo-import__group-info">
                    <p className="photo-import__group-name">
                      {label.flag && flagEmoji(label.flag)} {label.name}
                    </p>
                    <p className="photo-import__group-meta mono">
                      {group.photoIds.length} photo{group.photoIds.length === 1 ? '' : 's'}
                      {group.earliestTakenAt !== null && ` · ${dateStr(group.earliestTakenAt)}${group.latestTakenAt !== group.earliestTakenAt ? `–${dateStr(group.latestTakenAt)}` : ''}`}
                      {group.confidence === 'uncertain' && ' · uncertain match'}
                    </p>
                  </div>
                  <div className="photo-import__group-actions">
                    {group.key.kind !== 'none' && (
                      <button
                        type="button"
                        className={`photo-import__group-action${decision.kind === 'accept' ? ' photo-import__group-action--active' : ''}`}
                        onClick={() => setDecision(key, { kind: 'accept' })}
                      >
                        Accept
                      </button>
                    )}
                    <button type="button" className="photo-import__group-action" onClick={() => setCorrectingKey(key)}>
                      {group.key.kind === 'none' ? 'Assign a place' : 'Correct'}
                    </button>
                    <button
                      type="button"
                      className={`photo-import__group-action${decision.kind === 'skip' ? ' photo-import__group-action--active' : ''}`}
                      onClick={() => setDecision(key, { kind: 'skip' })}
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )
            })}

            <button type="button" className="photo-import__continue" onClick={proceedToTrips}>
              Continue
            </button>
          </div>
        )}

        {step === 'trips' && (
          <div className="photo-import__trips">
            {clusters.length === 0 ? (
              <p className="photo-import__hint">No capture dates to group into trips — photos will still be attached to their places.</p>
            ) : (
              <>
                <p className="photo-import__hint">Photos taken more than 4 days apart start a new trip. Edit any name, or leave a cluster out.</p>
                {clusters.map((cluster, i) => (
                  <div key={cluster.id} className="photo-import__cluster">
                    <input
                      type="text"
                      className="photo-import__cluster-name"
                      value={cluster.name}
                      disabled={!cluster.included}
                      onChange={(e) => {
                        const name = e.target.value
                        setClusters((prev) => prev.map((c, idx) => (idx === i ? { ...c, name } : c)))
                      }}
                    />
                    <p className="photo-import__cluster-meta mono">
                      {cluster.startDate === cluster.endDate ? cluster.startDate : `${cluster.startDate} – ${cluster.endDate}`} ·{' '}
                      {cluster.photoIds.length} photos
                    </p>
                    <button
                      type="button"
                      className={`photo-import__group-action${cluster.included ? ' photo-import__group-action--active' : ''}`}
                      onClick={() => setClusters((prev) => prev.map((c, idx) => (idx === i ? { ...c, included: !c.included } : c)))}
                    >
                      {cluster.included ? 'Included' : 'Skipped'}
                    </button>
                  </div>
                ))}
              </>
            )}

            <button type="button" className="photo-import__continue" disabled={writing} onClick={() => void runImport()}>
              {writing ? 'Importing…' : `Import ${resolveTargets(groups, decisions).length} photos`}
            </button>
            {error && (
              <p className="photo-import__error" role="alert">
                {error}
              </p>
            )}
          </div>
        )}

        {step === 'done' && result && (
          <div className="photo-import__done">
            <p className="photo-import__hint">
              Imported {result.photos} photo{result.photos === 1 ? '' : 's'} across {result.places} place{result.places === 1 ? '' : 's'}
              {result.trips > 0 && ` and ${result.trips} new trip${result.trips === 1 ? '' : 's'}`}.
            </p>
            <button type="button" className="photo-import__continue" onClick={onClose}>
              Done
            </button>
          </div>
        )}
      </div>

      {correctingKey && (
        <PlacePicker
          onCancel={() => setCorrectingKey(null)}
          onPick={(place: PickedPlace) => {
            setDecision(correctingKey, { kind: 'correct', place })
            setCorrectingKey(null)
          }}
        />
      )}
    </FullScreenOverlay>
  )
}

function CandidateThumb({ blob }: { blob: Blob | undefined }) {
  const url = useObjectUrl(blob)
  return url ? <img className="photo-import__thumb" src={url} alt="" /> : <div className="photo-import__thumb photo-import__thumb--loading" aria-hidden="true" />
}
