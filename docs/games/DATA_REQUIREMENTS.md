# Other Game Data — Extensive Data Fields

Companion to [PLAYERS_DATA.md](PLAYERS_DATA.md) and
[TEAMS_DATA.md](TEAMS_DATA.md): the data that belongs to neither players nor
teams but that the games in [MASTER_PLAN.md](MASTER_PLAN.md) need. Storage details in
the master plan §7 (everything is Django models in the existing Supabase Postgres — no new stack).

## Question / puzzle bank (`trivia_question`)
One generic table, `payload` JSONB per type — avoids one-table-per-game sprawl.
- **Survey boards** (Fan Favorites / Brickless) — prompt, ≥6 ranked answers with fan-counts,
  aliases per answer, survey date (answers reflect sentiment at that time)
- **Connections boards** — 16 players, 4 groups with labels + difficulty tier; must pass the
  exactly-one-solution validator before status=published
- **Heatmap boards** — hex layout (positions + criterion per hex); must pass the
  hex+neighbours solvability validator
- **Top-10 lists** — title, ranked entries with values, source/cutoff date, tie rule
- **Emoji riddles** — answer entity, ordered emoji sequence (3–6), aliases
- **Timeline events** — title, exact date, category (draft/trade/record/title), thumbnail
- **Who Would Win matchups** — two entities + era, optional sim inputs
- **MCQ quizzes** — question, 4 options, correct index, difficulty, topic tag

## Daily puzzles (`trivia_dailypuzzle`)
- game id, date, puzzle number (#001…), question FK or inline payload
- one shared instance per game per day — everyone plays the same board (comparability = retention)

## Guess log (`trivia_guesslog`) — the data flywheel
- user/anon id, game, question, normalized answer, correct?, elapsed ms, created_at
- Feeds: rarity % (NBA Grid), survey standings auto-transition (Fan Favorites → live data at ~500
  samples, no manual step), community splits (Blind Rank / Who Would Win), difficulty tuning

## Game sessions (`trivia_gamesession`)
- user, game, mode (single/multi/friend), score, started_at, finished_at, duration_ms
- Powers: the always-visible session timer requirement, time tiebreaks, profile "time played",
  streaks and daily-completion checkmarks

## Derived artifacts (computed, not collected — rebuilt by `build_pools_from_db`)
- **Player-category truth index** — player → {franchises, awards, stat feats, draft facts, college,
  country}; validates answers in Heatmap, Grid, Tic-Tac-Toe, Bingo, Possession Play
- **Teammate graph** — player pairs with overlapping team-season stints (+ BFS shortest path) for
  Teammate Chain and "played with X" criteria
- **Similarity vectors** — franchise/era/position/draft/stats/awards embedding for LeContexto ranks
- **Per-cell valid-answer counts** — grid generator guarantee (≥3 valid answers per cell) + rarity

## External / editorial sources
- Salaries: HoopsHype/Spotrac-style CSV, refreshed monthly (Higher/Lower)
- Social followers: optional, monthly refresh (Higher/Lower fun category)
- Historical/defunct logos: one-time manual curation (~40 files) for Pixel Reveal / Guess the Franchise
- Arena photos: rights-cleared only; missing photo ⇒ that question type is skipped (safe fallback)
- Survey seeds: editorial at launch via Django admin, replaced automatically by guess-log data

## Validation rules (blocking, run at authoring/sync time)
1. Connections: exactly one valid grouping; no orphan tiles.
2. Heatmap: every hex solvable given its neighbours; regenerate otherwise.
3. Grid/Tic-Tac-Toe: every intersection has ≥3 (grid) / ≥1 (TTT) valid players.
4. Survey questions: ≥6 answers, every answer alias-mapped.
5. Any question referencing a missing asset (photo/logo) is auto-unpublished.

## Implemented data layout (as of 2026-07-06)

The 12 built games are **seed-driven**, not live-API-driven (stats.nba.com times out from prod, so
runtime nba_api calls are avoided). Everything ships as validated static JSON:

- **`backend/trivia/data_static/players_curated.json`** — the 159-player master dataset (real
  `person_id`, fame tier, team stints, awards, draft, physicals, aliases). Published as the
  **`players-index`** pool that Career Path, Who Are Ya, LeContexto, Pack 5, SuperDraft and Imposter
  read via `fetchWholePool("players-index")`.
- **`backend/trivia/data_static/<game>_seed.json`** — per-game seeds (Connections boards, Heatmap hex
  boards, NBA Grid / Tic-Tac-Toe criteria configs, Bingo cards, Who Would Win matchups, Imposter
  mystery pool, SuperDraft objectives). Each game module `backend/trivia/games/<game>.py` exposes
  `build_pool()` + `validate_rows()`; the criteria games validate answers **client-side** against
  `players-index` using `src/utils/criteria.ts` (`playerMatches`) + `src/utils/answerMatch.ts`.

### Data-update runbook

1. Edit the relevant seed in `backend/trivia/data_static/` (or `players_curated.json` for player facts).
2. Run that game's validator script under `backend/trivia/games/*_validate.py` (and
   `curated_validate.py` for the dataset) — fix any flagged rows.
3. `cd backend && DATABASE_URL="" python manage.py build_pools_from_db` — regenerates every
   `backend/trivia/data/<slug>.json` pool + bumps `manifest.json` (empty DB-backed pools are skipped,
   keeping their committed files).
4. Commit `backend/trivia/data/` — the `scripts/copy-data.mjs` step (runs on `dev`/`build`) ships them
   to `public/data/` and the CDN.
5. **Expanding beyond the curated 159** (documented follow-up): run `manage.py sync_nba_data` from a
   residential IP to backfill `trivia_player`/stints from nba_api, then extend the curated authoring
   step — the game modules already read whatever `players-index` contains.
