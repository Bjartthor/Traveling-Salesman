import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('installScheduleWatch', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The high-heap Aw-snap was a window `message` ping-pong — invisible to the
  // rAF/setTimeout counts, which is how it hid for weeks. A message storm has
  // to show up in the census as a climbing `msgN`.
  it('counts message events delivered to the window, as msgN in the census', async () => {
    const page = new EventTarget()
    vi.stubGlobal('window', page)
    const { installScheduleWatch } = await import('@/debug/scheduleWatch')
    const { censusSummary } = await import('@/debug/census')

    installScheduleWatch()
    for (let i = 0; i < 3; i++) page.dispatchEvent(new Event('message'))

    expect(censusSummary().split(' · ')).toContain('msgN 3')
  })
})
