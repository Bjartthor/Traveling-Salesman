// Pure drag/zoom math for the 3D-look globe (@/components/map/GlobeMap). Kept
// out of the component so the geometry can be unit-tested without a DOM or a
// live d3 projection — same "logic lives outside the component" precedent as
// cityLayer.ts.

import { geoDistance, geoInterpolate } from 'd3-geo'

export type Rotation = [number, number, number] // [lambda, phi, gamma] degrees

// A drag of `scale` px sweeps one radian of great-circle arc on a sphere
// rendered at that scale (its radius, in px) — so 180/π converts screen
// pixels straight into degrees of rotation with no picked/tuned constant to
// retune later: dragging a point right at the globe's equator tracks the
// pointer almost exactly, the same "grab and turn" feel a real globe has.
const DEGREES_PER_RADIAN = 180 / Math.PI

// Keeps the globe from flipping over a pole into a disorienting upside-down
// spin. Yaw (lambda) is left free to spin indefinitely in either direction —
// only pitch (phi) is clamped.
export function clampLatitude(phi: number): number {
  return Math.max(-90, Math.min(90, phi))
}

/**
 * The new [lambda, phi, gamma] after dragging (dx, dy) screen pixels, given
 * the globe's current rotation and rendered scale (radius in px). Roll
 * (gamma) is untouched — this feature has no tilt gesture.
 */
export function rotateByDrag(rotation: Rotation, dx: number, dy: number, scale: number): Rotation {
  const k = DEGREES_PER_RADIAN / scale
  const [lambda, phi, gamma] = rotation
  return [lambda + dx * k, clampLatitude(phi - dy * k), gamma]
}

export function clampScale(scale: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, scale))
}

const HALF_PI = Math.PI / 2

// The point currently at the centre of the visible disk, given a rotation —
// verified directly against a live projection (not assumed): rotating
// [-lon, -lat, 0] centres [lon, lat] exactly, so the inverse holds too.
function centerOf(rotation: Rotation): [number, number] {
  return [-rotation[0], -rotation[1]]
}

/**
 * Whether a [lon, lat] point sits on the currently visible (near) hemisphere
 * of an orthographic globe at the given rotation. Needed for anything that
 * projects a bare point rather than a polygon: d3-geo's clipAngle only clips
 * polygon/line geometry drawn through the path generator — verified directly
 * that the raw forward projection of a point and its exact antipode collide
 * at the identical screen coordinate, so calling `projection([lon, lat])`
 * alone never tells you which hemisphere you actually got.
 */
export function isFrontFacing(rotation: Rotation, point: [number, number]): boolean {
  return geoDistance(point, centerOf(rotation)) <= HALF_PI
}

/**
 * Rotates `t` of the way along the great circle from the point currently
 * centred toward `target`, preserving roll (gamma) — `t=0` is a no-op,
 * `t=1` centres `target` exactly. This is what makes zooming in on an
 * off-centre point (see GlobeMap's zoomAt) turn the globe to face that point
 * rather than just magnifying it at whatever oblique angle it happened to be
 * sitting at: an orthographic projection foreshortens everything away from
 * its own centre (the same reason the edge of a real globe looks "on a
 * slant"), and scale alone can't undo that — only rotation can, because it's
 * the projection's centre, not its zoom level, that determines what's seen
 * face-on.
 *
 * `d3.geoInterpolate` degrades to a constant (returns the start point for
 * every t) when the two points already coincide — confirmed by reading its
 * source, not assumed — so re-zooming in on an already-centred point is a
 * safe no-op, not a divide-by-zero.
 */
export function rotationTowardPoint(rotation: Rotation, target: [number, number], t: number): Rotation {
  const [lon, lat] = geoInterpolate(centerOf(rotation), target)(t)
  return [-lon, -lat, rotation[2]]
}
