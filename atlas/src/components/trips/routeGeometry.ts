// Screen-space geometry for one leg of a trip's route arrows
// (docs/superpowers/specs/2026-10-07-trip-route-arrows-design.md): a gentle
// quadratic arc from one projected stop to the next, plus a small open
// chevron at its midpoint showing direction. Pure — no React, no d3.

export type Pt = readonly [number, number]

export interface RouteLeg {
  from: Pt
  control: Pt
  to: Pt
  /** [arm, tip, arm] polyline, or null when the leg is too short to carry one. */
  chevron: readonly [Pt, Pt, Pt] | null
}

// Perpendicular offset of the control point, as a fraction of the leg length.
const BOW = 0.2
// Below this a leg is invisible under the city dots anyway.
const MIN_LEG_PX = 4
// Below this a chevron would be bigger than the line it sits on.
const MIN_CHEVRON_LEG_PX = 18
const CHEVRON_PX = 5

export function routeLeg(from: Pt, to: Pt): RouteLeg | null {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const len = Math.hypot(dx, dy)
  if (len < MIN_LEG_PX) return null

  // Unit tangent, and the unit normal to its left — with screen y pointing
  // down, facing along (ux, uy) the left-hand side is (uy, -ux). Always bowing
  // left is what makes a leg and its reverse curve apart instead of overlapping.
  const ux = dx / len
  const uy = dy / len
  const nx = uy
  const ny = -ux

  const control: Pt = [(from[0] + to[0]) / 2 + nx * len * BOW, (from[1] + to[1]) / 2 + ny * len * BOW]
  if (len < MIN_CHEVRON_LEG_PX) return { from, control, to, chevron: null }

  // A quadratic Bézier at t = 0.5 sits at ¼·from + ½·control + ¼·to, and its
  // tangent there is parallel to (to − from) — so the chevron points along u.
  const tip: Pt = [0.25 * from[0] + 0.5 * control[0] + 0.25 * to[0], 0.25 * from[1] + 0.5 * control[1] + 0.25 * to[1]]
  const back = CHEVRON_PX
  const spread = CHEVRON_PX * 0.8
  const armA: Pt = [tip[0] - ux * back + nx * spread, tip[1] - uy * back + ny * spread]
  const armB: Pt = [tip[0] - ux * back - nx * spread, tip[1] - uy * back - ny * spread]
  return { from, control, to, chevron: [armA, tip, armB] }
}
