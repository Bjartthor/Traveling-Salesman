// The Google Drive section of the You/Settings screen (07-sync-and-deploy.md
// tasks 1, 4, 5): connect / disconnect, last-synced time, a manual "Sync now",
// the pending-upload count, honest error messages, and the two device-local
// toggles (auto-sync, upload-on-cellular).

import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'
import { AuthError, describeAuthError, isConfigured, signIn, signOut } from '@/sync/auth'
import { syncNow } from '@/sync/sync'
import { useSyncStore } from '@/sync/syncStore'
import './GoogleDriveSettings.css'

function formatRelative(ts: number | null): string {
  if (ts === null) return 'never'
  const secs = Math.max(0, Math.round((Date.now() - ts) / 1000))
  if (secs < 45) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(ts).toLocaleDateString()
}

export function GoogleDriveSettings() {
  const settings = useLiveQuery(() => settingsRepo.get(), [])
  const pendingCount = useLiveQuery(
    async () => (await db.photos.where('uploadState').equals('pending').toArray()).filter((p) => p.deletedAt === null).length,
    [],
  )
  const phase = useSyncStore((s) => s.phase)
  const storeError = useSyncStore((s) => s.error)

  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'disconnect'>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false)

  const connected = settings?.driveConnected === true

  if (!isConfigured()) {
    return (
      <section className="settings-screen__section">
        <h2 className="settings-screen__section-title">Google Drive</h2>
        <p className="settings-screen__hint">
          Drive sync isn’t configured in this build, so your data stays on this device only. A backup is still
          available below.
        </p>
      </section>
    )
  }

  async function handleConnect() {
    setBusy('connect')
    setLocalError(null)
    setNotice(null)
    try {
      await signIn()
      void syncNow()
      setNotice('Connected. Your data will mirror to your Google Drive.')
    } catch (e) {
      setLocalError(e instanceof AuthError ? describeAuthError(e.kind) : 'Could not connect to Google Drive.')
    } finally {
      setBusy(null)
    }
  }

  async function handleSyncNow() {
    setBusy('sync')
    setNotice(null)
    const result = await syncNow()
    setBusy(null)
    if (result.outcome === 'ok') setNotice('Sync complete.')
    // Any failure is surfaced by the live phase/error below — no fake success.
  }

  async function handleDisconnect() {
    setBusy('disconnect')
    try {
      await signOut()
      setConfirmingDisconnect(false)
      setNotice('Signed out. Your places, trips and photos stay on this device.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-screen__section">
      <h2 className="settings-screen__section-title">Google Drive</h2>

      <div className="drive__status">
        <span className={`drive__dot drive__dot--${connected ? 'on' : 'off'}`} aria-hidden="true" />
        <span className="drive__status-text">{connected ? 'Connected' : 'Not connected'}</span>
      </div>

      {!connected && (
        <>
          <p className="settings-screen__hint">
            Mirror your data and photos to your own Google Drive, so they survive losing this phone. No one else can
            see it — it lives in a private app folder.
          </p>
          <button type="button" className="settings-screen__action" disabled={busy !== null} onClick={() => void handleConnect()}>
            {busy === 'connect' ? 'Connecting…' : 'Connect Google Drive'}
          </button>
        </>
      )}

      {connected && (
        <>
          <dl className="settings-screen__stats">
            <div className="settings-screen__stat">
              <dt>Last synced</dt>
              <dd className="mono">{phase === 'syncing' ? 'syncing…' : formatRelative(settings?.lastSyncAt ?? null)}</dd>
            </div>
            {typeof pendingCount === 'number' && pendingCount > 0 && (
              <div className="settings-screen__stat">
                <dt>Photos to upload</dt>
                <dd className="mono">{pendingCount}</dd>
              </div>
            )}
          </dl>

          <button type="button" className="settings-screen__action" disabled={busy !== null || phase === 'syncing'} onClick={() => void handleSyncNow()}>
            {phase === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>

          <label className="drive__toggle">
            <input
              type="checkbox"
              checked={settings?.autoSync !== false}
              onChange={(e) => void settingsRepo.update({ autoSync: e.target.checked })}
            />
            <span>Sync automatically after changes</span>
          </label>

          <label className="drive__toggle">
            <input
              type="checkbox"
              checked={settings?.photoUploadOnCellular === true}
              onChange={(e) => void settingsRepo.update({ photoUploadOnCellular: e.target.checked })}
            />
            <span>
              Upload photos on mobile data
              <span className="drive__toggle-sub">Off = Wi-Fi only. Protects you from a big upload on a foreign SIM.</span>
            </span>
          </label>

          {!confirmingDisconnect ? (
            <button
              type="button"
              className="settings-screen__action settings-screen__action--secondary"
              disabled={busy !== null}
              onClick={() => setConfirmingDisconnect(true)}
            >
              Disconnect
            </button>
          ) : (
            <div className="drive__confirm">
              <p className="settings-screen__hint">Sign out of Google Drive? Your places, trips and photos stay on this device.</p>
              <div className="drive__confirm-actions">
                <button type="button" className="settings-screen__action settings-screen__action--secondary" disabled={busy !== null} onClick={() => void handleDisconnect()}>
                  {busy === 'disconnect' ? 'Signing out…' : 'Sign out'}
                </button>
                <button type="button" className="settings-screen__action settings-screen__action--secondary" disabled={busy !== null} onClick={() => setConfirmingDisconnect(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {(localError || (phase === 'error' && storeError)) && (
        <p className="settings-screen__error" role="alert">
          {localError ?? storeError}
        </p>
      )}
      {phase === 'offline' && storeError && <p className="settings-screen__hint">{storeError}</p>}
      {notice && <p className="settings-screen__hint">{notice}</p>}
    </section>
  )
}
