// Display-format helpers for visit/trip dates. Storage stays ISO `YYYY-MM-DD`
// everywhere (sort, compare, and Drive sync all read that field directly) —
// this module only turns it into the long-form Icelandic display the task
// calls for ("14 mars 2026") and back. The month table is the single source
// every call site reads from, rather than each screen hardcoding names.

export const ICELANDIC_MONTHS: readonly string[] = [
  'janúar',
  'febrúar',
  'mars',
  'apríl',
  'maí',
  'júní',
  'júlí',
  'ágúst',
  'september',
  'október',
  'nóvember',
  'desember',
]

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** `"2026-03-14"` -> `"14 mars 2026"`. Returns the input unchanged if it isn't a well-formed ISO date. */
export function formatLongDate(iso: string): string {
  const m = ISO_RE.exec(iso)
  if (!m) return iso
  const [, year, month, day] = m
  const monthName = ICELANDIC_MONTHS[Number(month) - 1]
  if (!monthName) return iso
  return `${Number(day)} ${monthName} ${year}`
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function toIso(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  // Reject overflow (e.g. 31 apríl rolling into maí) rather than silently normalising it.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Free-text entry is optional (the date picker is primary), but when typed it
 * must tolerate both the long display form ("14 mars 2026") and a terse
 * numeric shorthand ("14.3.2026"). Returns null for anything else.
 */
export function parseFlexibleDate(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed)
  if (dotted) {
    const [, day, month, year] = dotted
    return toIso(Number(year), Number(month), Number(day))
  }

  const worded = /^(\d{1,2})\s+([a-záðéíóúýþæö]+)\s+(\d{4})$/i.exec(trimmed)
  if (worded) {
    const [, day, monthWord, year] = worded
    const monthIndex = ICELANDIC_MONTHS.findIndex((m) => m === monthWord!.toLowerCase())
    if (monthIndex === -1) return null
    return toIso(Number(year), monthIndex + 1, Number(day))
  }

  return null
}
