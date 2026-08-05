// Manual backup (07-sync-and-deploy.md task 6) — export everything to a .zip
// via the share sheet, import the same zip back with a choice of merge or
// replace. Independent of Drive: works fully signed out, with no Google
// account at all. Sits right below Google Drive in the You screen — the
// backup this app can be inspected and moved by hand, the thing you can trust
// even if you don't trust the sync.

import { useState } from 'react'
import { importBackupMerge, importBackupReplace, readBackupFile, BackupFormatError, exportBackup, type BackupSummary } from '@/backup/backup'
import { shareOrDownloadZip } from '@/backup/share'
import './BackupSettings.css'

interface PendingImport {
  file: File
  summary: BackupSummary
  exportedAt: number
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function summaryLine(s: BackupSummary): string {
  return `${s.places} place${s.places === 1 ? '' : 's'} · ${s.trips} trip${s.trips === 1 ? '' : 's'} · ${s.photos} photo${s.photos === 1 ? '' : 's'}`
}

export function BackupSettings() {
  const [busy, setBusy] = useState<null | 'export' | 'reading' | 'importing'>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [confirmingReplace, setConfirmingReplace] = useState(false)

  function reset() {
    setError(null)
    setNotice(null)
  }

  async function handleExport() {
    reset()
    setBusy('export')
    try {
      const { blob, summary } = await exportBackup()
      const filename = `atlas-backup-${new Date().toISOString().slice(0, 10)}.zip`
      const outcome = await shareOrDownloadZip(blob, filename)
      if (outcome === 'shared') setNotice(`Shared: ${summaryLine(summary)}.`)
      else if (outcome === 'downloaded') setNotice(`Downloaded ${filename}: ${summaryLine(summary)}.`)
      // 'cancelled': the user dismissed the share sheet — nothing to report.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build a backup.')
    } finally {
      setBusy(null)
    }
  }

  async function handleFileSelected(file: File) {
    reset()
    setPending(null)
    setBusy('reading')
    try {
      const { doc, summary } = await readBackupFile(file)
      setPending({ file, summary, exportedAt: doc.exportedAt })
    } catch (e) {
      setError(e instanceof BackupFormatError ? e.message : 'Couldn’t read this file — is it an Atlas backup .zip?')
    } finally {
      setBusy(null)
    }
  }

  async function handleMerge() {
    if (!pending) return
    reset()
    setBusy('importing')
    try {
      const { summary } = await importBackupMerge(pending.file)
      setNotice(`Merged. This device now has ${summaryLine(summary)}.`)
      setPending(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not merge this backup.')
    } finally {
      setBusy(null)
    }
  }

  async function handleReplace() {
    if (!pending) return
    reset()
    setBusy('importing')
    try {
      const { summary } = await importBackupReplace(pending.file)
      setNotice(`Replaced. This device now has ${summaryLine(summary)}.`)
      setPending(null)
      setConfirmingReplace(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore this backup.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-screen__section">
      <h2 className="settings-screen__section-title">Backup</h2>
      <p className="settings-screen__hint">
        An independent copy of your places, trips and photos as one file — works with no Google account. Good for
        moving to a new phone, or just knowing your data isn’t only ever in one place.
      </p>

      <button type="button" className="settings-screen__action" disabled={busy !== null} onClick={() => void handleExport()}>
        {busy === 'export' ? 'Preparing…' : 'Export backup'}
      </button>

      {!pending && (
        <label className={`settings-screen__action settings-screen__action--secondary backup__file-label${busy !== null ? ' backup__file-label--disabled' : ''}`}>
          {busy === 'reading' ? 'Reading…' : 'Choose a backup file'}
          <input
            type="file"
            accept=".zip,application/zip"
            disabled={busy !== null}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleFileSelected(file)
            }}
          />
        </label>
      )}

      {pending && (
        <div className="backup__pending">
          <p className="settings-screen__hint">
            <span className="mono">{summaryLine(pending.summary)}</span>
            <br />
            Exported {formatDate(pending.exportedAt)}.
          </p>

          <button type="button" className="settings-screen__action" disabled={busy !== null} onClick={() => void handleMerge()}>
            {busy === 'importing' && !confirmingReplace ? 'Merging…' : 'Merge into this device'}
          </button>

          {!confirmingReplace ? (
            <button
              type="button"
              className="settings-screen__action settings-screen__action--secondary"
              disabled={busy !== null}
              onClick={() => setConfirmingReplace(true)}
            >
              Replace everything on this device
            </button>
          ) : (
            <div className="backup__confirm">
              <p className="settings-screen__hint">
                This replaces every place, trip and photo on this device with the backup’s contents. Anything changed
                since this backup was taken — and not also in Google Drive — will be lost.
              </p>
              <div className="backup__confirm-actions">
                <button type="button" className="settings-screen__action settings-screen__action--secondary" disabled={busy !== null} onClick={() => void handleReplace()}>
                  {busy === 'importing' ? 'Replacing…' : 'Replace'}
                </button>
                <button type="button" className="settings-screen__action settings-screen__action--secondary" disabled={busy !== null} onClick={() => setConfirmingReplace(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <button
            type="button"
            className="settings-screen__action settings-screen__action--secondary"
            disabled={busy !== null}
            onClick={() => {
              setPending(null)
              setConfirmingReplace(false)
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="settings-screen__error" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="settings-screen__hint">{notice}</p>}
    </section>
  )
}
