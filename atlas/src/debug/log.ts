// A durable, capped breadcrumb trail — written to IndexedDB rather than kept
// in memory, because memory is exactly what a renderer crash destroys; disk
// isn't. The point isn't to log everything, just enough recent, significant
// events that a crash report reads as "here's what happened right before
// this" instead of nothing. Device-only: never synced, never sent anywhere.

import { db } from '@/db/schema'
import type { LogLevel } from '@/db/types'

const MAX_ENTRIES = 300
// Trim in batches rather than count-and-trim on every write: one log line is
// then a single IndexedDB add, and the table briefly holds up to
// MAX_ENTRIES + TRIM_EVERY rows. The first write of a session always trims.
const TRIM_EVERY = 25
let writesSinceTrim = TRIM_EVERY

/** Never throws — a logging failure must never break the thing it's logging. */
async function logEvent(level: LogLevel, message: string, detail?: string): Promise<void> {
  try {
    await db.debugLog.add({ ts: Date.now(), level, message, detail: detail ?? null } as never)
    if (++writesSinceTrim < TRIM_EVERY) return
    writesSinceTrim = 0
    const count = await db.debugLog.count()
    if (count > MAX_ENTRIES) {
      const oldestIds = await db.debugLog.orderBy('id').limit(count - MAX_ENTRIES).primaryKeys()
      await db.debugLog.bulkDelete(oldestIds)
    }
  } catch {
    // best-effort only
  }
}

export const logInfo = (message: string, detail?: string): Promise<void> => logEvent('info', message, detail)
export const logError = (message: string, detail?: string): Promise<void> => logEvent('error', message, detail)

export function clearLog(): Promise<void> {
  return db.debugLog.clear()
}
