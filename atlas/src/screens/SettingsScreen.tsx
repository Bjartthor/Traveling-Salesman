import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/layout/EmptyState'

export function SettingsScreen() {
  return (
    <EmptyState
      title="You"
      description="Your headline stat, theme, Google Drive sync and the map data attribution will live here once those pieces are built."
      action={
        // Temporary Phase-2 affordance to reach the geo-data verification screen.
        <Link to="/debug" className="empty-state__link">
          Open geo data debug →
        </Link>
      }
    />
  )
}
