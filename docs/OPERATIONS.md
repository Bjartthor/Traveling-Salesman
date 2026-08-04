# Atlas — Operations

Practical runbook for the parts of Atlas that need occasional hands-on care. Written at the end of
Phase 7a (Google Drive sync). The **deployment** sections are stubbed for the deploy session (7b).

Everything here assumes **Node 20** for any build step (`nvm use 20`; a non-login shell defaults to
the apt Node 18, which the PWA build tooling refuses).

---

## 1. When sync fails: what to check first

Local data is **never** at risk from a sync failure or from signing out — a failed sync leaves the
device untouched, and sign-out clears only the in-memory token and the sync bookkeeping. So triage
calmly, in this order.

**Where to look first**

- **Settings → You → Google Drive**: connection status, *Last synced*, pending-photo count, and the
  specific error line. The app never shows a success it didn't achieve, so trust this.
- **Browser console**: `[GSI_LOGGER]` lines (sign-in / popup issues) and Drive HTTP errors.
- **DevTools → Application → IndexedDB → `atlas`**: `settings` (`driveConnected`, `lastSyncAt`) and
  `syncState` (`revision` vs `pushedRevision`, `remoteRevision`).

**Symptom → cause → fix**

| Symptom | Likely cause | Fix |
|---|---|---|
| Consent screen appears **every week** | OAuth consent screen still in **Testing** | Publish it to **In production** (plan §9.5). Testing grants expire after 7 days. |
| "Your browser blocked the Google sign-in popup" | Popup blocked, or the token request had no user gesture | Allow popups for the site; tap **Connect** / **Sync now** (a tap is the gesture GIS needs). |
| Sign-in fails with an origin/redirect error | Authorized **JavaScript origin** doesn't match the page origin | The origin must equal scheme+host+port **exactly** — no path, no trailing slash. `http://localhost:5173` for dev, `https://<user>.github.io` for prod. |
| Signed in, but Drive calls return **403** | Drive API not enabled, or the `drive.appdata` scope missing | Enable **Google Drive API**; add scope `https://www.googleapis.com/auth/drive.appdata` to the consent screen. |
| "Google Drive access has expired or was revoked" | Token gone / access revoked from the Google account page | Tap **Connect** to sign in again. Local data is untouched. |
| Data doesn't appear on the other device | Devices signed into **different Google accounts**, or the other device never finished a sync | Confirm the **same** Google account on both; check `syncState.remoteRevision` advances after a sync. |
| "This copy of Atlas is older than the data in your Drive" | A newer app version wrote a higher document schema | Update the app on this device, then sync. |
| Photos never upload | `photos.uploadState` stuck at `pending` | Check **Upload photos on mobile data** (off = Wi-Fi only) and whether the device is on cellular; confirm the local blob still exists (`photoBlobs`). |
| Indicator stuck on **Offline** | `navigator.onLine` false, or Drive unreachable | It auto-retries on reconnect / return to foreground; or tap **Sync now**. |

**The shared file itself** lives in Drive's hidden `appDataFolder` as `atlas-data.json` (plus one
`photo-<id>.jpg` per photo). It is invisible in the normal Drive UI by design; inspect it via the
Drive API or the OAuth Playground (scope `drive.appdata`) if you need to see it directly.

---

## 2. Rotating the OAuth client ID

The client ID is **not a secret** (it ships in the public bundle; there is no client secret in this
flow). Rotate it only if you deliberately replace the OAuth client or change its origins.

1. **Cloud Console → APIs & Services → Credentials.** Create a new **OAuth client ID → Web
   application** (or edit the existing one). Authorized JavaScript origins:
   - `http://localhost:5173`
   - `https://<user>.github.io` (origin only — no path, no trailing slash)
2. **Update the value in two places:**
   - Local dev: `atlas/.env.local` → `VITE_GOOGLE_CLIENT_ID=…` (git-ignored; see `atlas/.env.example`).
   - Production: the GitHub repo **Variable** `VITE_GOOGLE_CLIENT_ID` (Settings → Secrets and variables
     → Actions → **Variables**, *not* Secrets — it must be readable by `pull_request` builds and it
     isn't sensitive). Wired up in the deploy session (7b).
3. **Redeploy** (push to `main`) so the new build embeds the new ID.
4. **Users** silently re-acquire a token against the new client on next launch; if a fresh consent is
   needed they see it once. No local data is affected.

---

## 3. Regenerating geo data without disturbing user data

**The invariant that keeps user data safe:** reference tables (`countries`, `subdivisions`, `cities`)
are *replaceable*; user tables (`entries`, `trips`, `tripEntries`, `photos`) are *precious* and refer
to reference data only by **stable join keys**:

- country = ISO 3166-1 **alpha-2** code
- subdivision = `` `${countryCode}.${geonamesAdmin1}` ``
- bundled city = positive **`geonameId`**; non-bundled (online/manual) city = **negative** `geonameId`

Never change those keys in a regeneration — user entries reference them by value, and changing them
orphans user data.

**Steps**

1. `cd atlas && nvm use 20 && npm run build:geo`. Sources download to git-ignored `tools/.cache/`;
   artefacts are written to `atlas/public/geo/*`. The build **fails loud** (exit 1, naming the
   country) on any Natural Earth ↔ GeoNames mismatch — do not paper over it.
2. Commit the regenerated `atlas/public/geo/*` artefacts.
3. **Bump the reference-data version** so clients reseed on next launch — the `geoDataVersion` gate in
   [`atlas/src/geo/loader.ts`](../atlas/src/geo/loader.ts) (`ensureReferenceData`). This value is
   **device-local and never synced**, so a reseed on one device does not touch Drive or other devices;
   each device reseeds independently when it updates.
4. **Preserve non-bundled cities across the reseed.** `ensureReferenceData` clears and repopulates the
   reference tables; any `source: 'online'` / `'manual'` city (negative `geonameId`) that a user entry
   points at must survive the clear, or that entry is stranded (surfaces as `UnknownCityError` from the
   cascade). See the Phase 4a/4b notes in `PROGRESS.md`.
5. **Verify after regen:** row counts and required territories (as in the Phase 2 checks); open a
   couple of country detail screens; run `rebuildDerivedEntries()` and confirm it reports **0**
   mutations (no drift between stored and recomputed status).

---

## 4. Deployment runbook — TODO (Phase 7b)

To be written in the deploy session. It will cover: the GitHub Actions → Pages workflow, injecting
`VITE_GOOGLE_CLIENT_ID` from the repo **variable**, setting Vite `base` to `/<repo>/`, verifying the
deployed origin exactly matches the OAuth authorized origin, and the service-worker "Update available"
flow. Keeping this file as the single operational reference once that lands.
