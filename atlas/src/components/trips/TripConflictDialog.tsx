// The "only one trip can be active" prompt (05-trips.md task 1) — shown
// before starting or reopening a trip whenever that would otherwise leave two
// trips active at once. Resolved *before* @/components/trips/TripForm ever
// opens, so the form itself never has to pause mid-submit for a second
// dialog. Topmost layer (same z-index as the place-status sheet) since it can
// be triggered from inside TripDetail, itself a full-screen overlay.

import './TripConflictDialog.css'

export type ConflictResolution = 'close' | 'leaveOpen'

interface TripConflictDialogProps {
  activeTripName: string
  onResolve: (resolution: ConflictResolution) => void
  onCancel: () => void
}

export function TripConflictDialog({ activeTripName, onResolve, onCancel }: TripConflictDialogProps) {
  return (
    <div className="trip-conflict-backdrop" onClick={onCancel}>
      <div className="trip-conflict" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h2 className="trip-conflict__title">"{activeTripName}" is still running</h2>
        <p className="trip-conflict__body">Only one trip can capture places at a time. What should happen to it?</p>
        <button type="button" className="trip-conflict__option" onClick={() => onResolve('close')}>
          Close "{activeTripName}" and continue
        </button>
        <button type="button" className="trip-conflict__option" onClick={() => onResolve('leaveOpen')}>
          Leave "{activeTripName}" open, just switch
        </button>
        <button type="button" className="trip-conflict__cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
