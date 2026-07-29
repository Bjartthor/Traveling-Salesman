// Full-screen photo viewer (06-photos.md task 2): swipe between photos,
// pinch-zoom, caption, "set as cover". Gestures are hand-rolled on the
// Pointer Events API rather than a third-party viewer/gesture library — the
// plan's tech stack (00-PLAN.md §3) doesn't list one, and the app has
// generally kept to plain platform APIs elsewhere (d3-zoom, already in the
// stack for the map, is the one exception).
//
// Topmost layer in the app (z-index 50) — opened from within a full-screen
// detail overlay (30) and must sit above even the place-status sheet (40);
// nothing else needs to stack on top of it.

import { useEffect, useRef, useState } from 'react'
import type { Photo } from '@/db/types'
import { useFullUrl } from '@/components/photos/usePhotoBlobUrl'
import './PhotoViewer.css'

export interface PhotoViewerAction {
  label: string
  onSelect: () => void | Promise<void>
}

export interface PhotoViewerProps {
  photos: readonly Photo[]
  index: number
  onClose: () => void
  onIndexChange: (index: number) => void
  onCaptionChange: (photo: Photo, caption: string) => void | Promise<void>
  onDelete: (photo: Photo) => void | Promise<void>
  /** Omit to hide "Set as cover" entirely (only meaningful within a trip). */
  isCover?: (photo: Photo) => boolean
  onSetCover?: (photo: Photo) => void | Promise<void>
  /** Contextual reassign/untag actions — e.g. "Tag to Berlin", "Untag from this city". */
  actions?: (photo: Photo) => PhotoViewerAction[]
}

const SWIPE_THRESHOLD_PX = 70
const MAX_SCALE = 4
const DOUBLE_TAP_MS = 300
const TAP_MOVE_TOLERANCE_PX = 6

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}
function mid(a: { x: number; y: number }, b: { x: number; y: number }): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

interface GestureState {
  pointers: Map<number, { x: number; y: number }>
  singleStart: { x: number; y: number } | null
  startTranslate: { x: number; y: number }
  pinchStartDist: number
  pinchStartScale: number
  pinchStartMid: { x: number; y: number }
  pinchStartTranslate: { x: number; y: number }
  didPinch: boolean
}

function freshGesture(): GestureState {
  return {
    pointers: new Map(),
    singleStart: null,
    startTranslate: { x: 0, y: 0 },
    pinchStartDist: 0,
    pinchStartScale: 1,
    pinchStartMid: { x: 0, y: 0 },
    pinchStartTranslate: { x: 0, y: 0 },
    didPinch: false,
  }
}

export function PhotoViewer({
  photos,
  index,
  onClose,
  onIndexChange,
  onCaptionChange,
  onDelete,
  isCover,
  onSetCover,
  actions,
}: PhotoViewerProps) {
  const photo = photos[index]
  const stageRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<GestureState>(freshGesture())
  const lastTapAt = useRef(0)

  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [dragX, setDragX] = useState(0)
  const [interacting, setInteracting] = useState(false)

  const [caption, setCaption] = useState('')
  const [captionTouched, setCaptionTouched] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  // Reset zoom/pan/menus whenever the displayed photo changes.
  useEffect(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
    setDragX(0)
    gesture.current = freshGesture()
    setCaptionTouched(false)
    setConfirmDelete(false)
    setMenuOpen(false)
  }, [photo?.id])

  // Keep the caption field in sync with the underlying photo — guarded by
  // `captionTouched` (same pattern as PlaceStatusSheet's date field) so an
  // in-progress edit is never clobbered by a live-query refresh.
  useEffect(() => {
    if (!captionTouched) setCaption(photo?.caption ?? '')
  }, [photo, captionTouched])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft' && index > 0) onIndexChange(index - 1)
      else if (e.key === 'ArrowRight' && index < photos.length - 1) onIndexChange(index + 1)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, onIndexChange, index, photos.length])

  const fullUrl = useFullUrl(photo?.id ?? '')

  function clampTranslate(t: { x: number; y: number }, s: number): { x: number; y: number } {
    const rect = stageRef.current?.getBoundingClientRect()
    if (!rect || s <= 1) return { x: 0, y: 0 }
    const maxX = ((s - 1) * rect.width) / 2
    const maxY = ((s - 1) * rect.height) / 2
    return { x: clamp(t.x, -maxX, maxX), y: clamp(t.y, -maxY, maxY) }
  }

  function toggleZoom() {
    if (scale > 1.01) {
      setScale(1)
      setTranslate({ x: 0, y: 0 })
    } else {
      setScale(2)
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    // Best-effort: capture keeps receiving move/up events even if the finger
    // slides off the image, but a handful of pointer sessions the browser
    // doesn't consider "active" for capture purposes can throw here — that
    // must not abort tracking the gesture itself.
    try {
      ;(e.target as Element).setPointerCapture(e.pointerId)
    } catch {
      // no-op — gesture tracking below still works without capture
    }
    gesture.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setInteracting(true)
    if (gesture.current.pointers.size === 1) {
      gesture.current.singleStart = { x: e.clientX, y: e.clientY }
      gesture.current.startTranslate = translate
    } else if (gesture.current.pointers.size === 2) {
      const [p1, p2] = [...gesture.current.pointers.values()] as [{ x: number; y: number }, { x: number; y: number }]
      gesture.current.pinchStartDist = dist(p1, p2)
      gesture.current.pinchStartScale = scale
      gesture.current.pinchStartMid = mid(p1, p2)
      gesture.current.pinchStartTranslate = translate
      gesture.current.didPinch = true
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!gesture.current.pointers.has(e.pointerId)) return
    gesture.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const pts = [...gesture.current.pointers.values()]

    if (pts.length >= 2) {
      const [p1, p2] = pts as [{ x: number; y: number }, { x: number; y: number }]
      const d = dist(p1, p2)
      const m = mid(p1, p2)
      const newScale = clamp(gesture.current.pinchStartScale * (d / gesture.current.pinchStartDist), 1, MAX_SCALE)
      const newTranslate = {
        x: gesture.current.pinchStartTranslate.x + (m.x - gesture.current.pinchStartMid.x),
        y: gesture.current.pinchStartTranslate.y + (m.y - gesture.current.pinchStartMid.y),
      }
      setScale(newScale)
      setTranslate(clampTranslate(newTranslate, newScale))
    } else if (pts.length === 1 && gesture.current.singleStart) {
      const p = pts[0]!
      const dx = p.x - gesture.current.singleStart.x
      const dy = p.y - gesture.current.singleStart.y
      if (scale > 1.01) {
        setTranslate(clampTranslate({ x: gesture.current.startTranslate.x + dx, y: gesture.current.startTranslate.y + dy }, scale))
      } else if (!gesture.current.didPinch) {
        setDragX(dx)
      }
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    gesture.current.pointers.delete(e.pointerId)
    if (gesture.current.pointers.size > 0) return

    setInteracting(false)
    // How far *this* gesture actually moved, independent of scale — dragX is
    // only ever updated in the un-zoomed (swipe-candidate) branch above, so
    // it can't tell a stationary tap from a pan while zoomed in. Comparing
    // the release point to the gesture's own start does, which is what makes
    // double-tap correctly toggle zoom back out again, not just in.
    const movedDistance = gesture.current.singleStart ? dist(gesture.current.singleStart, { x: e.clientX, y: e.clientY }) : Infinity
    const wasTap = !gesture.current.didPinch && movedDistance < TAP_MOVE_TOLERANCE_PX
    const wasSwipe = !gesture.current.didPinch && scale <= 1.01 && Math.abs(dragX) >= SWIPE_THRESHOLD_PX

    if (wasSwipe) {
      const dir = dragX > 0 ? -1 : 1 // dragged right -> reveal previous; left -> next
      const nextIndex = index + dir
      setDragX(0)
      if (nextIndex >= 0 && nextIndex < photos.length) onIndexChange(nextIndex)
    } else {
      setDragX(0)
      if (scale < 1.05) {
        setScale(1)
        setTranslate({ x: 0, y: 0 })
      }
    }

    if (wasTap) {
      const now = Date.now()
      if (now - lastTapAt.current < DOUBLE_TAP_MS) toggleZoom()
      lastTapAt.current = now
    }

    gesture.current.didPinch = false
    gesture.current.singleStart = null
  }

  function commitCaption() {
    if (photo && captionTouched && caption !== photo.caption) void onCaptionChange(photo, caption)
  }

  if (!photo) return null
  const contextActions = actions?.(photo) ?? []

  return (
    <div className="photo-viewer" role="dialog" aria-modal="true" aria-label="Photo viewer">
      <header className="photo-viewer__header">
        <button type="button" className="photo-viewer__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        <span className="photo-viewer__counter mono">
          {index + 1} / {photos.length}
        </span>
        <button type="button" className="photo-viewer__menu-trigger" onClick={() => setMenuOpen((v) => !v)} aria-label="More actions">
          ⋯
        </button>
      </header>

      <div
        className="photo-viewer__stage"
        ref={stageRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          key={photo.id}
          className={`photo-viewer__image${interacting ? '' : ' photo-viewer__image--settled'}`}
          src={fullUrl ?? undefined}
          style={{ transform: `translate(${translate.x + dragX}px, ${translate.y}px) scale(${scale})` }}
          alt={photo.caption || ''}
          draggable={false}
        />
      </div>

      {menuOpen && (
        <div className="photo-viewer__menu" role="menu">
          {onSetCover && (
            <button
              type="button"
              className="photo-viewer__menu-item"
              onClick={() => void Promise.resolve(onSetCover(photo)).then(() => setMenuOpen(false))}
            >
              {isCover?.(photo) ? '✓ Cover photo' : 'Set as cover'}
            </button>
          )}
          {contextActions.map((action) => (
            <button
              key={action.label}
              type="button"
              className="photo-viewer__menu-item"
              onClick={() => void Promise.resolve(action.onSelect()).then(() => setMenuOpen(false))}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            className="photo-viewer__menu-item photo-viewer__menu-item--danger"
            onClick={() => {
              setMenuOpen(false)
              setConfirmDelete(true)
            }}
          >
            Delete photo
          </button>
        </div>
      )}

      <footer className="photo-viewer__footer">
        <input
          type="text"
          className="photo-viewer__caption"
          placeholder="Add a caption…"
          value={caption}
          onChange={(e) => {
            setCaption(e.target.value)
            setCaptionTouched(true)
          }}
          onBlur={commitCaption}
        />
      </footer>

      {confirmDelete && (
        <div className="photo-viewer__confirm-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="photo-viewer__confirm" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className="photo-viewer__confirm-body">Delete this photo?</p>
            <button
              type="button"
              className="photo-viewer__confirm-delete"
              onClick={() =>
                void Promise.resolve(onDelete(photo)).then(() => {
                  setConfirmDelete(false)
                  if (photos.length <= 1) onClose()
                  else onIndexChange(Math.min(index, photos.length - 2))
                })
              }
            >
              Delete
            </button>
            <button type="button" className="photo-viewer__confirm-cancel" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
