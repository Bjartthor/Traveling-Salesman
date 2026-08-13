import { describe, expect, it } from 'vitest'
import { formatLongDate, parseFlexibleDate, todayISO } from '@/domain/dateFormat'

describe('formatLongDate', () => {
  it('formats an ISO date in long Icelandic form', () => {
    expect(formatLongDate('2026-03-14')).toBe('14 mars 2026')
  })

  it('does not zero-pad the day', () => {
    expect(formatLongDate('2026-03-05')).toBe('5 mars 2026')
  })

  it('covers every month', () => {
    expect(formatLongDate('2026-01-01')).toBe('1 janúar 2026')
    expect(formatLongDate('2026-12-25')).toBe('25 desember 2026')
  })

  it('returns malformed input unchanged', () => {
    expect(formatLongDate('not-a-date')).toBe('not-a-date')
  })
})

describe('parseFlexibleDate', () => {
  it('parses the long Icelandic form', () => {
    expect(parseFlexibleDate('14 mars 2026')).toBe('2026-03-14')
  })

  it('parses the long form case-insensitively', () => {
    expect(parseFlexibleDate('14 MARS 2026')).toBe('2026-03-14')
  })

  it('parses dotted numeric shorthand', () => {
    expect(parseFlexibleDate('14.3.2026')).toBe('2026-03-14')
  })

  it('parses dotted shorthand with single-digit day/month', () => {
    expect(parseFlexibleDate('5.3.2026')).toBe('2026-03-05')
  })

  it('round-trips through formatLongDate', () => {
    const iso = '2026-03-14'
    expect(parseFlexibleDate(formatLongDate(iso))).toBe(iso)
  })

  it('rejects an unknown month name', () => {
    expect(parseFlexibleDate('14 march 2026')).toBeNull()
  })

  it('rejects an out-of-range day', () => {
    expect(parseFlexibleDate('31 apríl 2026')).toBeNull()
  })

  it('rejects garbage input', () => {
    expect(parseFlexibleDate('not a date')).toBeNull()
    expect(parseFlexibleDate('')).toBeNull()
    expect(parseFlexibleDate('   ')).toBeNull()
  })
})

describe('todayISO', () => {
  it('returns an ISO YYYY-MM-DD string', () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
