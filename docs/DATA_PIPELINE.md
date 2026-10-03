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

The fetch needs the pipeline dependency set: `pip install -r
backend/requirements-pipeline.txt` (pandas + nba_api on top of `requirements.txt`; the web function
on Vercel installs only `requirements.txt`).

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

**Starting-Five is filtered on the way out** (`data_pipeline/starting_five.py`).
The board is a fixed 2-guard/2-forward/1-center layout, but the box-score feed
regularly reports three guards or no center — those lineups have no winning
assignment, so `playable_lineups()` drops them — and it spells some players
differently from the autocomplete list, so `canonical_lineup_names()` pulls
those to the `all-players` spelling. Both run in `build_pools_from_db`,
`refresh_game_data` and the `/trivia/starting-five/` view, so a re-synced feed
is re-cleaned automatically; the store keeps the raw rows either way.

## The schedule (autonomous)

Windows Task **"NBA Data Refresh"** runs `backend/scripts/refresh_nba_data.cmd`
monthly (1st, 04:00). It: sync → `upload_dataset` → `gh workflow run
publish-game-data.yml` (the "Publish game data" workflow builds the files from the DB,
runs the question maintenance for the four public question games, and uploads only what
changed to the data host; nothing is committed and the website is not redeployed).
`upload_dataset` now only feeds `maintain_questions` (the Supabase snapshot the hidden games
and the fallback read); the publish workflow reads the committed `players_curated.json`. `gh` must be logged in as `stefanroman22`; if it is missing or
logged out the script logs an ERROR line and exits non-zero. (A `.ps1`
equivalent exists too, but the task uses the `.cmd` — more reliable under Task
Scheduler. Verified end-to-end on 2026-06-22.)

`DATABASE_URL` is read from the gitignored `backend/.env` (no secret in the repo).

```powershell
# Run it on demand:
backend\scripts\refresh_nba_data.cmd
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

## Cloudflare R2 (second data-host target)

The old `publish_game_data` command (whole pools to R2 under `v/<version>/`) was removed in
phase 6 of `docs/team/designs/2026-10-02-independent-game-data-publishing.md`: it was never
used. R2 is now a **target** of the manifest-v3 publisher instead: the same deploy folder
`publish_game_data_v3` writes (`_headers.json` carries the per-object cache headers and the
bucket CORS block) is uploaded by the `target: r2` branch of `publish-game-data.yml`, which is
not wired yet. Moving to R2 is an owner decision (Cloudflare account, custom domain; see the
design's hosting table).

## Authoring seed content — quality guidelines

- Source of truth: every player named in a seed must resolve to a `players_curated.json` row by exact
  `full_name` or a listed alias (accent-folded); write the curated spelling (`Nikola Jokić`), never a
  nickname. Team-seasons resolve against `trivia/data/playoff.json`; franchise names against
  `trivia/data/name-logo.json`.
- Only author claims the data can prove: criteria from the shared vocabulary (team/award/country/
  draft/college/stat/era), draft years, birthplaces, colleges, rings + stints for "YYYY <Team>
  champions", award years for "<decade> <award>" groups. No records ("72-10"), no scoring titles, no
  dunk contests, no "greatest" lists unless the group is an explicit opinion prompt.
- Depth floors: tictactoe and nba-grid need at least 3 playable solvers per cell (validator enforces 1
  and 3 respectively — author to 3), bingo at least 4 dealable (fame <= 3) per cell, heatmap at least 2
  per closed neighbourhood (generator + validator), fan-favorites at least 6 answers from a computed
  candidate list.
- Variety over volume: a new board must differ from every existing board in at least 3 of 6 criteria
  (grid/tictactoe) or share at most 10 of 16 cells (bingo); spread franchises, decades and criterion
  types; never reuse a four-member group; one label kind per group on connections boards.
- Seeds are append-only with sequential qids (`ttt-NNN`, `grid-NNN`, `bingo-NNN`, `cn-NNN`,
  `www-NNN`, `ff-NNN`, `hm-board-N`); published pools come only from `build_pools_from_db`; bump the
  count pin in the game's test in the same change.
- Run the game's validator (table in `docs/team/designs/2026-09-30-expand-question-pools.md`
  "Interfaces") before rebuilding; reject and regenerate on any problem line.
- Known limits recorded 2026-09-30: connections' validator skips tiles it cannot resolve (fold-aware
  index + unknown-tile failure is a follow-up); wordle is maxed at 525 under the current rule (+6 with
  generational-suffix stripping); who-are-ya / imposter / contexto grow only by re-tiering players to
  fame tier 1-2 in the generated dataset; contexto's 99 secrets vs `NO_REPEAT_DAYS = 365` will exhaust
  ~99 days after the first run.

## Superseded command (do not use)

`manage.py refresh_game_data` and `backend/scripts/refresh_game_data.ps1` predate `sync_nba_data` /
`build_pools_from_db` and are **not** what the scheduled task runs (see `refresh_nba_data.cmd`/`.ps1`
above). Left in the codebase but undocumented elsewhere; use `sync_nba_data` for anything new.
