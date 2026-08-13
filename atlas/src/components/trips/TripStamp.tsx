// The passport stamp (00-PLAN.md §8, 05-trips.md task 3) — the app's
// signature element. Each past trip (closed, or left open when the user
// switched to a different active trip — see @/domain/tripRepo) renders as one
// of these in the Trips tab, stacked with slight overlap down the page.
//
// The double hairline border's "uneven ink" texture is an SVG
// feTurbulence/feDisplacementMap filter applied only to two thin absolutely-
// positioned border layers, never to the text content — so the edge looks
// hand-stamped without blurring anything legible.

import type { CSSProperties } from 'react'
import type { Status } from '@/db/types'
import { stampInkSeed, stampRotationDeg } from '@/domain/stampSeed'
import { formatLongDate } from '@/domain/dateFormat'
import { CountryFlag } from '@/components/places/CountryFlag'
import { TripRouteMap } from '@/components/trips/TripRouteMap'
import './TripStamp.css'

interface TripStampCity {
  name: string
  lat: number
  lon: number
}

interface TripStampProps {
  tripId: string
  name: string
  startDate: string | null
  endDate: string | null
  countryCodes: readonly string[]
  countryStatus: ReadonlyMap<string, Status>
  cities: readonly TripStampCity[]
  coverPhotoUrl?: string | null // wired for Phase 6; always null until photos exist
  onClick?: () => void
}

export function TripStamp({
  tripId,
  name,
  startDate,
  endDate,
  countryCodes,
  countryStatus,
  cities,
  coverPhotoUrl,
  onClick,
}: TripStampProps) {
  const rotation = stampRotationDeg(tripId)
  const inkSeed = stampInkSeed(tripId)
  const filterId = `stamp-ink-${tripId}`
  const dateRange = `${startDate ? formatLongDate(startDate) : '—'} – ${endDate ? formatLongDate(endDate) : 'ONGOING'}`

  return (
    <button
      type="button"
      className="trip-stamp"
      style={{ '--stamp-rotation': `${rotation}deg` } as CSSProperties}
      onClick={onClick}
      aria-label={`${name}, ${dateRange}`}
    >
      {coverPhotoUrl && <div className="trip-stamp__cover" style={{ backgroundImage: `url(${coverPhotoUrl})` }} aria-hidden="true" />}

      <svg width="0" height="0" aria-hidden="true">
        <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={inkSeed} result="noise" />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.5" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>
      <div className="trip-stamp__border trip-stamp__border--outer" style={{ filter: `url(#${filterId})` }} aria-hidden="true" />
      <div className="trip-stamp__border trip-stamp__border--inner" style={{ filter: `url(#${filterId})` }} aria-hidden="true" />

      <div className="trip-stamp__content">
        <p className="trip-stamp__name">{name}</p>
        <p className="trip-stamp__dates mono">{dateRange}</p>
        <div className="trip-stamp__map">
          <TripRouteMap countryCodes={countryCodes} countryStatus={countryStatus} cities={cities} compact />
        </div>
        <div className="trip-stamp__grid">
          {countryCodes.map((code) => (
            <span key={code} className="trip-stamp__code">
              <CountryFlag code={code} />
            </span>
          ))}
        </div>
      </div>
    </button>
  )
}
