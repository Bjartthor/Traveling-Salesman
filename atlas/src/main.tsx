import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/tokens.css'
import '@/styles/base.css'
import { seedDatabase } from '@/db/seed'
import { registerUpdatePrompt } from '@/pwa/registerUpdatePrompt'
import { installGlobalErrorLogging } from '@/debug/globalHandlers'
import { ErrorBoundary } from '@/debug/ErrorBoundary'
import App from './App.tsx'

registerUpdatePrompt()
installGlobalErrorLogging()

seedDatabase().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
})
