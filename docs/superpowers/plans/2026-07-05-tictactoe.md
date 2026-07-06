# NBA Tic-Tac-Toe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the NBA Tic-Tac-Toe minigame: a 3x3 criteria grid playable solo (3-minute clock, 25 pts/cell, 225 max) and as a server-authoritative turn duel in multiplayer (claims, 3 steals each, 25s/turn), per frozen contracts #2/#3/#5/#6/#7/#8.

**Architecture:** One renderer (`src/Game Renderers/TicTacToe.tsx`) with two branches picked by the presence of the `turn` prop: SOLO renders its own board state from `gameInfo` (a `GridConfig` board from the seed pool) and validates guesses client-side with `playerMatches` + the `players-index` pool; MULTIPLAYER renders the server's `turnState` verbatim and only emits `turnAction`s. The backend module `backend/trivia/games/tictactoe.py` serves one random board from a hand-authored 8-board seed and carries a Python mirror of the criteria semantics so `validate_rows` can prove every cell has ≥1 valid player in `players_curated.json`.

**Tech Stack:** React 19 + TypeScript strict + framer-motion + house UI kit (`AutoCompleteInput`, `Button`, `Chip`, `CourtLoader`, `SubmitGuessPopup`); Django (seed-file round provider, no DB required); no new dependencies.

## Global Constraints

- Slug/route/id `tictactoe`, route `/tictactoe`, maxPoints **225** (25/cell) — registry entries (GameUtils.tsx, RenderGame.tsx, App.tsx, gameEndpoints.js, trivia routing, MultiplayerContext turnState plumbing, types.tsx `Criterion`/`PlayerIndexEntry`/`GridConfig`, `src/utils/criteria.ts`, `src/utils/pool.ts:fetchWholePool`) are pre-staged by the scaffolder. **Modify NOTHING shared.** This plan only touches files it Creates (plus overwriting the scaffolder's `tictactoe.py` stub, which this game agent owns).
- Renderer default-exports `Component({ gameInfo, onGameEnd, turn, onTurnAction, multiplayer })`; `turn`/`onTurnAction`/`multiplayer` optional (contract #5).
- GAME END CONTRACT: `onGameEnd(finalScore)` exactly once — guard with an `endedRef` + `timersRef` cleanup on unmount + reset effect on `[gameInfo]`. Copy the `later()`/`clearTimers()` pattern from `FanFavorites.tsx` for ALL delayed work.
- Design tokens only (`src/styles/theme.css`): `--brand` is the sole accent; green/red only via `--good`/`--bad`; numbers `.tnum`; CSS class prefix `ttt-`; `clamp()` sizing like `FanFavorites.css`.
- UI bar: fits 390x844 with NO page scroll; touch targets ≥ 44px; visible focus states; CourtLoader/empty/error states for the pool fetch; `useReducedMotion` respected; input anchored at the bottom of the play area; no layout shift on reveal.
- Backend: bundled seed fallback ALWAYS works, DB optional; never run tests/migrations against the Supabase `DATABASE_URL` — always `DATABASE_URL=""` (sqlite fallback).
- Guess logging (contract #7): fire-and-forget POST `${BACKEND_ORIGIN}/trivia/log-guesses/` with `{ game: "tictactoe", entries: [{question_id, answer, correct, elapsed_ms}] }` — solo mode only (multiplayer answers are server-validated).
- Multiplayer visuals: YOUR cells orange (`--brand`), opponent cells a second treatment derived from `--surface3` + outline — no new hue.
- All shell commands below run from repo root `c:/Users/stefa/OneDrive/Desktop/nba-projects/nba-minigames` in Git Bash unless a `cd` is shown.

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `backend/trivia/data_static/tictactoe_seed.json` | 8 hand-authored boards `{qid, rows:[3 Criterion], cols:[3 Criterion]}` |
| Overwrite (owned stub) | `backend/trivia/games/tictactoe.py` | `get_round`, `build_pool`, `validate_rows` + Python `player_matches` mirror |
| Create | `backend/trivia/tests/test_tictactoe.py` | Seed structure + endpoint + matcher tests |
| Create | `backend/scripts/validate_tictactoe_seed.py` | Standalone seed validator (thin wrapper over `validate_rows`) |
| Create | `src/Game Renderers/TicTacToe.tsx` | Renderer: solo + multiplayer branches |
| Create | `src/styles/TicTacToe.css` | Game CSS, `ttt-` prefix, tokens only |
| Modify | **NOTHING shared** | registry/types/criteria/pool/context are scaffolder-owned |

Note on interop already in place (verified in repo): `fetchWholePool` exists in `src/utils/pool.ts`; `playerMatches` exists in `src/utils/criteria.ts`; `Criterion`, `PlayerIndexEntry`, `GridConfig {qid, rows: Criterion[], cols: Criterion[]}` exist in `src/types/types.tsx`; `normalizeAnswer` exists in `src/utils/answerMatch.ts`. The seed board row shape IS `GridConfig` — no new payload type is needed.

---

### Task 1: Author the 8-board seed (`tictactoe_seed.json`)

**Files:**
- Create: `backend/trivia/data_static/tictactoe_seed.json`

**Interfaces:**
- Produces: a JSON array of 8 objects, each exactly `{ "qid": string (unique, "ttt-001".."ttt-008"), "rows": [Criterion x3], "cols": [Criterion x3] }` where `Criterion = { "type": "team"|"award"|"country"|"draft"|"college"|"stat"|"era", "value": string, "label": string }` per contract #3. Task 2's `build_pool()` returns these rows verbatim; the frontend consumes them as `GridConfig`.

Factual care: every cell (row x col intersection) must be satisfiable by at least one broadly famous player (fame tier likely present in the curated index). The anchor table below names ≥1 verifying player per cell; Task 3's validator is the machine gate against the real `players_curated.json` — if it flags a cell, swap that row/col criterion for another from the same board family and re-run.

**Board designs (rows x cols, with anchor players per cell):**

| qid | rows | cols | anchors (row-major) |
|---|---|---|---|
| ttt-001 | LAL, BOS, CHI | award:mvp, award:ring, award:allstar5plus | Kareem/Magic; Magic; Kobe — Bird; Bird; Pierce — Jordan; Jordan; Pippen |
| ttt-002 | MIA, SAS, DAL | award:fmvp, country:INTL, stat:20kpts | Wade; Dragic; LeBron — Duncan; Parker/Ginobili; Duncan — Dirk; Dirk/Doncic; Dirk |
| ttt-003 | GSW, OKC, HOU | award:mvp, stat:ppg20, era:2010s | Curry; Curry/Durant; Curry — Durant/Westbrook; Durant; Westbrook — Harden/Hakeem; Hakeem; Harden |
| ttt-004 | NYK, PHI, DET | award:ring, award:dpoy, stat:seasons15plus | Frazier; Camby; Carmelo — Dr. J; Mutombo; Mutombo — Isiah; Ben Wallace; Rasheed Wallace |
| ttt-005 | PHX, UTA, POR | award:allnba, draft:lottery, country:USA | Barkley; Booker; Nash(no—USA? use Barkley) — Malone; Malone(#13); Stockton — Lillard; Lillard(#6); Drexler |
| ttt-006 | CLE, MIL, LAC | award:roty, award:mvp, stat:20kpts | LeBron/Kyrie; LeBron; LeBron — Kareem; Giannis; Kareem — Griffin; Harden(any-stint); Harden |
| ttt-007 | era:1990s, era:2000s, era:2010s | team:LAL, team:BOS, team:SAS | Shaq; Pierce; D. Robinson — Kobe; Garnett; Duncan — LeBron; Kyrie; Kawhi |
| ttt-008 | DEN, MIN, ORL | award:mvp, award:allstar5plus, country:INTL | Jokic/Iverson; Carmelo; Jokic — Garnett; Garnett; Gobert/Rubio — Shaq(any-stint); Dwight; Turkoglu/Vucevic |

Remember award semantics are **player-level any-stint** (e.g. Harden satisfies LAC x mvp because he won an MVP and has an LAC stint) and `era` = any stint overlapping the decade.

- [ ] **Step 1: Write the file.** First two boards verbatim (author the remaining six in exactly this shape from the table above — every criterion needs a human `label`):

```json
[
  {
    "qid": "ttt-001",
    "rows": [
      { "type": "team", "value": "LAL", "label": "Lakers" },
      { "type": "team", "value": "BOS", "label": "Celtics" },
      { "type": "team", "value": "CHI", "label": "Bulls" }
    ],
    "cols": [
      { "type": "award", "value": "mvp", "label": "Won MVP" },
      { "type": "award", "value": "ring", "label": "NBA Champion" },
      { "type": "award", "value": "allstar5plus", "label": "5+ All-Star" }
    ]
  },
  {
    "qid": "ttt-002",
    "rows": [
      { "type": "team", "value": "MIA", "label": "Heat" },
      { "type": "team", "value": "SAS", "label": "Spurs" },
      { "type": "team", "value": "DAL", "label": "Mavericks" }
    ],
    "cols": [
      { "type": "award", "value": "fmvp", "label": "Finals MVP" },
      { "type": "country", "value": "INTL", "label": "International" },
      { "type": "stat", "value": "20kpts", "label": "20,000+ points" }
    ]
  }
]
```

Labels for the other criteria used: `mvp`→"Won MVP", `roty`→"Rookie of the Year", `dpoy`→"Defensive POY", `allnba`→"All-NBA selection", `ring`→"NBA Champion", `ppg20`→"20+ PPG career", `seasons15plus`→"15+ seasons", `lottery`→"Lottery pick", `USA`→"Born in USA", `INTL`→"International", `1990s/2000s/2010s`→"Played in the 90s/2000s/2010s", team values→franchise nickname ("Suns", "Jazz", "Blazers", "Cavaliers", "Bucks", "Clippers", "Knicks", "76ers", "Pistons", "Rockets", "Thunder", "Warriors", "Nuggets", "Timberwolves", "Magic").

- [ ] **Step 2: Sanity-parse it.**

Run: `python -c "import json;rows=json.load(open('backend/trivia/data_static/tictactoe_seed.json',encoding='utf-8'));print(len(rows),[r['qid'] for r in rows])"`
Expected: `8 ['ttt-001', ..., 'ttt-008']`

- [ ] **Step 3: Commit**

```bash
git add backend/trivia/data_static/tictactoe_seed.json
git commit -m "feat(tictactoe): author 8-board criteria seed"
```

---

### Task 2: Backend module — real `tictactoe.py` (TDD)

**Files:**
- Overwrite: `backend/trivia/games/tictactoe.py` (scaffolder stub — this agent owns it)
- Test: `backend/trivia/tests/test_tictactoe.py`

**Interfaces:**
- Consumes: `backend/trivia/data_static/tictactoe_seed.json` (Task 1); optionally `backend/trivia/data_static/players_curated.json` (foundation agent; may not exist yet — solvability check silently skips when absent so the aggregator pipeline never blocks on landing order).
- Produces (contract #4 — `trivia/games/__init__.py` auto-discovers these, do NOT edit it):
  - `get_round(request) -> JsonResponse({'series': [<one random board>]})`
  - `build_pool() -> list` (all 8 boards)
  - `validate_rows(rows) -> list[str]`
  - `player_matches(p: dict, c: dict) -> bool` (public — Task 3's script and the tests reuse it; exact mirror of `src/utils/criteria.ts`)
  - `CURATED_PATH: str`

- [ ] **Step 1: Write the failing tests** — `backend/trivia/tests/test_tictactoe.py`:

```python
"""NBA Tic-Tac-Toe backend: seed integrity, matcher semantics, endpoint shape."""
from django.test import TestCase
from django.urls import reverse

from trivia.games.tictactoe import build_pool, player_matches, validate_rows

DIRK = {
    "person_id": 1717, "full_name": "Dirk Nowitzki", "aliases": ["dirk"], "fame_tier": 1,
    "position": "F", "height_in": 84, "weight_lb": 245, "birth_year": 1978,
    "country": "Germany", "college": None,
    "draft": {"year": 1998, "round": 1, "pick": 9, "team_abbr": "MIL"},
    "jersey": 41, "is_active": False,
    "teams": [{"abbr": "DAL", "name": "Dallas Mavericks", "start_year": 1998, "end_year": 2019, "gp": 1522, "ppg": 20.7}],
    "awards": {"mvp": [2007], "fmvp": [2011], "dpoy": [], "roty": None, "smoy": [],
               "allstar_count": 14, "allnba_count": 12, "rings": [2011]},
    "career": {"pts": 31560, "reb": 11489, "ast": 3651, "ppg": 20.7, "rpg": 7.5, "apg": 2.4, "seasons": 21},
}


class PlayerMatchesTests(TestCase):
    def test_team_any_stint(self):
        self.assertTrue(player_matches(DIRK, {"type": "team", "value": "DAL", "label": "Mavericks"}))
        self.assertFalse(player_matches(DIRK, {"type": "team", "value": "LAL", "label": "Lakers"}))

    def test_award_country_stat_draft_era(self):
        self.assertTrue(player_matches(DIRK, {"type": "award", "value": "fmvp", "label": "Finals MVP"}))
        self.assertTrue(player_matches(DIRK, {"type": "country", "value": "INTL", "label": "International"}))
        self.assertFalse(player_matches(DIRK, {"type": "country", "value": "USA", "label": "USA"}))
        self.assertTrue(player_matches(DIRK, {"type": "stat", "value": "25kpts", "label": "25k pts"}))
        self.assertTrue(player_matches(DIRK, {"type": "draft", "value": "lottery", "label": "Lottery"}))
        self.assertFalse(player_matches(DIRK, {"type": "draft", "value": "top5", "label": "Top 5"}))
        self.assertTrue(player_matches(DIRK, {"type": "era", "value": "1990s", "label": "90s"}))
        self.assertFalse(player_matches(DIRK, {"type": "era", "value": "2020s", "label": "2020s"}))
        self.assertTrue(player_matches(DIRK, {"type": "college", "value": "none", "label": "No college"}))

    def test_undrafted_and_decade_draft(self):
        udf = dict(DIRK, draft=None)
        self.assertTrue(player_matches(udf, {"type": "draft", "value": "undrafted", "label": "Undrafted"}))
        self.assertTrue(player_matches(DIRK, {"type": "draft", "value": "decade-1990s", "label": "Drafted in 90s"}))


class SeedTests(TestCase):
    def test_pool_has_eight_valid_boards(self):
        rows = build_pool()
        self.assertEqual(len(rows), 8)
        self.assertEqual(validate_rows(rows), [])
        self.assertEqual(len({r["qid"] for r in rows}), 8)

    def test_validate_rejects_bad_board(self):
        bad = [{"qid": "x", "rows": [], "cols": []}]
        self.assertTrue(validate_rows(bad))


class EndpointTests(TestCase):
    def test_get_round_returns_one_board(self):
        res = self.client.get(reverse("tictactoe"))
        self.assertEqual(res.status_code, 200)
        series = res.json()["series"]
        self.assertEqual(len(series), 1)
        board = series[0]
        self.assertEqual(len(board["rows"]), 3)
        self.assertEqual(len(board["cols"]), 3)
        self.assertIn("qid", board)
```

- [ ] **Step 2: Run tests to verify the new ones fail** (stub has no `player_matches`):

Run: `cd backend && DATABASE_URL="" python manage.py test trivia.tests.test_tictactoe -v 2`
Expected: FAIL/ERROR with `ImportError: cannot import name 'player_matches'`

- [ ] **Step 3: Overwrite `backend/trivia/games/tictactoe.py`** with the real module:

```python
"""NBA Tic-Tac-Toe — backend round provider.

Serves one random 3x3 criteria board from the bundled seed (always available;
DB optional). Also hosts the Python mirror of the frozen criteria semantics
(contract #3, src/utils/criteria.ts) so validate_rows can prove every cell has
at least one valid player in the curated index.
"""
import json
import os
import random
import re
from datetime import date

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "NBA Tic-Tac-Toe"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "tictactoe_seed.json")
CURATED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "players_curated.json")

CRITERION_TYPES = {"team", "award", "country", "draft", "college", "stat", "era"}
AWARD_VALUES = {"mvp", "fmvp", "dpoy", "roty", "smoy", "ring", "allstar5plus", "allnba"}
STAT_VALUES = {"20kpts", "25kpts", "ppg20", "rpg10", "apg8", "seasons15plus"}
CURRENT_YEAR = date.today().year


def _load_json(path):
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def _load_seed():
    """Bundled seed rows (the always-available fallback; DB is optional)."""
    return _load_json(SEED_PATH)


def _decade_start(value):
    m = re.search(r"(\d{4})s$", value or "")
    return int(m.group(1)) if m else None


def player_matches(p, c):
    """Python mirror of src/utils/criteria.ts playerMatches (contract #3)."""
    t, v = c.get("type"), c.get("value")
    if t == "team":
        return any(s.get("abbr") == v for s in p.get("teams", []))
    if t == "award":
        a = p.get("awards", {})
        return {
            "mvp": bool(a.get("mvp")),
            "fmvp": bool(a.get("fmvp")),
            "dpoy": bool(a.get("dpoy")),
            "roty": a.get("roty") is not None,
            "smoy": bool(a.get("smoy")),
            "ring": bool(a.get("rings")),
            "allstar5plus": a.get("allstar_count", 0) >= 5,
            "allnba": a.get("allnba_count", 0) > 0,
        }.get(v, False)
    if t == "country":
        if v == "USA":
            return p.get("country") == "USA"
        if v == "INTL":
            return p.get("country") != "USA"
        return p.get("country") == v
    if t == "draft":
        d = p.get("draft")
        if v == "undrafted":
            return d is None
        if not d:
            return False
        if v == "top5":
            return d.get("pick", 99) <= 5
        if v == "lottery":
            return d.get("pick", 99) <= 14
        if v == "round2":
            return d.get("round") == 2
        if isinstance(v, str) and v.startswith("decade-"):
            ds = _decade_start(v)
            return ds is not None and ds <= d.get("year", 0) <= ds + 9
        return False
    if t == "college":
        if v == "none":
            return p.get("college") is None
        return p.get("college") == v
    if t == "stat":
        car = p.get("career", {})
        return {
            "20kpts": car.get("pts", 0) >= 20000,
            "25kpts": car.get("pts", 0) >= 25000,
            "ppg20": car.get("ppg", 0) >= 20,
            "rpg10": car.get("rpg", 0) >= 10,
            "apg8": car.get("apg", 0) >= 8,
            "seasons15plus": car.get("seasons", 0) >= 15,
        }.get(v, False)
    if t == "era":
        ds = _decade_start(v)
        if ds is None:
            return False
        return any(
            s.get("start_year", 9999) <= ds + 9 and (s.get("end_year") or CURRENT_YEAR) >= ds
            for s in p.get("teams", [])
        )
    return False


def _valid_criterion(c):
    return (
        isinstance(c, dict)
        and c.get("type") in CRITERION_TYPES
        and isinstance(c.get("value"), str) and c["value"]
        and isinstance(c.get("label"), str) and c["label"]
        and (c["type"] != "award" or c["value"] in AWARD_VALUES)
        and (c["type"] != "stat" or c["value"] in STAT_VALUES)
    )


def get_round(request):
    """One random seed board in the standard {'series': [...]} envelope."""
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Tic-Tac-Toe content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    """Static pool for build_pools_from_db (seed list; [] when missing)."""
    return _load_seed()


def validate_rows(rows):
    """Structural problems + (when the curated index exists) unsolvable cells."""
    problems = []
    seen_qids = set()
    for i, row in enumerate(rows):
        tag = f"board[{i}]"
        if not isinstance(row, dict):
            problems.append(f"{tag}: not an object")
            continue
        qid = row.get("qid")
        if not isinstance(qid, str) or not qid:
            problems.append(f"{tag}: missing qid")
        elif qid in seen_qids:
            problems.append(f"{tag}: duplicate qid {qid}")
        else:
            seen_qids.add(qid)
        for axis in ("rows", "cols"):
            crits = row.get(axis)
            if not isinstance(crits, list) or len(crits) != 3:
                problems.append(f"{tag}.{axis}: must be exactly 3 criteria")
                continue
            for j, c in enumerate(crits):
                if not _valid_criterion(c):
                    problems.append(f"{tag}.{axis}[{j}]: invalid criterion {c!r}")
    if problems:
        return problems

    players = _load_json(CURATED_PATH)
    if not players:
        # Foundation dataset not landed yet — structural checks only.
        return problems
    for row in rows:
        for r, rc in enumerate(row["rows"]):
            for cidx, cc in enumerate(row["cols"]):
                if not any(player_matches(p, rc) and player_matches(p, cc) for p in players):
                    problems.append(
                        f"{row['qid']}: cell r{r}c{cidx} unsolvable "
                        f"({rc['value']} x {cc['value']})"
                    )
    return problems
```

- [ ] **Step 4: Run the tests**

Run: `cd backend && DATABASE_URL="" python manage.py test trivia.tests.test_tictactoe -v 2`
Expected: `OK` (all tests pass). If `SeedTests.test_pool_has_eight_valid_boards` reports unsolvable cells, fix the SEED (Task 1 anchor table), never the validator.

- [ ] **Step 5: Run the whole trivia suite** (no regressions in the aggregator/pool pipeline):

Run: `cd backend && DATABASE_URL="" python manage.py test trivia`
Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/trivia/games/tictactoe.py backend/trivia/tests/test_tictactoe.py
git commit -m "feat(tictactoe): real backend module with criteria mirror + tests"
```

---

### Task 3: Seed validator script + static pool publish

**Files:**
- Create: `backend/scripts/validate_tictactoe_seed.py`

**Interfaces:**
- Consumes: `build_pool`, `validate_rows`, `CURATED_PATH` from `trivia.games.tictactoe` (Task 2).
- Produces: exit code 0 = seed OK; exit 1 + one problem per line = fix seed. CI/humans run it after any seed edit.

- [ ] **Step 1: Write the script**:

```python
"""Validate tictactoe_seed.json: structure + >=1 valid player per cell.

Usage (from backend/):  DATABASE_URL="" python scripts/validate_tictactoe_seed.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "backend.settings")
os.environ.setdefault("DATABASE_URL", "")

import django  # noqa: E402

django.setup()

from trivia.games.tictactoe import CURATED_PATH, build_pool, validate_rows  # noqa: E402


def main():
    rows = build_pool()
    if not rows:
        print("FAIL: tictactoe_seed.json missing or empty")
        return 1
    if not os.path.exists(CURATED_PATH):
        print("WARN: players_curated.json not found - structural checks only")
    problems = validate_rows(rows)
    if problems:
        print(f"FAIL: {len(problems)} problem(s)")
        for p in problems:
            print(f"  - {p}")
        return 1
    print(f"OK: {len(rows)} boards, all cells solvable" if os.path.exists(CURATED_PATH)
          else f"OK (structure only): {len(rows)} boards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run it**

Run: `cd backend && DATABASE_URL="" python scripts/validate_tictactoe_seed.py`
Expected: `OK: 8 boards, all cells solvable` (or the `WARN` + `OK (structure only)` line if the foundation agent's `players_curated.json` hasn't landed yet). On FAIL: swap the flagged criterion in the seed per Task 1's board-family guidance and re-run until OK.

- [ ] **Step 3: Publish the static pool** (contract #8 — committed pool at `backend/trivia/data/tictactoe.json`):

Run: `cd backend && DATABASE_URL="" python manage.py build_pools_from_db`
(If the command name differs in this checkout, list it first: `DATABASE_URL="" python manage.py help | grep -i pool` and run the pool-build command shown.)
Verify: `python -c "import json;print(len(json.load(open('backend/trivia/data/tictactoe.json',encoding='utf-8'))))"` → `8`

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/validate_tictactoe_seed.py backend/trivia/data/tictactoe.json
git commit -m "feat(tictactoe): seed validator script + published static pool"
```

---

### Task 4: Renderer — SOLO mode (`TicTacToe.tsx`)

**Files:**
- Create: `src/Game Renderers/TicTacToe.tsx`

**Interfaces:**
- Consumes: `GridConfig`, `Criterion`, `PlayerIndexEntry`, `OnGameEnd` from `src/types/types.tsx`; `fetchWholePool("players-index")` from `src/utils/pool.ts`; `playerMatches` from `src/utils/criteria.ts`; `normalizeAnswer` from `src/utils/answerMatch.ts`; `AutocompleteInput` (default export of `src/components/AutoCompleteInput.tsx` — props `{placeholder, value, setValue, suggestions: string[], onSubmit, customStyleInput, customStyleSuggestion}`); `SubmitGuessPopup`, `Button`, `Chip`, `CourtLoader` from house components; `apiFetch` + `BACKEND_ORIGIN` for guess logging.
- Produces: `export default TicTacToe` with EXACTLY this props interface (Task 5 extends behavior, not the signature; the scaffolder's pre-staged `RenderGame.tsx` case passes these props):

```ts
export interface TttCell { ownerUid: string; playerName: string }
export interface TttTurnState {
  board: (TttCell | null)[];                       // 9 entries
  criteria: { rows: Criterion[]; cols: Criterion[] };
  turnUid: string;
  deadlineTs: number;                              // epoch ms
  stealsLeft: Record<string, number>;
  winnerUid: string | null;
  draw: boolean;
}
export type TttAction =
  | { type: "claim"; cell: number; playerName: string }
  | { type: "steal"; cell: number; playerName: string };

interface TicTacToeProps {
  gameInfo: GridConfig[];
  onGameEnd: OnGameEnd;
  turn?: TttTurnState | null;                      // present => multiplayer duel
  onTurnAction?: (action: TttAction) => void;
  multiplayer?: { selfUid?: string };
}
```

Solo rules locked in (sensible defaults, recorded here): unlimited guesses, no lives, no penalty for misses; a player can be used on at most ONE cell per board (`usedIdsRef`); 25 pts/cell, 225 max; game ends at clock 0 or 9/9 cells; wrong/unknown guesses are logged for the flywheel.

- [ ] **Step 1: Write the solo renderer.** Core code (this is the full solo branch; multiplayer additions land in Task 5 — leave the `turn` prop consumed but the branch returning `null` for now is NOT acceptable, instead render solo whenever `turn == null` which is the complete Task 4 behavior):

```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import AutocompleteInput from "../components/AutoCompleteInput";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import { fetchWholePool } from "../utils/pool";
import { playerMatches } from "../utils/criteria";
import { normalizeAnswer } from "../utils/answerMatch";
import type { Criterion, GridConfig, OnGameEnd, PlayerIndexEntry } from "../types/types";
import "../styles/TicTacToe.css";

const CELL_POINTS = 25;           // 9 cells -> 225 max (registry maxPoints)
const SOLO_SECONDS = 180;         // 3-minute clock

// ... TttCell/TttTurnState/TttAction/TicTacToeProps exactly as in Interfaces ...

interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number }
type PoolState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; players: PlayerIndexEntry[] };

function TicTacToe({ gameInfo, onGameEnd, turn, onTurnAction, multiplayer }: TicTacToeProps) {
  const [pool, setPool] = useState<PoolState>({ status: "loading" });
  const [solved, setSolved] = useState<Record<number, string>>({});   // cell -> player name
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [guess, setGuess] = useState("");
  const [finished, setFinished] = useState(false);
  const [showPopup, setShowPopup] = useState(false);
  const [popUpInfo, setPopUpInfo] = useState({ Text: "", Color: "" });
  const [now, setNow] = useState(() => Date.now());
  const usedIdsRef = useRef<Set<number>>(new Set());
  const guessLogRef = useRef<GuessEntry[]>([]);
  const endedRef = useRef(false);
  const soloDeadlineRef = useRef(Date.now() + SOLO_SECONDS * 1000);
  const startRef = useRef(Date.now());
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reduce = useReducedMotion();

  const later = (fn: () => void, ms: number) => { timersRef.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  // Fresh state whenever a new board loads (play-again / rematch).
  useEffect(() => {
    clearTimers();
    setSolved({}); setSelectedCell(null); setGuess(""); setFinished(false); setShowPopup(false);
    usedIdsRef.current = new Set(); guessLogRef.current = []; endedRef.current = false;
    soloDeadlineRef.current = Date.now() + SOLO_SECONDS * 1000; startRef.current = Date.now();
  }, [gameInfo]);

  // Unmount: cancel pending work, flush un-sent guesses (abandoned games still feed the flywheel).
  useEffect(() => () => { clearTimers(); sendGuessLog(); }, []);

  // Players index (validation truth + suggestions).
  useEffect(() => {
    let alive = true;
    fetchWholePool("players-index").then((res) => {
      if (!alive) return;
      if (res.success) setPool({ status: "ready", players: res.data as PlayerIndexEntry[] });
      else setPool({ status: "error", message: res.error.message });
    });
    return () => { alive = false; };
  }, []);

  // Shared half-second tick (solo clock now; multiplayer deadline in Task 5).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  const board = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;
  const players = pool.status === "ready" ? pool.players : [];
  const suggestions = useMemo(() => players.map((p) => p.full_name), [players]);

  const flashPopup = (text: string, color: string) => {
    setPopUpInfo({ Text: text, Color: color });
    setShowPopup(true);
    later(() => setShowPopup(false), 1400);
  };

  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "tictactoe", entries }),
    }).catch(() => { /* analytics only */ });
  };

  const findPlayer = (raw: string): PlayerIndexEntry | null => {
    const n = normalizeAnswer(raw);
    if (!n) return null;
    return players.find(
      (p) => normalizeAnswer(p.full_name) === n || p.aliases.some((a) => normalizeAnswer(a) === n),
    ) ?? null;
  };

  const cellCriteria = (cell: number): [Criterion, Criterion] =>
    [board!.rows[Math.floor(cell / 3)], board!.cols[cell % 3]];

  // ---- SOLO ----
  const soloSecondsLeft = Math.max(0, Math.ceil((soloDeadlineRef.current - now) / 1000));
  const soloScore = Object.keys(solved).length * CELL_POINTS;

  const finishSolo = (score: number, text: string, color: string) => {
    if (endedRef.current) return;
    endedRef.current = true;
    setFinished(true);
    sendGuessLog();
    flashPopup(text, color);
    later(() => onGameEnd?.(score), 1500);
  };

  // Clock expiry ends the game exactly once.
  useEffect(() => {
    if (turn || !board || finished) return;
    if (soloSecondsLeft <= 0) finishSolo(soloScore, "Time!", "var(--bad)");
  }, [soloSecondsLeft, finished, board, turn]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleSoloSubmit = () => {
    if (!board || finished || selectedCell == null || solved[selectedCell]) return;
    const raw = guess;
    setGuess("");
    const [rowCrit, colCrit] = cellCriteria(selectedCell);
    const qid = `${board.qid}:${selectedCell}`;
    const elapsed = Date.now() - startRef.current;
    const p = findPlayer(raw);
    if (!p) {
      guessLogRef.current.push({ question_id: qid, answer: normalizeAnswer(raw), correct: false, elapsed_ms: elapsed });
      flashPopup("Not in our player index", "var(--muted)");
      return;
    }
    if (usedIdsRef.current.has(p.person_id)) {
      flashPopup(`${p.full_name} already used`, "var(--muted)");
      return;
    }
    const ok = playerMatches(p, rowCrit) && playerMatches(p, colCrit);
    guessLogRef.current.push({ question_id: qid, answer: p.full_name, correct: ok, elapsed_ms: elapsed });
    if (!ok) { flashPopup(`${p.full_name} doesn't fit`, "var(--bad)"); return; }

    usedIdsRef.current.add(p.person_id);
    const nextSolved = { ...solved, [selectedCell]: p.full_name };
    setSolved(nextSolved);
    setSelectedCell(null);
    const n = Object.keys(nextSolved).length;
    if (n === 9) finishSolo(9 * CELL_POINTS, "Board cleared! +225", "var(--good)");
    else flashPopup(`+${CELL_POINTS}`, "var(--good)");
  };

  // Loading / empty / error states (before any board UI).
  if (!board) return <p style={{ color: "var(--muted)" }}>No board available.</p>;
  if (!turn && pool.status === "loading") return <CourtLoader />;
  if (!turn && pool.status === "error")
    return (
      <div className="ttt-fetchfail">
        <p>{pool.status === "error" ? pool.message : ""}</p>
        <Button size="sm" onClick={() => {
          setPool({ status: "loading" });
          fetchWholePool("players-index").then((res) => {
            if (res.success) setPool({ status: "ready", players: res.data as PlayerIndexEntry[] });
            else setPool({ status: "error", message: res.error.message });
          });
        }}>Retry</Button>
      </div>
    );

  // ... JSX (Step 2) ...
}

export default TicTacToe;
```

- [ ] **Step 2: Solo JSX.** Board = 4x4 CSS grid (corner spacer, 3 col-criterion headers, then 3x [row-criterion header + 3 cells]); input row pinned last. Full solo return:

```tsx
return (
  <div className="ttt-wrap">
    <div className="ttt-head">
      <span className="ttt-clock tnum" role="timer"
        aria-label={`${soloSecondsLeft} seconds left`}
        data-low={soloSecondsLeft <= 30 || undefined}>
        {Math.floor(soloSecondsLeft / 60)}:{String(soloSecondsLeft % 60).padStart(2, "0")}
      </span>
      <span className="ttt-score tnum">{soloScore} / 225</span>
    </div>

    <div className="ttt-grid" role="grid" aria-label="Tic-tac-toe criteria board">
      <span className="ttt-corner" aria-hidden="true" />
      {board.cols.map((c, i) => (
        <span key={`c${i}`} className="ttt-crit ttt-crit--col">{c.label}</span>
      ))}
      {board.rows.map((r, ri) => (
        <div key={`r${ri}`} className="ttt-rowgroup" role="row">
          <span className="ttt-crit ttt-crit--row">{r.label}</span>
          {[0, 1, 2].map((ci) => {
            const cell = ri * 3 + ci;
            const name = solved[cell];
            const selected = selectedCell === cell;
            return (
              <motion.button
                key={cell}
                type="button"
                role="gridcell"
                className={`ttt-cell${name ? " is-mine" : ""}${selected ? " is-selected" : ""}`}
                disabled={!!name || finished}
                aria-label={`${r.label} and ${board.cols[ci].label}${name ? `: ${name}` : ""}`}
                onClick={() => setSelectedCell(selected ? null : cell)}
                animate={reduce ? undefined : { scale: name ? [1, 1.06, 1] : 1 }}
                transition={{ duration: 0.3 }}
              >
                {name ? <span className="ttt-cell-name">{name}</span> : <span className="ttt-cell-blank" aria-hidden="true" />}
              </motion.button>
            );
          })}
        </div>
      ))}
    </div>

    <div className="ttt-inputrow">
      <AutocompleteInput
        placeholder={selectedCell == null ? "Pick a square first…" : "Name a player…"}
        value={guess}
        setValue={setGuess}
        suggestions={suggestions}
        onSubmit={handleSoloSubmit}
        customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
        customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%", bottom: "48px", top: "auto" }}
      />
      <Button size="sm" aria-label="Confirm player" onClick={handleSoloSubmit}
        disabled={finished || selectedCell == null || guess.trim() === ""}>
        Confirm
      </Button>
    </div>

    <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} />
  </div>
);
```

(If `AutoCompleteInput`'s suggestion dropdown ignores the `bottom/top` overrides in `customStyleSuggestion`, keep the overrides out and accept the default drop-down direction — do NOT edit the shared component.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc -b && npm run lint`
Expected: both exit 0. Note: `turn`, `onTurnAction`, `multiplayer` are referenced in Task 4 only via the `!turn` guards; if `tsc` flags `onTurnAction`/`multiplayer` as unused, keep them in the destructuring with a `void onTurnAction; void multiplayer;` line and delete that line in Task 5.

- [ ] **Step 4: Manual smoke (solo)** — `npm run dev`, open `http://localhost:5173/tictactoe` (route pre-staged by scaffolder; if the route isn't staged yet, temporarily verify by rendering `<TicTacToe gameInfo={[firstSeedBoard]} onGameEnd={console.log} />` in a scratch route and REVERT the scratch before commit). Verify: CourtLoader shows while the index loads; picking a cell + typing "dirk" on a DAL x 20kpts cell scores +25; clock reaches 0:00 → one `onGameEnd` with the partial score.

- [ ] **Step 5: Commit**

```bash
git add "src/Game Renderers/TicTacToe.tsx"
git commit -m "feat(tictactoe): solo renderer (3-min clock, 25/cell, players-index validation)"
```

---

### Task 5: Renderer — MULTIPLAYER duel branch

**Files:**
- Modify: `src/Game Renderers/TicTacToe.tsx` (Task 4 file — same props signature)

**Interfaces:**
- Consumes: `turn: TttTurnState` (server-authoritative, contract #6), `onTurnAction(action: TttAction)`, `multiplayer?.selfUid`. The scaffolder's `OnlineMatch` passes `turn={mp.turnState} onTurnAction={sendTurnAction} multiplayer` — the renderer never mutates board state itself in this mode; it renders `turn` verbatim and emits actions.
- Produces: on terminal state (`turn.winnerUid !== null || turn.draw`), exactly one `onGameEnd(25 * myCellCount)` after a 1.8s winner banner (score mirrors the 25/cell scale so the HUD is consistent with registry maxPoints 225; the server separately settles the match via `settleMatch` — contract #6).

- [ ] **Step 1: Add the multiplayer state + handlers** inside the component (above the solo `return`):

```tsx
// ---- MULTIPLAYER (turn prop present => server is authoritative) ----
const [stealMode, setStealMode] = useState(false);
const selfUid = multiplayer?.selfUid ?? "";
const mpBoard: GridConfig | null = turn
  ? { qid: board?.qid ?? "mp", rows: turn.criteria.rows, cols: turn.criteria.cols }
  : null;
const myTurn = !!turn && turn.turnUid === selfUid && turn.winnerUid == null && !turn.draw;
const myStealsLeft = turn ? turn.stealsLeft[selfUid] ?? 0 : 0;
const mpSecondsLeft = turn ? Math.max(0, Math.ceil((turn.deadlineTs - now) / 1000)) : 0;
const myCells = turn ? turn.board.filter((c) => c?.ownerUid === selfUid).length : 0;
const terminal = !!turn && (turn.winnerUid !== null || turn.draw);

// New server snapshot => a move landed; clear local selection/steal intent.
useEffect(() => {
  setSelectedCell(null);
  setStealMode(false);
  setGuess("");
}, [turn?.turnUid, turn?.board]);   // eslint-disable-line react-hooks/exhaustive-deps

// Terminal state: banner, then hand the score back exactly once.
useEffect(() => {
  if (!terminal || endedRef.current) return;
  endedRef.current = true;
  later(() => onGameEnd?.(myCells * CELL_POINTS), 1800);
}, [terminal]);   // eslint-disable-line react-hooks/exhaustive-deps

const handleMpSubmit = () => {
  if (!turn || !myTurn || selectedCell == null) return;
  const occupant = turn.board[selectedCell];
  // claim: empty cell; steal: opponent cell with steals left.
  if (!stealMode && occupant) return;
  if (stealMode && (!occupant || occupant.ownerUid === selfUid || myStealsLeft <= 0)) return;
  const p = findPlayer(guess);
  setGuess("");
  if (!p) { flashPopup("Not in our player index", "var(--muted)"); return; }
  if (stealMode && occupant && normalizeAnswer(occupant.playerName) === normalizeAnswer(p.full_name)) {
    flashPopup("Name a different player to steal", "var(--muted)"); return;
  }
  // Local pre-check is UX only — the server re-validates (authoritative).
  const [rowCrit, colCrit] = [mpBoard!.rows[Math.floor(selectedCell / 3)], mpBoard!.cols[selectedCell % 3]];
  if (players.length && !(playerMatches(p, rowCrit) && playerMatches(p, colCrit))) {
    flashPopup(`${p.full_name} doesn't fit`, "var(--bad)"); return;
  }
  onTurnAction?.({ type: stealMode ? "steal" : "claim", cell: selectedCell, playerName: p.full_name });
  flashPopup("Sent…", "var(--muted)");
};
```

- [ ] **Step 2: Multiplayer JSX branch.** Immediately before the solo `return`, add `if (turn && mpBoard) return ( ... )` reusing the same grid markup with these differences (complete branch below; the grid/cell loop is identical to solo except the cell body):

```tsx
if (turn && mpBoard) {
  if (pool.status === "loading") return <CourtLoader />;
  // pool "error" in a live duel: still render the board — suggestions/pre-check
  // degrade gracefully (server validates), so never block the match on the fetch.
  const winnerIsMe = turn.winnerUid === selfUid;
  return (
    <div className="ttt-wrap">
      <div className="ttt-head">
        <span className={`ttt-turnpill${myTurn ? " is-you" : ""}`}>
          {terminal ? "Final" : myTurn ? "Your turn" : "Opponent's turn"}
        </span>
        <span className="ttt-clock tnum" role="timer" aria-label={`${mpSecondsLeft} seconds left`}
          data-low={mpSecondsLeft <= 5 || undefined}>
          0:{String(mpSecondsLeft).padStart(2, "0")}
        </span>
        <button
          type="button"
          className={`ttt-steal${stealMode ? " is-on" : ""}`}
          disabled={!myTurn || myStealsLeft <= 0 || terminal}
          aria-pressed={stealMode}
          onClick={() => { setStealMode((s) => !s); setSelectedCell(null); }}
        >
          Steal <span className="tnum">x{myStealsLeft}</span>
        </button>
      </div>

      <div className="ttt-grid" role="grid" aria-label="Tic-tac-toe duel board">
        <span className="ttt-corner" aria-hidden="true" />
        {mpBoard.cols.map((c, i) => <span key={`c${i}`} className="ttt-crit ttt-crit--col">{c.label}</span>)}
        {mpBoard.rows.map((r, ri) => (
          <div key={`r${ri}`} className="ttt-rowgroup" role="row">
            <span className="ttt-crit ttt-crit--row">{r.label}</span>
            {[0, 1, 2].map((ci) => {
              const cell = ri * 3 + ci;
              const occ = turn.board[cell];
              const mine = occ?.ownerUid === selfUid;
              const selectable = myTurn && !terminal && (stealMode ? !!occ && !mine : !occ);
              const selected = selectedCell === cell;
              return (
                <button
                  key={cell}
                  type="button"
                  role="gridcell"
                  className={`ttt-cell${mine ? " is-mine" : occ ? " is-theirs" : ""}${selected ? " is-selected" : ""}${stealMode && selectable ? " is-stealable" : ""}`}
                  disabled={!selectable}
                  aria-label={`${r.label} and ${mpBoard.cols[ci].label}${occ ? `: ${occ.playerName}` : ""}`}
                  onClick={() => setSelectedCell(selected ? null : cell)}
                >
                  {occ ? <span className="ttt-cell-name">{occ.playerName}</span> : <span className="ttt-cell-blank" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {terminal && (
        <div className={`ttt-banner${turn.draw ? "" : winnerIsMe ? " is-win" : " is-loss"}`} role="status">
          <span className="font-display">{turn.draw ? "Draw!" : winnerIsMe ? "You win!" : "Opponent wins"}</span>
        </div>
      )}

      <div className="ttt-inputrow">
        <AutocompleteInput
          placeholder={!myTurn ? "Waiting…" : selectedCell == null ? (stealMode ? "Pick a cell to steal…" : "Pick a square…") : "Name a player…"}
          value={guess}
          setValue={setGuess}
          suggestions={suggestions}
          onSubmit={handleMpSubmit}
          customStyleInput={{ width: "100%", maxWidth: "none", height: "44px", padding: "0 12px", fontSize: "0.85rem" }}
          customStyleSuggestion={{ fontSize: "0.8rem", maxHeight: "150px", minWidth: "100%" }}
        />
        <Button size="sm" aria-label="Confirm move" onClick={handleMpSubmit}
          disabled={!myTurn || terminal || selectedCell == null || guess.trim() === ""}>
          {stealMode ? "Steal" : "Claim"}
        </Button>
      </div>

      <SubmitGuessPopup show={showPopup} text={popUpInfo.Text} color={popUpInfo.Color} />
    </div>
  );
}
```

Also delete the Task 4 `void onTurnAction; void multiplayer;` line if it was added.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc -b && npm run lint`
Expected: exit 0, no unused-var warnings.

- [ ] **Step 4: Commit**

```bash
git add "src/Game Renderers/TicTacToe.tsx"
git commit -m "feat(tictactoe): multiplayer duel branch (authoritative turnState, steals, banner)"
```

---

### Task 6: `TicTacToe.css` — 390x844 no-scroll layout

**Files:**
- Create: `src/styles/TicTacToe.css`

**Interfaces:**
- Consumes: theme tokens from `src/styles/theme.css` only. Class names exactly as used in Tasks 4-5 (`ttt-wrap/head/clock/score/turnpill/steal/grid/corner/crit/rowgroup/cell/cell-name/cell-blank/inputrow/banner/fetchfail` + state classes `is-mine/is-theirs/is-selected/is-stealable/is-you/is-on/is-win/is-loss`).

Budget at 390x844: head ~36px + grid (col-header ~40px + 3 cell rows ~86px each) ~300px + input 44px + gaps ≈ 420px — comfortably no-scroll. Cells stay ≥ 44px touch targets at all clamps.

- [ ] **Step 1: Write the stylesheet:**

```css
/* ===== NBA Tic-Tac-Toe — criteria duel grid ===== */
.ttt-wrap {
  position: relative;
  width: 100%;
  max-width: 560px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: clamp(8px, 1.6dvh, 14px);
}

/* Header: clock + score (solo) / turn pill + clock + steal (duel) */
.ttt-head { display: flex; align-items: center; justify-content: center; gap: 10px; min-height: 36px; }
.ttt-clock {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--surface2);
  border: 1px solid var(--line2);
  font-size: clamp(13px, 2dvh, 15px);
  font-weight: 700;
  color: var(--text);
}
.ttt-clock[data-low] { color: var(--bad); border-color: var(--bad); }
.ttt-score { font-size: clamp(12px, 1.8dvh, 14px); color: var(--muted); font-weight: 700; }
.ttt-turnpill {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--surface2);
  border: 1px solid var(--line2);
  font-size: clamp(11px, 1.7dvh, 12.5px);
  color: var(--muted);
}
.ttt-turnpill.is-you { background: var(--brand-soft); border-color: var(--brand); color: var(--brand); }
.ttt-steal {
  min-height: 44px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--surface2);
  border: 1px solid var(--line2);
  color: var(--text);
  font-family: inherit;
  font-size: clamp(11px, 1.7dvh, 12.5px);
  font-weight: 700;
  cursor: pointer;
}
.ttt-steal.is-on { background: var(--brand); border-color: var(--brand); color: #fff; }
.ttt-steal:disabled { opacity: 0.45; cursor: default; }

/* ===== Grid: header column ~0.62fr + 3 equal cell columns ===== */
.ttt-grid {
  display: grid;
  grid-template-columns: minmax(52px, 0.62fr) repeat(3, minmax(0, 1fr));
  gap: clamp(5px, 1vw, 8px);
  width: 100%;
}
.ttt-rowgroup { display: contents; }   /* row header + cells live on the parent grid */
.ttt-corner { min-height: 34px; }
.ttt-crit {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 4px 5px;
  border-radius: 10px;
  background: var(--surface2);
  border: 1px solid var(--line);
  font-size: clamp(9.5px, 1.5dvh, 11.5px);
  font-weight: 700;
  line-height: 1.15;
  color: var(--muted);
}
.ttt-crit--col { min-height: 34px; }

.ttt-cell {
  position: relative;
  min-height: 44px;
  aspect-ratio: 1 / 0.82;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: var(--radius);
  background: var(--surface2);
  border: 1px solid var(--line);
  color: var(--text);
  font-family: inherit;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.ttt-cell:focus-visible,
.ttt-steal:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.ttt-cell:disabled { cursor: default; }
.ttt-cell.is-selected { border-color: var(--brand); background: var(--brand-soft); }

/* YOUR cells: orange. Opponent cells: surface3 + outline (no new hue). */
.ttt-cell.is-mine { background: var(--brand); border-color: var(--brand); }
.ttt-cell.is-mine .ttt-cell-name { color: #fff; }
.ttt-cell.is-theirs { background: var(--surface3); border-color: var(--line2); outline: 2px solid var(--line2); outline-offset: -4px; }
.ttt-cell.is-theirs .ttt-cell-name { color: var(--muted); }
.ttt-cell.is-stealable { border-style: dashed; border-color: var(--brand); }

.ttt-cell-name {
  font-size: clamp(9.5px, 1.5dvh, 11.5px);
  font-weight: 700;
  line-height: 1.1;
  text-align: center;
  overflow-wrap: anywhere;
}
.ttt-cell-blank { width: 40%; height: 8px; border-radius: 999px; background: var(--surface3); }

/* Winner banner (reserves no space until terminal — appears above the input) */
.ttt-banner {
  display: flex;
  justify-content: center;
  padding: 8px 12px;
  border-radius: var(--radius);
  background: var(--surface2);
  border: 1px solid var(--line2);
  font-size: clamp(15px, 2.4dvh, 19px);
  color: var(--text);
}
.ttt-banner.is-win { border-color: var(--good); color: var(--good); }
.ttt-banner.is-loss { border-color: var(--bad); color: var(--bad); }

/* Input row anchored at the bottom of the play area */
.ttt-inputrow { display: flex; gap: 8px; width: 100%; margin-top: auto; }

/* Pool fetch error state */
.ttt-fetchfail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 20px;
  color: var(--muted);
  text-align: center;
}

/* Small phones (390x844): tighter gaps so grid + input never scroll */
@media (max-width: 480px) {
  .ttt-grid { gap: 5px; }
  .ttt-cell { aspect-ratio: 1 / 0.78; }
  .ttt-crit { font-size: 9.5px; }
}
```

- [ ] **Step 2: Verify build + no-scroll**

Run: `npx tsc -b && npm run build`
Expected: exit 0.
Manual: `npm run dev`, DevTools device toolbar at **390x844**, open `/tictactoe`: no vertical page scrollbar with the board rendered; every cell tap target ≥ 44px (inspect computed height); tab through cells → visible orange focus ring; toggle "Emulate prefers-reduced-motion" → no cell pop animation.

- [ ] **Step 3: Commit**

```bash
git add src/styles/TicTacToe.css
git commit -m "feat(tictactoe): game stylesheet (390x844 no-scroll, duel cell states)"
```

---

### Task 7: Final verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Full frontend gates**

Run: `npm run lint && npx tsc -b && npm run build`
Expected: all exit 0.

- [ ] **Step 2: Full backend gate**

Run: `cd backend && DATABASE_URL="" python manage.py test trivia`
Expected: `OK`.

- [ ] **Step 3: Seed validator gate**

Run: `cd backend && DATABASE_URL="" python scripts/validate_tictactoe_seed.py`
Expected: `OK: 8 boards, all cells solvable` (or structure-only OK if the curated dataset still hasn't landed — re-run this command once it does, before release).

- [ ] **Step 4: Contract self-check (read-only)**
- `git diff --stat main...HEAD` (or `git status`) shows ONLY: `tictactoe_seed.json`, `games/tictactoe.py`, `tests/test_tictactoe.py`, `scripts/validate_tictactoe_seed.py`, `data/tictactoe.json`, `TicTacToe.tsx`, `TicTacToe.css`, this plan. Any shared file in the diff is a violation — revert it.
- Grep the renderer for the single-fire guard: `grep -n "endedRef" "src/Game Renderers/TicTacToe.tsx"` — must gate BOTH the solo finish and the multiplayer terminal effect.
- Guess-log check: in solo, submit one right + one wrong guess, end the game, confirm one `POST /trivia/log-guesses/` with `game: "tictactoe"` in the network tab (or Django runserver log).

- [ ] **Step 5: Commit anything the sweep fixed**

```bash
git add -A && git commit -m "chore(tictactoe): verification sweep fixes"
```

---

## Self-Review (performed while writing)

- **Spec coverage:** duel per contract #6 (authoritative turn rendering, claim/steal actions, 25s countdown from `deadlineTs`, steal UI with per-uid `stealsLeft`, winner banner, opponent cells `--surface3`+outline vs own orange) → Task 5/6. Solo (3-min own countdown, SessionTimer stays host-mounted and untouched, seed-shaped boards, own 8-board `tictactoe_seed.json` with per-cell solvability validator, unlimited guesses, 25/cell, 225 max, `onGameEnd` on clock end or full board) → Tasks 1-4. Shared cell input = `AutoCompleteInput` + `playerMatches` on both criteria → Tasks 4/5. Loading/error/empty states, no-scroll 390x844, guess logging, exact commands → Tasks 4/6/7.
- **Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step carries real code; the only conditional instruction (pool-build command name, suggestion dropdown direction) includes the exact discovery command / fallback behavior.
- **Type consistency:** `TttCell/TttTurnState/TttAction/TicTacToeProps` defined once in Task 4 and reused verbatim in Task 5; Python `player_matches(p, c)` name matches Task 2 tests and Task 3 script imports; CSS class names in Task 6 match Tasks 4-5 JSX one-for-one; `CELL_POINTS=25` used for both solo scoring and multiplayer `onGameEnd`.
