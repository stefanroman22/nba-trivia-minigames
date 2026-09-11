# Questions Store + Supabase Storage — Design

**Date:** 2026-09-10
**Status:** approved design, pending implementation plan
**Scope:** the six player-pool games — Career Path, Who Are Ya, Tic-Tac-Toe, Contexto,
SuperDraft Five, NBA Imposter

## 1. Goal

Stop shipping the whole player dataset to every browser that starts one of the six
player-pool games. Instead, pre-generate **questions** (one playable round each), keep
them in a Postgres table that scripts prune and top up over time, publish them as
versioned, immutable, CDN-cached snapshots in Supabase Storage, and have web,
multiplayer server and (later) a mobile app fetch **only the question they are about to
play** plus one small shared name list.

Non-goals for this iteration: AI-authored questions (later phase — the generator
interface is designed so they plug in), per-player editing in the admin panel (edits are
rare; the dataset stays a file), migrating the other eight games off their pool files,
client-side offline mode for mobile.

## 2. Where we start (measured 2026-09-10 on `fix/data-quality-audit`)

- `backend/trivia/data_static/players_curated.json`: 5,208 rows (1:1 with the league
  index); 4,900 are *playable* (≥1 team stint) — `curated_players.playable_rows`.
- Published as `players-index.json`: **4.1 MB raw / 465 KB gzipped**. Five of the six
  games fetch it as their round data on Start (`fetchWholePool("players-index")`,
  `src/utils/GameUtils.tsx:348-588`); Tic-Tac-Toe fetches a seed board and then the
  same pool inside the renderer to validate guesses (`TicTacToe.tsx:138,426`). It is
  cached in memory + `localStorage` keyed by manifest version (`src/utils/pool.ts`) and
  filtered client-side. Four other games (Bingo, Heatmap, NBA Grid, Pack Five) also read it —
  they are out of scope and keep it.
- `all-players.json` is a plain list of 5,208 name strings (86 KB / 30 KB gz) — no ids.
- Multiplayer (Railway, Node) deals rounds by calling Django `get_round` per game
  (`multiplayer_server/src/gameEndpoints.js`); Tic-Tac-Toe and Imposter are
  server-authoritative in `turnGames.js`, which loads the whole `players-index` from
  Django once per process.
- The versioned-publish pattern already exists and is proven:
  `trivia/data_pipeline/publish.py` (immutable `v/<version>/<key>.json`,
  `Cache-Control: public, max-age=31536000, immutable`; `manifest.json` at `max-age=60`,
  written **last**), driven by `manage.py publish_game_data` (R2, boto3). Supabase
  Storage is S3-compatible, so this code is reused unchanged.
- Supabase Postgres is the Django DB (transaction pooler, port 6543). `stats.nba.com`
  blocks datacenter IPs, so the raw fetch stays on the home PC; everything downstream
  of the raw file can run in the cloud.

## 3. Decisions (agreed in the design conversation)

| Question | Decision |
|---|---|
| Play-time source | **Published snapshot** in Supabase Storage. Postgres is the authoring store only. Zero DB reads when someone plays. |
| Scope | The six player-pool games. |
| Table shape | **One generic `questions` table, JSONB payload**, `game` discriminator; each game validates its own payload in code. |
| Where the maintenance job runs | **GitHub Actions cron** (reads Storage + Postgres, never nba.com). |
| AI generation | Later phase; generator interface accommodates it. |
| Sequencing | `fix/data-quality-audit` is merged **first** (separately). This design starts from a `dev` that has the 5,208-row dataset and `live_pool.py`. |
| Admin UI | Read-only questions list + manual retire + "Publish now". |
| Caching | Same for everyone → CDN caching. Immutable versioned files + 60 s manifest. **No Redis/KV.** |
| Versioning | Content version (bumped every publish) is separate from **schema** version (shape). Additive-only changes; a schema bump only for a breaking reshape (Section 11). |

## 4. Architecture

```
home PC (monthly)                    GitHub Actions (daily cron + manual)            play time
──────────────────                   ───────────────────────────────────            ─────────
nba_api fetch                        maintain_questions                             web / mobile / Railway
 └─ generate_players_curated          ├─ download datasets/players/<ver>             ├─ GET questions/manifest.json (60 s)
 └─ upload_dataset ──► Supabase       ├─ re-materialize + validate every ACTIVE      ├─ GET v/<ver>/players-names.json
    Storage: datasets/players/…       │   definition → retire the broken ones        ├─ GET v/<ver>/<game>/index.json
                                      ├─ top up each game to its target              └─ GET v/<ver>/<game>/<qid>.json
                                      ├─ write Postgres `questions`                        (all immutable, CDN-cached)
                                      └─ publish snapshot → Supabase Storage
                                          (files first, manifest LAST)
```

Two tiers, split by how often each changes:

- **Raw datasets** (`players_curated.json` now, `teams.json` etc. later) — rarely change;
  live in Storage under `datasets/`. The maintenance job **always downloads the current
  one at the start of a run**; it never uses a bundled or cached copy. This is the rule
  that prevents the seed-drift bug class the 2026-08-30 audit found.
- **Questions** — mutate on a schedule (prune/add); live in Postgres; published as
  snapshots.

## 5. Supabase Storage layout

One public bucket, `game-data`, accessed two ways: uploads through the S3-compatible
endpoint (boto3, existing `publish.py`), reads through the public object URL (CDN).

```
datasets/manifest.json                                  max-age=60   {"players": {"version", "url", "sha256", "count"}}
datasets/players/v/<dsver>/players_curated.json         immutable
questions/manifest.json                                 max-age=60   see below
questions/v/<ver>/players-names.json                    immutable
questions/v/<ver>/<game>/index.json                     immutable
questions/v/<ver>/<game>/<qid>.json                     immutable
```

`questions/manifest.json`:

```json
{ "schema": 1, "version": "2026-09-12.1", "generated_at": "…",
  "dataset": { "players": "2026-09-06.3" },
  "names": "<public-base>/questions/v/2026-09-12.1/players-names.json",
  "games": { "career-path": { "index": "<url>", "count": 300 }, "…": {} } }
```

`<ver>` = UTC date plus a per-day counter (`YYYY-MM-DD.N`), the convention
`build_pools_from_db` already uses. **Retention:** the publisher deletes `questions/v/*`
prefixes older than the three most recent versions after a successful manifest write.

Environment (names fixed here; values are supplied by Stefan, never committed):

| Var | Where | Purpose |
|---|---|---|
| `SUPABASE_S3_ENDPOINT`, `SUPABASE_S3_REGION`, `SUPABASE_S3_ACCESS_KEY_ID`, `SUPABASE_S3_SECRET_ACCESS_KEY`, `SUPABASE_STORAGE_BUCKET` | home PC (`upload_dataset`), GitHub Actions secrets | S3 uploads |
| `QUESTIONS_PUBLIC_BASE` | Actions, Railway, Vercel backend | public read base, e.g. `https://<ref>.supabase.co/storage/v1/object/public/game-data` |
| `VITE_QUESTIONS_BASE` | Vercel frontend (inlined via `next.config.ts` `env`) | same public base, browser side |
| `DATABASE_URL` | Actions secret | pooler URL (6543) |
| `GITHUB_DISPATCH_TOKEN` | Vercel backend | admin "Publish now" → `workflow_dispatch` |

## 6. Data model

Django model `trivia.Question` (table `trivia_question`), migration in `trivia`:

| Field | Type | Notes |
|---|---|---|
| `id` | BigAutoField | |
| `game` | CharField(32), indexed | slug: `career-path`, `who-are-ya`, `contexto`, `superdraft`, `tictactoe`, `imposter` |
| `qid` | CharField(48) | unique with `game`; e.g. `cp-000123`, `ttt-0042`, `ctx-2026-09-15` |
| `definition` | JSONField | the **definition** only (Section 7) — small, human-readable, dataset-independent |
| `status` | CharField(16), indexed with `game` | `active` \| `retired` |
| `quality` | JSONField | last materialization's metrics (e.g. per-cell solver counts) |
| `players_referenced` | JSONField (list of int) | person_ids the definition names; for impact queries when a player row changes. JSONField (not ArrayField) so the test suite keeps running on SQLite. |
| `content_hash` | CharField(64), unique with `game` | sha256 of canonical `definition`; prevents duplicate definitions |
| `dataset_version` | CharField(32) | players dataset version at last successful materialization |
| `created_by` | CharField(32) | `seed`, `generator`, `admin`, later `ai:<model>` |
| `created_at`, `updated_at`, `retired_at` | timestamps | |
| `retired_reason` | TextField, blank | validator problem text or admin note |

Retired rows are kept (audit trail; a generator must not re-create the same
`content_hash` while a retired row holds it — retirement is sticky unless an admin
reactivates via the DB).

## 7. Definitions and materialized payloads

A **definition** is what the table stores. A **materialized question** is what the
snapshot serves: definition + everything the client needs, precomputed against the
current dataset so the client never needs the player database. Every materialized file
has the envelope `{ "schema": 1, "game": "<slug>", "qid": "<qid>", … }`.

### 7.0 Shared: `players-names.json`

`[[person_id, "Full Name", ["alias", …]], …]` for all 4,900 playable players, sorted by
name. ~200 KB raw / ~50 KB gz. This is the autocomplete list and the name→id map for all
six games (replaces `all-players.json` for them; the accent-folded alias is already in
the dataset, so `normalizeAnswer` matching keeps working).

### 7.1 Career Path (`career-path`)

- Definition: `{ "person_id": 2544 }`. Generator emits one per eligible player: 3–7 team
  stints (`career_path.MIN_STINTS/MAX_STINTS`). Target: all eligible, `w` weight 3 for
  fame tier 2–3, else 1 (the existing weighting).
- Index item: `[qid, w]`. Client/MP server sample weighted.
- Materialized: `{ …envelope, "player": <PlayerIndexEntry row> }` (~1 KB).

### 7.2 Who Are Ya (`who-are-ya`)

- Definition: `{ "person_id" }`. Eligible: fame tier 1–2 with ≥1 stint (`who_are_ya._eligible`).
- Index item: `[qid]`. Materialized: `{ …, "player": <row> }`.

### 7.3 Tic-Tac-Toe (`tictactoe`)

- Definition: `{ "rows": [Criterion×3], "cols": [Criterion×3] }` — the existing board
  shape (`data_static/tictactoe_seed.json`; the 8 seeds are imported as `created_by=seed`).
- Generator: sample criteria pairs from the same vocabulary `tictactoe.player_matches`
  understands; keep a board only if **every cell has ≥ 3 and ≤ 400 valid players**
  (≥3 = the NBA Grid solvability floor; ≤400 keeps payloads small and cells
  meaningful). Target 60 boards.
- Materialized: `{ …, "rows", "cols", "valid": [[person_id,…]×9] }` (row-major cells).
  Client and MP server validate a guess by `nameToId(guess) ∈ valid[cell]`. The
  criteria matcher no longer runs on the client for this game.

### 7.4 SuperDraft Five (`superdraft`)

- Definition: `{ "slots": [{kind,value,label,sub}×5] }` drawn by the existing
  `superdraft._candidate_queues` + `draw_slots`, with a new generator rule
  `MIN_ELIGIBLE ≤ count ≤ MAX_ELIGIBLE (250)`. The cap removes the degenerate
  "country = USA" slot the audit flagged and bounds payload size. Target 200 slot sets,
  deduped by `content_hash`.
- The **daily objective** stays where it is: chosen by date in the renderer
  (`SuperDraft.tsx dailyObjective`). Objective needs four metrics per pick, so:
- Materialized: `{ …, "slots": [ { …slot, "eligible": [[person_id, height_in, rings, career_pts, birth_year], …] } ] }`.
  Worst case 5 × 250 × 5 ints ≈ 40 KB raw.

### 7.5 Contexto (`contexto`)

- Definition: `{ "secret_person_id", "day": "YYYY-MM-DD" }`. Generator schedules one
  secret per day, 90 days ahead, from fame tier 1–2, no repeats within 365 days.
- Similarity (`franchiseSeasons` Jaccard, era overlap, position family, draft
  proximity, awards cosine — `Contexto.tsx:25-110`) is **ported to Python once**
  (`trivia/questions/similarity.py`) and the TypeScript copy is deleted: the ranking
  is precomputed, so single-player and multiplayer can no longer disagree.
- Materialized: `{ …, "day", "secret": <row>, "ranking": [[person_id, rank], …] }` for
  all 4,900 playable players, sorted by rank (rank 1 is the secret). ≈70 KB raw /
  ≈20 KB gz — more than 20× smaller than today's pool, cached per day. The renderer
  shows only name + rank per guess (`Contexto.tsx` rows are `{pid, name, rank}`), and
  names come from `players-names.json`.
- Index item: `[qid, day]`. Selection: the item whose `day` is today (UTC); if none,
  FNV-1a over the date across the index (the existing `dailySecret` rule) so the game
  never dead-ends when the job has not run.

### 7.6 NBA Imposter (`imposter`)

- Definition: `{ "rule": "fame_tier<=2" }` — a single row `imposter-pool`.
- Materialized: `{ …, "names": ["…", …] }` (today's `imposter.json`, ~100 names).
  The turn server reads it instead of filtering `players-index`.

### 7.7 Per-game minimums (job fails if an active count drops below)

career-path 50 · who-are-ya 30 · contexto 30 scheduled days ahead · superdraft 30 ·
tictactoe 12 · imposter 20 names.

## 8. Generator / materializer / validator interface

`backend/trivia/questions/games/<slug>.py`, one module per game, each exposing:

```python
TARGET: int                      # active definitions the job tops up to
MINIMUM: int                     # Section 7.7
def generate(dataset, existing, rng, n) -> list[dict]   # n new definitions, none whose hash is in `existing`
def materialize(definition, dataset) -> dict            # payload or raise Invalid(reason)
def validate(materialized) -> list[str]                 # [] when publishable
def index_item(definition, materialized) -> list        # what goes in index.json
def players_referenced(definition, materialized) -> list[int]
```

`dataset` is `curated_players.playable_rows(rows)` plus the full rows list — the same
objects `live_pool.load_players()` hands the endpoints today, so the eligibility code in
`career_path.py`, `who_are_ya.py`, `superdraft.py`, `imposter.py`, and
`tictactoe.player_matches` is **moved** into these modules, not duplicated. A registry
`trivia/questions/games/__init__.py` mirrors `trivia/games/__init__.py` (module → slug).

## 9. Maintenance job — `manage.py maintain_questions`

Flags: `--games <slug,…>` (default all), `--no-publish`, `--dry-run`, `--rng-seed`.

1. Download `datasets/manifest.json`; download the players dataset it points at
   (verify sha256). Abort if unreachable — never fall back to a bundled file.
2. For each game, for each `active` row: `materialize` + `validate`. Any failure →
   `status=retired`, `retired_reason=<problems>`, `retired_at=now`. Update `quality`,
   `dataset_version` on success.
3. Top up: while active < `TARGET`, `generate` in batches, skipping hashes already in the
   table (any status), materialize + validate each, insert the survivors.
4. If any game is below `MINIMUM` → exit non-zero **before publishing** (the previous
   snapshot stays live).
5. Build the snapshot in a temp dir: `players-names.json`, per game `index.json` and one
   file per active question. Version = next `YYYY-MM-DD.N`.
6. Publish with `publish.upload_plan` (files, then manifest last), then apply retention.
7. Print a per-game summary (active / retired this run / added / version).

All Postgres writes for a run happen in one transaction that commits only after the
publish succeeds; a failed publish leaves the table as it was.

**`manage.py upload_dataset <path> --version <v>`** (home PC, after the monthly
`generate_players_curated`): uploads `datasets/players/v/<v>/players_curated.json`, then
rewrites `datasets/manifest.json`. Added to `backend/scripts/refresh_nba_data.cmd`.

**Workflow** `.github/workflows/maintain-questions.yml`: `schedule: "0 4 * * *"` (daily,
04:00 UTC) + `workflow_dispatch`; ubuntu, Python 3.13, `pip install -r
backend/requirements.txt -r backend/requirements-publish.txt`, run the command with the
secrets above, upload the summary as a job artifact. Concurrency group
`maintain-questions`, cancel-in-progress false.

## 10. Serving path

### 10.1 Frontend — `src/utils/questions.ts` (new; `pool.ts` untouched)

- `getManifest()` — fetch `${VITE_QUESTIONS_BASE}/questions/manifest.json`; memoized for
  60 s; on failure use the last manifest stored in `localStorage` (stale-but-playable,
  same fallback `pool.ts` has).
- `loadNames()`, `loadIndex(game)`, `loadQuestion(game, qid)` — memory + `localStorage`
  cache keyed by `${version}`; prune other versions (as `pool.ts` does). Refuse a
  manifest whose `schema` ≠ `SUPPORTED_SCHEMA` and surface the existing
  "Unable to connect" error shape.
- Pickers: `pickRandom(index)`, `pickWeighted(index)`, `pickDaily(index, today)`.
- `fetchQuestion(game): Promise<FetchResult>` — resolves to `{ success, data: [question] }`
  so `MiniGame.tsx handleStart` and the `gameInfo` prop contract are unchanged.
- `useNames()` hook for autocomplete.
- `next.config.ts` `env` gains `VITE_QUESTIONS_BASE`.

### 10.2 Game registry

`GameUtils.tsx`: the six entries switch `fetchData` from `fetchWholePool("players-index")`
to `fetchQuestion("<slug>")`.

### 10.3 Renderers — one payload shape for both modes

`gameInfo` is `[question]` in single-player **and** multiplayer. `useRoundPool` and every
`fetchWholePool("players-index")` call in the six renderers are removed. Per game:

- **CareerPath / WhoAreYa**: mystery = `gameInfo[0].player`; autocomplete = `useNames()`.
- **TicTacToe**: board + `valid` from the question; guess check = name→id ∈ `valid[cell]`;
  the `criteria.ts` import goes away for this game (the other criteria games keep it).
- **SuperDraft**: slots + `eligible` tuples from the question; `buildCandidates`,
  `drawSlots` and the client-side eligibility filter are deleted; `perPick` metrics read
  the tuple. `dailyObjective` stays.
- **Contexto**: `secret` + `ranking` from the question; `similarity`, `buildRanking`,
  `dailySecret` deleted; guess → id → rank lookup; per-guess hints from the tuple.
- **Imposter**: names from the question (explainer screen unchanged).

`src/types/types.tsx` gains `Question*` types; `GameData` union gains them.

### 10.4 Multiplayer server (Railway)

- New `multiplayer_server/src/questions.js`: same manifest/index/question loader in Node
  (in-process cache keyed by version, manifest re-checked every 60 s; env
  `QUESTIONS_PUBLIC_BASE`).
- `gameEndpoints.js`: the six games map to `questions.deal(gameId)` instead of Django
  URLs; `fetchRound` returns `[question]`, so `roundData` is unchanged for clients.
- `turnGames.js`: `initTTT` deals a board question + loads names; `handleTTT` validates
  by id against `valid`; the `players-index` load and `playerMatches` go away; Imposter
  draws its mystery from the imposter question's `names`.

### 10.5 Django

- `trivia/games/{career_path,who_are_ya,contexto,superdraft,imposter,tictactoe}.py` lose
  `get_round` (nothing calls them after 10.4); `imposter`/`tictactoe` stop publishing
  legacy pools; `players_index` keeps publishing `players-index` for the four
  out-of-scope games. `live_pool.py` stays (those games' validators and the admin
  panel read it).
- Admin API (`trivia/admin_api.py`, staff-only like the existing routes):
  `GET /api/admin/questions/?game=&status=&q=&limit=&offset=` (paged rows: qid, status,
  created_by, quality, dataset_version, retired_reason, updated_at),
  `POST /api/admin/questions/<id>/retire/` `{reason}`,
  `POST /api/admin/questions/publish/` → GitHub `workflow_dispatch` on
  `maintain-questions.yml` (202; 503 with a clear message if `GITHUB_DISPATCH_TOKEN`
  is unset).
- Admin panel game cards: the six games' `sources` become `questions:<slug>`; the Games
  tab's "Shared datasets" card gains `questions:players-names`.

## 11. Versioning

- **Content version** (`version`): bumped on every publish; it is the cache key.
- **Schema version** (`schema`): the *shape* of manifest/index/question files. Rule:
  **only add fields; never remove, rename, or change the type of one.** Growth of the
  pool, new questions, new games (a new key under `games`) are all additive and need no
  schema change. Clients ignore fields they don't know.
- A breaking reshape (if it ever happens) publishes `schema: 2` under
  `questions/v2/manifest.json`; `v1` keeps being published from the same table until
  every shipped app version can read v2. Not built now — documented so the mobile app
  pins `SUPPORTED_SCHEMA` from day one.
- The same additive rule applies to the six Django-free payloads the multiplayer server
  relays: it forwards questions verbatim.

## 12. Admin panel — Questions tab

`src/views/Admin.tsx` gets a fourth tab, `Questions`: game selector, status filter,
search, the same `admin-table` rendering as `SourceRows` (missing values render as "—"),
a per-row **Retire** button (confirm + reason → retire endpoint; row shows
`retired`, "takes effect at next publish"), and a **Publish now** button (dispatch
endpoint; shows "queued — check Actions"). No create/edit.

## 13. Error handling and degradation

| Failure | Behaviour |
|---|---|
| Dataset download fails in the job | job aborts, nothing changes, non-zero exit (Actions shows red) |
| A game drops below `MINIMUM` | job aborts before publish; previous snapshot stays live |
| Partial upload | manifest is written last → clients never see a version with missing files |
| Manifest unreachable on the client | last manifest + files from `localStorage`; if none, existing "Unable to connect" error |
| Manifest `schema` unsupported | treated as unreachable (error), never a crash |
| Question file 404 (retention race) | client re-fetches the manifest once and retries with the new version |
| Contexto has no item for today | FNV-1a fallback over the index (Section 7.5) |
| Railway can't reach Storage | `fetchRound` rejects → existing `roundDataError` path; turn games keep the existing "trust client" fallback |

## 14. Testing and verification

Backend (`manage.py test`): per-game generator/materializer/validator tests over a
committed **fixture dataset** (`trivia/tests/fixtures/players_fixture.json`, ~200 rows
chosen to include every edge the validators care about); `maintain_questions` tests
with an in-memory fake S3 client asserting: manifest written last, retention keeps three
versions, a `MINIMUM` breach publishes nothing, a failed upload rolls the DB back;
Contexto similarity golden test (top-20 for a fixed secret over the fixture equals a
checked-in file generated once from the current TypeScript implementation); admin API
permission and paging tests. `makemigrations --check` clean.

Frontend: `npm run lint`, `npm run build` (type-check), and a real browser pass of each
of the six games in single-player, plus one multiplayer game with two browsers against a
local Railway server (`multiplayer_server/scripts/sim_turngames.js` extended for the
by-id validation). Admin Questions tab exercised in the browser.

Production check after each phase ships: fetch the manifest URL, one index, one
question; start each migrated game on `nba-minigames.vercel.app`; Network tab confirms
no `players-index.json` download for the migrated games.

## 15. Rollout (each phase is one PR to `dev`, after `fix/data-quality-audit` has merged)

- **A. Backend + storage** — model, migration, generators, similarity port, job,
  workflow, `upload_dataset`; first real publish. No consumer changes; production
  unaffected.
- **B. Client library + Career Path + Who Are Ya** — `questions.ts`, names, two renderers.
- **C. Tic-Tac-Toe + SuperDraft + Imposter** (single-player).
- **D. Contexto** (single-player).
- **E. Multiplayer server** — `questions.js`, `gameEndpoints.js`, `turnGames.js`; Railway
  deploy (`railway up`, manual).
- **F. Admin Questions tab + API.**
- **G. Cleanup + docs** — delete `get_round` for the six, `useRoundPool`, the TS
  similarity/candidate code, legacy `imposter`/`tictactoe` pool publishing; update
  `docs/DATA_PIPELINE.md`, `docs/ARCHITECTURE.md`, `docs/games/*.md`, `CLAUDE.md`.

## 16. Cost and operations

No new paid service. Supabase Storage and egress stay well inside the current project's
plan (a full version ≈ 20 MB with 90 Contexto days; retention keeps three). GitHub
Actions: one ~2-minute job per day. Secrets in Section 5 are created by Stefan; the
implementation never invents or commits a value. Per the standing rule, anything that
would change the Supabase plan is a decision for Stefan, not the agent.

## 17. Out of scope / follow-ups

- Bingo, Heatmap, NBA Grid, Pack Five still download `players-index` — same treatment
  in a later plan.
- AI generators (`created_by=ai:<model>`) — plug into Section 8; needs a model/budget
  decision.
- Mobile client library — same manifest/index/question contract; nothing here blocks it.
- Deleting `all-players.json` — still used by Starting Five / Guess MVPs / Fan Favorites.
