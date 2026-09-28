import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// processImage.ts is the page's (main-thread) side of the photo worker. On the
// main thread `self` is the window itself, so if loading it ever evaluates
// imageWorker.ts there, the worker's `self.onmessage` job handler lands on the
// window — and answers every message the page receives (Google sign-in's popup
// replying with a token, say) with `self.postMessage`: a message back to the
// page itself, which it then answers again, forever. That loop was the
// runaway-heap "Aw snap" crash (see AW-SNAP-DEBUGGING.md).
describe('processImage (main-thread photo client)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { onmessage?: unknown }).onmessage
  })

  it('does not answer a message sent to the page with a message of its own', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('self', globalThis) // what `self` is on the main thread
    vi.stubGlobal('postMessage', (data: unknown) => posted.push(data))

    await import('@/photos/processImage')
    // Deliver one message the way the browser does — e.g. the sign-in popup's reply.
    const onmessage = (globalThis as { onmessage?: unknown }).onmessage
    if (typeof onmessage === 'function') onmessage({ data: { type: 'token-reply' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posted).toEqual([])
  })
})
