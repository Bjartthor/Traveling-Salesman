// ISO 3166-1 alpha-2 -> flag emoji, built from the two Regional Indicator
// Symbol letters rather than shipping 250 flag assets. The mono country code
// is always shown alongside it everywhere this is used (00-PLAN.md §8's
// "small flag or country code in mono") so nothing is lost on a platform
// whose emoji font doesn't render flags.

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - 65 // 'A'.charCodeAt(0)

export function flagEmoji(countryCode: string): string {
  const code = countryCode.toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return ''
  return String.fromCodePoint(
    ...[...code].map((c) => c.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET),
  )
}
