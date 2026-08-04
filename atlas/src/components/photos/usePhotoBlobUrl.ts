// Object-URL lifecycle for a photo's blobs — split out from PhotoGrid.tsx so
// that file only exports components (keeps Fast Refresh working there).

import { useEffect, useState } from 'react'
import { photoBlobsRepo } from '@/db/repo'
import { ensurePhotoBlob } from '@/sync/photos'

export function useThumbUrl(photoId: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void photoBlobsRepo.get(photoId).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob.thumb)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoId])
  return url
}

/**
 * Same lifecycle, but the full-resolution blob — for the viewer's main image.
 * This is the "photo opened" moment (07-sync task 5): if the blob is missing
 * because the photo was taken on another device, `ensurePhotoBlob` downloads it
 * from Drive, regenerates the thumbnail, and caches both. A failed download
 * (offline, not connected) just leaves the image blank rather than throwing.
 */
export function useFullUrl(photoId: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void ensurePhotoBlob(photoId)
      .then((blob) => {
        if (cancelled || !blob) return
        objectUrl = URL.createObjectURL(blob.full)
        setUrl(objectUrl)
      })
      .catch(() => {
        /* download failed — viewer shows its empty state */
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoId])
  return url
}
