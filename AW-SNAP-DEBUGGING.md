# Aw-snap crash — debugging log

> **2026-09-28: root cause found and fixed; not yet confirmed on a real
> device.** Start at [Resolution (2026-09-28)](#resolution-2026-09-28) and its
> [on-device checklist](#on-device-checklist-needs-you). Everything after that
> section is the 2026-08-28 session log, kept for the record. Its conclusions
> ("a malformed photo hangs exifr", "who calls `processImage`?") were wrong,
> and the resolution explains why.

## Resolution (2026-09-28)

### What was actually happening

It wasn't a malformed photo, and nothing was calling `processImage`. It was
an import side effect that turned the page into a message loop:

1. `photos/processImage.ts` (main-thread code) imported four resize constants
   from `photos/imageWorker.ts`. A runtime import evaluates the whole module,
   so the worker file (and all of exifr) was bundled into the **main**
   bundle and ran on the page at startup. The import chain is static and
   always loaded: `App.tsx` → `useSyncTriggers`/`SyncIndicator` →
   `sync/sync.ts` → `sync/photos.ts` → `processImage.ts` → `imageWorker.ts`.
   It had been like this since photos shipped (`bb17c6e`, 2026-07-29), before
   the first Aw-snap report.
2. `imageWorker.ts` ends with a top-level `self.onmessage = …`. In a worker,
   `self` is the worker. On the page, `self` **is the window**, so the
   worker's job handler got installed as `window.onmessage`.
3. The first message the page receives starts the loop. That's Google
   sign-in's popup replying with a token (on Connect or reconnect, or on Sync
   now / Retry after the ~1 h token expiry). On desktop Chrome it's also any
   extension that `postMessage`s into pages, and many do that on every load.
4. The handler treats the message as a photo job, fails (there's no file),
   and replies with `self.postMessage(error)`. On the page that's
   `window.postMessage`, a message to itself, which it answers again,
   forever. It runs about 9,000 round trips a second, all plain macrotasks:
   no rAF, no timers, no Dexie, no React.
5. Each round trip calls `exifr.parse(undefined, { gps: true, pick: […] })`
   with a fresh options literal. exifr 7.1.3 caches one `Options` per
   options-object *identity* in a module-level `Map` (`existingInstances`,
   `node_modules/exifr/src/options.mjs`) that is never cleared, and it builds
   that `Options` before it even looks at the input. About 4 KB is retained
   per round trip, which comes to ~38 MB/s and an OOM crash in ~1–2 minutes.

### Every earlier clue, explained

| Clue (PROGRESS.md / the log below) | Explanation |
|---|---|
| Heap climbs with **zero** interaction, on any route, and never recovers | A self-sustaining message loop that doesn't depend on the UI |
| `rafN`/`tmoN` flat, all 8 liveQuery counters flat, `dom` flat | Message events are none of those, and the census had no counter for them |
| 29 s gap for 3 cheap Dexie reads after `sync: pulled` | The main thread was saturated by ~9k handler runs/s |
| Starts around a sync / Drive connect. Incognito without Drive: fine. Incognito + connect: crash | Connect opens the sign-in popup, and its reply is the first message |
| Paused stack `self.onmessage → postMessage → Promise.then → self.onmessage …`, with **only Main** in the Threads panel | That's the loop itself, running on the main thread (async stack traces stitch the hops together) |
| `traverseTiffDependencyTree` / `checkLoadedPlugins` on the stack | Those run in exifr's `Options` **constructor**, which builds options and doesn't parse a file. Nothing was stuck parsing anything |
| Heap snapshot: `My` 110,013, `{gps, pick}` 110,013, `Au` exactly 11× | One `Options` plus one options literal per round trip. exifr has exactly 11 segment sub-options (`tiff jfif xmp icc iptc ihdr ifd0 ifd1 exif gps interop`) |
| Retainer `table in Map` | exifr's `existingInstances` Map |
| Still crashed after fix #1 took exifr out of the main-thread fallback | Fix #1 never touched the handler. The snapshot (which defaults to the main-thread heap) was of the main thread all along, not the Worker |
| `photos=0`, Photos UI removed, and it still crashed | No photo was ever involved. The "job" was the sign-in message |
| A fresh tab in the automation extension's browser climbed with zero clicks | That extension talks to pages via `postMessage` |
| Earlier live patches of `window.onmessage`/`postMessage` saw nothing | They were installed before navigating (so the navigation wiped them), or after the handler had already been assigned at startup |

This is also very likely the "exact runaway loop [that] was never isolated"
in the 2026-08-12 investigation (`868a531`). That one was sync-triggered and
started after photos shipped, but it can't be proven after the fact.

### Reproduced in the sandbox (before the fix)

On a plain dev-server page load, `window.onmessage` was the worker's
handler. One `window.postMessage({})` produced 9,090 iterations in the first
second and 45,667 in five, and the heap went 20 → 211 MB in 5 s. After
stopping it and churning the GC, the heap floor stayed at 199 MB, so the
memory was retained, not garbage. A production build confirmed the same
thing: `self.onmessage=…` and exifr sat in the main `index-*.js`.

### The fix

- **Root cause:** a new side-effect-free `photos/imageJob.ts` holds the
  shared constants and message types. `processImage.ts` imports only from
  it, never from `imageWorker.ts`, not even a type. With
  `verbatimModuleSyntax`, `import { type X }` still compiles to a
  side-effect `import {}` that evaluates the module.
- **Defense in depth:** `imageWorker.ts` installs its handler only when
  `self instanceof WorkerGlobalScope`, so a future stray import can't bring
  this back.
- **Instrumentation:** the census gains `msgN` (window `message` events,
  counted passively) next to `rafN`/`tmoN`. That closes the exact blind spot
  that hid this bug.

Tests (each watched failing first): `photos/processImage.test.ts` checks
that loading the page-side client and sending one message doesn't make the
page post back. `photos/imageWorker.test.ts` checks the module is inert on
the page but still answers jobs by id inside a worker (mutation-checked).
`debug/scheduleWatch.test.ts` checks `msgN`.

### Verified in the sandbox (after the fix)

- `tsc -b`, `eslint .`, and `vitest` 211/211 all pass.
- Production build: the main chunk has **no exifr and no handler**, and
  shrank from 644 to 571 KB. The worker chunk has exifr plus the guarded
  handler.
- Live: `window.onmessage` is `null`. One message produces exactly 1 message
  event, and the heap stays flat for 5 s. The census shows `msgN 1` and stays
  there.
- The photo pipeline still works through the real Worker: a 3000×1500 JPEG
  becomes 2048×1024 plus a thumbnail in ~80 ms, with the EXIF date extracted.

### On-device checklist (needs you)

This hasn't been tested yet on a real phone or desktop with a real Google
sign-in. That's the one step left.

1. **Deploy:** push to `main` (GitHub Pages deploys automatically), if that
   hasn't been done yet.
2. **Get the new build onto the device.** The You tab's About section shows
   the build commit, and it must match the fix commit. If it doesn't, tap
   the "new version" banner. If there's no banner, background and
   foreground the app once. If it's still stale, fully close the app/tab and
   reopen it. Close any *other* Atlas tabs/windows too, because the banner
   only reloads the one you tap.
3. **Trigger the old crash on purpose:** in the You tab, go to Google Drive
   → Disconnect, then Connect. That was the reliable repro (sign-in popup
   plus a forced full merge). On desktop, also try normal (non-Incognito)
   Chrome with your extensions on.
4. **Leave it running for ~5 minutes.** The old crash took ~1–2.
5. **Check the Debug log** in the You tab (newest at the top). You should
   see no `memory: climbing` or `heap pressure crossed` lines, and on the
   next launch no new `crash: previous session ended uncleanly`. The census,
   including `msgN`, is *only* written on those lines, so not seeing it at
   all is the good outcome.

**If it still crashes,** the census on those lines tells you where to look:
- `msgN` in the thousands and climbing: still a message loop, through some
  other path. Look for a `self.onmessage` or `postMessage` reaching the page.
- `msgN` small but the heap climbing: a different mechanism. Go straight to a
  DevTools heap snapshot plus a CPU profile.
- A crash at **low** heap (no climb): that's the separate, still-open
  low-heap/GPU variant (PROGRESS.md, "came back at LOW heap").

### Follow-ups (optional, not done)

- The **Photos UI** is still unwired app-wide (`32e9a50`). That was a
  stopgap for the misdiagnosis, and it can come back once the device check
  passes.
- Before it does, note that **photo GPS has never worked.** exifr's global
  `pick` filters the coordinates out of `readExif`'s result. This is flagged
  as a separate task. When fixing it, pass a module-level constant options
  object, never a fresh literal per call (see step 5 of "What was actually
  happening").
- The earlier hardening (`205267b` timeout, `41a0567` no exifr on the main
  thread, `048aa58` circuit breaker) was aimed at the misdiagnosis but does
  no harm, so keep it.
- The Aw-snap instrumentation (census counters, `countedQuery`,
  `scheduleWatch`, the heap watch, the crash sentinel) can be trimmed once
  the device check has held for a while.

---

# 2026-08-28 session log (superseded, kept for the record)

Companion to `PROGRESS.md`'s own Aw-snap sections (search it for "Aw snap" —
there's a whole prior investigation, 2026-08-17 through 08-24, that ruled out
render/zoom, rAF/timers, all 24 `useLiveQuery` sites, all Zustand stores, and
eventually found and fixed a real bug: a singleton EXIF-parsing Web Worker
that could infinite-loop on a malformed photo, commit `205267b`). This file
covers one session that started as "just remove the Photos UI" and ended up
finding that the 08-24 fix had a gap, fixing it twice, and then discovering
the crash the user is actually hitting is a **different, still-unsolved
bug** that merely happens to look similar.

**(As of 2026-08-28) Read this first if you're picking this up cold:** skip to
[Where this actually stands](#where-this-actually-stands) and
[Recommended next step](#recommended-next-step) — the numbered timeline below
is for when you need the reasoning behind a claim, not as required reading.

## Where this actually stands

*Superseded 2026-09-28. See [Resolution](#resolution-2026-09-28).*

- **Fixed and deployed:** two real gaps in the exifr/photo-processing safety
  net (below). Both verified live, both pushed to `main`/GitHub Pages.
- **Not fixed:** the crash the user is actually hitting when they connect
  Google Drive. We conclusively proved *what* is leaking (exifr's internal
  `Options` object, called with Atlas's exact `{ gps: true, pick:
  ['DateTimeOriginal'] }` signature) but never found *what calls it*. Every
  reachable call site in the app's own code was traced and ruled out — see
  [The mystery: who calls `processImage`?](#the-mystery-who-calls-processimage).
- **All Photos UI is still removed app-wide** (add/view/import), from before
  this session's fixes. See "Unwire the Photos UI app-wide as a stopgap…"
  (commit `32e9a50`) and memory `aw-snap-render-path-ruled-out` for that
  reasoning. Nothing here re-enables it.
- The two fixes shipped this session make the crash's *worst case* much
  smaller even without knowing the trigger (bounded to one or two ~20s leak
  windows instead of unbounded repetition) — worth having the user retest
  before spending more time on the mystery, since it may now be rare/mild
  enough to not matter practically, or the reduced severity may make it
  easier to catch mid-crash next time.

## Recommended next step

*Superseded 2026-09-28. See [Resolution](#resolution-2026-09-28).*

The static-reading approach is exhausted (see the file list below) — every
file that could plausibly call `processImage`/`parseExif` has been read in
full, and none of them do. Two ways forward, in order of effort:

1. **Cheap, ships in one commit:** add a `console.trace()` or a
   `logInfo('processImage: called', new Error().stack)`-style breadcrumb at
   the very top of `processImage()` in
   [`atlas/src/photos/processImage.ts`](atlas/src/photos/processImage.ts),
   so it lands in the existing debug log the user already knows how to copy
   (Settings → Debug log). Deploy, have them reproduce (connect Drive with
   real data on the device, or disconnect-then-reconnect), then just read the
   log — no DevTools/USB dance needed at all. This is almost certainly the
   fastest way to finally name the caller.
2. **If that's inconclusive:** a heap snapshot's **Retainers** panel, walked
   all the way up to a GC root (not just the first two or three levels), on
   a *current* (post both fixes) capture. We got partway there once (saw
   `table in Map` → a `Context/scope` chain → `setTimeout` → `Window`) but
   never fully resolved it to a named module/closure.

Do **not** re-open the "is it the Photos UI" question — that's answered, see
below. Do not re-suspect the render/zoom/map path either — that's the *other*
investigation (PROGRESS.md, 08-18 → 08-24), already separately ruled out.

---

## Timeline

### 1. Started as a stopgap: remove all Photos UI

User reported the app crashing, suspected photos, asked to just remove the
Photos UI for now rather than keep debugging. Removed the add/view/import
entry points from all four places they appeared — the "Photos" section +
viewer in [`CountrySheet.tsx`](atlas/src/components/map/CountrySheet.tsx) and
[`CountryDetail.tsx`](atlas/src/components/places/CountryDetail.tsx), the
main Photos section + per-city photo overlay in
[`TripDetail.tsx`](atlas/src/components/trips/TripDetail.tsx), and the
"Import from photos" flow + photo storage stats in
[`SettingsScreen.tsx`](atlas/src/screens/SettingsScreen.tsx). Deliberately did
**not** touch `db/schema.ts`, `sync/*`, `backup/*`, or `photoRepo.ts` — no
data lost, sync/backup of existing photos still works, this was UI-only.
Commit `32e9a50`. Full reasoning in memory `aw-snap-render-path-ruled-out`.

### 2. It still crashed — first live capture (phone, via USB remote debugging)

User set up `chrome://inspect` USB debugging (Windows laptop → Pixel 8; the
`adb`-not-found and "offline/pending auth" issues along the way were generic
Windows/ADB driver problems, not Atlas-specific — resolved by installing
Android platform-tools and replugging). Caught a live
"Paused before potential out-of-memory crash" pause.

**Findings from that capture:**
- The **call stack** showed real, unminified exifr internals —
  `checkLoadedPlugins()`, `onlyTiff` — matching the *exact* function names
  from the original 08-24 root-cause capture. The paused frame's locals
  included `l: [36867]` — 36867 is literally the EXIF tag ID for
  `DateTimeOriginal`.
- The stack was a `self.onmessage → postMessage → Promise.then →
  self.onmessage` loop, repeating hundreds of times — a scheduling
  mechanism **not** visible to `rAF`, `setTimeout`, or `setInterval`
  (exactly the three the 08-18→08-24 investigation had instrumented and
  found flat). This is *why* that investigation never caught this class of
  bug even after a week of trying.
- **Threads panel showed only "Main" paused** — no separate Worker thread
  listed. Since `self` is just an alias for `window` on the main thread, this
  meant it was running via `processImage.ts`'s **main-thread fallback**
  (`processOnMainThread`/`readExifMainThread`), not the dedicated
  `imageWorker.ts` Worker.
- A heap snapshot (2.6 million retained objects, 97% of heap at only 400MB
  total) confirmed it precisely: expanding one object showed fields
  `chunked`, `chunkLimit`, `mergeOutput`, `translateKeys`, `sanitize`,
  segment namespaces `exif`/`gps`/`ifd0`/`ifd1`/`interop`/`icc`/`ihdr`/
  `iptc`/`jfif`/`tiff`/`xmp` — unambiguously exifr's own `Options` class
  (constructor name `My` in the minified bundle).

**Root cause understood:** `processImage()`'s fallback logic was

```js
try { return await processViaWorker(file) }
catch { return processOnMainThread(file) }
```

The Worker path has a 20s timeout + `worker.terminate()` (the 08-24 fix,
commit `205267b`) — but when a job **times out**, that rejection fell into
the same `catch`, which retried the *identical* file with
`processOnMainThread` — running the same `exifr` parse synchronously on the
main thread, with no timeout and, critically, no way to interrupt it (unlike
a Worker, you can't force-kill the main thread out of a stuck loop). So a
file that hung the Worker (which the 08-24 fix correctly bounded to 20s)
would then hang the main thread **unboundedly**.

### 3. Fix #1: never run exifr on the main thread (commit `41a0567`)

Two changes to
[`atlas/src/photos/processImage.ts`](atlas/src/photos/processImage.ts):
- `processImage()` no longer falls back to `processOnMainThread` when the
  Worker error message includes "timed out" — it re-throws instead. (Falling
  back still happens for the *other* failure mode, genuine Worker
  unavailability — old Safari, CSP, etc. — which isn't a malformed-file
  signal.)
- `processOnMainThread` no longer calls `exifr`/`parseExif` at all —
  `readExifMainThread` was deleted outright. It only resizes now; a photo
  processed via this fallback just won't get GPS/date metadata.

Verified live (via `preview_eval` against a stubbed `Worker`) both failure
modes: a simulated timeout now rejects cleanly without touching
`createImageBitmap`; a simulated "Worker unavailable" now resolves fast with
`lat/lon/takenAt: null` and no exifr call. `tsc`/`eslint`/207 tests clean.

### 4. Retested — still crashed. Reproduced it independently via browser automation

User confirmed build `41A0567` on their phone, still got the climb on mere
Drive connect. To rule out needing the user as a go-between, used the
`claude-in-chrome` MCP tools (a Chrome-extension bridge to the user's actual
browser) to drive a fresh tab myself.

**This produced a red herring that took a while to untangle:** a brand-new
tab in the extension's browser group *still* climbed to 3+GB with zero
clicks — looked at first like "even a fresh, empty account crashes." Patched
`addEventListener('message', …)`, `window.onmessage =`, `new Worker()`, and
`window.fetch()` globally before navigating — all stayed at zero the whole
climb, which was itself a real and correct finding (rules out the
postMessage-trampoline mechanism *for that specific run*), but the "fresh
account" framing turned out to be wrong: a new **tab** in the same Chrome
**profile** still shares IndexedDB with real data, including a `driveConnected`
flag left over from earlier testing in that same profile. Read `GeoGate.tsx`
and the geo-seeding/region-backfill code (`geo/loader.ts`,
`geo/regionBackfill.ts`, `geo/photon.ts`) chasing a "first-run seeding" theory
that the object shape didn't actually support — dead end, but the code
reading confirmed those paths are properly bounded/cached (`decodeLayer`'s
`WeakMap`, `loadCountryTopology`'s per-country promise memo), so they're
cleared as suspects too.

### 5. Incognito testing isolated the real trigger

User tested a genuinely fresh **Incognito** window (no shared profile state):
- Incognito, no Drive connection: **no climb.**
- Incognito, connect Google Drive (pulling the real ~380-entry/11-trip
  dataset down fresh): **crash.**

This is the cleanest signal in the whole session. It rules out "fresh
account" and "photos" as independent triggers, and rules out anything
extension/browser-automation-specific (this was 100% native DevTools, no
tooling involved). It points at **merging/processing a real, substantial
dataset**, not "any app load" and not any explicit photo action.

It also retroactively explains why *disconnecting* didn't stop an in-progress
climb (the loop, once started, is self-sustaining and doesn't check UI
state), and why signing into a *second* Google account "didn't fix it" (that
test was run while the first climb was likely still active — not actually an
independent trial). And it explains why **disconnect-then-reconnect**
reliably triggers it even against the *same* account with *unchanged* data:
`signOut()` resets `syncState` (`remoteRevision`/`pushedRevision` → 0), so the
next `runSync()` can never take the "nothing changed, skip the merge" fast
path in [`sync.ts`](atlas/src/sync/sync.ts) — it's forced through a full
merge + `applyMergedSnapshot` + `rebuildDerivedEntries` cycle regardless of
whether the data actually differs.

### 6. Read the entire sync/merge/cascade pipeline end to end — no caller found

Given the trigger is "connect + real data merges," read every file in that
path in full, specifically hunting for any call into `processImage`/
`parseExif`/`ensurePhotoBlob`:

- [`sync/auth.ts`](atlas/src/sync/auth.ts) — `signIn()` is just the GIS OAuth
  flow + a settings flag. Clean.
- [`sync/sync.ts`](atlas/src/sync/sync.ts) — the full `runSync()`
  orchestration (pull → photo pass → merge → apply → push). `syncPhotos()`
  (from `sync/photos.ts`) only uploads/deletes already-local blobs, never
  reprocesses one. Clean.
- [`sync/merge.ts`](atlas/src/sync/merge.ts) — `mergeSnapshots` is a pure
  function, no I/O at all. Clean.
- [`sync/snapshot.ts`](atlas/src/sync/snapshot.ts) — `applyMergedSnapshot`
  only does Dexie `bulkPut`/`bulkAdd` calls plus `rebuildDerivedEntries()`.
  Clean.
- [`domain/cascade.ts`](atlas/src/domain/cascade.ts) — the pure derivation
  engine `rebuildDerivedEntries` delegates to. Traced the recursive
  `desired()` resolver and the `children` tree-building in `makeResolver`
  specifically looking for a cycle/infinite-recursion bug — the hierarchy is
  provably bounded (country → subdivision → city, max depth 2, kind-rank
  strictly increases at each level). No bug found by reading.
- [`domain/cascadeRepo.ts`](atlas/src/domain/cascadeRepo.ts) — the Dexie-facing
  wrapper. Clean.
- [`components/sync/GoogleDriveSettings.tsx`](atlas/src/components/sync/GoogleDriveSettings.tsx)
  — `handleConnect()` is just `signIn()` + `syncNow()`, no special first-connect
  path. Clean.
- [`components/backup/BackupSettings.tsx`](atlas/src/components/backup/BackupSettings.tsx)
  — confirmed 100% explicit-button-gated (export/import/merge/replace), user
  confirmed not used during any of these reproductions anyway. Clean.
- [`db/schema.ts`](atlas/src/db/schema.ts) — no Dexie `.hook()` registrations
  on any table (checked specifically as a "reactive side-effect on write"
  theory). Clean.
- `main.tsx`, `App.tsx`, `sync/useSyncTriggers.ts`,
  `pwa/registerUpdatePrompt.ts`, `db/seed.ts` — every unconditional boot-time
  call. None touch photos.

**The only four call sites of `processImage`/`processBatch` in the entire
codebase**, confirmed by grep: `AddPhotosButton.tsx` and `PhotoImportFlow.tsx`
(both unreachable — no screen imports them, per step 1's removal),
`backup.ts`'s `importBackupMerge`/`importBackupReplace` (explicit file-picker
action only, confirmed unused), and `sync/photos.ts`'s `ensurePhotoBlob`
(only reachable via `PhotoViewer.tsx`, also unreachable). None of them fit
the observed trigger.

### 7. Second heap snapshot (incognito + connect) — confirmed it moved to the Worker path

User repeated the incognito+connect test with a proper two-snapshot
**Comparison** capture (safer than one snapshot at the crash boundary, which
had failed once before — the serialization itself needs headroom the leak
doesn't leave). Between a 407MB and an 856MB snapshot:

- `My` (exifr Options): 110,013 new instances.
- `Au` (exifr's per-segment sub-options): 1,210,143 new — exactly 11×
  `My`'s count, same ratio as the very first capture.
- **`{gps, pick}`** — a V8 hidden-class label showing the literal property
  names of an object shape: 110,013 new. This is the smoking gun — that
  exact combination, `{ gps: true, pick: ['DateTimeOriginal'] }`, is Atlas's
  own precise call signature into `exifr.parse()`. It cannot be a
  coincidence or a different library.
- `(array)` and `Set` were the single largest contributors by raw size
  (+308MB and +58MB respectively, ~3.7M and ~3.6M new instances) — roughly
  34 arrays and 33 Sets per `My`/Options construction, consistent with
  exifr's internal parsing building several collections per attempt.

Since **fix #1 (step 3) already removed this exact call from the main
thread**, and this capture is unambiguously post-fix, the only place left in
the codebase with this call signature is
[`photos/imageWorker.ts`](atlas/src/photos/imageWorker.ts)'s `readExif()` —
meaning the Worker path (`processViaWorker`) *is* being invoked successfully
(the Worker constructs fine, so it's not hitting the main-thread fallback via
"unavailable" either) and *is* what's looping this time. This file was never
modified before this point.

### 8. Fix #2: circuit breaker on repeated Worker timeouts (commit `048aa58`)

Rather than keep chasing the unidentified caller, hardened the Worker path
to bound total damage regardless of how many times (or by what) it gets
invoked. In
[`atlas/src/photos/processImage.ts`](atlas/src/photos/processImage.ts):
a new `consecutiveTimeouts` counter increments on every Worker-job timeout
and resets on any successful job; once it reaches **2**, `workerBroken` is
set permanently for the session (previously, a timeout *never* set
`workerBroken` — "the next job gets a fresh worker," reasonable for one bad
file in a batch, but it meant an unknown repeated caller got a fresh 20s leak
window on every single retry, forever).

Once `workerBroken` is true, `getWorker()` returns `null` immediately, so
`processViaWorker` rejects fast with `'worker unavailable'` (not a "timed
out" message) — which, thanks to fix #1, safely falls through to the
now-exifr-free `processOnMainThread` instead of ever hanging again.

Verified live: with a stubbed always-hanging `Worker`, call 1 timed out at
20s as expected; calls 2 and 3 both resolved **immediately** via the safe
path (`mainThreadAttempted: true`, no further 20s hangs). `tsc`/`eslint`/207
tests clean.

## The mystery: who calls `processImage`?

*Answered 2026-09-28: nobody did. The worker's own message handler was running on the page. See [Resolution](#resolution-2026-09-28).*

What we knew at the time:

- It's triggered by connecting Google Drive (or reconnecting, which forces a
  full merge even against unchanged data) **when the device has real,
  substantial local data** — not by a fresh/empty account, not by any photo
  UI action (all removed anyway), not by backup import.
- It doesn't re-register any `message` listener, doesn't call
  `window.postMessage`/`MessagePort.postMessage`, doesn't call `new
  Worker()`, and doesn't call `window.fetch()` during the observed climbs —
  confirmed by live-patching all four as globals immediately after page load,
  before triggering the crash. This is consistent with **one** already-running
  `parse()` call whose *internal* retry/chunk-reading logic loops, rather
  than repeated application-level calls — matching the original 08-24
  diagnosis's own description of the bug ("a malformed/adversarial EXIF
  structure can send exifr's TIFF-dependency traversal into a loop that never
  returns").
- Every static call site into `processImage`/`processBatch`/`ensurePhotoBlob`
  in the app's own source has been read and ruled out (see step 6 and the
  four-call-site list above).
- The two heap snapshots (phone, and later incognito) show the *exact* same
  object shape and ratio, so it's the same underlying bug both times — just
  reached via the main thread the first time (before fix #1) and the Worker
  the second time (after fix #1, which only closed the main-thread door).

Leading open theory: something is calling `ensurePhotoBlob` (the only
`processImage` call site that's data-driven rather than UI-gated) for a
**local, stale photo record** — e.g. one left over from testing before this
session's Photos-UI removal, whose `driveFileId` now points at a Drive file
that's since been deleted or was never fully uploaded — via a path that
doesn't go through `PhotoViewer.tsx` (which is what step 6 assumed was the
only caller). This wasn't confirmed; it's a hypothesis for the next session,
best tested by checking `db.photos.count()` / `db.photoBlobs.count()` locally
on the affected device rather than more code reading. The `console.trace()`
breadcrumb suggested in [Recommended next step](#recommended-next-step) would
settle this directly.

## Reference

**Commits this session** (all pushed to `main`):
- `32e9a50` — Unwire the Photos UI app-wide as a stopgap.
- `41a0567` — Never run exifr on the main thread.
- `048aa58` — Trip the worker circuit breaker after repeat timeouts.

**Prior, related commit** (from the original 08-24 investigation, not this
session): `205267b` — Time out and kill a stuck photo-processing worker
instead of hanging forever. This is the fix that had the gap fix #1 closed.

**Files read in full this session** (beyond the ones already covered by the
08-18→08-24 investigation in `PROGRESS.md`): `sync/auth.ts`, `sync/sync.ts`,
`sync/photos.ts`, `sync/merge.ts`, `sync/snapshot.ts`, `domain/cascade.ts`,
`domain/cascadeRepo.ts`, `components/sync/GoogleDriveSettings.tsx`,
`components/backup/BackupSettings.tsx`, `backup/backup.ts`, `db/schema.ts`,
`main.tsx`, `App.tsx`, `sync/useSyncTriggers.ts`, `pwa/registerUpdatePrompt.ts`,
`geo/GeoGate.tsx`, `geo/geoStore.ts`, `geo/loader.ts`, `geo/regionBackfill.ts`,
`geo/photon.ts`, `components/map/topo.ts`, `photos/imageWorker.ts`,
`photos/processImage.ts`.
