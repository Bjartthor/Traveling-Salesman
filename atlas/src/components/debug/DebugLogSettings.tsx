// A running record of recent actions and errors (@/debug/log), kept on this
// device to help track down a crash after the fact — nothing is sent
// anywhere. Copy exists specifically so it can be pasted into a bug report.

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { clearLog } from '@/debug/log'
import type { LogEntry } from '@/db/types'
import './DebugLogSettings.css'

function formatEntry(e: LogEntry): string {
  const time = new Date(e.ts).toISOString()
  const head = `[${time}] ${e.level.toUpperCase()} ${e.message}`
  return e.detail ? `${head}\n  ${e.detail.replace(/\n/g, '\n  ')}` : head
}

export function DebugLogSettings() {
  const entries = useLiveQuery(() => db.debugLog.orderBy('id').reverse().toArray(), [])
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')

  async function handleCopy() {
    // entries is already newest-first (matches the on-screen list) — keep
    // that order in the copy too, so the most relevant (newest) entries are
    // first instead of buried at the end of a possibly-truncated paste.
    const text = (entries ?? []).map(formatEntry).join('\n\n')
    try {
      await navigator.clipboard.writeText(text || 'No log entries yet.')
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    } finally {
      setTimeout(() => setCopyState('idle'), 2000)
    }
  }

  return (
    <section className="settings-screen__section">
      <h2 className="settings-screen__section-title">Debug log</h2>
      <p className="settings-screen__hint">
        A running record of recent actions and errors, kept only on this device to help track down a crash — nothing
        is sent anywhere. If something goes wrong, copy this and share it.
      </p>

      <div className="debug-log__actions">
        <button type="button" className="settings-screen__action" onClick={() => void handleCopy()}>
          {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Couldn’t copy — select below' : 'Copy log'}
        </button>
        <button
          type="button"
          className="settings-screen__action settings-screen__action--secondary"
          onClick={() => void clearLog()}
        >
          Clear log
        </button>
      </div>

      {entries && entries.length > 0 ? (
        <ul className="debug-log__list">
          {entries.map((e) => (
            <li key={e.id} className={`debug-log__entry debug-log__entry--${e.level}`}>
              <span className="debug-log__time mono">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="debug-log__message">{e.message}</span>
              {e.detail && <pre className="debug-log__detail">{e.detail}</pre>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="settings-screen__hint">No log entries yet.</p>
      )}
    </section>
  )
}
