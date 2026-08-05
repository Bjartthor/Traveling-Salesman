import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/tokens.css'
import '@/styles/base.css'
import { seedDatabase } from '@/db/seed'
import { registerUpdatePrompt } from '@/pwa/registerUpdatePrompt'
import App from './App.tsx'

registerUpdatePrompt()

seedDatabase().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
