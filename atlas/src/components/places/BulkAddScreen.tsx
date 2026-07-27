// Quick add (04-places.md task 6): paste one place per line, match against
// the local index, review before committing. One status applies to the
// whole batch — backfilling years of travel is normally done a status at a
// time (this trip's "visited", that wishlist), not line by line.

import { useState, type CSSProperties } from 'react'
import type { Status } from '@/db/types'
import { STATUS_ORDER } from '@/domain/cascade'
import { defaultPick, resolveLines, splitLines, type LineResolution } from '@/domain/bulkResolve'
import { setPlaceStatus } from '@/domain/cascadeRepo'
import type { CityResult } from '@/geo/search'
import { STATUS_COLOR_VAR, STATUS_LABEL } from '@/components/map/statusColor'
import { FullScreenOverlay } from '@/components/layout/FullScreenOverlay'
import './BulkAddScreen.css'

type Step = 'paste' | 'review' | 'done'

export function BulkAddScreen({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [status, setStatus] = useState<Status>('visited')
  const [step, setStep] = useState<Step>('paste')
  const [resolutions, setResolutions] = useState<LineResolution[]>([])
  const [overrides, setOverrides] = useState<Map<number, CityResult | null>>(new Map())
  const [busy, setBusy] = useState(false)
  const [summary, setSummary] = useState<{ added: number; failed: string[] } | null>(null)

  const lineCount = splitLines(text).length

  function pickFor(index: number, resolution: LineResolution): CityResult | null {
    return overrides.has(index) ? (overrides.get(index) ?? null) : defaultPick(resolution)
  }

  const includedCount = resolutions.reduce((n, r, i) => (pickFor(i, r) ? n + 1 : n), 0)

  async function resolve() {
    setBusy(true)
    setResolutions(await resolveLines(splitLines(text)))
    setOverrides(new Map())
    setBusy(false)
    setStep('review')
  }

  async function commit() {
    setBusy(true)
    let added = 0
    const failed: string[] = []
    for (const [i, r] of resolutions.entries()) {
      const pick = pickFor(i, r)
      if (!pick) continue
      try {
        await setPlaceStatus({ kind: 'city', refId: String(pick.geonameId), status })
        added += 1
      } catch (e) {
        failed.push(`${r.line}: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    setBusy(false)
    setSummary({ added, failed })
    setStep('done')
  }

  return (
    <FullScreenOverlay title="Quick add" onClose={onClose}>
      {step === 'paste' && (
        <div className="bulk-add__step">
          <p className="bulk-add__intro">
            One place per line. Each is matched against what's already known — you'll get a chance to fix
            anything before it's saved.
          </p>
          <textarea
            className="bulk-add__textarea"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Garmisch-Partenkirchen\nSan Francisco\nTórshavn'}
            rows={10}
            autoFocus
          />
          <fieldset className="bulk-add__status-picker">
            <legend>Set all of these to</legend>
            <div className="bulk-add__status-options">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  className={`bulk-add__status-chip${status === s ? ' bulk-add__status-chip--active' : ''}`}
                  style={{ '--chip-color': STATUS_COLOR_VAR[s] } as CSSProperties}
                  onClick={() => setStatus(s)}
                  aria-pressed={status === s}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </fieldset>
          <button type="button" className="bulk-add__primary" disabled={busy || lineCount === 0} onClick={() => void resolve()}>
            {busy ? 'Matching…' : `Match ${lineCount || ''} place${lineCount === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="bulk-add__step">
          <p className="bulk-add__intro">
            Add {includedCount} place{includedCount === 1 ? '' : 's'} as {STATUS_LABEL[status].toLowerCase()}.
          </p>
          <ul className="bulk-add__review-list">
            {resolutions.map((r, i) => (
              <ReviewRow key={`${i}-${r.line}`} resolution={r} picked={pickFor(i, r)} onPick={(pick) => setOverrides((prev) => new Map(prev).set(i, pick))} />
            ))}
          </ul>
          <div className="bulk-add__actions">
            <button type="button" className="bulk-add__secondary" onClick={() => setStep('paste')}>
              Back
            </button>
            <button type="button" className="bulk-add__primary" disabled={busy || includedCount === 0} onClick={() => void commit()}>
              {busy ? 'Adding…' : `Add ${includedCount} place${includedCount === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {step === 'done' && summary && (
        <div className="bulk-add__step">
          <p className="bulk-add__intro">
            Added {summary.added} place{summary.added === 1 ? '' : 's'}.
            {summary.failed.length > 0 && ` ${summary.failed.length} failed.`}
          </p>
          {summary.failed.length > 0 && (
            <ul className="bulk-add__errors">
              {summary.failed.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          <button type="button" className="bulk-add__primary" onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </FullScreenOverlay>
  )
}

interface ReviewRowProps {
  resolution: LineResolution
  picked: CityResult | null
  onPick: (pick: CityResult | null) => void
}

function ReviewRow({ resolution, picked, onPick }: ReviewRowProps) {
  const skipped = picked === null
  const hasAnyPick = resolution.status !== 'notFound'

  return (
    <li className="bulk-add__row">
      <div className="bulk-add__row-head">
        <p className="bulk-add__line">{resolution.line}</p>
        {hasAnyPick && (
          <label className="bulk-add__skip">
            <input
              type="checkbox"
              checked={!skipped}
              onChange={(e) => onPick(e.target.checked ? defaultPick(resolution) : null)}
            />
            Include
          </label>
        )}
      </div>

      {resolution.status === 'notFound' && (
        <p className="bulk-add__miss">No match found — add it manually afterward.</p>
      )}

      {resolution.status === 'ambiguous' && !skipped && (
        <div className="bulk-add__candidates">
          {resolution.candidates.map((c) => (
            <button
              key={c.geonameId}
              type="button"
              className={`bulk-add__candidate${picked?.geonameId === c.geonameId ? ' bulk-add__candidate--active' : ''}`}
              onClick={() => onPick(c)}
            >
              {c.name} — {c.subdivisionName ? `${c.subdivisionName}, ` : ''}
              {c.countryName}
            </button>
          ))}
        </div>
      )}

      {resolution.status === 'matched' && !skipped && picked && (
        <p className="bulk-add__match">
          {picked.name} — {picked.subdivisionName ? `${picked.subdivisionName}, ` : ''}
          {picked.countryName}
        </p>
      )}
    </li>
  )
}
