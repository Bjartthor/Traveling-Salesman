import { flagEmoji } from '@/geo/flags'
import './CountryFlag.css'

/** Flag + mono ISO code, paired so nothing is lost on a platform that renders flag emoji as tofu. */
export function CountryFlag({ code }: { code: string }) {
  return (
    <span className="country-flag">
      <span aria-hidden="true">{flagEmoji(code)}</span>
      <span className="mono">{code}</span>
    </span>
  )
}
