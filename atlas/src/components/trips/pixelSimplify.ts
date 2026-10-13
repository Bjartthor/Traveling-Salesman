// A fixed-size map (the Trips-tab stamps, the trip detail map) never zooms,
// so any vertex closer than a fraction of a pixel to the one before it is
// invisible — yet 1:10m country outlines carry thousands of them, and every
// one becomes path-string text in the DOM. This wraps a projection so its
// output stream drops those points before the path is built. Not for the
// zoomable maps: they magnify one base-scale path, so detail that's sub-pixel
// at 1× is exactly what a zoom reveals.

import type { GeoProjection, GeoStream } from 'd3-geo'

/** Feed `projection` through a filter dropping projected points within `minDistancePx` (Manhattan) of the last kept one in the same line/ring. */
export function pixelSimplified(projection: GeoProjection, minDistancePx = 0.75): { stream: (output: GeoStream) => GeoStream } {
  return {
    stream(output: GeoStream): GeoStream {
      let lastX = NaN
      let lastY = NaN
      const filter: GeoStream = {
        point(x, y) {
          if (Math.abs(x - lastX) + Math.abs(y - lastY) < minDistancePx) return
          lastX = x
          lastY = y
          output.point(x, y)
        },
        lineStart() {
          lastX = NaN
          lastY = NaN
          output.lineStart()
        },
        lineEnd() {
          output.lineEnd()
        },
        polygonStart() {
          output.polygonStart()
        },
        polygonEnd() {
          output.polygonEnd()
        },
        sphere() {
          output.sphere?.()
        },
      }
      return projection.stream(filter)
    },
  }
}
