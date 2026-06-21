# Game data pipeline

All game data is built by one command and published as versioned JSON. The cloud
(Render) NEVER calls the NBA API — `stats.nba.com` blocks data-center IPs.

## Refresh the data (run at home, weekly)

```bash
cd backend
venv/Scripts/python.exe manage.py refresh_game_data                 # live: fetches via nba_api
venv/Scripts/python.exe manage.py refresh_game_data --skip-live     # offline: reuse existing playoff/starting_five
venv/Scripts/python.exe manage.py refresh_game_data --label 2026-07-01   # custom version label
```

This writes `trivia/data/<key>.json` for `playoff`, `starting-five`, `name-logo`,
`all-players`, `wordle`, `mvps`, plus `trivia/data/manifest.json` (version + per-file
SHA-256 + counts). Validation runs first; a malformed pool aborts the write.

Then commit & push `backend/trivia/data/` to publish.

## Endpoints (foundation for CDN + client-side randomization)

The trivia app is mounted at `/trivia/`:

- `GET /trivia/manifest/` — current version + per-pool hash/count.
- `GET /trivia/pool/<game>/` — the whole pool for a game (client caches it and randomizes locally).

The existing per-game random endpoints (`/trivia/playoff-series/`, `/trivia/wordle/`, etc.)
are unchanged.

## Schedule it (Windows Task Scheduler)

Create a weekly task: Program `powershell.exe`, Arguments
`-NoProfile -ExecutionPolicy Bypass -File "C:\path\to\nba-minigames\backend\scripts\refresh_game_data.ps1"`.
Because the data is historical, weekly (or even monthly off-season) is plenty.
