// Catches what an ErrorBoundary can't: exceptions outside React's render
// (event handlers, timers, non-React async code) and rejected promises no one
// awaited. Neither of these crashes the tab by itself, but both are exactly
// the kind of thing worth having in the breadcrumb trail leading up to one.

import { logError } from '@/debug/log'

export function installGlobalErrorLogging(): void {
  window.addEventListener('error', (event) => {
    void logError(event.message || 'Uncaught error', event.error instanceof Error ? event.error.stack : undefined)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason
    void logError(
      reason instanceof Error ? reason.message : String(reason),
      reason instanceof Error ? reason.stack : undefined,
    )
  })
}
