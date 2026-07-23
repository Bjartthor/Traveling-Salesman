import { HashRouter, Route, Routes } from 'react-router-dom'
import { BottomNav } from '@/components/nav/BottomNav'
import { MapScreen } from '@/screens/MapScreen'
import { PlacesScreen } from '@/screens/PlacesScreen'
import { TripsScreen } from '@/screens/TripsScreen'
import { SettingsScreen } from '@/screens/SettingsScreen'
import './App.css'

function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <main className="app-content">
          <Routes>
            <Route path="/" element={<MapScreen />} />
            <Route path="/places" element={<PlacesScreen />} />
            <Route path="/trips" element={<TripsScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Routes>
        </main>
        <BottomNav />
      </div>
    </HashRouter>
  )
}

export default App
