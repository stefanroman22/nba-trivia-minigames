# Who Would Win? Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the "Who Would Win?" opinion-voting minigame: 10 era-hypothetical matchups per session, tap-a-side voting logged through the GuessLog flywheel, live community split bars from a GuessLog aggregation endpoint, and a crowd-agreement summary screen that ends with `onGameEnd(0)`.

**Architecture:** The scaffolder already pre-staged ALL shared wiring (GameUtils entry with `fetchData: () => fetchGamePool("who-would-win", 10)`, RenderGame case, App route, `WwwMatchup` type, module registration in `trivia/games/__init__.py`). This plan only replaces the three stub files it owns (renderer, CSS, backend module) and creates the seed. Votes are POSTed as `correct:false` GuessLog entries via the existing `/trivia/log-guesses/` endpoint; the live split is a new `EXTRA_URLS` view in the game's own backend module that groups GuessLog rows by answer. The static pool `backend/trivia/data/who-would-win.json` is generated from the seed via `build_pools_from_db` (sqlite fallback).

**Tech Stack:** React 19 + TypeScript strict + framer-motion (frontend), Django + DRF (backend), plain `fetch`/`apiFetch` (no new deps).

## Global Constraints

- **Never** run tests/migrate against the Supabase `DATABASE_URL` in `backend/.env` — always prefix backend commands with `DATABASE_URL=""` (sqlite fallback). All backend commands in this plan run from Git Bash.
- Modify **NOTHING shared**: `GameUtils.tsx`, `RenderGame.tsx`, `App.tsx`, `types/types.tsx`, `pool.ts`, `criteria.ts`, `trivia/games/__init__.py`, `trivia/urls.py`, `views.py`, `models.py` are pre-staged/frozen. This game only owns the four files listed per task below.
- Design system: `--brand` #ff6a1a is the **sole accent**; green/red only for good/bad feedback (not used here — crowd agreement is not "correct"). Tokens from `src/styles/theme.css` only, `clamp()` sizing, `.font-display` headings, `.tnum` on every number.
- UI bar: play area fits 390x844 with NO page scroll (in-component scroll allowed only inside the summary list); touch targets >= 44px (whole half-card is the tap target); visible `:focus-visible` states; loading/error/empty states for every fetch; motion respects `useReducedMotion`; no layout shift when the split reveals (split area has reserved fixed height).
- GAME END CONTRACT: `onGameEnd(0)` exactly once, guarded by `endedRef` + reset effect on `[gameInfo]`. This game awards no points; the custom summary screen shows BEFORE `onGameEnd(0)` fires (user taps "Finish").
- Renderer signature (frozen contract #5): default-exports `WhoWouldWin({ gameInfo, onGameEnd, turn?, onTurnAction?, multiplayer? })` with `gameInfo: WwwMatchup[]`. `WwwMatchup` already exists in `src/types/types.tsx:158` as `{ qid: string; a: { label: string; sub?: string }; b: { label: string; sub?: string } }` — do not edit it.
- Backend module contract (#4): `backend/trivia/games/who_would_win.py` exposes `get_round(request)` -> `JsonResponse({'series':[...]})` from the bundled seed, `build_pool()`, `validate_rows(rows)`, `EXTRA_URLS`. The games package auto-registers these; do not touch `__init__.py`.
- Guess-log flywheel (#7): vote = POST `${BACKEND_ORIGIN}/trivia/log-guesses/` with `{game:"who-would-win", entries:[{question_id: qid, answer: "a"|"b", correct: false, elapsed_ms}]}` using `apiFetch` from `src/utils/Api.tsx` (adds JWT when present; guests log anonymously).
- Repo root for all commands: `c:/Users/stefa/OneDrive/Desktop/nba-projects/nba-minigames`.

**Files owned by this plan (complete list):**
- Create: `backend/trivia/data_static/who_would_win_seed.json`
- Create (generated): `backend/trivia/data/who-would-win.json` (+ regenerated `backend/trivia/data/manifest.json`)
- Overwrite stub: `backend/trivia/games/who_would_win.py`
- Create: `backend/trivia/tests/test_who_would_win.py`
- Overwrite stub: `src/Game Renderers/WhoWouldWin.tsx`
- Overwrite stub: `src/styles/WhoWouldWin.css`

Validator decision (recorded): no separate script file — `validate_rows()` lives in the game module per contract #4 and is run standalone via `manage.py shell -c` (Task 2) and automatically by `build_pools_from_db` via `trivia/data_pipeline/validate.py` (already wired; `VALIDATORS` picks it up from the module).

---

### Task 1: Author the seed — 30 matchups with factual care

**Files:**
- Create: `backend/trivia/data_static/who_would_win_seed.json`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: seed rows in the exact `WwwMatchup` shape `{qid, a:{label, sub}, b:{label, sub}}` consumed by Task 2's `_load_seed()`/`validate_rows()`, Task 3's tests, and Task 4's pool build. `qid` format: `"www-001"`…`"www-030"`, unique. `label` <= 60 chars, `sub` <= 90 chars.

**Factual-care rules:** every record/streak in a `sub` must be real (they are pre-verified below — copy them verbatim; do NOT invent new records). Star names must belong to that exact season's roster. `sub` is flavor, not stats trivia — where a record is not certain, the sub names the storyline instead.

- [ ] **Step 1: Write the seed file** with exactly this content (all 30 rows, verified facts):

```json
[
  {"qid": "www-001", "a": {"label": "'96 Bulls", "sub": "72-10 · Jordan, Pippen, Rodman"}, "b": {"label": "'17 Warriors", "sub": "Curry, Durant, Klay, Draymond"}},
  {"qid": "www-002", "a": {"label": "'01 Lakers", "sub": "Shaq & Kobe · 15-1 playoff run"}, "b": {"label": "'13 Heat", "sub": "LeBron, Wade, Bosh · 27-game win streak"}},
  {"qid": "www-003", "a": {"label": "'86 Celtics", "sub": "Bird, McHale, Parish · 40-1 at home"}, "b": {"label": "'87 Lakers", "sub": "Magic, Kareem, Worthy · Showtime peak"}},
  {"qid": "www-004", "a": {"label": "'14 Spurs", "sub": "Duncan, Parker, Manu, Kawhi · the beautiful game"}, "b": {"label": "'04 Pistons", "sub": "Billups, Rip, Ben & Rasheed · Goin' to Work"}},
  {"qid": "www-005", "a": {"label": "'16 Cavs", "sub": "LeBron, Kyrie, Love · back from 3-1 down"}, "b": {"label": "'11 Mavs", "sub": "Dirk's revenge tour"}},
  {"qid": "www-006", "a": {"label": "'83 Sixers", "sub": "Moses Malone & Dr. J · Fo', Fo', Fo'"}, "b": {"label": "'89 Pistons", "sub": "Bad Boys · Isiah, Dumars, Rodman"}},
  {"qid": "www-007", "a": {"label": "'72 Lakers", "sub": "33 straight wins · West & Chamberlain"}, "b": {"label": "'70 Knicks", "sub": "Willis Reed, Frazier, DeBusschere"}},
  {"qid": "www-008", "a": {"label": "'97 Jazz", "sub": "Stockton to Malone"}, "b": {"label": "'05 Suns", "sub": "Seven seconds or less · Nash, Amar'e, Marion"}},
  {"qid": "www-009", "a": {"label": "'08 Celtics", "sub": "KG, Pierce, Ray Allen"}, "b": {"label": "'10 Lakers", "sub": "Kobe & Pau · back-to-back champs"}},
  {"qid": "www-010", "a": {"label": "'95 Rockets", "sub": "Clutch City · Hakeem & Drexler"}, "b": {"label": "'93 Suns", "sub": "MVP Barkley, KJ, Majerle"}},
  {"qid": "www-011", "a": {"label": "'19 Raptors", "sub": "Kawhi's run · The Shot"}, "b": {"label": "'21 Bucks", "sub": "Giannis' 50-point closeout"}},
  {"qid": "www-012", "a": {"label": "'02 Kings", "sub": "Webber, Peja, Bibby, Divac"}, "b": {"label": "'00 Blazers", "sub": "Sheed, Pippen, Steve Smith"}},
  {"qid": "www-013", "a": {"label": "'91 Bulls", "sub": "Jordan's first title"}, "b": {"label": "'85 Lakers", "sub": "finally beat Boston in the Garden"}},
  {"qid": "www-014", "a": {"label": "'03 Spurs", "sub": "Duncan's Finals masterpiece"}, "b": {"label": "'06 Heat", "sub": "Shaq & prime Flash"}},
  {"qid": "www-015", "a": {"label": "'67 Sixers", "sub": "68-13 · Wilt Chamberlain"}, "b": {"label": "'71 Bucks", "sub": "66-16 · Kareem & Oscar"}},
  {"qid": "www-016", "a": {"label": "'96 Sonics", "sub": "64-18 · Kemp & Payton"}, "b": {"label": "'00 Pacers", "sub": "Reggie Miller, Rik Smits, Jalen Rose"}},
  {"qid": "www-017", "a": {"label": "'95 Magic", "sub": "young Shaq & Penny"}, "b": {"label": "'99 Spurs", "sub": "Twin Towers · Duncan & Robinson"}},
  {"qid": "www-018", "a": {"label": "'12 Thunder", "sub": "KD, Russ, Harden — all 23 or younger"}, "b": {"label": "'07 Spurs", "sub": "Duncan, Parker, Manu · Finals sweep"}},
  {"qid": "www-019", "a": {"label": "'20 Lakers", "sub": "LeBron & AD · bubble champs"}, "b": {"label": "'23 Nuggets", "sub": "Jokic's coronation"}},
  {"qid": "www-020", "a": {"label": "'24 Celtics", "sub": "64-18 · Tatum & Brown"}, "b": {"label": "'17 Cavs", "sub": "LeBron, Kyrie, Love"}},
  {"qid": "www-021", "a": {"label": "'98 Bulls", "sub": "The Last Dance"}, "b": {"label": "'02 Lakers", "sub": "three-peat capper"}},
  {"qid": "www-022", "a": {"label": "'77 Blazers", "sub": "Bill Walton's title"}, "b": {"label": "'79 Sonics", "sub": "Seattle's only crown · DJ & Gus Williams"}},
  {"qid": "www-023", "a": {"label": "'15 Warriors", "sub": "dawn of the dynasty"}, "b": {"label": "'16 Spurs", "sub": "67-15 · Kawhi & LaMarcus"}},
  {"qid": "www-024", "a": {"label": "'06 Mavs", "sub": "Dirk & Josh Howard"}, "b": {"label": "'09 Magic", "sub": "Dwight and a wall of shooters"}},
  {"qid": "www-025", "a": {"label": "'92 Blazers", "sub": "Clyde Drexler, Terry Porter"}, "b": {"label": "'93 Knicks", "sub": "60 wins · Ewing, Starks, Oakley"}},
  {"qid": "www-026", "a": {"label": "'88 Lakers", "sub": "Pat Riley's guaranteed repeat"}, "b": {"label": "'94 Rockets", "sub": "MVP Hakeem Olajuwon"}},
  {"qid": "www-027", "a": {"label": "'11 Bulls", "sub": "62-20 · MVP Derrick Rose"}, "b": {"label": "'13 Spurs", "sub": "one rebound from a ring"}},
  {"qid": "www-028", "a": {"label": "'18 Rockets", "sub": "65-17 · Harden & CP3"}, "b": {"label": "'09 Cavs", "sub": "66-16 · MVP LeBron"}},
  {"qid": "www-029", "a": {"label": "'22 Warriors", "sub": "Curry's fourth ring"}, "b": {"label": "'12 Heat", "sub": "LeBron's first title"}},
  {"qid": "www-030", "a": {"label": "'60s Celtics", "sub": "Russell's eight straight titles"}, "b": {"label": "'80s Lakers", "sub": "five rings of Showtime"}}
]
```

- [ ] **Step 2: Verify the file parses and has 30 unique qids**

Run (Git Bash, repo root):
```bash
python -c "import json;rows=json.load(open('backend/trivia/data_static/who_would_win_seed.json',encoding='utf-8'));qids=[r['qid'] for r in rows];assert len(rows)==30 and len(set(qids))==30, (len(rows),len(set(qids)));print('OK 30 rows, unique qids')"
```
Expected: `OK 30 rows, unique qids`

- [ ] **Step 3: Commit**

```bash
git add backend/trivia/data_static/who_would_win_seed.json
git commit -m "feat(who-would-win): author 30-matchup seed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Backend module — get_round, live tally endpoint, validator (TDD)

**Files:**
- Overwrite: `backend/trivia/games/who_would_win.py` (scaffold stub — this game agent owns it)
- Test: `backend/trivia/tests/test_who_would_win.py` (create)

**Interfaces:**
- Consumes: seed from Task 1; `GuessLog` model (`trivia/models.py:157` — fields `game`, `question_id`, `answer`, `correct`, `elapsed_ms`, indexed on `["game","question_id"]`); games package auto-registration (`get_round` -> URL name `who-would-win` at `/trivia/who-would-win/`, `EXTRA_URLS` appended verbatim).
- Produces:
  - `get_round(request) -> JsonResponse({"series": [<10 distinct seed rows>]})`
  - `get_tally(request)` at `/trivia/who-would-win/tally/?qid=<qid>` (URL name `who-would-win-tally`) -> `JsonResponse({"qid": str, "a": int, "b": int, "total": int})`; 400 `{"error": "qid is required"}` when qid missing.
  - `build_pool() -> list` (all 30 seed rows), `validate_rows(rows) -> list[str]`.
  - Frontend (Task 5) depends on the exact tally JSON keys `qid/a/b/total`.

- [ ] **Step 1: Write the failing tests** — create `backend/trivia/tests/test_who_would_win.py`:

```python
import json

from django.test import TestCase
from django.urls import reverse

from trivia.games.who_would_win import _load_seed, validate_rows
from trivia.models import GuessLog


class SeedTests(TestCase):
    def test_seed_loads_and_validates(self):
        rows = _load_seed()
        self.assertGreaterEqual(len(rows), 30)
        self.assertEqual(validate_rows(rows), [])

    def test_validator_catches_bad_rows(self):
        bad = [
            {"qid": "www-001", "a": {"label": "X"}, "b": {"label": "Y"}},
            {"qid": "www-001", "a": {"label": ""}, "b": {"sub": "no label"}},
        ]
        problems = validate_rows(bad)
        self.assertTrue(any("duplicate qid" in p for p in problems))
        self.assertTrue(any("side 'a' needs a label" in p for p in problems))
        self.assertTrue(any("side 'b' needs a label" in p for p in problems))
        self.assertTrue(any("need >= 30" in p for p in problems))


class GetRoundTests(TestCase):
    def test_serves_ten_distinct_matchups_from_seed(self):
        res = self.client.get(reverse("who-would-win"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 10)
        qids = [r["qid"] for r in series]
        self.assertEqual(len(set(qids)), 10)
        for r in series:
            self.assertTrue(r["a"]["label"])
            self.assertTrue(r["b"]["label"])


class TallyTests(TestCase):
    def test_requires_qid(self):
        res = self.client.get(reverse("who-would-win-tally"))
        self.assertEqual(res.status_code, 400)

    def test_groups_guesslog_by_answer_scoped_to_game_and_qid(self):
        for _ in range(3):
            GuessLog.objects.create(game="who-would-win", question_id="www-001", answer="a")
        GuessLog.objects.create(game="who-would-win", question_id="www-001", answer="b")
        # noise: other qid, other game, junk answer — all excluded
        GuessLog.objects.create(game="who-would-win", question_id="www-002", answer="a")
        GuessLog.objects.create(game="fan-favorites", question_id="www-001", answer="a")
        GuessLog.objects.create(game="who-would-win", question_id="www-001", answer="zzz")
        res = self.client.get(reverse("who-would-win-tally"), {"qid": "www-001"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"qid": "www-001", "a": 3, "b": 1, "total": 4})

    def test_zero_votes_returns_zeros(self):
        res = self.client.get(reverse("who-would-win-tally"), {"qid": "www-999"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"qid": "www-999", "a": 0, "b": 0, "total": 0})

    def test_vote_via_log_guesses_shows_up_in_tally(self):
        # end-to-end: the exact payload the renderer POSTs
        res = self.client.post(
            reverse("log-guesses"),
            json.dumps({
                "game": "who-would-win",
                "entries": [{"question_id": "www-005", "answer": "a",
                             "correct": False, "elapsed_ms": 1200}],
            }),
            content_type="application/json",
        )
        self.assertEqual(res.status_code, 200)
        tally = self.client.get(reverse("who-would-win-tally"), {"qid": "www-005"}).json()
        self.assertEqual(tally["a"], 1)
        self.assertEqual(tally["total"], 1)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && DATABASE_URL="" python manage.py test trivia.tests.test_who_would_win -v 2
```
Expected: FAIL — `NoReverseMatch: 'who-would-win-tally'` (and `validate_rows` assertions fail against the stub's empty implementation).

- [ ] **Step 3: Overwrite the stub** `backend/trivia/games/who_would_win.py` with the full implementation:

```python
"""Who Would Win — opinion matchups + live community tally.

get_round serves a session of matchups straight from the bundled seed
(always-available fallback; no DB needed). Votes arrive through the shared
/trivia/log-guesses/ flywheel as GuessLog rows (game="who-would-win",
answer="a"|"b", correct=False); the tally endpoint aggregates those rows
live, grouped by answer, so the community split is always current.
"""
import json
import os
import random

from django.conf import settings
from django.db.models import Count
from django.http import JsonResponse
from django.urls import path

GAME_NAME = "Who Would Win"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "who_would_win_seed.json")
ROUNDS_PER_SESSION = 10
MAX_LABEL_LEN = 60
MAX_SUB_LEN = 90
MIN_MATCHUPS = 30


def _load_seed():
    """Bundled seed rows (the always-available fallback; DB is optional)."""
    if not os.path.exists(SEED_PATH):
        return []
    try:
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def get_round(request):
    """A session's worth of distinct matchups in the standard envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "Who Would Win content not ready"}, status=503)
    return JsonResponse({"series": random.sample(rows, min(ROUNDS_PER_SESSION, len(rows)))})


def get_tally(request):
    """Live community split for one matchup: GuessLog grouped by answer.

    The flywheel endpoint stores every vote as a GuessLog row; this view is
    the read side. Only "a"/"b" answers count (junk rows are ignored).
    """
    # Lazy import keeps trivia.games importable outside a fully-wired app
    # (data_pipeline.validate relies on that).
    from trivia.models import GuessLog

    qid = (request.GET.get("qid") or "").strip()
    if not qid:
        return JsonResponse({"error": "qid is required"}, status=400)
    counts = {"a": 0, "b": 0}
    qs = (
        GuessLog.objects.filter(game="who-would-win", question_id=qid)
        .values("answer")
        .annotate(n=Count("id"))
    )
    for row in qs:
        if row["answer"] in counts:
            counts[row["answer"]] = row["n"]
    return JsonResponse(
        {"qid": qid, "a": counts["a"], "b": counts["b"], "total": counts["a"] + counts["b"]}
    )


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Per-game pool validation problems (empty list = valid)."""
    problems = []
    if not isinstance(rows, list):
        return ["who-would-win: expected a list"]
    seen = set()
    for i, r in enumerate(rows):
        if not isinstance(r, dict):
            problems.append(f"who-would-win[{i}]: not an object")
            continue
        qid = r.get("qid")
        if not qid or not isinstance(qid, str):
            problems.append(f"who-would-win[{i}]: missing qid")
        elif qid in seen:
            problems.append(f"who-would-win[{i}]: duplicate qid {qid}")
        else:
            seen.add(qid)
        for side in ("a", "b"):
            s = r.get(side)
            if not isinstance(s, dict) or not s.get("label"):
                problems.append(f"who-would-win[{i}]: side '{side}' needs a label")
                continue
            if len(s["label"]) > MAX_LABEL_LEN:
                problems.append(f"who-would-win[{i}]: side '{side}' label too long (>{MAX_LABEL_LEN})")
            if len(str(s.get("sub") or "")) > MAX_SUB_LEN:
                problems.append(f"who-would-win[{i}]: side '{side}' sub too long (>{MAX_SUB_LEN})")
    if len(rows) < MIN_MATCHUPS:
        problems.append(f"who-would-win: need >= {MIN_MATCHUPS} matchups, got {len(rows)}")
    return problems


# Aggregated verbatim by trivia/games/__init__.py under the /trivia/ prefix.
EXTRA_URLS = [
    path("who-would-win/tally/", get_tally, name="who-would-win-tally"),
]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && DATABASE_URL="" python manage.py test trivia.tests.test_who_would_win -v 2
```
Expected: `OK` — 7 tests pass.

- [ ] **Step 5: Run the standalone seed validation** (the "validator run" the spec asks for):

```bash
cd backend && DATABASE_URL="" python manage.py shell -c "from trivia.games.who_would_win import _load_seed, validate_rows; rows=_load_seed(); ps=validate_rows(rows); print(len(rows), 'rows'); print('\n'.join(ps) if ps else 'VALID')"
```
Expected output: `30 rows` then `VALID`.

- [ ] **Step 6: Regression-check the existing trivia suite**

```bash
cd backend && DATABASE_URL="" python manage.py test trivia -v 1
```
Expected: `OK` (no existing test touches this module, but the games package imports it — a syntax error would surface here).

- [ ] **Step 7: Commit**

```bash
git add backend/trivia/games/who_would_win.py backend/trivia/tests/test_who_would_win.py
git commit -m "feat(who-would-win): backend module with live GuessLog tally endpoint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Publish the static pool (seed → /data/who-would-win.json)

**Files:**
- Create (generated): `backend/trivia/data/who-would-win.json`
- Modify (generated): `backend/trivia/data/manifest.json`

**Interfaces:**
- Consumes: `build_pool()` from Task 2 (registered in `POOL_BUILDERS` automatically); `manage.py build_pools_from_db` (validates each pool via `validate_rows` and skips invalid/empty pools, keeping existing files).
- Produces: the static pool that `fetchGamePool("who-would-win", 10)` (already pre-staged in `GameUtils.tsx:520`) loads from `/data/who-would-win.json` via `src/utils/pool.ts`. Rows are the exact seed rows — same shape as `WwwMatchup`.

- [ ] **Step 1: Migrate the sqlite fallback DB** (build command queries DB-backed builders first; unmigrated sqlite would crash it). This is the sqlite fallback, NOT Supabase:

```bash
cd backend && DATABASE_URL="" python manage.py migrate
```
Expected: migrations apply (or "No migrations to apply") against local `db.sqlite3`.

- [ ] **Step 2: Build the pools**

```bash
cd backend && DATABASE_URL="" python manage.py build_pools_from_db
```
Expected: line `  wrote who-would-win.json (30 rows)`; DB-backed pools (name-logo, playoff, …) report `skip <key>: [... empty pool ...] (kept existing file)` — that is correct behavior on an empty sqlite DB. Other seed-based game modules may also write their pools; do not stage those.

- [ ] **Step 3: Verify the pool content**

```bash
python -c "import json;rows=json.load(open('backend/trivia/data/who-would-win.json',encoding='utf-8'));assert len(rows)==30;print('pool OK', rows[0]['qid'])"
```
Expected: `pool OK www-001`

- [ ] **Step 4: Commit ONLY this game's artifacts** (surgical: manifest must ship so the client cache keys roll):

```bash
git add backend/trivia/data/who-would-win.json backend/trivia/data/manifest.json
git checkout -- backend/trivia/data/ 2>/dev/null || true
git commit -m "data(who-would-win): publish static pool from seed

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
(The `git checkout --` reverts any other pool files the build rewrote; staged files are unaffected.)

---

### Task 4: Renderer CSS — 390x844 layout, big tap targets, split bars

**Files:**
- Overwrite: `src/styles/WhoWouldWin.css` (scaffold stub — this game agent owns it)

**Interfaces:**
- Consumes: `src/styles/theme.css` tokens only (`--brand`, `--brand-soft`, `--surface2/3`, `--line/--line2`, `--text`, `--muted`, `--radius`).
- Produces: class names consumed verbatim by Task 5's TSX: `www-wrap`, `www-head`, `www-eyebrow`, `www-progress`, `www-arena`, `www-vs`, `www-card` (+ `is-mine`, `is-other`), `www-card-label`, `www-card-sub`, `www-split`, `www-bar-track`, `www-bar-fill` (+ `is-mine`), `www-split-nums`, `www-status`, `www-status-text`, `www-foot`, `www-summary`, `www-summary-title`, `www-summary-list`, `www-summary-row` (+ `is-agreed`), `www-summary-num`, `www-summary-pick`, `www-summary-crowd`, `www-empty`.

- [ ] **Step 1: Write the full stylesheet** (conventions per FanFavorites.css: `www-` prefix, tokens only, clamp() sizing; height budget for 844px: head ~44 + card ~190 + vs ~26 + card ~190 + status 40 + foot 48 + gaps ~80 ≈ 620px — fits with app chrome):

```css
/* ===== Who Would Win — opinion matchups (prefix: www-) ===== */
.www-wrap {
  position: relative;
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(10px, 1.8dvh, 18px);
}

/* Header */
.www-head { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.www-eyebrow {
  font-size: clamp(10.5px, 1.5dvh, 12px);
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--muted);
}
.www-progress { font-size: clamp(12px, 1.8dvh, 14px); font-weight: 700; color: var(--text); }

/* ===== Arena: two stacked half-cards, VS badge between ===== */
.www-arena { display: flex; flex-direction: column; gap: clamp(4px, 0.8dvh, 8px); width: 100%; }
.www-vs {
  align-self: center;
  font-size: clamp(13px, 2dvh, 17px);
  letter-spacing: 1.5px;
  color: var(--brand);
}

/* Whole half-card is the tap target (>= 140px tall, far above the 44px floor) */
.www-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  min-height: clamp(150px, 24dvh, 210px);
  padding: clamp(12px, 2dvh, 20px);
  background: var(--surface2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease;
}
.www-card:not(:disabled):hover { border-color: var(--brand); transform: translateY(-1px); }
.www-card:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.www-card:disabled { cursor: default; }
.www-card.is-mine { border-color: var(--brand); background: var(--brand-soft); }
.www-card.is-other { opacity: 0.72; }

.www-card-label {
  font-size: clamp(17px, 2.6dvh, 24px);
  line-height: 1.2;
  text-align: center;
  overflow-wrap: anywhere;
}
.www-card.is-mine .www-card-label { color: var(--brand); }
.www-card-sub {
  min-height: 1.2em; /* reserved even when empty — no shift between cards */
  font-size: clamp(11px, 1.7dvh, 13px);
  color: var(--muted);
  text-align: center;
}

/* Split area: fixed height reserved BEFORE the vote so the reveal never shifts layout */
.www-split {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: min(100%, 300px);
  min-height: 34px;
}
.www-bar-track {
  display: block;
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: var(--surface3);
  border: 1px solid var(--line2);
  overflow: hidden;
}
.www-bar-fill { display: block; height: 100%; border-radius: 999px; background: var(--muted); }
.www-bar-fill.is-mine { background: var(--brand); }
.www-split-nums { font-size: 12px; font-weight: 700; color: var(--text); }
.www-card.is-other .www-split-nums { color: var(--muted); }

/* Status line (loader / early-votes note / error + retry) — fixed height, no shift */
.www-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 40px;
  width: 100%;
  text-align: center;
}
.www-status-text { font-size: clamp(11.5px, 1.7dvh, 13px); color: var(--muted); }

/* Bottom-anchored action (mobile: input/CTA lives at the bottom of the play area) */
.www-foot { width: 100%; max-width: 420px; margin-top: auto; }

/* ===== Summary screen ===== */
.www-summary {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(10px, 1.8dvh, 16px);
  width: 100%;
}
.www-summary-title { font-size: clamp(18px, 2.8dvh, 26px); text-align: center; line-height: 1.25; }
.www-summary-title .tnum { color: var(--brand); }
.www-summary-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  max-height: 46dvh;      /* in-component scroll only — page never scrolls */
  overflow-y: auto;
}
.www-summary-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 10px;
  background: var(--surface2);
  border: 1px solid var(--line);
  border-radius: 10px;
}
.www-summary-row.is-agreed { border-color: var(--brand); }
.www-summary-num {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: var(--surface3);
  border: 1px solid var(--line2);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--muted);
}
.www-summary-row.is-agreed .www-summary-num { background: var(--brand); border-color: var(--brand); color: #fff; }
.www-summary-pick {
  flex: 1;
  min-width: 0;
  font-size: clamp(11px, 1.7dvh, 12.5px);
  font-weight: 700;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.www-summary-crowd { flex: none; font-size: 11px; color: var(--muted); }

/* Empty state */
.www-empty { font-size: clamp(12px, 1.8dvh, 14px); color: var(--muted); text-align: center; }

/* Small phones (390x844): tighter cards so both fit without page scroll */
@media (max-width: 480px) {
  .www-card { min-height: clamp(140px, 22dvh, 190px); padding: 10px 12px; }
  .www-arena { gap: 4px; }
}
```

- [ ] **Step 2: Commit** (builds are verified together with the TSX in Task 5)

```bash
git add src/styles/WhoWouldWin.css
git commit -m "feat(who-would-win): renderer stylesheet

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Renderer — vote flow, live split, summary, onGameEnd(0)

**Files:**
- Overwrite: `src/Game Renderers/WhoWouldWin.tsx` (scaffold stub — this game agent owns it)

**Interfaces:**
- Consumes: `WwwMatchup`, `OnGameEnd` from `src/types/types.tsx` (frozen); `Button`, `CourtLoader` from `src/components/ui`; `apiFetch` from `src/utils/Api` (JWT-aware POST); `BACKEND_ORIGIN` from `src/configurations/backend`; tally endpoint `GET ${BACKEND_ORIGIN}/trivia/who-would-win/tally/?qid=` returning `{qid, a, b, total}` (Task 2); CSS classes from Task 4.
- Produces: default export `WhoWouldWin({ gameInfo, onGameEnd, turn?, onTurnAction?, multiplayer? }: WhoWouldWinProps)` — exactly what the pre-staged `RenderGame.tsx:196` case calls. Calls `onGameEnd(0)` exactly once, only from the summary screen's Finish button.

**Design decisions (recorded):**
- "Sided with the crowd" rule: your side's vote count `>= ` the other side's = agreed (ties count as agreeing — you're not against the crowd). Tally-fetch failure records `agreed: null` and the summary row shows "split unknown"; the denominator stays 10 per the spec's "6/10" copy.
- Own vote is included in the split: the tally GET is issued only after the log-guesses POST settles.
- No `timersRef`/`later()` here because the component schedules **zero** timeouts; the equivalent stale-async guard for the fetches is `sessionRef` (bumped on `[gameInfo]` reset and unmount), which satisfies the same "no stale onGameEnd/setState" invariant.
- `tallyLoading` disables the Next button so a late tally response can never render under the wrong matchup.

- [ ] **Step 1: Write the full component:**

```tsx
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import type { WwwMatchup, OnGameEnd } from "../types/types";
import "../styles/WhoWouldWin.css";

export interface WhoWouldWinProps {
  gameInfo: WwwMatchup[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

type Side = "a" | "b";

interface Tally {
  qid: string;
  a: number;
  b: number;
  total: number;
}

interface PickRecord {
  qid: string;
  choice: Side;
  /** true = voted with the majority (ties count as with); null = tally unavailable. */
  agreed: boolean | null;
}

/** Below this many total votes the split shows an "early votes" note. */
const EARLY_VOTES = 10;

export default function WhoWouldWin({ gameInfo, onGameEnd }: WhoWouldWinProps) {
  const [idx, setIdx] = useState(0);
  const [picked, setPicked] = useState<Side | null>(null);
  const [tally, setTally] = useState<Tally | null>(null);
  const [tallyLoading, setTallyLoading] = useState(false);
  const [tallyError, setTallyError] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const picksRef = useRef<PickRecord[]>([]);
  const endedRef = useRef(false);
  // Bumped on reset/unmount so in-flight fetches can never setState (or worse,
  // record picks) into a new session — the async twin of the timersRef pattern.
  const sessionRef = useRef(0);
  const startRef = useRef(Date.now());
  const reduce = useReducedMotion();

  // Fresh state whenever a new matchup set loads (e.g. play-again).
  useEffect(() => {
    sessionRef.current += 1;
    setIdx(0);
    setPicked(null);
    setTally(null);
    setTallyLoading(false);
    setTallyError(false);
    setShowSummary(false);
    picksRef.current = [];
    endedRef.current = false;
    startRef.current = Date.now();
  }, [gameInfo]);

  // Unmount: invalidate in-flight fetches.
  useEffect(() => {
    return () => {
      sessionRef.current += 1;
    };
  }, []);

  const matchup = gameInfo && gameInfo.length > 0 ? gameInfo[idx] : null;

  const fetchTally = async (qid: string, side: Side) => {
    const sess = sessionRef.current;
    setTallyLoading(true);
    setTallyError(false);
    try {
      const res = await fetch(
        `${BACKEND_ORIGIN}/trivia/who-would-win/tally/?qid=${encodeURIComponent(qid)}`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = (await res.json()) as Tally;
      if (sess !== sessionRef.current) return;
      const mine = side === "a" ? t.a : t.b;
      const other = side === "a" ? t.b : t.a;
      const rec = picksRef.current[picksRef.current.length - 1];
      if (rec && rec.qid === qid) rec.agreed = mine >= other;
      setTally(t);
      setTallyLoading(false);
    } catch {
      if (sess !== sessionRef.current) return;
      setTallyLoading(false);
      setTallyError(true);
    }
  };

  const handlePick = (side: Side) => {
    if (picked || !matchup || showSummary) return;
    setPicked(side);
    picksRef.current.push({ qid: matchup.qid, choice: side, agreed: null });
    const elapsed = Date.now() - startRef.current;
    // Vote through the flywheel first, THEN read the tally so your own vote is
    // part of the split you see. Logging is best-effort — a failed POST still
    // shows the community numbers.
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({
        game: "who-would-win",
        entries: [
          { question_id: matchup.qid, answer: side, correct: false, elapsed_ms: elapsed },
        ],
      }),
    })
      .catch(() => {
        /* analytics only */
      })
      .finally(() => {
        void fetchTally(matchup.qid, side);
      });
  };

  const handleNext = () => {
    if (!picked) return;
    if (idx + 1 >= gameInfo.length) {
      setShowSummary(true);
      return;
    }
    setIdx(idx + 1);
    setPicked(null);
    setTally(null);
    setTallyError(false);
    startRef.current = Date.now();
  };

  // GAME END CONTRACT: exactly once, and only after the summary screen.
  const handleFinish = () => {
    if (endedRef.current) return;
    endedRef.current = true;
    onGameEnd?.(0);
  };

  // Empty state (pool missing / filtered out upstream).
  if (!matchup && !showSummary)
    return <p className="www-empty">No matchups available. Please try again later.</p>;

  // ===== Summary screen (shown BEFORE onGameEnd fires) =====
  if (showSummary) {
    const picks = picksRef.current;
    const agreedCount = picks.filter((p) => p.agreed === true).length;
    return (
      <div className="www-wrap">
        <motion.div
          className="www-summary"
          initial={reduce ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <span className="www-eyebrow">Debate settled</span>
          <h2 className="www-summary-title font-display">
            You sided with the crowd{" "}
            <span className="tnum">
              {agreedCount}/{picks.length}
            </span>
          </h2>
          <div className="www-summary-list">
            {picks.map((p, i) => {
              const m = gameInfo[i];
              if (!m) return null;
              const yours = p.choice === "a" ? m.a.label : m.b.label;
              const crowd =
                p.agreed === null
                  ? "split unknown"
                  : p.agreed
                    ? "with the crowd"
                    : `crowd took ${p.choice === "a" ? m.b.label : m.a.label}`;
              return (
                <div
                  key={p.qid}
                  className={`www-summary-row${p.agreed ? " is-agreed" : ""}`}
                >
                  <span className="www-summary-num tnum">{i + 1}</span>
                  <span className="www-summary-pick">{yours}</span>
                  <span className="www-summary-crowd">{crowd}</span>
                </div>
              );
            })}
          </div>
          <Button size="md" onClick={handleFinish}>
            Finish
          </Button>
        </motion.div>
      </div>
    );
  }

  const sideCard = (side: Side, m: WwwMatchup) => {
    const info = side === "a" ? m.a : m.b;
    const isMine = picked === side;
    const votes = tally ? (side === "a" ? tally.a : tally.b) : 0;
    const pct = tally && tally.total > 0 ? Math.round((votes / tally.total) * 100) : 0;
    return (
      <button
        type="button"
        className={`www-card${isMine ? " is-mine" : ""}${picked && !isMine ? " is-other" : ""}`}
        onClick={() => handlePick(side)}
        disabled={!!picked}
        aria-label={`Vote ${info.label}`}
      >
        <span className="www-card-label font-display">{info.label}</span>
        <span className="www-card-sub">{info.sub ?? ""}</span>
        {/* Fixed-height split area — reserved before the vote, no layout shift */}
        <span className="www-split">
          {tally && (
            <>
              <span className="www-bar-track" aria-hidden="true">
                <motion.span
                  className={`www-bar-fill${isMine ? " is-mine" : ""}`}
                  initial={reduce ? { width: `${pct}%` } : { width: "0%" }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </span>
              <span className="www-split-nums tnum">
                {pct}% · {votes} {votes === 1 ? "vote" : "votes"}
              </span>
            </>
          )}
        </span>
      </button>
    );
  };

  return (
    <div className="www-wrap">
      <div className="www-head">
        <span className="www-eyebrow">Who would win?</span>
        <span className="www-progress tnum">
          Matchup {idx + 1} / {gameInfo.length}
        </span>
      </div>

      <div className="www-arena">
        {sideCard("a", matchup as WwwMatchup)}
        <span className="www-vs font-display" aria-hidden="true">
          VS
        </span>
        {sideCard("b", matchup as WwwMatchup)}
      </div>

      {/* Status line: hint → loader → early-votes note / error+retry */}
      <div className="www-status" aria-live="polite">
        {!picked && <span className="www-status-text">Tap a side to cast your vote.</span>}
        {picked && tallyLoading && <CourtLoader label="Counting votes…" />}
        {picked && !tallyLoading && tallyError && (
          <>
            <span className="www-status-text">Couldn't load the community split.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fetchTally((matchup as WwwMatchup).qid, picked)}
            >
              Retry
            </Button>
          </>
        )}
        {picked && !tallyLoading && !tallyError && tally && tally.total < EARLY_VOTES && (
          <span className="www-status-text">Early votes — small sample so far.</span>
        )}
      </div>

      <div className="www-foot">
        <Button size="md" block onClick={handleNext} disabled={!picked || tallyLoading}>
          {idx + 1 >= gameInfo.length ? "See results" : "Next matchup"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

```bash
npx tsc -b
npm run lint
```
Expected: both exit 0. If `CourtLoader`'s `label` prop or `Button`'s `variant="secondary"` signatures differ from the scaffold's usage, check `src/components/ui` exports and match them — do not modify the shared components.

- [ ] **Step 3: Production build**

```bash
npm run build
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/Game Renderers/WhoWouldWin.tsx"
git commit -m "feat(who-would-win): renderer with vote flow, live split bars, crowd summary

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: End-to-end verification (live tally + mobile no-scroll)

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above; Django on :8000, Vite on :5173 (single-player needs only these two).

- [ ] **Step 1: Start both servers** (Git Bash, background):

```bash
cd backend && DATABASE_URL="" python manage.py runserver 8000 &
npm run dev &
```

- [ ] **Step 2: Verify the tally endpoint is live and dynamic**

```bash
curl -s "http://localhost:8000/trivia/who-would-win/tally/?qid=www-001"
curl -s -X POST http://localhost:8000/trivia/log-guesses/ -H "Content-Type: application/json" -d '{"game":"who-would-win","entries":[{"question_id":"www-001","answer":"a","correct":false,"elapsed_ms":900}]}'
curl -s "http://localhost:8000/trivia/who-would-win/tally/?qid=www-001"
```
Expected: first call `{"qid": "www-001", "a": 0, "b": 0, "total": 0}` (or prior counts), second `{"logged": 1}`, third shows `a` incremented by 1 — proving the split aggregates GuessLog live.

- [ ] **Step 3: Verify get_round fallback**

```bash
curl -s "http://localhost:8000/trivia/who-would-win/" | python -c "import json,sys;d=json.load(sys.stdin);assert len(d['series'])==10;print('get_round OK')"
```
Expected: `get_round OK`

- [ ] **Step 4: Play a full session in the browser** at `http://localhost:5173/who-would-win`:
  - Tap a side → orange highlight on your card, bars animate in, percentages + vote counts render with `.tnum`, "Early votes — small sample so far." shows (total < 10).
  - Kill the Django server mid-session and vote → status shows "Couldn't load the community split." with a working Retry button; Next still advances (summary row shows "split unknown").
  - Complete all 10 → "See results" → summary shows "You sided with the crowd X/10" and 10 rows → "Finish" → GameResult appears (0 points) — confirm `onGameEnd` fired once (no console double-fire warnings, no state updates after).

- [ ] **Step 5: Mobile no-scroll check** — DevTools responsive mode at exactly **390x844**:
  - Voting screen: header, both cards, VS, status line and the Next button all visible with NO page scroll; both cards remain >= 140px tall (tap targets).
  - After voting: bars appear with zero layout shift (split area height was reserved).
  - Summary: title + list + Finish visible; only the `.www-summary-list` scrolls internally if needed.
  - Keyboard: Tab reaches both cards, Retry, and Next with a visible orange focus ring.
  - OS "reduce motion" on (or emulate): bars snap to width, no entrance animations.

- [ ] **Step 6: Final gates**

```bash
npx tsc -b && npm run lint && npm run build
cd backend && DATABASE_URL="" python manage.py test trivia -v 1
```
Expected: all pass.

- [ ] **Step 7: Stop the servers, final commit if any fixups were needed**

```bash
git add -A -- "src/Game Renderers/WhoWouldWin.tsx" src/styles/WhoWouldWin.css backend/trivia/games/who_would_win.py backend/trivia/tests/test_who_would_win.py
git commit -m "fix(who-would-win): verification fixups" || echo "nothing to fix"
```

---

## Self-Review (completed by planner)

- **Spec coverage:** 10 matchups/session (pre-staged `fetchGamePool("who-would-win", 10)` + seed of 30 → Task 1/3) ✓; tap-side vote via log-guesses with `correct:false` (Task 5 `handlePick`) ✓; live tally endpoint grouping GuessLog by answer (Task 2 `get_tally`) ✓; animated split bars, orange you-side / neutral other, percentages + vote counts, early-votes note under 10 (Tasks 4–5) ✓; whole half-card tap targets (Task 4 `.www-card`) ✓; Next matchup button ✓; summary "You sided with the crowd 6/10" before `onGameEnd(0)` ✓; seed authoring with factual care + validator + run (Tasks 1–2) ✓; error/loading/empty states (loader, retry, empty gate) ✓; mobile no-scroll check (Task 6 Step 5) ✓.
- **Placeholder scan:** no TBDs; every code step contains complete code; all 30 seed rows written out.
- **Type consistency:** tally JSON `{qid,a,b,total}` matches `Tally` interface; CSS class names in Task 4 match Task 5 TSX one-to-one; `validate_rows` messages in Task 2 impl match Task 2 test assertions; URL name `who-would-win-tally` consistent between module, tests and curl checks.
