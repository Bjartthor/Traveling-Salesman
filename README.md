# Atlas — Travel Tracker

A personal travel tracker that runs as an installable web app on the phone. It records which
countries, subdivisions and cities you've visited, lived in, passed through or want to visit, shows
a world map coloured by status, and groups visits into trips. No backend — all data lives on-device
and mirrors to your own Google Drive.

Build progress and session handoff notes are in [`PROGRESS.md`](PROGRESS.md). Operational how-tos —
sync troubleshooting, rotating the OAuth client, regenerating geo data, deploying — are in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Running it

```sh
cd atlas
npm install
npm run dev
```

Open the printed `localhost` URL. This is a mobile-first app — resize your browser to phone width
(390×844 or narrower) to see it as intended.

```sh
npm run build    # production build, output in atlas/dist
npm run preview  # serve the production build locally
npm run lint     # ESLint
npm test         # Vitest
```

Requires Node 20+ (the PWA build tooling doesn't run on Node 18).

Google Drive sync needs `VITE_GOOGLE_CLIENT_ID` — copy `atlas/.env.example` to `atlas/.env.local`
and fill in a client ID (`docs/OPERATIONS.md` §2). Without it the app still runs; sync is simply
unavailable and says so in the UI.

## Deploying

Pushes to `main` build and deploy to GitHub Pages automatically via
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml); Vite's `base` is derived from the
repo name at build time, nothing to hand-configure. One-time setup for a new repo:

1. Create the GitHub repo and push this project to it.
2. **Settings → Pages → Source: GitHub Actions.**
3. **Settings → Secrets and variables → Actions → Variables** — add `VITE_GOOGLE_CLIENT_ID` (the
   same value as `.env.local`; it's a repository **variable**, not a secret — see plan §9 and
   `docs/OPERATIONS.md` §2).
4. In Google Cloud Console, add `https://<your-github-username>.github.io` (origin only — no path,
   no trailing slash) as an Authorized JavaScript origin.

Full runbook — including what to check when a deploy or a sync fails — is in
[`docs/OPERATIONS.md`](docs/OPERATIONS.md).

## Installing on Android

1. Open the deployed URL in **Chrome**.
2. Tap the **⋮** menu → **Add to Home screen** (or tap Chrome's own **Install** banner, if it
   offers one).
3. Confirm. Atlas now opens full-screen from the home screen like a native app, and keeps working
   offline after the first load.

## Project layout

- `atlas/` — the app (Vite + React + TypeScript)
- `docs/` — operational runbooks
- `.github/workflows/` — CI and GitHub Pages deployment
