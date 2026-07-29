// Object-URL lifecycle for a photo's blobs — split out from PhotoGrid.tsx so
// that file only exports components (keeps Fast Refresh working there).

import { useEffect, useState } from 'react'
import { photoBlobsRepo } from '@/db/repo'

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

/** Same lifecycle, but the full-resolution blob — for the viewer's main image. */
export function useFullUrl(photoId: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    void photoBlobsRepo.get(photoId).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob.full)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [photoId])
  return url
}
