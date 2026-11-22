# Weekly Leaderboard Mini App

Displays top tippers for the current week using the analytics oracle.

## Permissions

Declared in `manifest.json`:

- `analytics:read`
- `profile:read`

## Local setup

1. Run the analytics oracle locally (default `http://localhost:4000`) or set `window.LINKORA_ANALYTICS_URL` before loading the app.
2. Serve this directory with a static server, or open `index.html` in the Linkora mini-app shell.
3. The app fetches `/analytics/leaderboard/weekly` and refreshes every 60 seconds.

When no tippers are returned, the UI shows: `No tips yet this week`.
