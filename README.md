# Atlas — Travel Tracker

A personal travel tracker that runs as an installable web app on the phone. It records which
countries, subdivisions and cities you've visited, lived in, passed through or want to visit, shows
a world map coloured by status, and groups visits into trips. No backend — all data lives on-device
and mirrors to your own Google Drive.

The full design is in [`travelingSalesmanClaudeInputs/00-PLAN.md`](../travelingSalesmanClaudeInputs/00-PLAN.md).
Build progress and session handoff notes are in [`PROGRESS.md`](PROGRESS.md).

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
```

Requires Node 20+ (the PWA build tooling doesn't run on Node 18).

## Project layout

- `atlas/` — the app (Vite + React + TypeScript)
- `travelingSalesmanClaudeInputs/` — the design plan and per-phase build prompts
