# NBA Data Pipeline

How game data is gathered, stored, kept fresh, and served. One **central store**
in Supabase feeds every game (current and future); games never own their own data.

## The store (Supabase Postgres)

`backend/trivia/models.py` — one normalized schema, queried by all games:

| Table | Feeds | Notes |
|---|---|---|
| `Team` | Name→Logo | 30 franchises |
| `Player` | Wordle, All-Players | ~5,100 all-time, from the **live** roster endpoint (fresh after drafts/trades) |
| `PlayoffSeries` | Series-Winner | **full history 1946-47 → present** (912+ series) |
| `Mvp` | Guess-the-MVP | 1955-56 → present (from `utils/nba_mvps.csv`) |
| `StartingFiveGame` | Starting-Five | game + winning team's starters |
| `SyncRun` | — | audit log of every sync (dataset, status, rows, error) |

**Adding a new game later:** add a table (or query existing ones) and a view —
the store is the shared "big data" the brief asked for.

## How it's gathered — `manage.py sync_nba_data`

`backend/trivia/data_pipeline/sources.py` + the command. For each dataset it
**fetches → validates → upserts**, and is built to be autonomous and safe:

- **Retry/backoff** on every NBA-API call (`--timeout` per call).
- **Validation** before the DB is touched (shape, ranges, minimum counts).
- **Non-destructive upsert** — only valid rows are written, and writes are
  upserts, so a bad/partial/throttled fetch can never overwrite or wipe good
  data. Worst case: the previous good data stays. Every run logs a `SyncRun`.
- **Players** come from the live `CommonAllPlayers` endpoint (current rosters),
  not the stale bundled list.
- **Playoff series** are derived by grouping the playoff **game log** into
  team-vs-team matchups, which captures best-of-3/5/7 across every era.

```bash
# Full historical backfill (one-time; playoffs back to 1946-47):
python manage.py sync_nba_data --full
# Routine refresh (what the schedule runs): players + last 2 seasons + teams + mvps
python manage.py sync_nba_data --max-games 20 --timeout 20
# Fill specific gap seasons (e.g. if some timed out):
python manage.py sync_nba_data --datasets playoff --season-list 1994-95,1995-96 --timeout 30
```

## ⚠️ Must run from a residential IP

`stats.nba.com` **blocks data-center IPs** (verified: GitHub Actions / Vercel /
Railway all time out). So the *fetch* cannot run in the cloud — only the storing
target (Supabase) and serving (Vercel) are cloud. The fetch runs on a home machine.

## How it's served (two paths, both fed by the store)

- **Single-player** reads static `/data/*.json` pools from the Vercel CDN (cheap,
  scales). `manage.py build_pools_from_db` regenerates those pools from the DB.
- **Multiplayer + direct API** hit the Django `/trivia/*` endpoints, which query
  Supabase live (always fresh). Each endpoint falls back to the bundled pool file
  if the DB is ever empty/unreachable, so players never get an error.

## The schedule (autonomous)

Windows Task **"NBA Data Refresh"** runs `backend/scripts/refresh_nba_data.ps1`
monthly (1st, 04:00). It: sync → regenerate pools → commit/push to `dev`
(CI promotes to `main`) → `vercel deploy` to publish the pools.

`DATABASE_URL` is read from the gitignored `backend/.env` (no secret in the repo).

```powershell
# Run it on demand:
powershell -ExecutionPolicy Bypass -File backend\scripts\refresh_nba_data.ps1
# Inspect / change / remove the schedule:
schtasks /Query  /TN "NBA Data Refresh" /V /FO LIST
schtasks /Change /TN "NBA Data Refresh" /SC WEEKLY /D MON     # e.g. weekly instead
schtasks /Delete /TN "NBA Data Refresh" /F
```

## Monitoring

- `backend/scripts/last_refresh.log` — transcript of the latest run.
- `SyncRun` table — one row per dataset per run (status/rows/error). The task
  only requires the PC to be on at run time (Task Scheduler runs a missed job at
  next logon). For pure-cloud scheduling you'd need a residential proxy (paid).
