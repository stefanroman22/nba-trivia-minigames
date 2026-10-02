# Independent game-data publishing

Status: proposed, awaiting owner approval (2026-10-02)

## Goal

Update one game's data and put it live by pressing a manual "Publish game data" button in GitHub,
without redeploying the website or the backend, and without shipping unfinished UI work. Only files
that actually changed are uploaded, and players only re-download the games that changed.

## Why the current setup can't do this

Pool files (`backend/trivia/data/*.json`) are copied into `public/data/` by `scripts/copy-data.mjs`
at frontend build time, so they reach players only through a full website deploy from `main`.
`dev` usually holds unfinished UI work, so promoting just to ship data drags that work along.
Rebuilding the files happens only in `backend/scripts/refresh_nba_data.cmd` on the owner's PC.

Other gaps found while tracing the code:
- `src/utils/pool.ts` uses one global `manifest.version`, so any data change makes every player
  re-download every game, and file URLs carry no version (a stale file can be cached under a new key).
- The R2 publish path (`publish_game_data`) is unused, re-uploads everything, and uses a manifest
  shape the frontend can't read.
- `maintain_questions` re-uploads all ~1,800 question files on every run.

## Hosting decision

| Option | Free allowance | Independent of site deploy | Risk if exceeded | Verdict |
|---|---|---|---|---|
| Separate Vercel project for data only, deployed by CLI | Hobby CDN transfer shared with the site | yes | Vercel emails; Hobby stops at limits | **chosen** |
| Vercel Blob | 10 GB transfer, 10,000 cache-miss reads | yes | Blob blocked for 30 days | rejected: an outage would break five games |
| Supabase Storage (where questions live) | 5 GB cached + 5 GB uncached egress | yes | whole project restricted, database included | rejected for pools: ties game data to database health |

A data-only Vercel project (for example `nba-minigames-data`) is deployed straight from the GitHub
Action with the Vercel CLI, never from git. The website and backend projects are untouched. The CLI
hashes every file and uploads only files Vercel doesn't already have, so unchanged files are never
re-sent. Files are served from the same 19-region Vercel CDN, with compression.

## Per-game feasibility

| Game | Data file | Feasible | Notes |
|---|---|---|---|
| Guess the Series Winner | `playoff.json` (414 KB) | yes | Multiplayer reads the live table, so it may run ahead of single-player until a publish. |
| Name the NBA Club | `name-logo.json` (5 KB) | yes | Rarely changes. |
| Guess the MVP | `mvps.json` (15 KB) | yes | Autocomplete comes from the backend `/trivia/all-players/`, unaffected. |
| Fill in the Starting 5 | `starting-five.json` (286 KB) | yes | Verify the builder applies the same 2G/2F/1C and name filters as the backend endpoint. |
| Fan Favorites | `fan-favorites.json` (46 KB) | yes | Also needs `all-players.json`. The builder re-ranks boards with 500+ guesses (a DB write); keep it. |
| (shared) all players | `all-players.json` (86 KB) | yes | Used by Fan Favorites autocomplete. |
| Career Path, Who Are Ya, Tic-Tac-Toe, LeContexto | Supabase Storage snapshots | already independent | Keep on Supabase. Make the existing workflow manual-only; optional phase 5 stops re-uploading unchanged files. |
| NBA Wordle | none | not applicable | Must stay live: one word per day and a once-per-day play check. A public file would leak future words. |
| Hidden games, `players-index.json` (4.1 MB) | | excluded | Not published until those games return; no live game reads them. |

## Design

**Content-addressed files.** Each pool is published as `pools/<key>.<sha12>.json` with
`Cache-Control: public, max-age=31536000, immutable`. Same content means the same name, so an
unchanged game is never uploaded or re-downloaded.

**Manifest v2** at `pools/manifest.json` (`max-age=60`), written last:
```json
{"schema": 2, "version": "2026-10-02.1", "published_at": "...",
 "games": {"mvps": {"file": "mvps.3f9a1c2b7e04.json", "sha256": "...", "count": 71, "bytes": 14769}}}
```
`pools/manifest-history.json` keeps the last 5 manifests for rollback.

**Each deploy is a full snapshot** containing the current files plus the files referenced by the
previous 3 manifests, so a player holding a manifest that is up to 60 seconds old never gets a 404.

**Players re-download only what changed.** `pool.ts` reads manifest v2, keys browser storage by
`pool:<key>:<sha256>`, and fetches the URL from the manifest. If the data site or manifest fails,
it falls back to the bundled `/data/<key>.json` from the last website build, so a data outage
never breaks a game.

## Phases

**0. Owner setup** (needs the owner's account; free on the Hobby plan, confirm before creating)
- Create an empty Vercel project for data in the existing team.
- Create a Vercel token and add GitHub secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_DATA_PROJECT_ID`.
  (`DATABASE_URL` and `DJANGO_SECRET_KEY` already exist.)

**1. Publish command** `python manage.py publish_pools [--games mvps,playoff] [--dry-run]`
- Builds the selected live pools (default: all six) from the database with the existing builders
  and validates them with `validate_pool`. A failing pool stops the run; nothing is published.
- Hashes each file, fetches the live `pools/manifest.json`, and lists changed, unchanged and new games.
- No changes: prints "nothing to publish" and exits 0 so the workflow skips the deploy.
- Writes the deploy folder: changed files, previous files still referenced, `manifest.json`,
  `manifest-history.json`, and a `vercel.json` with cache and CORS headers
  (`Access-Control-Allow-Origin` limited to the site's origins).
- Never calls the NBA website, so it runs on GitHub's servers.
- Tests: hashing, diff against a fake live manifest, folder contents, "nothing changed" exit, a
  failing pool aborting the run.

**2. Workflow** `.github/workflows/publish-game-data.yml`, `workflow_dispatch` only
- Inputs: `games` (empty = all), `dry_run` (default true on the first runs).
- Steps: checkout, Python, `publish_pools`, then `vercel deploy --prod` of the folder with no build
  step, then verify: fetch the live manifest and every changed file, compare SHA-256, fail loudly on
  mismatch.
- Job summary lists each game as changed/unchanged with its size.
- Concurrency group so two publishes never overlap.

**3. Frontend switch** (ships once through the normal dev → main promote)
- `pool.ts` reads manifest v2 with per-game hashes and the bundled `/data` fallback.
- `.env.production`: `VITE_DATA_BASE=https://<data-project>.vercel.app/pools`.
- Tests for: one changed game re-downloading only that game, data-site failure falling back to
  bundled files, a corrupt cache entry.
- Browser QA on all five pool games.

**4. Retire the old route**
- `refresh_nba_data.cmd` keeps `sync_nba_data` (needs a home IP), then runs
  `gh workflow run publish-game-data.yml` instead of committing pools and running `vercel deploy`.
- Bundled `/data` stays as the fallback, refreshed whenever the site deploys anyway.
- Delete or archive the unused R2 publish path.
- `docs/DEPLOYMENT.md`, `docs/team/DECISIONS.md` and the memory note updated.

**5. Optional: question games**
- Remove the daily cron from `maintain-questions.yml` so it runs only on demand (owner request 2026-10-01).
- Stop re-uploading unchanged question files: content-address them the same way.

## Owner workflow afterwards

1. Data changes in a table (owner edit, a script, or the PC's NBA sync).
2. GitHub, Actions tab: **Publish game data**, choose games or leave empty, **Run workflow**.
3. About a minute later the changed games are live. Unchanged games are not touched, and the
   website, backend and any in-progress UI work stay exactly as they were.

## Risks

- **Free-tier transfer is shared with the website.** Today's pools total about 850 KB uncompressed
  per first-time player, and much less compressed and cached. Watch usage in Vercel after launch.
- **Single-player can lag multiplayer** for series, logos, MVPs, Starting 5 and Fan Favorites until a
  publish, because multiplayer reads the tables live. Acceptable; publishing closes the gap.
- **Rollback** republishes a previous manifest from `manifest-history.json`. Never use
  `vercel rollback` on the data project: it pins the domain (see the deploy-topology note).
