// Hand the exported zip to the OS share sheet (07-sync-and-deploy.md task 6)
// so it can go straight to Files, a cloud drive, AirDrop, etc. Falls back to a
// plain download where the Web Share API (or file sharing specifically) isn't
// available — desktop browsers, mainly.

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled'

export async function shareOrDownloadZip(blob: Blob, filename: string): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: 'application/zip' })

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Atlas backup' })
      return 'shared'
    } catch (e) {
      // The user dismissing the share sheet is not a failure — don't fall
      // through to an unexpected download right after they said no.
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // Any other share failure: fall back to a direct download below.
    }
  }

  const url = URL.createObjectURL(blob)
  try {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
  } finally {
    URL.revokeObjectURL(url)
  }
  return 'downloaded'
}
