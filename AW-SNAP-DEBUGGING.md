# Aw-snap crash — session log (2026-08-28)

Companion to `PROGRESS.md`'s own Aw-snap sections (search it for "Aw snap" —
there's a whole prior investigation, 2026-08-17 through 08-24, that ruled out
render/zoom, rAF/timers, all 24 `useLiveQuery` sites, all Zustand stores, and
eventually found and fixed a real bug: a singleton EXIF-parsing Web Worker
that could infinite-loop on a malformed photo, commit `205267b`). This file
covers one session that started as "just remove the Photos UI" and ended up
finding that the 08-24 fix had a gap, fixing it twice, and then discovering
the crash the user is actually hitting is a **different, still-unsolved
bug** that merely happens to look similar.

**Read this first if you're picking this up cold:** skip to
[Where this actually stands](#where-this-actually-stands) and
[Recommended next step](#recommended-next-step) — the numbered timeline below
is for when you need the reasoning behind a claim, not as required reading.

## Where this actually stands

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

Still open. What we know for certain:

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
