import { useEffect, useRef, useState } from 'react'

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

/** Animates toward `target` with a quick ease-out tween; jumps instantly under prefers-reduced-motion. */
export function useTweenedNumber(target: number, duration = 500): number {
  const [value, setValue] = useState(target)
  const fromRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (prefersReducedMotion()) {
      fromRef.current = target
      setValue(target)
      return
    }
    const from = fromRef.current
    if (from === target) return
    const start = performance.now()

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      setValue(from + (target - from) * easeOutCubic(t))
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [target, duration])

  return value
}
