import { HashRouter, Route, Routes } from 'react-router-dom'
import { GeoGate } from '@/geo/GeoGate'
import { BottomNav } from '@/components/nav/BottomNav'
import { MapScreen } from '@/screens/MapScreen'
import { PlacesScreen } from '@/screens/PlacesScreen'
import { TripsScreen } from '@/screens/TripsScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import { DebugScreen } from '@/screens/DebugScreen'
import './App.css'

function App() {
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
              <Route path="/debug" element={<DebugScreen />} />
            </Routes>
          </main>
          <BottomNav />
        </div>
      </GeoGate>
    </HashRouter>
  )
}

export default App
