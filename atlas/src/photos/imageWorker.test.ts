import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// imageWorker.ts is meant to run only as a Worker (`new Worker(new URL(...))`),
// but a stray import from main-thread code evaluates it on the page instead,
// where `self` is the window — see processImage.test.ts for what that caused.
describe('imageWorker', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete (globalThis as { onmessage?: unknown }).onmessage
  })

  it('stays inert when evaluated on the page instead of in a worker', async () => {
    const posted: unknown[] = []
    vi.stubGlobal('self', globalThis) // what `self` is on the main thread
    vi.stubGlobal('postMessage', (data: unknown) => posted.push(data))

    await import('@/photos/imageWorker')
    const onmessage = (globalThis as { onmessage?: unknown }).onmessage
    if (typeof onmessage === 'function') onmessage({ data: { type: 'token-reply' } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(posted).toEqual([])
  })

  it('answers each job with a response carrying its jobId when running in a worker', async () => {
    class WorkerGlobalScope {}
    const posted: unknown[] = []
    const scope = Object.assign(new WorkerGlobalScope(), {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      postMessage: (data: unknown) => posted.push(data),
    })
    vi.stubGlobal('WorkerGlobalScope', WorkerGlobalScope)
    vi.stubGlobal('self', scope)

    await import('@/photos/imageWorker')
    scope.onmessage?.({ data: { jobId: 7, file: new File([], 'x.jpg') } })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Node has no OffscreenCanvas, so the job itself fails — but it must still
    // be answered, by id, or processImage's caller waits out the full timeout.
    expect(posted).toEqual([{ jobId: 7, ok: false, error: 'OffscreenCanvas/createImageBitmap unavailable in this worker' }])
  })
})
