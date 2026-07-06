# NBA Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the single-player NBA Connections game — 16 player tiles hiding 4 groups of 4, five hearts, difficulty-tiered solved bars — plus its offline-capable backend round provider and a factually-validated 40-board seed.

**Architecture:** One React renderer (`ConnectionsGame.tsx`) owns all client state (tile order, selection, hearts, solved groups) and validates guesses locally against the board's own `groups` (no criteria.ts needed — Connections ships explicit member lists). The Django module `connections.py` serves one random board from a bundled seed in the frozen `{'series':[...]}` envelope (DB optional, seed always works). A standalone Python validator proves each seed board is a clean 4×4 partition with exactly one valid solution before ship.

**Tech Stack:** React 19 + TypeScript (strict) + framer-motion; Django (JsonResponse, no DB dependency); Python 3 stdlib for the validator.

## Global Constraints

- **Design tokens only** (src/styles/theme.css): `--brand #ff6a1a` is the sole accent; `--bg`, `--surface/2/3`, `--text`, `--muted`, `--good #2fc762`, `--bad #ff4d4d`, `--line/--line2`, `--radius 14px`. `.font-display` (Russo One) for headings, `.tnum` for all numerals.
- **Difficulty tier colors (spec-mandated, orange family only):** 1=`#ffb347`, 2=`#ff8a3d`, 3=`var(--brand)`, 4=`#c2510a`. These are the ONLY colors outside the token set, and only on solved bars. No other new hues.
- **Play area fits 390×844 with NO page scroll**; touch targets ≥44px; visible focus states; contrast ≥4.5:1; `.tnum` on all numbers; respect `useReducedMotion`.
- **Scoring:** +50 per solved group, 200 max (4 groups). `onGameEnd(50 * solvedCount)` — called **exactly once**, guarded by `timersRef` cleanup on unmount + reset effect on `[gameInfo]`.
- **Hearts:** start at 5; wrong submit −1; at 0 → reveal remaining groups muted, then end.
- **Multiplayer prop:** when `multiplayer === true`, HIDE the Shuffle control (spec). Deselect always shown.
- **Round:** exactly 1 board via `fetchGamePool("connections", 1)` (scaffolder-owned; already wired in RenderGame).
- **CLAUDE.md surgical rule:** touch ONLY the files this plan names. Do NOT edit registry/types/criteria/pool — the scaffolder pre-staged them.
- **NEVER run backend tests/migrate against the Supabase `DATABASE_URL`.** Always prefix backend commands with `DATABASE_URL=""` (sqlite fallback).

---

## File Structure

**Create / overwrite (this game owns these — nobody else touches them):**
- `src/Game Renderers/ConnectionsGame.tsx` — overwrite the scaffolder stub with the real renderer. Keep the exported `ConnectionsGameProps` shape unchanged (RenderGame already passes `gameInfo/onGameEnd/turn/onTurnAction/multiplayer`).
- `src/styles/ConnectionsGame.css` — overwrite the stub CSS (`.cn-*` prefix, tokens + clamp only).
- `backend/trivia/games/connections.py` — overwrite the scaffolder stub with the real `get_round` / `build_pool` / `validate_rows`.
- `backend/trivia/data_static/connections_seed.json` — author 40 boards.
- `backend/trivia/games/connections_validate.py` — standalone seed validator script.
- `backend/trivia/tests/test_connections.py` — backend unit test for the module (create only; see Task 3 for the package-vs-single-file check).

**Modify (shared): NOTHING.** Types (`ConnectionsBoard`, `ConnectionsGameProps`), `RenderGame.tsx` case, `GameUtils.tsx`, routes, `gameEndpoints.js`, trivia routing, and `fetchGamePool` are ALL pre-staged by the scaffolder per frozen contracts #2/#5. Confirm, never edit.

### Pre-staged contracts this plan consumes (read-only — verify, don't change)

- `src/types/types.tsx`:
  ```ts
  export interface ConnectionsBoard {
    qid: string;
    tiles: string[];
    groups: { label: string; difficulty: number; members: string[] }[];
  }
  export type OnGameEnd = (finalScore: number) => void;
  ```
- `src/Game Renderers/ConnectionsGame.tsx` (stub) already exports:
  ```ts
  export interface ConnectionsGameProps {
    gameInfo: ConnectionsBoard[];
    onGameEnd: OnGameEnd;
    turn?: unknown;
    onTurnAction?: (a: unknown) => void;
    multiplayer?: boolean;
  }
  ```
- `src/Game Renderers/RenderGame.tsx` already renders the `"connections"` case passing `gameInfo/onGameEnd/turn/onTurnAction/multiplayer`.
- `src/utils/pool.ts`: `fetchGamePool(gameKey, rounds): Promise<FetchResult>` (used by the page host, not the renderer — the renderer receives `gameInfo`).
- `src/components/ui`: `Button`, `CourtLoader` (named exports). `SubmitGuessPopup` default export from `../components/SubmitGuessPopUp` with props `{ show, text, color }`.
- Guess logging endpoint: `POST ${BACKEND_ORIGIN}/trivia/log-guesses/` `{ game, entries:[{question_id, answer, correct, elapsed_ms}] }` fire-and-forget (mirror FanFavorites `sendGuessLog`).

---

## Task 1: Author the 40-board seed with factual care

**Files:**
- Create: `backend/trivia/data_static/connections_seed.json`

**Interfaces:**
- Produces: a JSON array of 40 board rows, each matching `ConnectionsBoard`:
  `{ qid:string, tiles:string[16], groups:[4 × { label:string, difficulty:1|2|3|4, members:string[4] }] }`.
  `tiles` MUST be the 16 group members combined (order is the initial display order — pre-shuffle them so the answer isn't readable top-to-bottom). `qid` unique per board (`"cn-001"…"cn-040"`).

**Authoring rules (factual care — this is the point of the game):**
- Every group is a real, checkable NBA fact. Rotate these category archetypes across the 40 boards so no board repeats a theme within itself:
  - **Draft classes:** e.g. `"2003 NBA Draft class"` → LeBron James, Carmelo Anthony, Dwyane Wade, Chris Bosh.
  - **Colleges:** e.g. `"Duke Blue Devils"` → Grant Hill, Kyrie Irving, JJ Redick, Jayson Tatum.
  - **Title-team teammates:** e.g. `"2016 Cavaliers champions"` → LeBron James, Kyrie Irving, Kevin Love, Tristan Thompson.
  - **Countries:** e.g. `"Born in Australia"` → Ben Simmons, Patty Mills, Joe Ingles, Matthew Dellavedova.
  - **Jersey numbers:** e.g. `"Wore #23"` → Michael Jordan, LeBron James, Anthony Davis, Draymond Green.
  - **Nickname themes:** e.g. `"'The ___' nicknames"` → The Answer (Iverson), The Truth (Pierce), The Beard (Harden), The Brow (Davis).
- **Trap overlaps are DELIBERATE but there must be EXACTLY ONE full valid solution.** Build each board so a player could *plausibly* fit a tile in two categories on a surface read, but only one 4-way partition is fully consistent. Example intended trap: LeBron James fits "2003 Draft" AND "Wore #23" — the board must ensure LeBron is only completable in ONE group given the other three members of each. The Task 2 validator enforces this; author defensively, then fix what it flags.
- **Difficulty tiers 1→4** = easy→hardest. Tier 1 = obvious/casual (famous draft class, marquee title team). Tier 4 = deep-cut (obscure jersey number, niche college, wordplay nicknames). Each board has exactly one group per tier (1,2,3,4).
- Use full canonical player names (`"LeBron James"`, not `"Lebron"`) — matches how tiles render and how the validator keys against `players_curated`.
- Prefer players present in `players_curated.json` so the validator can cross-check the trait; you MAY use a factually-correct player absent from the curated set (validator will simply skip the cross-check for that trait — see Task 2).

- [ ] **Step 1: Write the first board as the shape reference**

```json
[
  {
    "qid": "cn-001",
    "tiles": [
      "Carmelo Anthony", "Kyrie Irving", "Patty Mills", "Kevin Love",
      "Dwyane Wade", "JJ Redick", "Joe Ingles", "Tristan Thompson",
      "LeBron James", "Grant Hill", "Ben Simmons", "Chris Bosh",
      "Jayson Tatum", "Matthew Dellavedova", "Andrew Bogut", "Marvin Bagley III"
    ],
    "groups": [
      { "label": "2003 NBA Draft class", "difficulty": 1,
        "members": ["LeBron James", "Carmelo Anthony", "Dwyane Wade", "Chris Bosh"] },
      { "label": "2016 Cavaliers champions", "difficulty": 2,
        "members": ["Kyrie Irving", "Kevin Love", "Tristan Thompson", "Matthew Dellavedova"] },
      { "label": "Duke Blue Devils", "difficulty": 3,
        "members": ["Grant Hill", "JJ Redick", "Jayson Tatum", "Marvin Bagley III"] },
      { "label": "Born in Australia", "difficulty": 4,
        "members": ["Patty Mills", "Joe Ingles", "Ben Simmons", "Andrew Bogut"] }
    ]
  }
]
```

Intended trap in `cn-001`: LeBron/Kyrie/Love/Thompson are all Cavaliers, but LeBron is pulled into the 2003-draft group (Kyrie was 2011) — only one partition works. Note the authoring discipline: an early draft of this board used "Aron Baynes" for Duke, which is FALSE (Baynes went to Washington State) — the validator catches it and you replace with a real Duke player (Marvin Bagley III). Double-check every member before moving on.

- [ ] **Step 2: Author boards `cn-002` … `cn-040`** following the archetype rotation and difficulty-tier rule above. Aim for 2–3 boards per archetype-combo so the 40 feel varied. Every group double-checked against real NBA history before moving on.

- [ ] **Step 3: JSON sanity**

Run: `cd backend && DATABASE_URL="" python -c "import json; d=json.load(open('trivia/data_static/connections_seed.json')); print(len(d),'boards'); assert len(d)==40"`
Expected: `40 boards` and no assertion error.

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/data_static/connections_seed.json
git commit -m "feat(connections): author 40-board seed with real NBA facts"
```

---

## Task 2: Seed validator script + run + hand-fix

**Files:**
- Create: `backend/trivia/games/connections_validate.py`

**Interfaces:**
- Produces: a CLI script. `python -m trivia.games.connections_validate` (run from `backend/`) prints per-board problems and exits non-zero if any board fails. Checks per board:
  1. exactly 16 tiles, all unique;
  2. exactly 4 groups, each with exactly 4 members;
  3. `tiles` set === union of all group members (a true 4×4 partition, no stray/missing names);
  4. difficulties are exactly `{1,2,3,4}` (one each);
  5. **cross-group trap check** — for each group whose category is *derivable* from `players_curated.json`, no tile assigned to a DIFFERENT group also validly satisfies this group's criterion. If the curated file is missing a player or the trait isn't derivable, that specific check is SKIPPED (structural checks still run).

**Derivable-trait mapping (how the validator infers a group's criterion from its label):**
- college labels (contain a school name) → compare `players_curated[player].college`.
- country labels (`"Born in <country>"`) → `players_curated[player].country`.
- jersey labels (`"Wore #<n>"`) → `players_curated[player].jersey`.
- draft-class labels (`"<year> NBA Draft…"`) → `players_curated[player].draft.year`.
- Title-team / teammate / nickname labels are NOT reliably derivable → skip the cross-check for those groups (structural checks 1–4 still guarantee the partition; author owns those facts).

- [ ] **Step 1: Write the validator**

```python
"""Standalone seed validator for NBA Connections.

Run from backend/:  python -m trivia.games.connections_validate
Exits non-zero if any board is malformed or has an ambiguous solution.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(__file__)
SEED = os.path.join(HERE, "..", "data_static", "connections_seed.json")
CURATED = os.path.join(HERE, "..", "data_static", "players_curated.json")


def _load(path):
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _index_curated(curated):
    """name (lowercased) -> curated row, or {} if the file is absent."""
    if not curated:
        return {}
    return {row["full_name"].lower(): row for row in curated}


def _derive(label):
    """(kind, value) the label asserts, or (None, None) if not derivable."""
    m = re.search(r"\b(19|20)\d{2}\b", label)
    if m and "draft" in label.lower():
        return ("draft_year", int(m.group(0)))
    m = re.search(r"#\s*(\d+)", label)
    if m:
        return ("jersey", int(m.group(1)))
    m = re.match(r"born in (.+)", label.strip(), re.IGNORECASE)
    if m:
        return ("country", m.group(1).strip().lower())
    # Otherwise treat the label as a possible college phrase (matched loosely
    # against curated colleges); teammate/nickname labels simply won't match.
    return ("college", label.strip().lower())


def _satisfies(row, kind, value):
    """Does curated player row satisfy (kind, value)? None = can't tell."""
    if row is None:
        return None
    if kind == "draft_year":
        return bool(row.get("draft")) and row["draft"].get("year") == value
    if kind == "jersey":
        return row.get("jersey") == value
    if kind == "country":
        return (row.get("country") or "").lower() == value
    if kind == "college":
        col = (row.get("college") or "").lower()
        if not col:
            return None
        return col in value or value in col or col.split()[0] in value
    return None


def validate(boards, curated_index):
    problems = []
    for b in boards:
        qid = b.get("qid", "?")
        tiles = b.get("tiles", [])
        groups = b.get("groups", [])
        if len(tiles) != 16 or len(set(tiles)) != 16:
            problems.append(f"{qid}: tiles not 16-unique ({len(tiles)}, {len(set(tiles))} unique)")
        if len(groups) != 4 or any(len(g.get("members", [])) != 4 for g in groups):
            problems.append(f"{qid}: not four 4-member groups")
            continue
        member_union = [m for g in groups for m in g["members"]]
        if set(member_union) != set(tiles) or len(member_union) != 16:
            problems.append(f"{qid}: tiles != union(groups) (partition broken)")
        diffs = sorted(g.get("difficulty") for g in groups)
        if diffs != [1, 2, 3, 4]:
            problems.append(f"{qid}: difficulties {diffs} != [1,2,3,4]")
        # Cross-group trap check: a member of group B must NOT also satisfy A.
        for g in groups:
            kind, value = _derive(g["label"])
            if value is None:
                continue
            for other in groups:
                if other is g:
                    continue
                for member in other["members"]:
                    row = curated_index.get(member.lower())
                    if _satisfies(row, kind, value) is True:
                        problems.append(
                            f"{qid}: '{member}' (in '{other['label']}') also satisfies "
                            f"'{g['label']}' [{kind}={value}] — ambiguous solution")
    return problems


def main():
    boards = _load(SEED)
    if boards is None:
        print("FAIL: connections_seed.json missing")
        return 1
    curated = _load(CURATED)
    if curated is None:
        print("WARN: players_curated.json missing — running structural checks only")
    problems = validate(boards, _index_curated(curated))
    if problems:
        print(f"FAIL: {len(problems)} problem(s):")
        for p in problems:
            print("  -", p)
        return 1
    print(f"OK: {len(boards)} boards valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: Run the validator**

Run: `cd backend && DATABASE_URL="" python -m trivia.games.connections_validate`
Expected first run: likely `FAIL` listing structural/ambiguity problems to fix.

- [ ] **Step 3: Hand-fix every reported problem in `connections_seed.json`**, then re-run until:
Expected: `OK: 40 boards valid` (or `WARN: players_curated.json missing …` + `OK` if the foundation agent hasn't shipped curated yet — the structural pass must still be clean).

- [ ] **Step 4: Commit**

```bash
git add backend/trivia/games/connections_validate.py backend/trivia/data_static/connections_seed.json
git commit -m "feat(connections): seed validator + hand-fixed 40 boards to clean pass"
```

---

## Task 3: Backend round provider (`connections.py`)

**Files:**
- Overwrite: `backend/trivia/games/connections.py`
- Create: `backend/trivia/tests/test_connections.py`

**Interfaces:**
- Consumes: `connections_seed.json` (Task 1).
- Produces (frozen contract #4):
  - `get_round(request) -> JsonResponse({'series':[<one board>]})` — one random seed board; `503 {'error':…}` when seed empty.
  - `build_pool() -> list` — the full seed list (for `build_pools_from_db` / copy-data).
  - `validate_rows(rows) -> list[str]` — structural problems (NO curated cross-check, so builds never require the curated file).

- [ ] **Step 1: Overwrite the module**

```python
"""NBA Connections — backend round provider (frozen contract #4).

Serves one random board from the bundled seed. DB is optional; the seed file is
the always-available fallback. build_pool()/validate_rows() feed the pool
pipeline. Ambiguity (cross-group) checks live in connections_validate.py — this
module only does structural validation so builds never require players_curated.
"""
import json
import os
import random

from django.conf import settings
from django.http import JsonResponse

GAME_NAME = "NBA Connections"
SEED_PATH = os.path.join(settings.BASE_DIR, "trivia", "data_static", "connections_seed.json")


def _load_seed():
    if not os.path.exists(SEED_PATH):
        return []
    try:
        with open(SEED_PATH, "r", encoding="utf-8") as f:
            rows = json.load(f)
    except (OSError, ValueError):
        return []
    return rows if isinstance(rows, list) else []


def get_round(request):
    rows = _load_seed()
    if not rows:
        return JsonResponse({"error": "NBA Connections content not ready"}, status=503)
    return JsonResponse({"series": [random.choice(rows)]})


def build_pool():
    return _load_seed()


def validate_rows(rows):
    """Structural problems only (16 unique tiles, 4x4 partition, tiers 1-4)."""
    problems = []
    for b in rows:
        qid = b.get("qid", "?")
        tiles = b.get("tiles", [])
        groups = b.get("groups", [])
        if len(tiles) != 16 or len(set(tiles)) != 16:
            problems.append(f"{qid}: tiles not 16-unique")
            continue
        if len(groups) != 4 or any(len(g.get("members", [])) != 4 for g in groups):
            problems.append(f"{qid}: not four 4-member groups")
            continue
        union = [m for g in groups for m in g["members"]]
        if set(union) != set(tiles) or len(union) != 16:
            problems.append(f"{qid}: partition broken (tiles != union of groups)")
        if sorted(g.get("difficulty") for g in groups) != [1, 2, 3, 4]:
            problems.append(f"{qid}: difficulties must be exactly 1,2,3,4")
    return problems
```

- [ ] **Step 2: Confirm the test location + import path**

Check whether tests live in a package (`backend/trivia/tests/`) or a single `backend/trivia/tests.py`. Put the test in the matching place (this plan assumes the `tests/` package; if it's a single file, append the class there instead). Verify import:
Run: `cd backend && DATABASE_URL="" python -c "import trivia.games.connections as c; print(hasattr(c,'get_round'), hasattr(c,'build_pool'), hasattr(c,'validate_rows'))"`
Expected: `True True True`

- [ ] **Step 3: Write the backend test**

```python
# backend/trivia/tests/test_connections.py
import json

from django.test import RequestFactory, TestCase

from trivia.games import connections


class ConnectionsBackendTest(TestCase):
    def test_get_round_returns_one_board(self):
        resp = connections.get_round(RequestFactory().get("/"))
        self.assertEqual(resp.status_code, 200)
        payload = json.loads(resp.content)
        self.assertEqual(len(payload["series"]), 1)
        board = payload["series"][0]
        self.assertEqual(len(board["tiles"]), 16)
        self.assertEqual(len(board["groups"]), 4)

    def test_build_pool_nonempty_and_valid(self):
        pool = connections.build_pool()
        self.assertEqual(len(pool), 40)
        self.assertEqual(connections.validate_rows(pool), [])
```

- [ ] **Step 4: Run the test**

Run: `cd backend && DATABASE_URL="" python manage.py test trivia -v 1`
Expected: OK (the two Connections tests pass alongside existing trivia tests).

- [ ] **Step 5: Generate the published pool JSON** (frozen contract #8 — ship the static pool the client fetches)

Run: `cd backend && DATABASE_URL="" python manage.py build_pools_from_db` (or the repo's documented `copy-data` step). Confirm `backend/trivia/data/connections.json` exists with 40 rows:
Run: `cd backend && DATABASE_URL="" python -c "import json; print(len(json.load(open('trivia/data/connections.json'))))"`
Expected: `40`

- [ ] **Step 6: Commit**

```bash
git add backend/trivia/games/connections.py backend/trivia/tests/test_connections.py backend/trivia/data/connections.json
git commit -m "feat(connections): real backend round provider + tests + published pool"
```

---

## Task 4: Renderer CSS skeleton (390×844, no scroll)

**Files:**
- Overwrite: `src/styles/ConnectionsGame.css`

**Interfaces:**
- Produces the `.cn-*` class contract the renderer (Task 5) uses: `.cn-wrap`, `.cn-head` (+ `.cn-title`, `.cn-sub`), `.cn-hearts`, `.cn-solved` (+ `.cn-solved-bar` reading a `--tier` custom prop for the difficulty color, `.cn-solved-label`, `.cn-solved-members`), `.cn-grid`, `.cn-tile` (+ `.is-selected`), `.cn-controls`, `.cn-note`.

**Layout budget for 390×844 (no page scroll):** head (~52px) + hearts (~24px) + solved bars (0–4 × ~40px) + tile grid (shrinks as bars appear: a 4-col grid of the *remaining* rows) + controls (~48px) + popup row (~20px). Because a solved group REMOVES its row of tiles as it collapses into a bar, total height stays roughly constant — no layout shift beyond the intended collapse.

- [ ] **Step 1: Write the CSS**

```css
/* ===== NBA Connections ===== */
.cn-wrap {
  position: relative;
  width: 100%;
  max-width: 560px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(8px, 1.4dvh, 14px);
}

/* Header */
.cn-head { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
.cn-title { font-size: clamp(15px, 2.2dvh, 20px); color: var(--text); }
.cn-sub { font-size: clamp(10.5px, 1.5dvh, 12px); color: var(--muted); }

/* Hearts */
.cn-hearts { display: flex; gap: 7px; }

/* Solved group bars (collapse target) */
.cn-solved { display: flex; flex-direction: column; gap: 6px; width: 100%; }
.cn-solved-bar {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: 40px;
  padding: 6px 10px;
  border-radius: var(--radius);
  background: var(--tier, var(--brand));
  color: #1a1206;
  text-align: center;
}
.cn-solved-label { font-size: 12.5px; font-weight: 700; letter-spacing: 0.3px; }
.cn-solved-members { font-size: 11px; font-weight: 600; opacity: 0.85; }

/* Tile grid — 4 columns of the remaining tiles */
.cn-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: clamp(5px, 1.1vw, 8px);
  width: 100%;
}
.cn-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  min-height: 56px;
  padding: 4px 5px;
  min-width: 0;
  font-size: clamp(9.5px, 1.35dvh, 12px);
  font-weight: 700;
  line-height: 1.1;
  color: var(--text);
  background: var(--surface2);
  border: 1px solid var(--line);
  border-radius: 10px;
  cursor: pointer;
  overflow: hidden;
  transition: background 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}
.cn-tile:hover { border-color: var(--line2); }
.cn-tile:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }
.cn-tile.is-selected {
  background: var(--brand-soft);
  border-color: var(--brand);
  color: var(--brand);
  transform: translateY(-1px);
}
.cn-tile:disabled { cursor: default; }

/* Controls */
.cn-controls { display: flex; gap: 10px; justify-content: center; width: 100%; }

.cn-note { font-size: 12px; color: var(--muted); text-align: center; }

/* Small phones (390x844): tighter tiles so 16 fit with no scroll */
@media (max-width: 480px) {
  .cn-grid { gap: 5px; }
  .cn-tile { min-height: 52px; font-size: 10px; }
  .cn-solved-bar { min-height: 38px; }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/ConnectionsGame.css
git commit -m "feat(connections): CSS layout skeleton (390x844 no-scroll)"
```

---

## Task 5: Renderer logic (`ConnectionsGame.tsx`)

**Files:**
- Overwrite: `src/Game Renderers/ConnectionsGame.tsx`

**Interfaces:**
- Consumes: `ConnectionsGameProps` (unchanged from stub), `ConnectionsBoard`/`OnGameEnd` types, `Button`/`CourtLoader` from `../components/ui`, `SubmitGuessPopup` default from `../components/SubmitGuessPopUp`, `BACKEND_ORIGIN` from `../configurations/backend`, `apiFetch` from `../utils/Api`.
- Produces: default-exported `ConnectionsGame`. Calls `onGameEnd(50 * solved.length)` exactly once.

**State model (all local — Connections carries its own answer key in `groups`, so NO criteria.ts):**
- `order: string[]` — remaining (unsolved) tiles in display order; init `shuffle(board.tiles)`, mutated by Shuffle, shrunk when a group solves.
- `solved: SolvedGroup[]` — solved groups in solve order (drives the bars, top to bottom).
- `selected: string[]` — currently picked tiles (hard cap 4).
- `hearts: number` — starts 5.
- `finished: boolean` — end guard.
- `popup {show,text,color}` + `timersRef` + `later`/`clearTimers` (FanFavorites pattern verbatim).

**Core evaluation helper (pure, module scope — the tricky part). Returns the exactly-matched group index (or −1) plus the best overlap with any unsolved group, so the caller can show "One away!" at 3/4.**

- [ ] **Step 1: Write the full renderer**

```tsx
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import SubmitGuessPopup from "../components/SubmitGuessPopUp";
import { Button, CourtLoader } from "../components/ui";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "../utils/Api";
import type { ConnectionsBoard, OnGameEnd } from "../types/types";
import "../styles/ConnectionsGame.css";

export interface ConnectionsGameProps {
  gameInfo: ConnectionsBoard[];
  onGameEnd: OnGameEnd;
  turn?: unknown;
  onTurnAction?: (a: unknown) => void;
  multiplayer?: boolean;
}

const POINTS_PER_GROUP = 50; // 4 groups -> 200 max
const START_HEARTS = 5;

const TIER_COLOR: Record<number, string> = {
  1: "#ffb347", 2: "#ff8a3d", 3: "var(--brand)", 4: "#c2510a",
};

const same = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  const sb = new Set(b);
  return a.every((x) => sb.has(x));
};

function evaluateGuess(
  picked: string[],
  groups: ConnectionsBoard["groups"],
  solvedIdx: Set<number>,
): { matchIdx: number; bestOverlap: number } {
  let matchIdx = -1;
  let bestOverlap = 0;
  groups.forEach((g, i) => {
    if (solvedIdx.has(i)) return;
    const overlap = picked.filter((p) => g.members.includes(p)).length;
    if (overlap > bestOverlap) bestOverlap = overlap;
    if (overlap === 4 && same(picked, g.members)) matchIdx = i;
  });
  return { matchIdx, bestOverlap };
}

const shuffle = (arr: string[]) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

interface SolvedGroup { idx: number; label: string; difficulty: number; members: string[]; }
interface GuessEntry { question_id: string; answer: string; correct: boolean; elapsed_ms: number; }

function ConnectionsGame({ gameInfo, onGameEnd, multiplayer }: ConnectionsGameProps) {
  const board = gameInfo && gameInfo.length > 0 ? gameInfo[0] : null;

  const [order, setOrder] = useState<string[]>([]);
  const [solved, setSolved] = useState<SolvedGroup[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [hearts, setHearts] = useState(START_HEARTS);
  const [finished, setFinished] = useState(false);
  const [popup, setPopup] = useState({ show: false, text: "", color: "" });

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const guessLogRef = useRef<GuessEntry[]>([]);
  const startRef = useRef(Date.now());
  const reduce = useReducedMotion();

  const later = (fn: () => void, ms: number) => { timersRef.current.push(setTimeout(fn, ms)); };
  const clearTimers = () => { timersRef.current.forEach(clearTimeout); timersRef.current = []; };

  // Fire-and-forget guess log (the data flywheel). Mirrors FanFavorites.
  const sendGuessLog = () => {
    const entries = guessLogRef.current;
    guessLogRef.current = [];
    if (!entries.length) return;
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game: "connections", entries }),
    }).catch(() => { /* analytics only */ });
  };

  // Fresh state whenever a new board loads (play-again / next round).
  useEffect(() => {
    clearTimers();
    setOrder(board ? shuffle(board.tiles) : []);
    setSolved([]);
    setSelected([]);
    setHearts(START_HEARTS);
    setFinished(false);
    setPopup({ show: false, text: "", color: "" });
    guessLogRef.current = [];
    startRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board]);

  // Unmount: cancel pending timers + flush guess log (abandoned rounds still feed the flywheel).
  useEffect(() => () => { clearTimers(); sendGuessLog(); }, []);

  const flash = (text: string, color: string) => {
    setPopup({ show: true, text, color });
    later(() => setPopup((p) => ({ ...p, show: false })), 1500);
  };

  const toggleTile = (name: string) => {
    if (finished) return;
    setSelected((prev) => {
      if (prev.includes(name)) return prev.filter((n) => n !== name);
      if (prev.length >= 4) return prev; // hard cap at 4
      return [...prev, name];
    });
  };

  const endGame = (solvedCount: number) => {
    setFinished(true);
    sendGuessLog();
    later(() => onGameEnd?.(POINTS_PER_GROUP * solvedCount), 300);
  };

  const revealRemaining = (currentSolved: SolvedGroup[]) => {
    // Hearts exhausted: reveal every still-unsolved group as a muted bar, in
    // difficulty order, then end with the score for what the player DID solve.
    const solvedIdxSet = new Set(currentSolved.map((s) => s.idx));
    const remaining = board!.groups
      .map((g, i) => ({ g, i }))
      .filter(({ i }) => !solvedIdxSet.has(i))
      .sort((a, b) => a.g.difficulty - b.g.difficulty);
    remaining.forEach(({ g, i }, k) => {
      later(() => {
        setSolved((prev) => [...prev, { idx: i, label: g.label, difficulty: g.difficulty, members: g.members }]);
        setOrder((prev) => prev.filter((t) => !g.members.includes(t)));
      }, 400 + k * 450);
    });
    later(() => endGame(currentSolved.length), 400 + remaining.length * 450 + 500);
  };

  const handleSubmit = () => {
    if (finished || selected.length !== 4 || !board) return;
    const solvedIdxSet = new Set(solved.map((s) => s.idx));
    const { matchIdx, bestOverlap } = evaluateGuess(selected, board.groups, solvedIdxSet);
    const elapsed = Date.now() - startRef.current;
    const picked = [...selected];

    if (matchIdx >= 0) {
      const g = board.groups[matchIdx];
      guessLogRef.current.push({ question_id: board.qid, answer: picked.join("|"), correct: true, elapsed_ms: elapsed });
      const nextSolved = [...solved, { idx: matchIdx, label: g.label, difficulty: g.difficulty, members: g.members }];
      setSolved(nextSolved);
      setOrder((prev) => prev.filter((t) => !g.members.includes(t)));
      setSelected([]);
      if (nextSolved.length === 4) {
        flash("Solved! +50 — board cleared", "var(--good)");
        endGame(4);
      } else {
        flash("+50", "var(--good)");
      }
      return;
    }

    // Wrong group: -1 heart, "One away!" when 3/4 belong to one unsolved group.
    guessLogRef.current.push({ question_id: board.qid, answer: picked.join("|"), correct: false, elapsed_ms: elapsed });
    const nextHearts = hearts - 1;
    setHearts(nextHearts);
    setSelected([]);
    if (nextHearts <= 0) {
      flash("Out of hearts", "var(--bad)");
      revealRemaining(solved);
    } else {
      flash(bestOverlap === 3 ? "One away!" : "Not a group", "var(--bad)");
    }
  };

  if (!board) return <div className="cn-wrap"><CourtLoader label="Loading board…" /></div>;
  if (!board.tiles || board.tiles.length !== 16 || !board.groups || board.groups.length !== 4)
    return <div className="cn-wrap"><p className="cn-note">This board is unavailable. Please try another round.</p></div>;

  const canSubmit = !finished && selected.length === 4;

  return (
    <div className="cn-wrap">
      <div className="cn-head">
        <h2 className="cn-title font-display">NBA Connections</h2>
        <span className="cn-sub">Find four groups of four.</span>
      </div>

      {/* Hearts */}
      <div className="cn-hearts" aria-label={`${hearts} hearts left`}>
        {[...Array(START_HEARTS)].map((_, i) => {
          const alive = i < hearts;
          return (
            <motion.svg
              key={i} width="18" height="18" viewBox="0 0 24 24"
              animate={reduce ? undefined : { scale: alive ? 1 : 0.82, rotate: alive ? 0 : [0, -14, 12, -6, 0] }}
              transition={{ duration: 0.45 }}
              fill={alive ? "var(--bad)" : "none"} stroke={alive ? "var(--bad)" : "var(--line2)"}
              strokeWidth="2" style={{ opacity: alive ? 1 : 0.55 }}
            >
              <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
            </motion.svg>
          );
        })}
      </div>

      {/* Solved bars */}
      {solved.length > 0 && (
        <div className="cn-solved">
          <AnimatePresence>
            {solved.map((s) => (
              <motion.div
                key={s.idx}
                className="cn-solved-bar"
                style={{ ["--tier" as string]: TIER_COLOR[s.difficulty] }}
                initial={reduce ? false : { opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                <span className="cn-solved-label">{s.label}</span>
                <span className="cn-solved-members">{s.members.join(" · ")}</span>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Remaining tiles */}
      <div className="cn-grid">
        {order.map((name) => {
          const isSel = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              className={`cn-tile${isSel ? " is-selected" : ""}`}
              onClick={() => toggleTile(name)}
              disabled={finished}
              aria-pressed={isSel}
            >
              {name}
            </button>
          );
        })}
      </div>

      {/* Controls: Deselect always; Shuffle hidden in multiplayer (spec) */}
      <div className="cn-controls">
        {!multiplayer && (
          <Button
            size="sm" variant="secondary"
            onClick={() => setOrder((prev) => shuffle(prev))}
            disabled={finished || order.length === 0}
          >
            Shuffle
          </Button>
        )}
        <Button
          size="sm" variant="secondary"
          onClick={() => setSelected([])}
          disabled={finished || selected.length === 0}
        >
          Deselect
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
          Submit
        </Button>
      </div>

      <SubmitGuessPopup show={popup.show} text={popup.text} color={popup.color} />
    </div>
  );
}

export default ConnectionsGame;
```

> Implementer notes: (a) confirm `CourtLoader` accepts a `label` prop — StartingFive/FanFavorites use the shared loader; if its prop name differs, pass the label per its real signature. (b) `variant="secondary"` matches the Button usage in StartingFive.tsx; if the Button API differs, use the correct secondary/ghost variant. (c) the `["--tier" as string]` inline custom-prop cast satisfies `tsc` strict for a CSS variable in a `style` object.

- [ ] **Step 2: Typecheck**

Run: `npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors for `ConnectionsGame.tsx`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add "src/Game Renderers/ConnectionsGame.tsx"
git commit -m "feat(connections): renderer — selection, hearts, tiered solve bars, reveal"
```

---

## Task 6: States + mobile no-scroll verification

**Files:** none (verification over Task 4/5 output).

- [ ] **Step 1: Loading / empty / error states confirmed in code**
- **Loading:** `!board` → `<CourtLoader label="Loading board…" />` (host shows CourtLoader while `fetchGamePool` is in flight; the renderer branch covers the empty-`gameInfo` gap so there is no blank flash).
- **Empty / malformed:** `tiles.length !== 16 || groups.length !== 4` → `.cn-note` "This board is unavailable. Please try another round." (client guard for a bad seed row).
- **Error:** network failure returns `{success:false, error}` from `fetchGamePool` and is rendered by the page host (contract #2); the renderer never mounts without data. Confirm that host path exists — nothing to add in the renderer.

- [ ] **Step 2: Manual 390×844 no-scroll check**

Run: `npm run dev`, open the connections route, DevTools device toolbar at **390×844**. Verify:
- 16 tiles + hearts + header + controls fit with NO page scroll.
- Solve a group → its row collapses into a full-width bar in the difficulty color; grid reflows to remaining rows; no horizontal or page scroll at any solved-count (0→4).
- Touch targets: tiles ≥52px tall, buttons ≥44px.
- Long names (e.g. "Matthew Dellavedova") wrap inside the tile without overflow.
- Miss 5 times → remaining groups reveal as bars in difficulty order, then results show. Solve all 4 → "+50 board cleared", score 200.
- Tab through tiles → visible orange focus ring (`:focus-visible`).

- [ ] **Step 3: Verify scoring + single-end contract**
- Solve exactly N groups then lose → results score `50*N` (0/50/100/150). Solve all 4 → 200. Confirm `onGameEnd` fires exactly once (temporary `console.count("onGameEnd")` in dev, then remove before commit).

- [ ] **Step 4: Verify multiplayer Shuffle-hide**
- Render with `multiplayer` true (or via OnlineMatch): Shuffle absent, Deselect + Submit present. Revert the temporary change.

- [ ] **Step 5: Commit any fixes** from Steps 2–4

```bash
git add "src/Game Renderers/ConnectionsGame.tsx" src/styles/ConnectionsGame.css
git commit -m "fix(connections): mobile no-scroll + state polish from device check"
```

---

## Self-Review (completed by planner)

**1. Spec coverage**
- 16 tiles / 4 groups of 4 → Task 1 seed + Task 2 partition check + renderer grid. ✓
- Trap overlaps but exactly one solution → Task 2 cross-group ambiguity check. ✓
- 5 hearts; select exactly 4 → Submit enables → `canSubmit = selected.length===4`, cap at 4 in `toggleTile`. ✓
- Wrong submit −1 heart; "One away!" at 3/4 → `handleSubmit` `bestOverlap===3`. ✓
- Solved group collapses to full-width bar colored by difficulty tier + label revealed → `.cn-solved-bar` + `TIER_COLOR` + label/members. ✓
- +50/group, 200 max → `POINTS_PER_GROUP` × 4 groups. ✓
- Single-player Shuffle + Deselect; multiplayer hides Shuffle → `!multiplayer &&` guard. ✓
- Hearts 0 → reveal remaining muted, `onGameEnd(50*solved)` → `revealRemaining` + `endGame`. ✓
- Seed 40 boards with the exact shape → Task 1. ✓
- Validator checks 16 unique, 4×4 partition, no dual-fit → Task 2. ✓
- Round = 1 random board via `fetchGamePool("connections",1)` → backend `get_round` random + host fetch (contract #5, pre-staged). ✓
- Guess logging (flywheel, contract #7) → `sendGuessLog` per submit. ✓
- Loading/empty/error + mobile no-scroll → Task 6. ✓

**2. Placeholder scan:** No TBD / "handle edge cases" / "similar to Task N". Every code step shows full code; every verify step gives an exact command + expected output. ✓

**3. Type consistency:** `evaluateGuess` returns `{matchIdx,bestOverlap}` used consistently; `SolvedGroup` fields (`idx,label,difficulty,members`) consistent across state, `revealRemaining`, and the bar render; `ConnectionsGameProps` matches the pre-staged stub; `TIER_COLOR` keyed 1–4 matching seed `difficulty`; backend `validate_rows` and the validator's structural checks agree on the partition rule. ✓

**Known dependency:** Task 2's cross-group check needs `players_curated.json` (foundation agent). If absent at execution time, the validator prints WARN and runs structural-only — still a clean gate; re-run the cross-check once curated ships.
