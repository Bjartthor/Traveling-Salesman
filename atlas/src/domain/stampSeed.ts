// Deterministic per-trip seed derived from the trip id (05-trips.md task 3:
// "rotated ... seeded deterministically from the trip id so a given trip
// always looks the same"). No Dexie, no React — a pure hash, pinned down with
// a test so a refactor can't silently change every stamp's look.

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** -2..+2 degrees, stable for a given trip id. */
export function stampRotationDeg(tripId: string): number {
  return (hashString(tripId) % 401) / 100 - 2
}

/** A small integer for the ink-texture SVG filter's `seed` attribute — different trips get visibly different "ink," a given trip is stable. */
export function stampInkSeed(tripId: string): number {
  return hashString(tripId) % 100
}
