import { NavLink } from 'react-router-dom'
import './BottomNav.css'

const TABS = [
  { to: '/', label: 'Map', icon: <MapIcon /> },
  { to: '/places', label: 'Places', icon: <PlacesIcon /> },
  { to: '/trips', label: 'Trips', icon: <TripsIcon /> },
  { to: '/settings', label: 'You', icon: <YouIcon /> },
] as const

export function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.to === '/'}
          className={({ isActive }) => `bottom-nav__tab${isActive ? ' bottom-nav__tab--active' : ''}`}
        >
          <span className="bottom-nav__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="bottom-nav__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

export function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z" strokeLinecap="round" />
      <path d="M9 4v14M15 6v14" strokeLinecap="round" />
    </svg>
  )
}

function PlacesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.4" />
    </svg>
  )
}

function TripsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="6" width="17" height="14" rx="2" />
      <path d="M8 3.5v5M16 3.5v5M3.5 11h17" />
    </svg>
  )
}

function YouIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.4-4 4.1-6 7.5-6s6.1 2 7.5 6" />
    </svg>
  )
}
