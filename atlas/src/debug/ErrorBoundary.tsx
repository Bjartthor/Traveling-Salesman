// Wraps the whole app (main.tsx). Without this, a render-time exception
// anywhere just unmounts React and leaves a blank page — no explanation, and
// (until now) nothing recorded either. This catches it, logs it to the
// breadcrumb trail, and offers a reload instead of a dead screen.

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError } from '@/debug/log'
import './ErrorBoundary.css'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    void logError(error.message || 'Render error', `${error.stack ?? ''}\n${info.componentStack ?? ''}`.trim())
  }

  render() {
    if (this.state.error) {
      return (
        <div className="error-boundary">
          <p className="error-boundary__title">Something went wrong.</p>
          <p className="error-boundary__hint">
            Your data is safe on this device. What broke has been noted in the debug log (Settings → Debug log) —
            copy it from there if you want to help track it down.
          </p>
          <button type="button" className="error-boundary__action" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
