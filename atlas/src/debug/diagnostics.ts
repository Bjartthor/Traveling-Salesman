// Device-local switch for the heavier crash diagnostics — kept in
// localStorage (not Dexie) because it has to be read synchronously in
// main.tsx, before anything else is installed. Off by default: the runaway
// those probes were built to catch (the window `message` ping-pong, see
// AW-SNAP-DEBUGGING.md) is fixed, so wrapping every setTimeout and
// requestAnimationFrame app-wide is only worth paying for while chasing a
// new one. The cheap, always-useful parts (heap watchdog, crash sentinel,
// `msgN`) stay on regardless.

const KEY = 'atlas:extraDiagnostics'

export function extraDiagnosticsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

/** Takes effect the next time the app starts. */
export function setExtraDiagnostics(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    // Storage blocked — the switch just stays off.
  }
}
