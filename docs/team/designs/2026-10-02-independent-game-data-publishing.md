# Independent game-data publishing

Status: approved; phases 1-3 live, phase 5 (safety nets) built on `feat/game-data-safety-nets`,
phase 6 (question games) built on `feat/game-data-questions` (2026-10-02), not yet switched on.
Revised 2026-10-02 to fix every weak point found in review.

## Goal

1. Update one game's data and put it live with a manual "Publish game data" button in GitHub,
   without redeploying the website or the backend, and without shipping unfinished UI work.
2. Upload only files that changed; players re-download only what changed.
3. Single-player and multiplayer read the same published data.
4. One publishing system for every file-based game, with small payloads and no fields lost.

## Why the current setup can't do this

- Pool files (`backend/trivia/data/*.json`) reach players only through a full website deploy from
  `main` (`scripts/copy-data.mjs` copies them into `public/data/` at build time). `dev` usually holds
  unfinished UI work, so promoting just to ship data drags that work along.
- Rebuilding the files happens only in `backend/scripts/refresh_nba_data.cmd` on the owner's PC.
- `src/utils/pool.ts` uses one global `manifest.version`, so any change re-downloads every game, and
  file URLs carry no version (a stale file can be cached under a new key).
- Multiplayer reads different sources: Series, Club, MVP, Starting 5 and Fan Favorites come from live
  backend endpoints (DB), while single-player reads the files. The two can disagree.
- Two publishing systems exist: pool files (above) and question snapshots (`maintain_questions` to
  Supabase Storage), each with its own manifest format. `maintain_questions` re-uploads all ~1,800
  files every run. The R2 path (`publish_game_data`) is unused.
- Whole pools are downloaded to play a few rounds: `playoff.json` is 414 KB for a 5-round game.

## Weak points from review, and how this plan fixes each

| # | Weak point | Fix in this plan |
|---|---|---|
| 1 | Vercel Hobby is for non-commercial use | The publisher is **host-agnostic**: it writes a folder of files plus a manifest, and a small "target" step uploads it. Two targets: Vercel data project (default, free today) and Cloudflare R2 (zero egress fees, commercial use allowed). Switching host = changing one secret and one env var, no code change. Moving to R2 needs an owner decision (Cloudflare account, possibly a payment method on file, and a custom domain, since `r2.dev` URLs are rate-limited and not meant for production). |
| 2 | Free transfer is shared with the website | Payloads shrink about 10x or more (#3), files are immutable and cached for a year, and a weekly read-only workflow reports bytes served against the free allowance and alerts on Slack at 50% and 80%. |
| 3 | Files are bigger than needed | **Chunked, de-duplicated, lossless files** (see "Payload design"). A game downloads one small chunk, not the whole pool. Every field the game uses today is still present. |
| 4 | Two publishing systems | **One publisher and one manifest format** for pool games and question games, on the same host. Question games move off Supabase Storage, which also removes the Supabase egress limit as a risk to the database. |
| 5 | Manual publishing is easy to forget | (a) The PC's NBA sync triggers the publish workflow automatically. (b) A daily read-only "freshness check" compares the tables' content hashes with the published manifest and posts on Slack when a game's table changed but wasn't published, naming the game and the button to press. |
| 6 | Single-player can disagree with multiplayer | **Multiplayer reads the same published files** through the same manifest. The multiplayer server already does this for the four question games (`multiplayer_server/src/questions.js`); the five pool games move to the same loader. The backend game endpoints stay only as a last-resort fallback. |

## Hosting

| Option | Free allowance | Independent of site deploy | If exceeded | Role |
|---|---|---|---|---|
| Separate Vercel project for data, deployed by CLI | Hobby CDN transfer, shared with the site | yes | Vercel emails; Hobby stops at limits | **default target** |
| Cloudflare R2 + custom domain | 10 GB storage, 1M writes, 10M reads; egress free | yes | billed per use (check before switching) | **second target**, for commercial use or growth |
| Vercel Blob | 10 GB transfer, 10,000 cache-miss reads | yes | Blob blocked for 30 days | rejected |
| Supabase Storage | 5 GB cached + 5 GB uncached egress | yes | whole project restricted, database included | rejected; question games move off it |

The Vercel target deploys the folder with the Vercel CLI straight from GitHub, never from git. The CLI
uploads only files Vercel doesn't already have. The R2 target uploads only keys not already present
(content-addressed names make that a simple existence check).

## Per-game feasibility

| Game | Published data | Feasible | Notes |
|---|---|---|---|
| Guess the Series Winner | playoff series | yes | Chunked. Multiplayer switches from `/trivia/playoff-series/` to the files. |
| Name the NBA Club | teams | yes | 30 rows, single small file. |
| Guess the MVP | MVPs by season | yes | 71 rows, single small file. Autocomplete keeps using the backend player list. |
| Fill in the Starting 5 | games and lineups | yes | Chunked. The builder must apply the same 2G/2F/1C and name filters as the backend endpoint (verify with a test). |
| Fan Favorites | boards | yes | One file per board. Live re-ranking (500+ guesses) runs at publish time, so both modes see the same counts. |
| (shared) all players | names for autocomplete | yes | Names only. |
| Career Path, Who Are Ya, Tic-Tac-Toe, LeContexto | questions | yes | Move from Supabase Storage to the same publisher; already one file per question. |
| NBA Wordle | none | stays live | One word per day plus a once-per-day check; a public file would leak future words. |
| Hidden games, `players-index.json` (4.1 MB) | | excluded | Not published until those games return. |

## Payload design (lossless)

- **Content-addressed, immutable files.** `<game>/<name>.<sha12>.json`,
  `Cache-Control: public, max-age=31536000, immutable`. Same content gives the same name, so unchanged
  data is never uploaded or re-downloaded.
- **Chunks.** Large pools are split into chunks of about 50 rounds (Series: about 18 chunks of
  ~23 KB instead of 414 KB). A game picks a random chunk, plus a second one if it needs more rounds.
  Chunks are reshuffled at publish so each one mixes eras.
- **Shared lookups instead of repetition.** Rows that repeat the same team name, abbreviation and
  logo URL store a team id, and each game publishes one `teams` lookup. The client rebuilds the exact
  original row shape before the game sees it, so renderers don't change and no field is lost.
- **Compact JSON plus compression.** Files are written without whitespace and served compressed
  by the CDN.
- **Losslessness is tested.** For every game, a test rebuilds the full original rows from the
  published chunks and lookups and asserts they equal what the builder produced, field for field.

## Manifest v3 (one format for all games)

`manifest.json`, `Cache-Control: max-age=60`, written last:
```json
{"schema": 3, "version": "2026-10-02.1", "published_at": "...",
 "games": {
   "playoff": {"kind": "chunked", "rows": 912, "lookups": {"teams": "playoff/teams.1a2b3c4d5e6f.json"},
               "chunks": ["playoff/c00.9f8e7d6c5b4a.json", "..."]},
   "mvps": {"kind": "single", "rows": 71, "file": "mvps/all.3f9a1c2b7e04.json"},
   "career-path": {"kind": "questions", "rows": 500, "index": "career-path/index.0a1b2c3d4e5f.json"}},
 "names": "shared/players-names.5e6f7a8b9c0d.json",
 "question_names": "shared/question-names.7a8b9c0d1e2f.json"}
```
A question index is `{"schema": 1, "game", "dataset", "items": [[qid, ...]], "files": {qid: sha12}}`;
each question is `<game>/<qid>.<sha12>.json`.
`manifest-history.json` keeps the last 5 manifests for rollback. Each deploy also keeps the files
referenced by the previous 3 manifests, so a player holding a manifest up to 60 seconds old never
hits a missing file.

## Phases

**0. Owner setup** (owner's accounts; free today, confirm before creating anything)
- Create an empty Vercel project for data in the existing team, and a Vercel token.
- GitHub secrets: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_DATA_PROJECT_ID`
  (`DATABASE_URL`, `DJANGO_SECRET_KEY`, `SLACK_BOT_TOKEN` already exist).
- Later, only if moving to R2: Cloudflare account, bucket, custom domain, R2 token.

**1. Publisher** `python manage.py publish_game_data_v3 [--games ...] [--dry-run]`
(new command; the unused R2 command is removed in phase 6)
- Builds each selected game's rows from the database with the existing builders and question
  generators, validates them, and stops on any failure with nothing published.
- Splits, de-duplicates and hashes the files (payload design above), diffs against the live
  manifest, and exits 0 with "nothing to publish" when nothing changed.
- Writes the deploy folder: changed files, files still referenced by recent manifests, manifest,
  history, and host config (cache and CORS headers, CORS limited to the site's origins).
- Never calls the NBA website.
- Tests: chunking and lookups round-trip losslessly for every game, diff detection, "nothing
  changed", a failing game aborting the run, manifest-history trimming.

**2. Publish workflow** `.github/workflows/publish-game-data.yml`, manual only
- Inputs: `games` (empty = all), `target` (vercel or r2), `dry_run` (default true until launch).
- Runs the publisher, uploads with the chosen target, then verifies: fetches the live manifest and
  every changed file and compares SHA-256. Fails loudly on mismatch.
- Job summary: each game as changed or unchanged, with bytes.
- Concurrency group so two publishes never overlap.

**3. Shared client loader**, used by both the website and the multiplayer server
- One small TypeScript module (`src/utils/gameData.ts`) plus a Node twin in `multiplayer_server`
  (or one shared file) that: reads manifest v3 (60-second cache), fetches a random chunk or a single
  file or a question, rebuilds full rows from the lookups, and caches by content hash.
- The website (`pool.ts`, `questions.ts`) and the multiplayer server (`gameEndpoints.js`,
  `questions.js`, `turnGames.js`) all switch to it. Multiplayer then uses exactly the same data as
  single-player.
- Fallbacks: the website falls back to the bundled `/data` copy; the multiplayer server falls back
  to the backend endpoints. Both log when they do.
- Tests: one changed game re-downloads only that game, lookups rebuild rows exactly, data-site
  failure falls back, corrupt cache entry, a stale manifest during a publish.

**4. Ship the switch** (once, through the normal dev → main promote, plus `railway up` for the
multiplayer server)
- `.env.production`: `VITE_DATA_BASE=https://<data-host>/`.
- Browser QA of all nine file-based games in single-player, plus multiplayer QA of one pool game and
  one question game with two clients.

**5. Freshness and monitoring**
- [x] `refresh_nba_data.cmd` (+ `.ps1`): keep `sync_nba_data` (needs a home IP) and
  `upload_dataset`, then `gh workflow run publish-game-data.yml` instead of committing pools and
  running `vercel deploy`. Logs an error and exits non-zero when `gh` is missing or logged out.
- [x] Daily read-only freshness check (`game-data-freshness.yml`, 06:30 UTC):
  `publish_game_data_v3 --check-only` builds the rows without DB writes (the Fan Favorites
  re-rank is applied in memory only), diffs them with the live manifest, and posts one Slack
  message to `#agent-backend` naming any unpublished game. Unreachable manifest = "unknown",
  no message.
- [~] Weekly usage report (`game-data-usage.yml`, Mondays 07:00 UTC): reports the live version,
  published bytes (raw and gzip'd) and data deployments this week, plus a link to the Vercel
  usage dashboard. **Bytes served vs. the allowance and the 50%/80% alerts are not possible on
  Hobby**: the only usage API (`GET /v1/billing/charges`) needs the `billing` scope, which is
  Pro/Enterprise only
  (https://vercel.com/docs/integrations/create-integration/vercel-api-integrations#scopes).
  Vercel's own limit emails remain the bandwidth alert.

**6. Retire the old routes** (built on `feat/game-data-questions`, 2026-10-02)
- [x] `publish_v3` gets `kind: "questions"` for career-path, who-are-ya, tictactoe, contexto:
  a content-addressed index (the snapshot `index.json` minus `version`, plus `files` =
  qid -> sha12) and one content-addressed file per question holding the snapshot's exact bytes.
  The question games' NamesEntry list is the top-level `question_names` file, kept separate from
  `names` (all dataset names as strings for Fan Favorites / Starting 5; `question_names` is the
  playable pool with ids, aliases and bio facts). Tests: byte-for-byte equal to
  `write_snapshot`, stable per-question URLs, unchanged detection, carry-over, check-only
  zero writes (`trivia/tests/test_publish_v3_questions.py`).
- [x] Question maintenance is a step of the publish: `publish_game_data_v3` runs
  `runner.maintain` (re-materialize, retire, top up, minimum gate) and builds every game in one
  transaction (a failed gate or build rolls it back, nothing written); `--skip-maintain`
  publishes the current rows read-only; workflow dry runs pass `--no-commit`. The dataset is
  the committed `players_curated.json` (sha256 identical to the Storage dataset on 2026-10-02).
  `--check-only` covers the question games read-only (no maintenance).
- [x] Site (`questions.ts`) and relay (`questions.js`, used by `turnGames.js` and `index.js`)
  read a question game through the shared loader (`gameData.ts` / `gameData.js`: index ->
  picker -> question file; pickers moved there) when the v3 manifest has it, else the Supabase
  store, logged once per game. Hidden superdraft/imposter stay on the store.
- [x] `maintain-questions.yml` is manual only (schedule removed, header note), kept for the
  hidden games and to refresh the fallback snapshot. Not deleted: the hidden games still read it.
- [x] Unused R2 path removed: `manage.py publish_game_data` and `build_publish_plan`.
  `data_pipeline/publish.py` keeps `upload_plan` (used by `maintain_questions` and
  `upload_dataset`). The schema-1 questions manifest stays until the retirement below; the
  bundled `/data` manifest stays as the website's fallback.
- [x] `docs/DEPLOYMENT.md`, `docs/team/DECISIONS.md` updated. The deploy-topology memory note is
  the owner's local file (update it after the switch).
- [ ] Switch on (owner): see "Switching the question games on" below.
- [ ] Retire the Supabase questions store 30 days after the switch: see below.

**Switching the question games on** (no code or site deploy needed; the code falls back until
the manifest has the games)
1. Merge `feat/game-data-questions` to `dev`, promote to `main` (the workflow runs from `main`),
   and `railway up` the relay (its `DATA_PUBLIC_BASE` must be the data host).
2. Actions → **Publish game data**, `games` = `career-path,who-are-ya,tictactoe,contexto`,
   `target` vercel, `dry_run` ticked. Check the summary (4 games + `question-names` "new",
   ~800 files) and the artifact; the DB writes were rolled back.
3. Run it again with `dry_run` unticked. The verify step checks every new file's SHA-256.
4. Check: `curl -s https://nba-minigames-data.vercel.app/manifest.json` lists the four games
   with `"kind":"questions"` and a `question_names`; play each game on the site (DevTools
   Network shows `nba-minigames-data.vercel.app/<game>/<qid>.<sha12>.json`, no `supabase.co`
   question request); one online career-path and one tic-tac-toe room. Today's contexto secret
   is unchanged (same `trivia_question` rows as the snapshot).
5. Next morning the freshness check should say fresh.

**Retiring the Supabase questions store** (owner runs or approves; 30 days after the switch;
nothing here deletes anything until then)
1. Confirm the switch held: relay logs have no `[questions] ... using the questions store` lines
   for the four games, and the freshness check has been fresh.
2. Decide the hidden games: publish superdraft/imposter through v3 too (add them to
   `publish_v3.QUESTION_GAMES` and to `QUESTION_GAMES` in `gameData.ts`, `PUBLISHED_GAMES` in
   `questions.js`; their payloads already work), or accept they stop working while hidden. The
   store cannot be emptied while they read it.
3. Remove the fallback code in one PR: the store branch of `src/utils/questions.ts` and
   `multiplayer_server/src/questions.js`, `VITE_QUESTIONS_BASE` (`.env*`, `next.config.ts`),
   `QUESTIONS_PUBLIC_BASE` (relay env, `.env.example`s), `manage.py maintain_questions`,
   `upload_dataset`, `trivia/questions/storage.py` + `upload.py` + the snapshot writer,
   `data_pipeline/publish.py`, `requirements-publish.txt`, `maintain-questions.yml`, the
   `upload_dataset` step of `refresh_nba_data.cmd`. Ship it (site + `railway up`).
4. Empty the bucket (bucket `questions`, project `roscfxiuxsbrymdtqmth`): Supabase dashboard →
   Storage → `questions` → delete the folders `questions/` (schema-1 manifest + `v/<version>/`
   snapshots) and `datasets/` (players dataset), or with the S3 keys:
   `aws s3 rm s3://$SUPABASE_STORAGE_BUCKET/questions/ --recursive --endpoint-url $SUPABASE_S3_ENDPOINT --region $SUPABASE_S3_REGION`
   and the same for `datasets/`. Then delete the bucket.
5. Revoke the Supabase S3 access key, delete the `SUPABASE_S3_*` / `SUPABASE_STORAGE_BUCKET` /
   `QUESTIONS_PUBLIC_BASE` GitHub secrets and env vars, and update `docs/CREDENTIALS.md`.

## Owner workflow afterwards

1. Data changes in a table (an edit, a script, or the PC's NBA sync, which publishes automatically).
2. If it wasn't automatic: GitHub, Actions tab, **Publish game data**, choose games or leave empty,
   **Run workflow**. If you forget, the daily freshness check tells you on Slack.
3. About a minute later the changed games are live in single-player and multiplayer. Nothing else
   is touched.

## Remaining risks

- **Bigger scope.** Phases 3 and 6 touch every file-based game and the multiplayer server, so they
  need the full browser and two-client QA listed above. Ship pool games first and question games
  second, behind the same loader, so each half can be checked alone.
- **Moving to R2 is an owner money decision**, if it ever happens; the code supports it from day one.
- **Rollback** republishes a previous manifest from `manifest-history.json`. Never use
  `vercel rollback` on the data project: it pins the domain (see the deploy-topology note).
