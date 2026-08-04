// Google Identity Services token flow (plan §7 OAuth, 07-sync-and-deploy.md
// task 1). Returns a short-lived access token for the Drive appDataFolder scope.
// No client secret, no refresh token, nothing sensitive in the bundle.
//
// The access token lives in module memory ONLY — never localStorage, never
// IndexedDB. On a page reload we start tokenless and silently re-acquire one if
// the user had connected Drive on this device (settings.driveConnected).

import { db } from '@/db/schema'
import { settingsRepo } from '@/db/repo'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? ''
const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
// Refresh a bit before the ~1h expiry so an in-flight sync never races the clock.
const EXPIRY_MARGIN_MS = 60_000

export type AuthErrorKind =
  | 'not_configured' // no VITE_GOOGLE_CLIENT_ID at build time
  | 'offline' // network down at sign-in / script load
  | 'declined' // user closed the popup or denied access
  | 'popup_blocked' // browser blocked the popup (often: no user gesture)
  | 'revoked' // token gone / access revoked from the Google account page
  | 'unknown'

export class AuthError extends Error {
  readonly kind: AuthErrorKind
  constructor(kind: AuthErrorKind, message: string) {
    super(message)
    this.name = 'AuthError'
    this.kind = kind
  }
}

/** A human sentence per failure — what happened and what to do about it. */
export function describeAuthError(kind: AuthErrorKind): string {
  switch (kind) {
    case 'not_configured':
      return 'Google Drive sync isn’t configured in this build (no client ID). Data stays on this device.'
    case 'offline':
      return 'You’re offline, so signing in to Google Drive isn’t possible right now. Your data is safe on this device — try again when you’re back online.'
    case 'declined':
      return 'Google sign-in was cancelled. Nothing was connected. Tap Connect to try again.'
    case 'popup_blocked':
      return 'Your browser blocked the Google sign-in popup. Allow popups for this site, then tap Connect again.'
    case 'revoked':
      return 'Google Drive access has expired or was revoked. Tap Connect to sign in again — your local data is untouched.'
    default:
      return 'Something went wrong talking to Google. Your local data is safe. Please try again.'
  }
}

export const isConfigured = (): boolean => CLIENT_ID.length > 0

// --- GIS script loading (once) ---

let gisPromise: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (gisPromise) return gisPromise
  gisPromise = new Promise<void>((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    const onload = () => resolve()
    const onerror = () => {
      gisPromise = null // let a later attempt retry once back online
      reject(new AuthError('offline', 'Could not load the Google sign-in library.'))
    }
    if (existing) {
      existing.addEventListener('load', onload, { once: true })
      existing.addEventListener('error', onerror, { once: true })
      if (window.google?.accounts?.oauth2) resolve()
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.addEventListener('load', onload, { once: true })
    script.addEventListener('error', onerror, { once: true })
    document.head.appendChild(script)
  })
  return gisPromise
}

// --- token client + in-memory token ---

interface TokenResponse {
  access_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}
interface GisError {
  type?: string
  message?: string
}
interface TokenClient {
  requestAccessToken: (overrides?: { prompt?: string }) => void
}
interface GoogleOAuth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (resp: TokenResponse) => void
    error_callback?: (err: GisError) => void
  }) => TokenClient
  revoke: (token: string, done?: () => void) => void
}
declare global {
  interface Window {
    google?: { accounts: { oauth2: GoogleOAuth2 } }
  }
}

interface StoredToken {
  value: string
  expiresAt: number
}
let token: StoredToken | null = null
let client: TokenClient | null = null
let pending: { resolve: (t: string) => void; reject: (e: AuthError) => void } | null = null
let inFlight: Promise<string> | null = null

export function hasValidToken(): boolean {
  return token !== null && Date.now() < token.expiresAt - EXPIRY_MARGIN_MS
}

/** Drop the in-memory token — called when Drive answers 401 (token no longer valid). */
export function forgetToken(): void {
  token = null
}

function mapTokenError(resp: TokenResponse): AuthError {
  switch (resp.error) {
    case 'access_denied':
      return new AuthError('declined', resp.error_description ?? 'Access denied.')
    case 'interaction_required':
    case 'login_required':
    case 'consent_required':
      return new AuthError('revoked', resp.error_description ?? 'Sign-in required.')
    default:
      return new AuthError('unknown', resp.error_description ?? resp.error ?? 'Token request failed.')
  }
}

function mapGisError(err: GisError): AuthError {
  switch (err.type) {
    case 'popup_failed_to_open':
      return new AuthError('popup_blocked', err.message ?? 'Popup blocked.')
    case 'popup_closed':
      return new AuthError('declined', err.message ?? 'Popup closed before completing.')
    default:
      return new AuthError('unknown', err.message ?? 'Sign-in failed.')
  }
}

function ensureClient(): TokenClient {
  if (client) return client
  const oauth2 = window.google?.accounts?.oauth2
  if (!oauth2) throw new AuthError('offline', 'Google sign-in library not ready.')
  client = oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      const req = pending
      pending = null
      if (!req) return
      if (resp.error || !resp.access_token) return req.reject(mapTokenError(resp))
      token = { value: resp.access_token, expiresAt: Date.now() + (resp.expires_in ?? 3600) * 1000 }
      req.resolve(resp.access_token)
    },
    error_callback: (err) => {
      const req = pending
      pending = null
      if (req) req.reject(mapGisError(err))
    },
  })
  return client
}

/**
 * Get a usable access token. Returns the cached one while valid; otherwise
 * requests a new one with `prompt: ''` — silent if the user still has an active
 * Google session and a prior grant, showing the consent/chooser UI only when it
 * can't be satisfied silently (exactly the plan's "request silently, show
 * consent only if that fails"). Concurrent callers share one request.
 */
export async function getAccessToken(): Promise<string> {
  if (!isConfigured()) throw new AuthError('not_configured', 'No Google client ID.')
  if (hasValidToken()) return token!.value
  if (inFlight) return inFlight

  inFlight = (async () => {
    if (!navigator.onLine) throw new AuthError('offline', 'No network connection.')
    await loadGis()
    const tokenClient = ensureClient()
    return await new Promise<string>((resolve, reject) => {
      pending = { resolve, reject }
      try {
        tokenClient.requestAccessToken({ prompt: '' })
      } catch (e) {
        pending = null
        reject(new AuthError('unknown', e instanceof Error ? e.message : String(e)))
      }
    })
  })()

  try {
    return await inFlight
  } finally {
    inFlight = null
  }
}

/** Explicit user-initiated connect. Marks this device connected on success. */
export async function signIn(): Promise<void> {
  await getAccessToken()
  await settingsRepo.update({ driveConnected: true })
}

/**
 * Sign out: revoke the token with Google, drop it from memory, mark this device
 * disconnected, and clear the sync bookkeeping — but leave ALL local user data
 * intact (the UI confirmation says so). Next connect re-pulls from Drive.
 */
export async function signOut(): Promise<void> {
  const current = token?.value
  token = null
  if (current && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(current)
    } catch {
      // Best-effort; a failed revoke still means we forget the token locally.
    }
  }
  await settingsRepo.update({ driveConnected: false })
  await db.syncState.update(1, {
    remoteRevision: 0,
    pushedRevision: 0,
    lastPulledAt: null,
    lastPushedAt: null,
    lastSyncedSettings: null,
  })
}
