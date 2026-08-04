// Google Drive REST v3 wrapper (07-sync-and-deploy.md task 2). Everything lives
// in `appDataFolder`, hidden from the user's normal Drive view.
//
// Reliability rules from the brief:
//   - Retry 429 and 5xx with exponential backoff + jitter, capped at 5 attempts.
//   - Treat 401 as "refresh the token and retry once".
//   - Every operation is idempotent — a sync interrupted halfway is safe to rerun
//     (e.g. deleting an already-deleted file resolves rather than throwing).

import { AuthError, forgetToken, getAccessToken } from '@/sync/auth'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const MAX_ATTEMPTS = 5
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 16_000

export interface DriveFile {
  id: string
  name?: string
  modifiedTime?: string
  size?: string
}

/** A non-retryable Drive failure (a 4xx other than 401). Carries the status. */
export class DriveError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(`Drive ${status}: ${message}`)
    this.name = 'DriveError'
    this.status = status
  }
}

/** Thrown internally to signal "this attempt can be retried" (429/5xx/network). */
class RetryableError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'RetryableError'
    this.status = status
  }
}

/**
 * Drive could not be reached after exhausting retries — a transient condition
 * (offline, rate-limited past the cap, server having a bad day). The sync
 * orchestrator treats this as "queue and try again later", never as data loss.
 */
export class DriveUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DriveUnavailableError'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function backoffDelay(attempt: number): number {
  const capped = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt)
  return capped + Math.random() * BASE_DELAY_MS // full-ish jitter
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (e instanceof RetryableError) {
        if (attempt < MAX_ATTEMPTS - 1) {
          await sleep(backoffDelay(attempt))
          continue
        }
        throw new DriveUnavailableError(e.message) // out of retries → transient failure
      }
      throw e
    }
  }
}

function withAuth(init: RequestInit, accessToken: string): RequestInit {
  return { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300)
  } catch {
    return ''
  }
}

/**
 * One authorized request. Refreshes the token and retries once on 401; maps
 * 429/5xx and network failures to a RetryableError for `withRetry`, and any
 * other non-2xx to a terminal DriveError. AuthErrors (e.g. revoked) propagate.
 */
async function authorizedFetch(url: string, init: RequestInit): Promise<Response> {
  const doFetch = async (): Promise<Response> => {
    const accessToken = await getAccessToken()
    return fetch(url, withAuth(init, accessToken))
  }

  let resp: Response
  try {
    resp = await doFetch()
  } catch (e) {
    if (e instanceof AuthError) throw e
    throw new RetryableError('network error')
  }

  if (resp.status === 401) {
    forgetToken()
    try {
      resp = await doFetch() // one refreshed retry (getAccessToken may re-prompt)
    } catch (e) {
      if (e instanceof AuthError) throw e
      throw new RetryableError('network error')
    }
  }

  if (resp.status === 429 || resp.status >= 500) throw new RetryableError(`HTTP ${resp.status}`, resp.status)
  if (!resp.ok) throw new DriveError(resp.status, await safeText(resp))
  return resp
}

const escapeQuery = (value: string): string => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Find a file by exact name in appDataFolder, or null. */
export async function findFile(name: string): Promise<DriveFile | null> {
  const params = new URLSearchParams({
    spaces: 'appDataFolder',
    q: `name = '${escapeQuery(name)}' and trashed = false`,
    fields: 'files(id,name,modifiedTime,size)',
    pageSize: '10',
    orderBy: 'modifiedTime desc',
  })
  const resp = await withRetry(() => authorizedFetch(`${API}/files?${params.toString()}`, { method: 'GET' }))
  const json = (await resp.json()) as { files?: DriveFile[] }
  return json.files?.[0] ?? null
}

export async function downloadJson<T>(fileId: string): Promise<T> {
  const resp = await withRetry(() => authorizedFetch(`${API}/files/${fileId}?alt=media`, { method: 'GET' }))
  return (await resp.json()) as T
}

export async function downloadBlob(fileId: string): Promise<Blob> {
  const resp = await withRetry(() => authorizedFetch(`${API}/files/${fileId}?alt=media`, { method: 'GET' }))
  return resp.blob()
}

function multipartBody(
  metadata: Record<string, unknown>,
  media: string | Blob,
  mediaType: string,
): { body: Blob; contentType: string } {
  const boundary = `atlas-${crypto.randomUUID()}`
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${mediaType}\r\n\r\n`
  const tail = `\r\n--${boundary}--`
  return {
    body: new Blob([head, media, tail]),
    contentType: `multipart/related; boundary=${boundary}`,
  }
}

async function uploadMultipart(
  name: string,
  media: string | Blob,
  mediaType: string,
  fileId: string | undefined,
): Promise<DriveFile> {
  // On create, name + parent go in the metadata; on update (PATCH) neither may
  // be re-sent (the file already has them, and appDataFolder can't be re-parented).
  const metadata = fileId ? {} : { name, parents: ['appDataFolder'] }
  const { body, contentType } = multipartBody(metadata, media, mediaType)
  const url = fileId
    ? `${UPLOAD}/files/${fileId}?uploadType=multipart&fields=id,name`
    : `${UPLOAD}/files?uploadType=multipart&fields=id,name`
  const resp = await withRetry(() =>
    authorizedFetch(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': contentType }, body }),
  )
  return (await resp.json()) as DriveFile
}

/** Create or (with fileId) overwrite a JSON file. Returns the file's id. */
export function uploadJson(name: string, data: unknown, fileId?: string): Promise<DriveFile> {
  return uploadMultipart(name, JSON.stringify(data), 'application/json', fileId)
}

/** Create or (with fileId) overwrite a binary file. */
export function uploadBlob(name: string, blob: Blob, fileId?: string): Promise<DriveFile> {
  return uploadMultipart(name, blob, blob.type || 'application/octet-stream', fileId)
}

/** Delete a file. A 404 (already gone) resolves — deletion is idempotent. */
export async function deleteFile(fileId: string): Promise<void> {
  try {
    await withRetry(() => authorizedFetch(`${API}/files/${fileId}`, { method: 'DELETE' }))
  } catch (e) {
    if (e instanceof DriveError && e.status === 404) return
    throw e
  }
}
