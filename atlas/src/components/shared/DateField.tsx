// The one shared date-input component (used by the place-status sheet for
// countries/subdivisions/cities alike, and by the trip form) — tapping it
// opens the native date picker, which is the primary way to set a date since
// the long-form display ("14 mars 2026") is awkward to type. Typing directly
// is still possible (tab into the field, or click then type) and tolerates
// both the long form and "14.3.2026"; an unparseable value silently reverts
// rather than blocking on an inline error, since free text is optional here.
//
// The picker opens on `onClick` rather than `onFocus` so keyboard users
// tabbing into the field aren't ambushed by it — only an actual pointer tap
// triggers it, matching "tapping the field opens it."

import { useEffect, useRef, useState } from 'react'
import { formatLongDate, parseFlexibleDate } from '@/domain/dateFormat'
import './DateField.css'

interface DateFieldProps {
  value: string | null
  onChange: (iso: string | null) => void
  placeholder?: string
  ariaLabel?: string
  id?: string
  min?: string
  max?: string
}

export function DateField({ value, onChange, placeholder, ariaLabel, id, min, max }: DateFieldProps) {
  const nativeRef = useRef<HTMLInputElement>(null)
  const [text, setText] = useState(value ? formatLongDate(value) : '')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!dirty) setText(value ? formatLongDate(value) : '')
  }, [value, dirty])

  function openPicker() {
    const input = nativeRef.current
    if (!input) return
    if (typeof input.showPicker === 'function') {
      try {
        input.showPicker()
        return
      } catch {
        // falls through to focus() — showPicker() throws if not called from a
        // user gesture, or is simply unsupported (Safari, Firefox as of now).
      }
    }
    input.focus()
  }

  function commitText() {
    setDirty(false)
    const trimmed = text.trim()
    if (!trimmed) {
      if (value !== null) onChange(null)
      return
    }
    const parsed = parseFlexibleDate(trimmed)
    if (parsed) onChange(parsed)
    else setText(value ? formatLongDate(value) : '') // unparseable — revert silently, optional feature
  }

  return (
    <div className="date-field">
      <input
        type="text"
        className="date-field__display"
        id={id}
        value={text}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onClick={openPicker}
        onChange={(e) => {
          setDirty(true)
          setText(e.target.value)
        }}
        onBlur={commitText}
      />
      <input
        ref={nativeRef}
        type="date"
        className="date-field__native"
        tabIndex={-1}
        aria-hidden="true"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => {
          setDirty(false)
          onChange(e.target.value || null)
        }}
      />
    </div>
  )
}
