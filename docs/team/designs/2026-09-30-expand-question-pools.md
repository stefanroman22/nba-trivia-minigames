# Design: expand-question-pools

Task: "Expand question pools for games with real headroom left" (Category AI, P1, Notion
3ea2cfb1-c595-818a-82dd-d14ea65795c7). Grow the small static pools (heatmap 6, tictactoe 8, bingo 10,
nba-grid 12, fan-favorites 24, who-would-win 30, connections 40) and the runner-driven Question-store
games, under a hard rule: every new item must be verifiably correct against
`backend/trivia/data_static/players_curated.json` (or another committed real dataset), checked by each
game's existing validator. Do not pad name-logo / mvps / playoff (already the ceiling of real history).
Check wordle's headroom explicitly. Hidden games (heatmap, connections, nba-grid, bingo, pack-five,
superdraft, imposter) are still maintained.

Classify: hard / backend + data / risk high / provisional engine opus. Design round 2026-09-30, planner
on fable; one `backend-engine` (sonnet) proposal + sign-off seat, no frontend seat (no `src/` change).
Worktree `C:\Users\stefa\.team-worktrees\expand-question-pools`, branch `team/expand-question-pools`
(from `origin/dev` bcaec4b). Local run.

## Decision summary

**Engine: mixed.** Steps 1-7 (content authoring that needs NBA judgment: heatmap bank, tictactoe / grid /
bingo criteria boards, connections groups, who-would-win matchups, fan-favorites answer sets) are
`[opus]`; steps 8-11 (constant bumps with a scripted dry-run, the wordle check, the serial pool rebuild +
tests, the guidelines note) are `[sonnet]`. Per-step tags are in `## Implementation plan`.

**D1 — how pools get rebuilt with no `DATABASE_URL`.** Run every command with `DATABASE_URL=""` so
`settings.py` falls back to sqlite (`backend/db.sqlite3`, gitignored). The rebuild is the existing
path, in this order: `migrate` → `seed_fan_favorites` (upserts the seed into the local sqlite
`FanFavoritesQuestion` table) → `build_pools_from_db --label <version>`. With empty DB tables the DB-only
builders (`name-logo`, `wordle`, `mvps`, `playoff`, `starting-five`) return `[]`, `validate_pool` reports
"empty pool" and the command **skips them and keeps the committed files** — that is the designed
non-clobber behaviour, not an error. Seed-backed builders (`heatmap`, `connections`, `nba-grid`,
`tictactoe`, `bingo`, `who-would-win`) are rewritten from the seeds; `players-index` and `imposter`
come out byte-identical (verified: today's files hash-match `json.dumps(builder(), ensure_ascii=False)`);
`fan-favorites` is rebuilt from the sqlite rows, which equal the normalized seed (verified: today's
published `fan-favorites.json` == `load_seed()`, i.e. no live re-ranked standings exist yet, so
nothing is lost). One accepted side effect: `all-players.json` is rewritten in curated (person_id)
order instead of today's alphabetical order — a one-line diff, harmless (the autocomplete sorts its own
matches, `canonical_lineup_names`/`check_parity` are set-based) and exactly what the production monthly
`build_pools_from_db` will do anyway. Do not revert it: the manifest hash must match the file.

**D2 — Question-store games are in scope only as constant bumps.** `career-path`, `superdraft` and the
tictactoe *question* family are capped by `TARGET` in `backend/trivia/questions/games/*.py`; raising
the constants takes effect on the next daily `maintain_questions` run (GitHub Actions, has the
secrets). Verified offline by an in-memory-sqlite dry run of `runner.run(...)` against the real curated
dataset (step 8). `who-are-ya` (`TARGET = None`, already every tier 1-2 player), `imposter` (one derived
pool row, tier ≤ 2) and `contexto` (60 days ahead, secrets are the same 99 tier 1-2 players) have **no
headroom without promoting players to fame tier 1-2** in the generated `players_curated.json` — a
dataset/tiering decision for a separate card, not a seed edit. `pack-five` has no pool at all (deals
from players-index at play time). These four are recorded as "no action, reason given", not failures.

**D3 — targets (checkable "done" numbers).** Double, not quadruple: each authored board needs hand
verification against real data, and a second card can top up further using the guidelines this task
writes. heatmap 6→12 (generated, deterministic), tictactoe 8→16, nba-grid 12→24, bingo 10→20,
connections 40→60, who-would-win 30→60, fan-favorites 24→40; `TARGET` career-path 300→500 (1,983
eligible journeymen), superdraft 200→300, tictactoe questions 60→120. The engine proposal asked for
larger numbers (heatmap 16, connections 80, grid 40, bingo 30, fan-favorites 48, career-path 800);
planner keeps the doubles — quality and verification cost dominate, and the pools are consumed one
board per play.

**D4 — heatmap: extend `BANK`, accept that boards 1-6 regenerate.** The engine proposed freezing the
bank to keep boards 1-6 stable. Planner decides for variety (the spec's stated preference): the bank
gains 20 pinned criteria (8 franchises, 2 eras, 2 awards, 2 draft decades, 4 colleges, 2 stats). Every
board is re-proven by `heatmap_validate.py`, the game is hidden, and no GuessLog rows reference
`hm-board-*`. Reason recorded here; no DECISIONS.md conflict entry needed (folded once).

**D5 — connections verifiability.** `connections_validate.py` only checks labels it can derive
(draft year, born-in, No. 1 pick, jersey, position, college) and silently skips tiles whose name is not
an exact curated `full_name` (17 existing tiles only resolve via `aliases`, 11 not at all, e.g. "Rip
Hamilton", "Penny Hardaway", "Gerry McNamara" — who never played in the NBA). New boards therefore
must (i) use only label kinds the validator or the step's check script can prove, and (ii) pass a
tile-resolution check (full_name or alias, accent-folded). Changing the validator itself (fold-aware
index, unknown-tile failure) and repairing the 11 legacy tiles is a follow-up, not this card (it would
rewrite existing boards).

**D6 — who-would-win verifiability.** Sides are real team-seasons, proven against
`backend/trivia/data/playoff.json` (912 real series: season + franchise names); `sub` lines name only
players who have a curated stint with that franchise covering that season (no W-L records or slogans,
which nothing can check). Matchups are pinned in step 6.

**D7 — fan-favorites.** New prompts are restricted to `category` `player`/`team` whose answer set is
computable from `players_curated.json` (awards, career, draft, country, stints) or `playoff.json`
(Finals winners/finalists) — prompts and derivation rules are pinned in step 7; counts stay editorial
(the seed's documented convention, auto-replaced at ≥ 500 live guesses). `seed_fan_favorites` currently
drops `category` on insert (defaults every new row to `player`) — that is fixed in the same step,
because both the offline rebuild and the eventual production seeding go through it.

**D8 — wordle is maxed.** Under the build rule (`Player.last_name` → `wordle_word`, 5 ASCII letters
after accent-stripping) the 5,208-player index yields exactly 525 words = today's pool. The only
headroom is 6 surnames carried behind a generational suffix (`Oubre Jr.`, `Giles III`, `Carey Jr.`,
`Acuff Jr.`, `Cenac Jr.`, `Lemon Jr.` → `Oubre`, `Giles`, `Carey`, `Acuff`, `Cenac`, `Lemon`), which would
need a `wordle_word` rule change plus a production rebuild, and 2 names (`Ajayi`, `Awaka`) that the
next `sync_nba_data` picks up on its own. Outcome: **maxed (525/525); +6 possible via suffix stripping
— noted as a follow-up, not done here.** Step 9 re-runs the measurement so the number is in the log.

**Sign-off.** The backend-engine sign-off pass arrived after the doc's first commit with four concrete
objections, all folded in once: step 3's similarity rule restricted to pairs involving a new board
(grid-001/grid-006 already share 4), step 5's check script now enforces K4 college membership
(`label.startswith(college + " ")`) plus a K1 cross-trap check, step 10's git paths corrected for a
`backend/` cwd, step 11's commit uses an explicit pathspec and runs after step 10. Planner
self-verified the risky check scripts: all 60 pinned who-would-win sides exist in `playoff.json`; the
champion-roster rule holds on `cn-001`'s 2016 Cavaliers group and on the 1978/1979/1982/1984 edge
cases; the step-8 in-memory-sqlite dry run completes (25 s for career-path + tictactoe at today's
targets, 0 retired); the step-9 snippet prints exactly the D8 numbers.

**D9 — production handoff (no credentials here).** After this ships, `fan-favorites.json` on the CDN
has 40 boards but the production `FanFavoritesQuestion` table has 24. The next monthly refresh
(`backend/scripts/refresh_nba_data.cmd`, 1st of month 04:00) rebuilds `fan-favorites.json` from that
table and would **regress the pool to 24** unless the owner runs
`venv\Scripts\python.exe manage.py seed_fan_favorites` (home machine, real `DATABASE_URL`) first. This is
an owner action, listed under Parked / handoff.

## Interfaces

No new public interface. Data shapes stay frozen per game:

| Game | Seed file (authored, BE-3) | Row shape | Validator (exact command, from `backend/`, `DATABASE_URL=""`) |
|---|---|---|---|
| heatmap | `trivia/data_static/heatmap_seed.json` (written by `heatmap_gen.py`) | `{qid:"hm-board-N", hexes:[{id, criterion:{type,value,label}, neighbors}]}` ×28 | `.venv/Scripts/python trivia/games/heatmap_validate.py` → `OK — all 12 boards solvable ...` |
| tictactoe | `trivia/data_static/tictactoe_seed.json` | `{qid:"ttt-NNN", rows:[3 criteria], cols:[3 criteria]}` | `.venv/Scripts/python trivia/games/validate_tictactoe_seed.py` → `OK: 16 boards, all cells solvable` |
| nba-grid | `trivia/data_static/nba_grid_seed.json` | `{qid:"grid-NNN", rows:[3], cols:[3]}` | `.venv/Scripts/python -m trivia.games.nba_grid_validate` → `OK — 24 configs, ...` |
| bingo | `trivia/data_static/bingo_seed.json` | `{qid:"bingo-NNN", cells:[16 criteria]}` | `.venv/Scripts/python manage.py validate_bingo_seed` → `OK — 20 cards, ...` |
| connections | `trivia/data_static/connections_seed.json` | `{qid:"cn-NNN", tiles:[16], groups:[{label, difficulty 1-4, members:[4]}]×4}` | `.venv/Scripts/python -m trivia.games.connections_validate` → `OK: 60 boards valid` |
| who-would-win | `trivia/data_static/who_would_win_seed.json` | `{qid:"www-NNN", a:{label ≤60, sub ≤90}, b:{...}}` | `validate_rows` via the step-6 script (no standalone CLI) |
| fan-favorites | `trivia/data_static/fan_favorites_seed.json` (`{"questions":[...]}`) | `{id:"ff-NNN", prompt, survey_date, category, answers:[{answer,count,aliases}] ≥6, counts sum 100}` | `validate_pool("fan-favorites", load_seed())` via the step-7 script |

Criterion vocabulary (shared by tictactoe / grid / bingo / heatmap, mirrors `src/utils/criteria.ts`):
`type` ∈ team (value = current franchise abbr, e.g. `LAL`), award ∈ {mvp, fmvp, dpoy, roty, smoy, ring,
allstar5plus, allnba}, country (`USA`, `INTL`, or an exact curated country), draft ∈ {top5, lottery,
round2, undrafted, decade-1980s … decade-2020s}, college (`none` or exact curated college string), stat ∈
{20kpts, 25kpts, ppg20, rpg10, apg8, seasons15plus}, era ∈ {1980s, 1990s, 2000s, 2010s, 2020s}.

Question-store constants (module attributes read by `trivia/questions/runner.py`):
`career_path.TARGET = 500`, `superdraft.TARGET = 300`, `tictactoe.TARGET = 120`; `MINIMUM`s unchanged.

Command fix: `seed_fan_favorites` `defaults` gains `"category": q.get("category", "player")`.

## File plan

| File | Change | Step |
|---|---|---|
| `backend/trivia/data_static/heatmap_gen.py` | +20 `BANK` entries; `range(1, 7)` → `range(1, 13)`; docstring "6" → "12" | 1 |
| `backend/trivia/games/heatmap_validate.py` | docstring "all 6 boards" → "all 12 boards" (comment only) | 1 |
| `backend/trivia/data_static/heatmap_seed.json` | regenerated (12 boards) | 1 |
| `backend/trivia/tests/test_heatmap.py` | `test_seed_has_six_boards` → twelve | 1 |
| `backend/trivia/data_static/tictactoe_seed.json` | +8 boards `ttt-009`…`ttt-016` | 2 |
| `backend/trivia/tests/test_tictactoe.py` | 8 → 16 (two asserts) | 2 |
| `backend/trivia/data_static/nba_grid_seed.json` | +12 configs `grid-013`…`grid-024` | 3 |
| `backend/trivia/tests/test_nba_grid.py` | 12 → 24 | 3 |
| `backend/trivia/data_static/bingo_seed.json` | +10 cards `bingo-011`…`bingo-020` | 4 |
| `backend/trivia/games/bingo.py` | `EXPECTED_CARDS = 20` | 4 |
| `backend/trivia/data_static/connections_seed.json` | +20 boards `cn-041`…`cn-060` | 5 |
| `backend/trivia/tests/test_connections.py` | 40 → 60 | 5 |
| `backend/trivia/data_static/who_would_win_seed.json` | +30 matchups `www-031`…`www-060` | 6 |
| `backend/trivia/tests/test_who_would_win.py` | floor 30 → 60 | 6 |
| `backend/trivia/data_static/fan_favorites_seed.json` | +16 questions `ff-025`…`ff-040` | 7 |
| `backend/trivia/management/commands/seed_fan_favorites.py` | write `category` | 7 |
| `backend/trivia/tests/test_fan_favorites.py` | 24 → 40; new `SeedCommandTests` | 7 |
| `backend/trivia/questions/games/{career_path,superdraft,tictactoe}.py` | `TARGET` constants | 8 |
| `backend/trivia/data/*.json`, `backend/trivia/data/manifest.json` | regenerated by `build_pools_from_db` only | 10 |
| `docs/DATA_PIPELINE.md` | new section "Authoring seed content — quality guidelines" | 11 |

Shared / serial: only step 10 touches `trivia/data/` and the manifest; step 11 touches
`docs/DATA_PIPELINE.md`. Steps 1-9 touch pairwise-disjoint files (each game's seed + its own test module
+ at most its own game module) and may run in parallel in this worktree; **they must not run
`build_pools_from_db`, must not `git commit`, and must not run the full suite** (the published-pool
parity tests in `test_heatmap`/`test_nba_grid` and the `/trivia/manifest` tests legitimately fail until
step 10). Step 10 commits everything.

## Risks

- **Hallucinated content passing a structural validator.** Mitigated per game: heatmap/grid/bingo/
  tictactoe are proven against the curated pool by code; connections new boards use only provable label
  kinds + tile resolution (D5); who-would-win sides/subs are proven against `playoff.json` + stints (D6);
  fan-favorites answer lists are generated from data, not typed (D7). Wordle: no content written.
- **Heatmap boards 1-6 change** (D4). Accepted; hidden game.
- **`build_pools_from_db` in the worktree** rewrites `all-players.json` order (accepted, D1) and must be
  run only after `migrate` (otherwise `no such table: trivia_team` from `build_name_logo`).
- **Production fan-favorites regression on the next monthly refresh** unless the owner seeds prod (D9).
- **Runner cost/size at higher `TARGET`s.** superdraft questions carry ≤ 250 eligible tuples × 5 slots
  (~45 KB each): 300 → ~13 MB per published version (retention keeps 3). career-path rows ~1.5 KB → 500
  ≈ 0.8 MB. Generation work is a few million `player_matches` calls — seconds. Dry run in step 8 measures
  it.
- **Contexto latent failure (not fixed here, flagged):** 99 tier 1-2 secrets with `NO_REPEAT_DAYS = 365`
  and `TARGET = 60` days ahead means candidates run out ≈ 99 days after the first run; then the scheduled
  count falls under `MINIMUM = 30` and `maintain_questions` starts exiting 1. Needs its own card.
- **Thin bingo pool.** Only 134 curated players have fame tier ≤ 3 (dealable); many criteria have < 4
  dealable matches (coverage table in step 4). The validator catches every thin cell.
- **Parallel steps in one worktree.** Disjoint files, no commits, no shared sqlite (step 8 uses an
  in-memory DB; step 10 owns `db.sqlite3`).

## Test plan (offline, verify stage)

From `backend/` with `DATABASE_URL=""` and `.venv/Scripts/python` (the worktree venv; BE-18 says
`venv`, this worktree uses `.venv`):

1. Per-game validators listed under Interfaces, each printing its OK line with the new count.
2. `python manage.py test trivia users` — green. Count pins after this task: heatmap 12, tictactoe 16,
   nba-grid 24, bingo `EXPECTED_CARDS` 20, connections 60, who-would-win ≥ 60, fan-favorites 40.
   `test_pool_endpoints` checks every manifest count equals the file length (proves step 10 ran).
3. `python manage.py check` and `makemigrations --check --dry-run` (no model change; must stay clean).
4. Step-8 dry-run script output shows `added` counts reaching the new targets with zero `retired`.
5. Manifest inspection: `python -c "import json;m=json.load(open('trivia/data/manifest.json'));print({k:v['count'] for k,v in m['games'].items()})"`
   → heatmap 12, tictactoe 16, nba-grid 24, bingo 20, connections 60, who-would-win 60, fan-favorites 40;
   all other counts unchanged (all-players 5208, players-index 4900, imposter 99, playoff 912,
   starting-five 503, wordle 525, mvps 71, name-logo 30).

## Implementation plan

Conventions for every step: work in `C:\Users\stefa\.team-worktrees\expand-question-pools`; shell
commands are Git Bash from `backend/` unless noted (`PY=.venv/Scripts/python`); always prefix
`DATABASE_URL=""` (PowerShell: `$env:DATABASE_URL = ""`). Never edit `trivia/data/*.json` by hand.
Match each seed file's existing formatting exactly (documented per step). Steps 1-9 do not commit.

**Shared check helper (used by steps 2-7; paste as-is into a heredoc, it needs no file):**

```python
# --- curated helpers ---------------------------------------------------------
import os, json, re, unicodedata, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings"); os.environ["DATABASE_URL"] = ""
django.setup()
from trivia.data_pipeline.curated_players import playable_rows
CUR = playable_rows(json.load(open("trivia/data_static/players_curated.json", encoding="utf-8")))
def fold(s): return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c)).lower().strip()
BY_NAME = {}
for r in CUR:
    for key in [r["full_name"], *(r.get("aliases") or [])]:
        BY_NAME.setdefault(fold(key), r)  # first (most prominent by file order) wins
def resolve(name):
    """curated row for a tile/answer, or None (exact full_name or alias, accent-folded)."""
    return BY_NAME.get(fold(name))
def on_team_in_season(row, abbr, end_year):
    """Did the player have a stint with franchise `abbr` covering season (end_year-1)-(end_year)?"""
    return any(s["abbr"] == abbr and s["start_year"] <= end_year - 1 and (s["end_year"] or 2026) >= end_year
               for s in row["teams"])
```

### Step 1 `[opus]` — heatmap: 6 → 12 boards

Files: `backend/trivia/data_static/heatmap_gen.py`, `backend/trivia/data_static/heatmap_seed.json`
(generated), `backend/trivia/tests/test_heatmap.py`.

1. In `heatmap_gen.py` append these 20 entries to `BANK` (after the `ppg20` entry, same dict style;
   team labels are FULL current franchise names because the renderer resolves the logo by label via
   `src/constants/teamLogos.ts::currentLogoUrl`):
   ```python
       {"type": "team", "value": "DAL", "label": "Dallas Mavericks"},
       {"type": "team", "value": "HOU", "label": "Houston Rockets"},
       {"type": "team", "value": "MIL", "label": "Milwaukee Bucks"},
       {"type": "team", "value": "CLE", "label": "Cleveland Cavaliers"},
       {"type": "team", "value": "POR", "label": "Portland Trail Blazers"},
       {"type": "team", "value": "UTA", "label": "Utah Jazz"},
       {"type": "team", "value": "DEN", "label": "Denver Nuggets"},
       {"type": "team", "value": "ATL", "label": "Atlanta Hawks"},
       {"type": "era", "value": "1980s", "label": "Played in the 80s"},
       {"type": "era", "value": "2020s", "label": "Played in the 2020s"},
       {"type": "award", "value": "fmvp", "label": "Finals MVP"},
       {"type": "award", "value": "roty", "label": "Rookie of the Year"},
       {"type": "draft", "value": "decade-2000s", "label": "Drafted in the 2000s"},
       {"type": "draft", "value": "decade-2010s", "label": "Drafted in the 2010s"},
       {"type": "college", "value": "none", "label": "No college"},
       {"type": "college", "value": "Kentucky", "label": "Kentucky Wildcats"},
       {"type": "college", "value": "Duke", "label": "Duke Blue Devils"},
       {"type": "college", "value": "North Carolina", "label": "North Carolina Tar Heels"},
       {"type": "stat", "value": "rpg10", "label": "10+ RPG career"},
       {"type": "stat", "value": "25kpts", "label": "25,000+ pts"},
   ```
   Change `for i in range(1, 7):` to `for i in range(1, 13):` in `main()`; change the module
   docstring's "build 6 solvable Heatmap boards" to "build 12 ..." and `heatmap_validate.py`'s
   docstring line "Exits 0 when all 6 boards pass" to "all 12 boards" (comment-only edits, nothing else
   in that file).
2. Run `DATABASE_URL="" $PY trivia/data_static/heatmap_gen.py` → prints
   `wrote ... heatmap_seed.json (12 boards, 4900 players)`. Expect boards 1-6 to differ from before (D4).
   Output formatting is `json.dump(indent=2, ensure_ascii=False)` with no trailing newline — identical
   to the committed file's style, so no hand edit.
3. Run `DATABASE_URL="" $PY trivia/games/heatmap_validate.py` → must print
   `OK — all 12 boards solvable (4900 players) and varied (...)` and exit 0. If it prints `FAIL` for a
   variety floor or a `TOO THIN` hex, the fix is deterministic: remove the four `college` entries added
   above, re-run steps 2-3; if it still fails, remove the two `draft` decade entries and re-run. Do not
   touch `MIN_SOLVERS`, the floors, or any board by hand. If `build_board` raises
   "could not build a fully-solvable board", raise `range(600)` in `build_board` to `range(1200)` and
   re-run.
4. `test_heatmap.py`: rename `test_seed_has_six_boards` → `test_seed_has_twelve_boards`, assert `12`.
5. Done-check: `DATABASE_URL="" $PY manage.py test trivia.tests.test_heatmap` — every test passes
   **except** `test_published_pool_matches_the_seed` (expected until step 10). Record the validator's
   printed depth line (min/p25/median) in your step notes.

### Step 2 `[opus]` — tictactoe seed: 8 → 16 boards

Files: `backend/trivia/data_static/tictactoe_seed.json`, `backend/trivia/tests/test_tictactoe.py`.

Formatting: hand-written JSON, 2-space indent, each criterion on ONE line as
`{ "type": "team", "value": "LAL", "label": "Lakers" }` (spaces inside braces), boards separated by
`},\n  {`, file ends with `]\n`. Append boards `ttt-009` … `ttt-016` after `ttt-008`.

Authoring rules (all enforced by the checks below):
- `rows` and `cols` are 3 criteria each from the shared vocabulary. Keep the game's pattern of at
  least one axis being three `team` criteria on ≥ 5 of the 8 new boards; the other ≤ 3 boards may use
  a non-team axis (era / draft / country) like `ttt-007`.
- Every cell must have **≥ 3** solvers in the playable pool (stricter than `validate_rows`' ≥ 1; the
  existing `ttt-008` has a 1-solver cell — leave it, it is not this card's bug).
- Variety: each new board must differ from every other board (old and new) in at least 3 of its 6
  criteria; use at least 6 franchises not in the current seed (`LAL BOS CHI MIA SAS DAL GSW OKC HOU
  NYK PHI DET PHX UTA POR CLE MIL LAC DEN MIN ORL` are used) — candidates with ≥ 290 playable
  players: `ATL WAS SAC BKN IND CHA MEM TOR NOP`; cover at least 4 different column types across the
  set (award, stat, draft, country, era, college).
- Labels: short display names in the file's existing style (`"Hawks"`, `"Won a ring"`, `"Drafted 2010s"`).

Coverage reference (playable pool, 4,900 rows): award mvp 37, fmvp 37, dpoy 27, roty 77, smoy 36, ring
616, allstar5plus 148, allnba 269; stat 20kpts 52, 25kpts 27, ppg20 86, rpg10 59, apg8 19, seasons15plus
193; draft top5 387, lottery 1027, round2 1199, undrafted 1269; country INTL 522, Canada 52, France 52;
college none 306, Kentucky 121, Duke 99, UCLA 96, North Carolina 89. Thin pairings to avoid: `smoy`,
`apg8`, `dpoy` or `25kpts` × a small-market team.

Done-check script (from `backend/`; must print `OK`):

```bash
DATABASE_URL="" $PY - <<'EOF'
# --- curated helpers --- (paste the shared helper block here)
from trivia.games.tictactoe import build_pool, player_matches, validate_rows
boards = build_pool(); assert len(boards) == 16, len(boards)
assert validate_rows(boards) == [], validate_rows(boards)
sigs = {}; bad = []
for b in boards:
    crits = [(c["type"], c["value"]) for c in b["rows"] + b["cols"]]
    for q, other in sigs.items():
        if len(set(crits) & set(other)) > 3: bad.append(f"{b['qid']} too similar to {q}")
    sigs[b["qid"]] = crits
    if int(b["qid"].split("-")[1]) <= 8: continue
    for r in b["rows"]:
        for c in b["cols"]:
            n = sum(1 for p in CUR if player_matches(p, r) and player_matches(p, c))
            if n < 3: bad.append(f"{b['qid']}: {r['value']} x {c['value']} has {n} solvers (< 3)")
print("\n".join(bad) or "OK")
EOF
```
(Existing boards `ttt-001/002/004` share > 3 criteria only with themselves; if the similarity check
names two OLD boards, ignore that pair — only lines naming a `ttt-009`…`ttt-016` board must be fixed.)

Then `DATABASE_URL="" $PY trivia/games/validate_tictactoe_seed.py` → `OK: 16 boards, all cells solvable`.
Edit `test_tictactoe.py::test_pool_has_eight_valid_boards` → rename `test_pool_has_sixteen_valid_boards`,
both `8` → `16`. `DATABASE_URL="" $PY manage.py test trivia.tests.test_tictactoe` → all pass.

### Step 3 `[opus]` — nba-grid: 12 → 24 configs

Files: `backend/trivia/data_static/nba_grid_seed.json`, `backend/trivia/tests/test_nba_grid.py`.

Formatting: same one-criterion-per-line style as tictactoe but with column-aligned padding inside each
board (see `grid-001`); reproduce the alignment for new entries (pad `"type"` and `"value"` with
spaces so `"value"` / `"label"` keys line up within a board). Append `grid-013` … `grid-024`.

Rules: 3 rows × 3 cols from the vocabulary; the validator requires **≥ 3 playable solvers per cell**
(`nba_grid_validate.MIN_PER_CELL`). Variety: at least 4 boards whose rows are three franchises not yet
used as grid rows (`LAL BOS GSW SAS MIA CHI HOU PHX DAL` are used — take from `NYK PHI DET MIL CLE POR
UTA DEN OKC TOR ATL SAC WAS IND BKN`), at least 3 boards with a `college` or `draft` decade axis, at
least 2 boards with era rows spanning `1980s`/`1990s`, and every criterion type appears somewhere in
the new set. No new board (`grid-013`+) may share more than 3 of its 6 criteria with any other board,
old or new (pairs of two OLD boards are exempt — `grid-001`/`grid-006` already share 4). Coverage numbers:
see step 2. Cell depth matters for playability, not just the floor: prefer cells with ≥ 8 solvers
unless the intersection is the point of the cell.

Done-check: `DATABASE_URL="" $PY -m trivia.games.nba_grid_validate` → `OK — 24 configs, all 9 cells
each have >=3 valid players (checked against 4900 curated rows)`; plus the similarity check (same
snippet as step 2 with `from trivia.games.nba_grid import build_pool, validate_rows` and the qid cut-off
`<= 12`, skipping the per-cell loop since the validator covers it). Edit
`test_nba_grid.py::test_bundled_seed_is_valid` `12` → `24`. `DATABASE_URL="" $PY manage.py test
trivia.tests.test_nba_grid` → all pass except `test_published_pool_matches_the_seed` (until step 10).

### Step 4 `[opus]` — bingo: 10 → 20 cards

Files: `backend/trivia/data_static/bingo_seed.json`, `backend/trivia/games/bingo.py`.

Formatting: one cell per line with the file's column padding (`{ "type": "team",    "value": "LAL",
"label": "Played for the Lakers" }`); append `bingo-011` … `bingo-020`. Set `EXPECTED_CARDS = 20` in
`bingo.py` (the only code change).

Rules: 16 distinct `(type, value)` cells per card; the validator requires **≥ 4 matches among the 134
dealable players (fame_tier ≤ 3)** per cell — this is the binding constraint. Dealable coverage: teams
LAL 24, BOS 28, GSW 17, CHI 14, MIA 16, NYK 16, PHI 18, SAS 14, DET 15, PHX 14, DAL 17, HOU 22, MIL 17,
CLE 13, POR 12, UTA 11, DEN 11, OKC 17, TOR 17, IND 7, ATL 14, SAC 15, MIN 12, WAS 20, ORL 14, MEM 16,
NOP 14, CHA 9, BKN 16, LAC 23; awards mvp 27, fmvp 24, dpoy 16, roty 27, smoy 5, ring 63, allstar5plus
73, allnba 98; country USA 103, INTL 31, France 4 (all other single countries < 4 — do not use them);
draft top5 64, lottery 102, round2 9, undrafted 3 (**unusable**), decade-1980s 13, 1990s 20, 2000s 38,
2010s 51, 2020s 3 (**unusable**); college none 25, Kentucky 9, Duke 6, UCLA 7, North Carolina 4, Kansas
3 (**unusable**), Arizona 3 (**unusable**); stat 20kpts 37, 25kpts 21, ppg20 48, rpg10 21, apg8 11,
seasons15plus 63; era 1980s 17, 1990s 36, 2000s 67, 2010s 109, 2020s 86.
Variety: each new card uses 4-6 team cells, ≥ 1 cell of each of the other six types, and shares at most
10 of its 16 cells with any other card (old or new); across the ten new cards use every franchise with
≥ 9 dealable players at least once and `IND`/`CHA` never.

Done-check: `DATABASE_URL="" $PY manage.py validate_bingo_seed` → per-card `min=`/`max=` lines then
`OK — 20 cards, every cell has >= 4 dealable (fame<=3) players` (no "expected 20 cards, found N"
warning). Overlap check:

```bash
DATABASE_URL="" $PY - <<'EOF'
import os, django, itertools; os.environ.setdefault("DJANGO_SETTINGS_MODULE","backend.settings"); os.environ["DATABASE_URL"]=""; django.setup()
from trivia.games import bingo
cards = bingo._load_seed(); assert len(cards) == 20
keys = {c["qid"]: {(x["type"], x["value"]) for x in c["cells"]} for c in cards}
bad = [f"{a} shares {len(keys[a]&keys[b])} cells with {b}" for a, b in itertools.combinations(keys, 2)
       if len(keys[a] & keys[b]) > 10 and (int(a[-3:]) > 10 or int(b[-3:]) > 10)]
print("\n".join(bad) or "OK")
EOF
```
`DATABASE_URL="" $PY manage.py test trivia.tests.test_bingo` → all pass.

### Step 5 `[opus]` — connections: 40 → 60 boards

Files: `backend/trivia/data_static/connections_seed.json`, `backend/trivia/tests/test_connections.py`.

Formatting: the file is exactly `json.dumps(boards, indent=2, ensure_ascii=False) + "\n"`; load →
append → dump with those parameters (do not hand-edit). Append `cn-041` … `cn-060`.

Board recipe (verifiability first, D5). Every new board has exactly one group of each kind below;
assign difficulties 1-4 in any order that fits the board, but each board must use each of 1,2,3,4
exactly once:
- **K1 champion roster** — label `"<YYYY> <Nickname> champions"` (season-ending year), members = 4
  players with a curated ring in `YYYY` AND a stint with that franchise covering that season. Menu (use
  each at most once, 20 boards → all 20): 2025 Thunder (OKC), 2024 Celtics (BOS), 2023 Nuggets (DEN),
  2020 Lakers (LAL), 2012 Heat (MIA), 2009 Lakers (LAL), 2007 Spurs (SAS), 2003 Spurs (SAS), 2001 Lakers
  (LAL), 1998 Bulls (CHI), 1997 Bulls (CHI), 1995 Rockets (HOU), 1993 Bulls (CHI), 1990 Pistons (DET),
  1986 Celtics (BOS), 1985 Lakers (LAL), 1984 Celtics (BOS), 1982 Lakers (LAL), 1979 SuperSonics (OKC),
  1978 Bullets (WAS).
- **K2 draft class** — label `"<YYYY> NBA Draft class"` (validator-derivable: `draft.year == YYYY`).
  Menu of unused years: 1984, 1985, 1987, 1992, 1995, 1996, 1997, 1999, 2001, 2004, 2006, 2011, 2012, 2013,
  2014, 2015, 2016, 2017, 2021, 2023. Members must have that exact `draft.year` in curated.
- **K3 origin** — label `"Born in <Country>"` (validator-derivable: `country == Country`). Menu:
  France, Canada, Brazil, Turkey, Cameroon, Argentina, Greece, Croatia, Lithuania, Nigeria, Slovenia,
  Serbia (each has ≥ 4 famous curated players; use each at most twice across the 20 boards and never the
  same four members twice). Do NOT use Australia/Germany/Spain (already boards) and never label a group
  "<Country> national team".
- **K4 college** — label starts with the curated college name exactly, e.g. `"Kansas Jayhawks"`,
  `"UCLA Bruins"`, `"North Carolina Tar Heels"`, `"Connecticut Huskies"`, `"Michigan State Spartans"`,
  `"Arizona Wildcats"`, `"Texas Longhorns"`, `"Florida Gators"`, `"Louisiana State Tigers"`, `"Villanova
   Wildcats"`, `"Ohio State Buckeyes"`, `"Indiana Hoosiers"`, `"Louisville Cardinals"`, `"Notre Dame
   Fighting Irish"`, `"Marquette Golden Eagles"`, `"Illinois Fighting Illini"`, `"Gonzaga Bulldogs"`,
  `"Oklahoma Sooners"`, `"Memphis Tigers"`, `"Georgia Tech Yellow Jackets"` (validator-derivable via
  `_own_derive` because the label *starts with* a college the pool knows ≥ 3 players for; do not reuse
  Duke, Kentucky, Georgetown, Syracuse, Michigan, Wake Forest). Members' curated `college` must equal
  that name.
- K4 membership is only loosely checked by the validator (`_satisfies` substring-matches colleges), so
  the check script below additionally requires each K4 member's curated `college` to be truthy and the
  group label to start with exactly `college + " "` (e.g. college `"Kansas"`, label `"Kansas Jayhawks"`).
- Every tile must `resolve()` (exact `full_name` or an entry in `aliases`, accent-folded) — write the
  tile exactly as the curated `full_name` (e.g. `"Nikola Jokić"`, `"Luka Dončić"`), never a nickname.
- Cross-group traps: a member of one group must not satisfy another group's label on the same board
  (e.g. Andrew Wiggins is both 2014 draft and Born in Canada → cannot share a board). The validator
  reports these as `ambiguous solution`; swap the member, not the label.
- No group may repeat another board's four members (old boards included — the validator checks).

Done-check (all three must pass):
1. `DATABASE_URL="" $PY -m trivia.games.connections_validate` → `OK: 60 boards valid`.
2. Board-content check:
```bash
DATABASE_URL="" $PY - <<'EOF'
# --- curated helpers --- (paste the shared helper block here)
NICK = {"Thunder":"OKC","Celtics":"BOS","Nuggets":"DEN","Lakers":"LAL","Heat":"MIA","Spurs":"SAS","Bulls":"CHI",
        "Rockets":"HOU","Pistons":"DET","SuperSonics":"OKC","Bullets":"WAS"}
boards = json.load(open("trivia/data_static/connections_seed.json", encoding="utf-8")); assert len(boards) == 60
bad = []
for b in boards:
    if int(b["qid"].split("-")[1]) <= 40: continue
    kinds = set()
    for t in b["tiles"]:
        if resolve(t) is None: bad.append(f"{b['qid']}: tile {t!r} not in players_curated (full_name/alias)")
    for g in b["groups"]:
        m = re.match(r"^(\d{4}) (\w+) champions$", g["label"])
        if m:
            kinds.add("K1"); year, abbr = int(m.group(1)), NICK[m.group(2)]
            for name in g["members"]:
                r = resolve(name)
                if r and not (year in r["awards"]["rings"] and on_team_in_season(r, abbr, year)):
                    bad.append(f"{b['qid']}: {name} has no {year} ring with {abbr} in curated")
        elif re.match(r"^\d{4} NBA Draft class$", g["label"]): kinds.add("K2")
        elif g["label"].startswith("Born in "): kinds.add("K3")
        else:
            kinds.add("K4")
            for name in g["members"]:
                r = resolve(name)
                if r and not (r.get("college") and g["label"].startswith(r["college"] + " ")):
                    bad.append(f"{b['qid']}: {name} college {r.get('college')!r} does not match K4 label {g['label']!r}")
    # K1 cross-trap: nobody OUTSIDE the champion group may also hold that ring with that franchise.
    for g in b["groups"]:
        m = re.match(r"^(\d{4}) (\w+) champions$", g["label"])
        if not m: continue
        year, abbr = int(m.group(1)), NICK[m.group(2)]
        for other in b["groups"]:
            if other is g: continue
            for name in other["members"]:
                r = resolve(name)
                if r and year in r["awards"]["rings"] and on_team_in_season(r, abbr, year):
                    bad.append(f"{b['qid']}: {name} (in {other['label']!r}) also fits {g['label']!r} -- ambiguous")
    if kinds != {"K1", "K2", "K3", "K4"}: bad.append(f"{b['qid']}: group kinds {sorted(kinds)} != K1-K4")
print("\n".join(bad) or "OK")
EOF
```
3. `test_connections.py::test_build_pool_nonempty_and_valid` `40` → `60`;
   `DATABASE_URL="" $PY manage.py test trivia.tests.test_connections` → all pass (the qid-specific
   tests use `cn-003/010/023/032/036/040`, untouched by appending).

### Step 6 `[opus]` — who-would-win: 30 → 60 matchups

Files: `backend/trivia/data_static/who_would_win_seed.json`, `backend/trivia/tests/test_who_would_win.py`.

Formatting: one matchup object per line, `  {"qid": ..., "a": {...}, "b": {...}},` (compact, two-space
indent, `·` allowed in subs), last line without the trailing comma, file ends `]\n`. Append `www-031`
… `www-060`.

Pinned matchups (label = `'YY Nickname`; season = the one ending in 20YY/19YY; franchise abbr for the
stint check in brackets):

| qid | a | b |
|---|---|---|
| www-031 | '25 Thunder [OKC, 2025] | '16 Warriors [GSW, 2016] |
| www-032 | '19 Bucks [MIL, 2019] | '22 Celtics [BOS, 2022] |
| www-033 | '07 Mavs [DAL, 2007] | '07 Suns [PHX, 2007] |
| www-034 | '14 Heat [MIA, 2014] | '15 Cavs [CLE, 2015] |
| www-035 | '90 Pistons [DET, 1990] | '84 Celtics [BOS, 1984] |
| www-036 | '82 Lakers [LAL, 1982] | '81 Celtics [BOS, 1981] |
| www-037 | '92 Bulls [CHI, 1992] | '73 Knicks [NYK, 1973] |
| www-038 | '69 Celtics [BOS, 1969] | '75 Warriors [GSW, 1975] |
| www-039 | '76 Celtics [BOS, 1976] | '78 Bullets [WAS, 1978] |
| www-040 | '08 Lakers [LAL, 2008] | '10 Celtics [BOS, 2010] |
| www-041 | '18 Warriors [GSW, 2018] | '12 Spurs [SAS, 2012] |
| www-042 | '03 Kings [SAC, 2003] | '04 Wolves [MIN, 2004] |
| www-043 | '06 Pistons [DET, 2006] | '05 Heat [MIA, 2005] |
| www-044 | '01 Sixers [PHI, 2001] | '01 Bucks [MIL, 2001] |
| www-045 | '97 Bulls [CHI, 1997] | '89 Lakers [LAL, 1989] |
| www-046 | '94 Knicks [NYK, 1994] | '99 Knicks [NYK, 1999] |
| www-047 | '90 Blazers [POR, 1990] | '91 Lakers [LAL, 1991] |
| www-048 | '86 Rockets [HOU, 1986] | '88 Pistons [DET, 1988] |
| www-049 | '98 Jazz [UTA, 1998] | '98 Pacers [IND, 1998] |
| www-050 | '02 Nets [BKN, 2002] | '01 Raptors [TOR, 2001] |
| www-051 | '10 Suns [PHX, 2010] | '10 Magic [ORL, 2010] |
| www-052 | '15 Hawks [ATL, 2015] | '15 Clippers [LAC, 2015] |
| www-053 | '16 Thunder [OKC, 2016] | '21 Nets [BKN, 2021] |
| www-054 | '20 Clippers [LAC, 2020] | '20 Bucks [MIL, 2020] |
| www-055 | '21 Suns [PHX, 2021] | '22 Grizzlies [MEM, 2022] |
| www-056 | '23 Heat [MIA, 2023] | '23 Lakers [LAL, 2023] |
| www-057 | '24 Mavs [DAL, 2024] | '25 Pacers [IND, 2025] |
| www-058 | '24 Wolves [MIN, 2024] | '25 Knicks [NYK, 2025] |
| www-059 | '13 Grizzlies [MEM, 2013] | '13 Pacers [IND, 2013] |
| www-060 | '17 Rockets [HOU, 2017] | '19 Blazers [POR, 2019] |

`sub` for each side: 2-4 player names, comma-separated, each written exactly as the curated
`full_name` (or an alias), each with a stint for that franchise covering that season; no records,
seeds, or slogans (nothing can verify "72-10"). ≤ 90 characters. Labels ≤ 60.

Done-check (must print `OK`):
```bash
DATABASE_URL="" $PY - <<'EOF'
# --- curated helpers --- (paste the shared helper block here)
from trivia.games.who_would_win import _load_seed, validate_rows
PLAYOFF = json.load(open("trivia/data/playoff.json", encoding="utf-8"))
NICK = {"Thunder":("OKC","Thunder"),"Warriors":("GSW","Warriors"),"Bucks":("MIL","Bucks"),"Celtics":("BOS","Celtics"),
 "Mavs":("DAL","Mavericks"),"Suns":("PHX","Suns"),"Heat":("MIA","Heat"),"Cavs":("CLE","Cavaliers"),"Pistons":("DET","Pistons"),
 "Lakers":("LAL","Lakers"),"Bulls":("CHI","Bulls"),"Knicks":("NYK","Knicks"),"Bullets":("WAS","Bullets"),"Spurs":("SAS","Spurs"),
 "Kings":("SAC","Kings"),"Wolves":("MIN","Timberwolves"),"Sixers":("PHI","76ers"),"Blazers":("POR","Trail Blazers"),
 "Rockets":("HOU","Rockets"),"Jazz":("UTA","Jazz"),"Pacers":("IND","Pacers"),"Nets":("BKN","Nets"),"Raptors":("TOR","Raptors"),
 "Magic":("ORL","Magic"),"Hawks":("ATL","Hawks"),"Clippers":("LAC","Clippers"),"Grizzlies":("MEM","Grizzlies")}
rows = _load_seed(); assert len(rows) == 60, len(rows); assert validate_rows(rows) == [], validate_rows(rows)
bad = []
for r in rows:
    if int(r["qid"].split("-")[1]) <= 30: continue
    for side in ("a", "b"):
        m = re.match(r"^'(\d\d) (\w+)$", r[side]["label"])
        if not m: bad.append(f"{r['qid']}{side}: label {r[side]['label']!r} not 'YY Nick"); continue
        yy, nick = int(m.group(1)), m.group(2); year = 2000 + yy if yy < 30 else 1900 + yy
        abbr, suffix = NICK[nick]; season = f"{year-1}-{str(year)[-2:]}"
        if not any(s["season"] == season and (s["team_a"].endswith(suffix) or s["team_b"].endswith(suffix)) for s in PLAYOFF):
            bad.append(f"{r['qid']}{side}: no {season} playoff series for a team ending in {suffix!r}")
        for name in [n.strip() for n in r[side].get("sub", "").split(",") if n.strip()]:
            p = resolve(name)
            if p is None: bad.append(f"{r['qid']}{side}: {name!r} not in curated")
            elif not on_team_in_season(p, abbr, year): bad.append(f"{r['qid']}{side}: {name} has no {abbr} stint covering {season}")
print("\n".join(bad) or "OK")
EOF
```
`test_who_would_win.py::test_seed_loads_and_validates` `assertGreaterEqual(len(rows), 30)` → `60`.
`DATABASE_URL="" $PY manage.py test trivia.tests.test_who_would_win` → all pass.

### Step 7 `[opus]` — fan-favorites: 24 → 40 questions + `seed_fan_favorites` writes `category`

Files: `backend/trivia/data_static/fan_favorites_seed.json`,
`backend/trivia/management/commands/seed_fan_favorites.py`, `backend/trivia/tests/test_fan_favorites.py`.

1. Test first — add to `test_fan_favorites.py`:
```python
from django.core.management import call_command

class SeedCommandTests(TestCase):
    def test_seed_command_writes_category(self):
        call_command("seed_fan_favorites")
        self.assertEqual(FanFavoritesQuestion.objects.get(qid="ff-002").category, "team")
        self.assertEqual(FanFavoritesQuestion.objects.get(qid="ff-001").category, "player")
```
   Run `DATABASE_URL="" $PY manage.py test trivia.tests.test_fan_favorites.SeedCommandTests` → FAILS
   (`'player' != 'team'`). Then in `seed_fan_favorites.py` add `"category": q.get("category", "player"),`
   to the `defaults` dict (after `"survey_date"`). Re-run → passes.
2. Append questions `ff-025` … `ff-040` to `questions` (file is `json.dumps(indent=2,
   ensure_ascii=False) + "\n"`; load → append → dump). Each: `id`, `prompt`, `survey_date:
   "2026-09-30"`, `category` (`player` or `team`), `answers` ≥ 6 (aim 7-10), `count`s positive integers
   summing to exactly 100 in strictly descending order, `aliases` = lowercase surname, unaccented full
   name, common nickname(s); `answer` = curated `full_name` exactly (players) or the `full_name` in
   `trivia/data/name-logo.json` (teams). Pinned prompts and derivation rules (compute the candidate
   list with the snippet below, then pick the 7-10 most famous as answers — lowest `fame_tier` first):

   | id | category | prompt | rule over curated (`CUR`) / playoff.json |
   |---|---|---|---|
   | ff-025 | player | Name a player with 10,000+ career assists | `career.ast >= 10000` |
   | ff-026 | player | Name a player with 15,000+ career rebounds | `career.reb >= 15000` |
   | ff-027 | player | Name a Rookie of the Year who later won MVP | `awards.roty is not None and awards.mvp` |
   | ff-028 | player | Name a Defensive Player of the Year who also won an NBA title | `awards.dpoy and awards.rings` |
   | ff-029 | player | Name a second-round pick who made an All-NBA team | `draft and draft.round == 2 and awards.allnba_count > 0` |
   | ff-030 | player | Name an undrafted player who won an NBA championship | `draft is None and awards.rings` |
   | ff-031 | player | Name a player with 20,000+ points who never won an NBA title | `career.pts >= 20000 and not awards.rings` |
   | ff-032 | player | Name an NBA player born in Canada | `country == "Canada"` |
   | ff-033 | player | Name a player with 8 or more career assists per game | `career.apg >= 8` |
   | ff-034 | player | Name an MVP who was drafted outside the top 10 | `awards.mvp and draft and draft.pick > 10` |
   | ff-035 | player | Name a 5-time All-Star who played for the New York Knicks | `awards.allstar_count >= 5 and any(s.abbr == "NYK")` |
   | ff-036 | player | Name a player who averaged 10+ rebounds per game for his career | `career.rpg >= 10` |
   | ff-037 | team | Name a franchise that has won an NBA title since 2010 | playoff.json rows with `round == "NBA Finals"` and season ≥ `2009-10`: `winner` → current franchise |
   | ff-038 | team | Name a team that reached the NBA Finals in the 2020s | `round == "NBA Finals"`, season ≥ `2019-20`: both `team_a`/`team_b` |
   | ff-039 | team | Name a franchise that has won back-to-back NBA titles | consecutive-season `NBA Finals` winners with the same franchise id (the numeric id in `team_*_logo` — map to the current name via `name-logo.json` `team_id`) |
   | ff-040 | team | Name a team Dwight Howard played for | stints of `resolve("Dwight Howard")` → stint `name` mapped to the current franchise name |

   Alternates if a rule yields < 6 answers (swap in, keep the id): "Name a team Russell Westbrook played
   for" (team), "Name a player with 15 or more NBA seasons who never made an All-Star team"
   (`career.seasons >= 15 and awards.allstar_count == 0`, player), "Name a Sixth Man of the Year who also
   won an NBA title" (`awards.smoy and awards.rings`, player).

   Candidate snippet (prints every match with fame tier, most famous first):
```bash
DATABASE_URL="" $PY - <<'EOF'
# --- curated helpers --- (paste the shared helper block here)
rule = lambda r: r["career"]["ast"] >= 10000        # <- replace per prompt
hits = sorted((r for r in CUR if rule(r)), key=lambda r: (r["fame_tier"], -r["career"]["seasons"]))
print(len(hits)); print("\n".join(f'{r["fame_tier"]} {r["full_name"]}' for r in hits[:40]))
EOF
```
3. Done-check:
```bash
DATABASE_URL="" $PY - <<'EOF'
# --- curated helpers --- (paste the shared helper block here)
from trivia.utils.fan_favorites import load_seed
from trivia.data_pipeline.validate import validate_pool
TEAMS = {t["full_name"] for t in json.load(open("trivia/data/name-logo.json", encoding="utf-8"))}
qs = load_seed(); assert len(qs) == 40, len(qs); assert validate_pool("fan-favorites", qs) == [], validate_pool("fan-favorites", qs)
bad = []
for q in qs:
    if int(q["qid"].split("-")[1]) <= 24: continue
    if q["category"] not in ("player", "team"): bad.append(f"{q['qid']}: category {q['category']}")
    if sum(a["count"] for a in q["answers"]) != 100: bad.append(f"{q['qid']}: counts sum {sum(a['count'] for a in q['answers'])}")
    if len({a["count"] for a in q["answers"]}) != len(q["answers"]): bad.append(f"{q['qid']}: tied counts")
    for a in q["answers"]:
        ok = (resolve(a["answer"]) is not None and resolve(a["answer"])["full_name"] == a["answer"]) if q["category"] == "player" else a["answer"] in TEAMS
        if not ok: bad.append(f"{q['qid']}: answer {a['answer']!r} is not a canonical curated/name-logo name")
        if not a.get("aliases"): bad.append(f"{q['qid']}: {a['answer']} has no aliases")
print("\n".join(bad) or "OK")
EOF
```
   Edit `test_fan_favorites.py::test_load_seed_returns_24_normalized_questions` → `..._40_...`, `24` →
   `40`. `DATABASE_URL="" $PY manage.py test trivia.tests.test_fan_favorites` → all pass.

### Step 8 `[sonnet]` — Question-store `TARGET` bumps + offline dry run

Files: `backend/trivia/questions/games/career_path.py` (`TARGET = 300` → `500`),
`backend/trivia/questions/games/superdraft.py` (`TARGET = 200` → `300`),
`backend/trivia/questions/games/tictactoe.py` (`TARGET = 60` → `120`). Nothing else changes (no
`MINIMUM`, no `who_are_ya`/`imposter`/`contexto`, no runner code). Add one comment line above each
changed constant: `# 2026-09-30: raised from <old> (expand-question-pools); eligible pool comfortably
larger, see docs/team/designs/2026-09-30-expand-question-pools.md`.

Done-check — real-dataset dry run in an in-memory sqlite DB (nothing written, no credentials):
```bash
DATABASE_URL="sqlite://:memory:" $PY - <<'EOF'
import os, json, random, time, django
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings"); django.setup()
from django.core.management import call_command
call_command("migrate", verbosity=0)
from trivia.questions import runner
from trivia.questions.base import load_dataset_from_rows
from trivia.questions.games import GAME_MODULES
ds = load_dataset_from_rows(json.load(open("trivia/data_static/players_curated.json", encoding="utf-8")), "local-curated")
t = time.time()
summary = runner.run(["career-path", "superdraft", "tictactoe"], publish=False, dry_run=True, rng=random.Random(1), dataset=ds)
print(summary, f"{time.time()-t:.0f}s")
for slug in ("career-path", "superdraft", "tictactoe"):
    assert summary[slug]["active"] == GAME_MODULES[slug].TARGET, (slug, summary[slug])
    assert summary[slug]["retired"] == 0, (slug, summary[slug])
print("OK")
EOF
```
Expected: `career-path: active 500`, `superdraft: active 300`, `tictactoe: active 120`, `retired 0`,
`OK`, total well under 10 minutes (record the seconds in your notes; > 15 min means the daily job would
be at risk — then halve the tictactoe bump to 90 and re-run). Also run
`DATABASE_URL="" $PY manage.py test trivia.tests.test_questions_runner trivia.tests.test_questions_registry
trivia.tests.test_questions_tictactoe trivia.tests.test_questions_superdraft` → all pass (they patch or
never pin `TARGET`).

### Step 9 `[sonnet]` — wordle headroom check (measurement only, no content)

No product file changes. Run from `backend/`:
```bash
$PY - <<'EOF'
import json, re, unicodedata
from trivia.utils.text_utils import wordle_word   # run with cwd=backend so the import resolves
names = json.load(open("trivia/data/all-players.json", encoding="utf-8"))
pool = {w.upper() for w in json.load(open("trivia/data/wordle.json", encoding="utf-8"))}
SUF = re.compile(r"\s+(Jr\.?|Sr\.?|II|III|IV|V)$")
cur, strip = set(), set()
for n in names:
    last = n.split(" ", 1)[1] if " " in n else n          # Player.last_name = DISPLAY_LAST_COMMA_FIRST before the comma
    w = wordle_word(last); s = wordle_word(SUF.sub("", last))
    if w: cur.add(w.upper())
    if s: strip.add(s.upper())
print("pool", len(pool), "| build rule over the 5,208-name index", len(cur), "| not yet in pool", sorted(cur - pool))
print("extra via suffix stripping", len(strip - cur), sorted(strip - cur))
EOF
```
(If the import fails, prefix `DATABASE_URL="" DJANGO_SETTINGS_MODULE=backend.settings` — `text_utils`
has no Django dependency, a plain `python -c` from `backend/` works.)
Expected output: `pool 525 | build rule ... 525 | not yet in pool ['AJAYI', 'AWAKA']` and `extra via
suffix stripping 6 ['ACUFF', 'CAREY', 'CENAC', 'GILES', 'LEMON', 'OUBRE']`. Done: the numbers match D8;
if they differ, update the two numbers in D8 of this doc and in the step-11 note. Outcome for the card:
**wordle is maxed at 525; +6 possible only with a suffix-stripping rule change (follow-up).**

### Step 10 `[sonnet]` — serial: rebuild the pools, run the suite, commit

Runs only after steps 1-9 are complete. From `backend/`:
1. `DATABASE_URL="" $PY manage.py migrate --noinput` (creates the gitignored `db.sqlite3`).
2. `DATABASE_URL="" $PY manage.py seed_fan_favorites` → `Seeded 40 Fan Favorites questions`.
3. `DATABASE_URL="" $PY manage.py build_pools_from_db --label <YYYY-MM-DD>` where `<YYYY-MM-DD>` is
   today's UTC date (append `.1` if it equals the current `manifest.json` `version`). Expected output:
   `skip name-logo`, `skip wordle`, `skip mvps`, `skip playoff`, `skip starting-five` (each "empty pool
   … kept existing file"), `wrote` lines for `all-players (5208)`, `fan-favorites (40)`, `heatmap (12)`,
   `connections (60)`, `nba-grid (24)`, `tictactoe (16)`, `bingo (20)`, `who-would-win (60)`,
   `imposter (99)`, `players-index (4900)`, then `Regenerated 10 pools + manifest`. Any `skip` for a
   seed-backed game means its validator failed — stop and fix that game's step; never hand-edit
   `trivia/data/`.
4. `git status --short trivia/data` (cwd is `backend/`) must list exactly: `manifest.json`, `all-players.json`
   (order change, D1), `fan-favorites.json`, `heatmap.json`, `connections.json`, `nba-grid.json`,
   `tictactoe.json`, `bingo.json`, `who-would-win.json`. `players-index.json` and `imposter.json` must
   NOT appear (byte-identical); if they do, the curated file changed underneath — stop and report.
5. Manifest check (Test plan §5) prints the expected counts.
6. `DATABASE_URL="" $PY manage.py test trivia users` → green; `DATABASE_URL="" $PY manage.py check`;
   `DATABASE_URL="" $PY manage.py makemigrations --check --dry-run` → `No changes detected`.
7. Delete `backend/db.sqlite3` (gitignored, but leave the worktree clean).
8. Commit everything from steps 1-10 in one commit:
   (still from `backend/`, so address the repo root with `-C ..`):
   `git -C .. add -A backend/trivia docs/team/designs && git -C .. commit -m "feat(data): expand heatmap, tictactoe, grid, bingo, connections, who-would-win and fan-favorites pools"`
   (no Co-Authored-By / AI trailer).

### Step 11 `[sonnet]` — content-quality guidelines note

File: `docs/DATA_PIPELINE.md`. Append a new section immediately before `## Superseded command (do not
use)`, titled `## Authoring seed content — quality guidelines`, with exactly these points (prose, one
bullet each; keep it under 40 lines):
- Source of truth: every player named in a seed must resolve to a `players_curated.json` row by exact
  `full_name` or a listed alias (accent-folded); write the curated spelling (`Nikola Jokić`), never a
  nickname. Team-seasons resolve against `trivia/data/playoff.json`; franchise names against
  `trivia/data/name-logo.json`.
- Only author claims the data can prove: criteria from the shared vocabulary (team/award/country/
  draft/college/stat/era), draft years, birthplaces, colleges, rings + stints for "YYYY <Team>
  champions", award years for "<decade> <award>" groups. No records ("72-10"), no scoring titles, no
  dunk contests, no "greatest" lists unless the group is an explicit opinion prompt.
- Depth floors: tictactoe and nba-grid ≥ 3 playable solvers per cell (validator enforces 1 and 3
  respectively — author to 3), bingo ≥ 4 dealable (fame ≤ 3) per cell, heatmap ≥ 2 per closed
  neighbourhood (generator + validator), fan-favorites ≥ 6 answers from a computed candidate list.
- Variety over volume: a new board must differ from every existing board in ≥ 3 of 6 criteria
  (grid/tictactoe) or share ≤ 10 of 16 cells (bingo); spread franchises, decades and criterion types;
  never reuse a four-member group; one label kind per group on connections boards.
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
This step runs after step 10 has committed. Done: the section renders as Markdown (no broken tables),
`git diff --stat -- docs/DATA_PIPELINE.md` (from the repo root) shows only additions. Commit with an
explicit pathspec so nothing else is swept in:
`git commit -m "docs(data): seed content-quality guidelines from the pool expansion" -- docs/DATA_PIPELINE.md`.

## Self-review (skill step 5b)

- Coverage: every game in the spec has a step or a recorded decision (heatmap 1, tictactoe 2 + 8,
  nba-grid 3, bingo 4, connections 5, who-would-win 6, fan-favorites 7, career-path/superdraft 8,
  who-are-ya/imposter/contexto/pack-five D2, wordle D8 + 9, name-logo/mvps/playoff untouched by spec);
  "run each existing validator" → per-step commands; "verifiably correct" → D5-D7 + check scripts;
  "variety" → per-step rules; "guidelines for a future task" → step 11; hidden games kept → yes.
- No placeholders: every step names files, exact edits, commands and expected output.
- Consistency: counts 12/16/24/20/60/60/40 and TARGETs 500/300/120 appear identically in D3, File plan,
  Test plan and steps; the shared helper block is referenced by name in steps 2-7.
- Scope: no validator rewrites, no dataset re-tiering, no frontend change, no credentials.
- Ambiguity settled: "fan out per game" = one step per game, parallelisable, serial tail (step 10);
  "wordle headroom" = D8 outcome; "hidden games" = expanded, not surfaced; heatmap regeneration = D4.

## Parked / handoff (owner or follow-up card; no credentials in this run)

- **Owner, before 2026-10-01 04:00:** run `venv\Scripts\python.exe manage.py seed_fan_favorites` from the
  home machine so the production `FanFavoritesQuestion` table holds all 40 boards; otherwise the
  monthly `refresh_nba_data.cmd` rebuilds `fan-favorites.json` back to 24 (D9).
- Follow-up card: contexto secret exhaustion (`NO_REPEAT_DAYS = 365` vs 99 tier 1-2 players).
- Follow-up card: fame-tier re-tiering in `players_curated.json` (unlocks who-are-ya, imposter,
  contexto, pack-five variety).
- Follow-up card: `connections_validate.py` fold-aware/alias index + unknown-tile failure; repair the 11
  legacy tiles (incl. "Gerry McNamara", who never played in the NBA, on `cn-030`).
- Follow-up (optional): `wordle_word` generational-suffix stripping (+6 answers).
