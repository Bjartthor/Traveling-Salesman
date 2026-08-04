import { HashRouter, Route, Routes } from 'react-router-dom'
import { GeoGate } from '@/geo/GeoGate'
import { BottomNav } from '@/components/nav/BottomNav'
import { MapScreen } from '@/screens/MapScreen'
import { PlacesScreen } from '@/screens/PlacesScreen'
import { TripsScreen } from '@/screens/TripsScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { PlaceStatusSheet } from '@/components/places/PlaceStatusSheet'
import { CountryDetail } from '@/components/places/CountryDetail'
import { ActiveTripBanner } from '@/components/trips/ActiveTripBanner'
import { TripDetail } from '@/components/trips/TripDetail'
import { SyncIndicator } from '@/components/sync/SyncIndicator'
import { useSyncTriggers } from '@/sync/useSyncTriggers'
import './App.css'

function App() {
  useSyncTriggers()
  return (
    <HashRouter>
      <GeoGate>
        <div className="app-shell">
          <main className="app-content">
            <Routes>
              <Route path="/" element={<MapScreen />} />
              <Route path="/places" element={<PlacesScreen />} />
              <Route path="/trips" element={<TripsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
            </Routes>
          </main>
          <ActiveTripBanner />
          <SyncIndicator />
          <BottomNav />
        </div>
        <CountryDetail />
        <TripDetail />
        <PlaceStatusSheet />
      </GeoGate>
    </HashRouter>
  )
}

export default App
