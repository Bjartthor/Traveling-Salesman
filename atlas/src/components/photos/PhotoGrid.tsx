// Thumbnail grid shared by every photo-attach point (06-photos.md task 2):
// CountryDetail's country-level photos, TripDetail's trip-level and
// per-city-tag photos. Purely presentational — the caller owns the
// PhotoViewer overlay and whatever write actions it wires up.

import type { Photo } from '@/db/types'
import { useThumbUrl } from '@/components/photos/usePhotoBlobUrl'
import './PhotoGrid.css'

export function PhotoGrid({
  photos,
  coverPhotoId,
  onSelect,
}: {
  photos: readonly Photo[]
  coverPhotoId?: string | null
  onSelect: (index: number) => void
}) {
  if (photos.length === 0) return null
  return (
    <div className="photo-grid">
      {photos.map((photo, i) => (
        <button key={photo.id} type="button" className="photo-grid__item" onClick={() => onSelect(i)}>
          <PhotoThumb photo={photo} />
          {coverPhotoId === photo.id && <span className="photo-grid__cover-badge mono">Cover</span>}
        </button>
      ))}
    </div>
  )
}

function PhotoThumb({ photo }: { photo: Photo }) {
  const url = useThumbUrl(photo.id)
  return url ? (
    <img className="photo-grid__thumb" src={url} alt={photo.caption || ''} loading="lazy" />
  ) : (
    <div className="photo-grid__thumb photo-grid__thumb--loading" aria-hidden="true" />
  )
}
