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

## Publish to the CDN (Phase 2 — Cloudflare R2)

After refreshing, publish the versioned data to object storage so web + mobile read it
from the CDN edge instead of Django:

```bash
pip install -r requirements-publish.txt          # one-time (boto3; home only, not on Render)
venv/Scripts/python.exe manage.py publish_game_data --dry-run   # preview the upload plan, no creds
venv/Scripts/python.exe manage.py publish_game_data             # real upload (needs R2 env vars)
```

`publish_game_data` reads `trivia/data/manifest.json` for the version, uploads each pool to
`v/<version>/<key>.json` (immutable, cached forever) and a small `manifest.json` (60 s TTL)
whose `games` map points at the public CDN URLs. Clients read `manifest.json`, see a new
`version`, and fetch the new immutable files — old versions stay cached, so updates are instant
and never stale.

### One-time R2 account setup (you do this once)

1. Create a Cloudflare R2 bucket and an **S3 API token** (Access Key ID + Secret).
2. Attach a **custom domain** to the bucket (required for CDN caching; the `r2.dev` URL is not cached).
3. Set these env vars where you run the publish (home machine / scheduled task):

```
R2_ACCOUNT_ID=...            # Cloudflare account id
R2_BUCKET=nba-minigames
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_PUBLIC_BASE_URL=https://data.yourdomain.com   # the bucket's custom domain
```

The Render web service needs **none** of these.
