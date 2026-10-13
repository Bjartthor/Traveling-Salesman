import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom'
import { logInfo } from '@/debug/log'
import { breadcrumbDetail } from '@/debug/breadcrumb'
import { GeoGate } from '@/geo/GeoGate'
import { BottomNav } from '@/components/nav/BottomNav'
import { MapScreen } from '@/screens/MapScreen'
import { PlaceStatusSheet } from '@/components/places/PlaceStatusSheet'
import { ActiveTripBanner } from '@/components/trips/ActiveTripBanner'
import { UndoToast } from '@/components/undo/UndoToast'
import { useCountryDetailStore } from '@/domain/countryDetailStore'
import { useTripDetailStore } from '@/domain/tripDetailStore'
import { SyncIndicator } from '@/components/sync/SyncIndicator'
import { UpdateBanner } from '@/components/pwa/UpdateBanner'
import { useSyncTriggers } from '@/sync/useSyncTriggers'
import './App.css'

function RouteLogger() {
  const location = useLocation()
  useEffect(() => {
    void logInfo(`nav: ${location.pathname}`, breadcrumbDetail())
  }, [location.pathname])
  return null
}

// Code-split: the Map tab (the landing screen) and the place sheet ship in the
// main bundle; the other tabs and the two full-screen overlays load on first
// use. The service worker precaches every chunk, so this costs nothing offline.
const PlacesScreen = lazy(() => import('@/screens/PlacesScreen').then((m) => ({ default: m.PlacesScreen })))
const TripsScreen = lazy(() => import('@/screens/TripsScreen').then((m) => ({ default: m.TripsScreen })))
const SettingsScreen = lazy(() => import('@/screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })))
const CountryDetail = lazy(() => import('@/components/places/CountryDetail').then((m) => ({ default: m.CountryDetail })))
const TripDetail = lazy(() => import('@/components/trips/TripDetail').then((m) => ({ default: m.TripDetail })))

/** Mounts (and so first downloads) an overlay's chunk only once it's opened. */
function Overlays() {
  const countryOpen = useCountryDetailStore((s) => s.openCode !== null)
  const tripOpen = useTripDetailStore((s) => s.openTripId !== null)
  return (
    <Suspense fallback={null}>
      {countryOpen && <CountryDetail />}
      {tripOpen && <TripDetail />}
    </Suspense>
  )
}

function App() {
  useSyncTriggers()
  return (
    <HashRouter>
      <RouteLogger />
      <GeoGate>
        <div className="app-shell">
          <main className="app-content">
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<MapScreen />} />
                <Route path="/places" element={<PlacesScreen />} />
                <Route path="/trips" element={<TripsScreen />} />
                <Route path="/settings" element={<SettingsScreen />} />
              </Routes>
            </Suspense>
          </main>
          <ActiveTripBanner />
          <SyncIndicator />
          <UpdateBanner />
          <BottomNav />
        </div>
        <Overlays />
        <UndoToast />
        <PlaceStatusSheet />
      </GeoGate>
    </HashRouter>
  )
}

export default App
