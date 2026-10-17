# The Ladder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show players, inside the app, how ranks are distributed and what it takes to climb: a cached ladder endpoint and a responsive "The ladder" modal with percentile, share and sign-up hooks.

**Architecture:** One read-only endpoint (`GET /api/ranks/ladder/`) built from a 10-minute-cached distribution (`users/ladder.py`) plus a per-request `you` block; the frontend adds a `useLadder` hook (module cache like `useLeaderboard`), pure copy helpers in `src/utils/ladder.ts` (unit-tested with `node --test`), a `LadderModal` registered in `ModalHost`, and three entry points. No chart library: the bars are CSS widths.

**Tech Stack:** Django 5.1 + DRF, Django cache (Redis in prod, DB cache locally), Next.js 16 / React 19 / Redux Toolkit / framer-motion, `node --experimental-strip-types` test scripts.

**Spec:** `docs/superpowers/specs/2026-10-16-rank-ladder-design.md`

## Global Constraints

- Work in the worktree `C:\Users\stefa\.team-worktrees\rank-ladder` (branch `feat/rank-ladder` from `origin/dev`). Backend tests: from `backend/`, `C:\Users\stefa\OneDrive\Desktop\nba-projects\nba-minigames\backend\venv\Scripts\python.exe manage.py test <label> --noinput`. Frontend: `npm ci` once (if `npm ci` refuses the lockfile, STOP: the lockfile must only ever be regenerated with `npx npm@10` — report it), `npx next typegen && npx tsc --noEmit`, `npm run lint`, unit scripts `node --experimental-strip-types scripts/<name>.mjs`.
- The public population is `users.leaderboard._ranked()` (adult, not banned) — the same as the global board. Never a new filter.
- Percentile thresholds are five `ORDER BY points DESC OFFSET k LIMIT 1` queries, never a full points list in Python.
- `rules` values must be read from `trivia.awarding` / `users.views` constants, never retyped.
- Per-game maxima come from `visibleGames[].maxPoints` on the frontend (already equal to the backend caps).
- Copy rules (spec §2): one decimal only in the "Top x %" headline; floor 0.1, cap 99.9; "Early adopter" under 20 players; `toLocaleString` for points.
- UI rules: `docs/constraints/UI_SHELL_CONSTRAINTS.md` — labels swap via `SwapText`, no height snaps; the Modal shell handles sheet vs desktop. Brand "Swish Quest" / swishquest.com only.
- REQUIRED SUB-SKILL for the bars (Task 3): load the `dataviz` skill before writing the bar markup/CSS.
- Surgical changes; one-line commit messages; **no `Co-Authored-By` / AI attribution trailers** (owner rule).

## Review Focus

1. A fresh database (0 or 1 public players): `distribution()` must not divide by zero or index an empty queryset; `share_pct` 0.0 for every rank, `percentiles` all 0, the modal shows "Early adopter". → Task 1 `test_empty_population`, Task 2 `toTopCopy`/`percentileHeadline` tests.
2. A signed-in teen (not in the public population) opens the ladder: `you` is computed (position via `rank_of`, percentile against the public total), never a 500 and never `same_rank_pct` > 100. → Task 1 `test_teen_gets_a_you_block`.
3. The cache key must change if the ladder or the rules change: `ladder:v1` is versioned; `distribution()` is memoised by TTL only — a rank threshold change ships with a bump to `LADDER_CACHE_KEY`. → Task 1 docstring + test that a second call hits the cache (`assertNumQueries(0)` after warm-up).
4. The modal opened from the rank-up modal while `pendingRankUp` was just cleared: `ModalHost` must switch kinds cleanly (open("ladder") from inside the rank-up content replaces the modal; no double overlay). → Task 3 browser pass.
5. A guest: `you: null` must render the sign-up CTA, never "Top NaN %". → Task 2 `youBlockOrGuest` test, Task 3 browser pass as a guest.

---

### Task 1: Ladder endpoint

**Files:**
- Create: `backend/users/ladder.py`, `backend/users/test_ladder.py`
- Modify: `backend/users/views.py` (new view `get_ladder`, import), `backend/users/urls.py` (route)

**Interfaces:**
- Consumes: `users.ranks.LADDER / RANK_NAMES / progress / division`, `users.leaderboard._ranked / rank_of / total`, `trivia.awarding.FIRST_GAME_BONUS / DAILY_FULL / DAILY_HALF / DAILY_TAIL_RATE / STREAK_MILESTONES / MAX_FREEZES`, `users.views.GUEST_CARRYOVER_MAX`.
- Produces: `users.ladder.PERCENTILES = (1, 5, 10, 25, 50)`, `LADDER_CACHE_KEY = "ladder:v1"`, `LADDER_TTL = 600`, `distribution() -> {"total_players", "ladder", "percentiles"}`, `you_block(user, dist) -> dict`, `rules() -> dict`; `GET /api/ranks/ladder/` → the spec §1 JSON.

- [ ] **Step 1: Write the failing tests** — `backend/users/test_ladder.py`:

```python
"""The ladder endpoint: rank distribution, percentile thresholds, the signed-in `you` block (ladder spec §1)."""
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import Client, TestCase, override_settings

from trivia import awarding
from users import ladder
from users.views import GUEST_CARRYOVER_MAX

User = get_user_model()

# The local default cache is the DatabaseCache (a cache hit is itself a query); an in-memory cache
# lets `test_second_call_is_cached` assert zero queries.
LOCMEM = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}


def _player(i, points, rank, age_group="adult"):
    return User.objects.create_user(
        username=f"p{i}", email=f"p{i}@example.com", password="x", points=points, rank=rank, age_group=age_group
    )


@override_settings(CACHES=LOCMEM)
class DistributionTests(TestCase):
    def setUp(self):
        cache.clear()
        # 10 public players: 4 Rookie, 3 Role Player, 2 Sixth Man, 1 Starter; points 0..9000.
        pts = [0, 10, 20, 30, 100, 150, 200, 600, 900, 9000]
        ranks = ["Rookie"] * 4 + ["Role Player"] * 3 + ["Sixth Man"] * 2 + ["Starter"]
        for i, (p, r) in enumerate(zip(pts, ranks)):
            _player(i, p, r)
        # Hidden from the public population: a teen and a banned account.
        _player(90, 50_000, "GOAT", age_group="teen")
        banned = _player(91, 50_000, "GOAT")
        from django.utils import timezone
        User.objects.filter(pk=banned.pk).update(banned_at=timezone.now())

    def tearDown(self):
        cache.clear()

    def test_counts_and_shares_follow_the_ladder_order(self):
        d = ladder.distribution()
        self.assertEqual(d["total_players"], 10)
        names = [row["name"] for row in d["ladder"]]
        self.assertEqual(names, list(ladder.RANK_NAMES))
        by = {row["name"]: row for row in d["ladder"]}
        self.assertEqual(by["Rookie"]["players"], 4)
        self.assertEqual(by["Rookie"]["share_pct"], 40.0)
        self.assertEqual(by["Starter"]["players"], 1)
        self.assertEqual(by["GOAT"]["players"], 0)
        self.assertEqual(by["GOAT"]["share_pct"], 0.0)
        self.assertEqual(by["Starter"]["points"], 1_500)
        self.assertEqual(by["Starter"]["days"], 3)

    def test_percentile_thresholds(self):
        d = ladder.distribution()
        # top 10% of 10 players = the single best (9000); top 50% = the 5th best (150); 25% = 3rd best (600).
        self.assertEqual(d["percentiles"]["10"], 9_000)
        self.assertEqual(d["percentiles"]["25"], 600)
        self.assertEqual(d["percentiles"]["50"], 150)
        self.assertEqual(d["percentiles"]["1"], 9_000)

    def test_second_call_is_cached(self):
        ladder.distribution()
        with self.assertNumQueries(0):
            ladder.distribution()

    def test_empty_population(self):
        User.objects.all().delete()
        cache.clear()
        d = ladder.distribution()
        self.assertEqual(d["total_players"], 0)
        self.assertTrue(all(row["share_pct"] == 0.0 for row in d["ladder"]))
        self.assertEqual(set(d["percentiles"].values()), {0})


class YouBlockTests(TestCase):
    def setUp(self):
        cache.clear()
        for i, p in enumerate([0, 50, 120, 400, 900, 2_000, 6_000, 20_000, 50_000, 160_000]):
            _player(i, p, "Rookie")
        User.objects.filter(points__gte=100).update(rank="Role Player")
        User.objects.filter(points__gte=500).update(rank="Sixth Man")
        self.me = User.objects.get(points=900)  # 5th best of 10 -> top 50%, Sixth Man

    def tearDown(self):
        cache.clear()

    def test_you_block(self):
        you = ladder.you_block(self.me, ladder.distribution())
        self.assertEqual(you["rank"], "Sixth Man")
        self.assertEqual(you["position"], 6)
        self.assertEqual(you["percentile"], 60.0)
        self.assertEqual(you["ahead_of_pct"], 40.0)
        self.assertEqual(you["same_rank_pct"], 60.0)  # 6 of 10 have >= 500 and rank Sixth Man
        self.assertEqual(you["next_rank"], "Starter")
        self.assertEqual(you["points_to_next"], 600)
        # Top 50% of 10 = the 5th best (2,000): position 6 is just outside it.
        self.assertEqual(you["to_top"]["50"], 2_000 - 900)
        self.assertEqual(you["to_top"]["10"], 160_000 - 900)

    def test_teen_gets_a_you_block(self):
        teen = _player(99, 700, "Sixth Man", age_group="teen")
        you = ladder.you_block(teen, ladder.distribution())
        self.assertEqual(you["position"], 7)  # 6 public players have more points
        self.assertLessEqual(you["same_rank_pct"], 100.0)
        self.assertGreater(you["percentile"], 0)


class LadderEndpointTests(TestCase):
    def setUp(self):
        cache.clear()
        _player(1, 300, "Role Player")

    def tearDown(self):
        cache.clear()

    def test_guest_gets_the_ladder_and_rules_without_you(self):
        res = Client().get("/api/ranks/ladder/")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIsNone(body["you"])
        self.assertEqual(len(body["ladder"]), 9)
        self.assertEqual(body["rules"]["first_game_bonus"], awarding.FIRST_GAME_BONUS)
        self.assertEqual(body["rules"]["daily_full"], awarding.DAILY_FULL)
        self.assertEqual(body["rules"]["streak_milestones"], {str(k): v for k, v in awarding.STREAK_MILESTONES.items()})
        self.assertEqual(body["rules"]["max_freezes"], awarding.MAX_FREEZES)
        self.assertEqual(body["rules"]["guest_carryover_max"], GUEST_CARRYOVER_MAX)

    def test_signed_in_gets_you(self):
        c = Client()
        tokens = c.post("/api/login/", {"id": "p1@example.com", "password": "x"}, content_type="application/json").json()
        body = c.get("/api/ranks/ladder/", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}").json()
        self.assertEqual(body["you"]["rank"], "Role Player")
        self.assertEqual(body["you"]["position"], 1)
```

(If `users/test_progression_api.py` logs in differently — e.g. a helper or `cache.clear()` for the login throttle — copy that pattern.)

- [ ] **Step 2: Run them to see them fail**

Run: `... manage.py test users.test_ladder --noinput` → ImportError on `users.ladder`.

- [ ] **Step 3: Create `backend/users/ladder.py`**

```python
"""The ladder: how ranks are distributed and what it takes to climb (ladder spec §1).

`distribution()` is the expensive part — one GROUP BY over the public players plus five OFFSET queries for the
percentile thresholds — and is cached for LADDER_TTL under LADDER_CACHE_KEY. Bump the key's version whenever the
ladder (users.ranks.LADDER) or the shape of the payload changes, so a deploy never serves a stale shape. The `you`
block is per request (one rank_of query) and never cached.
"""
import math

from django.core.cache import cache
from django.db.models import Count

from users import leaderboard, ranks

PERCENTILES = (1, 5, 10, 25, 50)
LADDER_CACHE_KEY = "ladder:v1"
LADDER_TTL = 600  # seconds
RANK_NAMES = ranks.RANK_NAMES


def _threshold(ranked, total, pct):
    """Points of the player at the top-`pct`% boundary: at least this many points puts you in the top pct%."""
    if total == 0:
        return 0
    k = max(0, math.ceil(total * pct / 100) - 1)
    row = ranked.order_by("-points").values_list("points", flat=True)[k:k + 1]
    return row[0] if row else 0


def _compute():
    ranked = leaderboard._ranked()
    total = ranked.count()
    counts = dict(ranked.values("rank").annotate(n=Count("id")).values_list("rank", "n"))
    rows = []
    for r in ranks.LADDER:
        n = counts.get(r.name, 0)
        rows.append({
            "name": r.name,
            "points": r.points,
            "days": r.days,
            "players": n,
            "share_pct": round(100 * n / total, 1) if total else 0.0,
        })
    return {
        "total_players": total,
        "ladder": rows,
        "percentiles": {str(p): _threshold(ranked, total, p) for p in PERCENTILES},
    }


def distribution():
    """Cached rank counts + percentile thresholds for the public population (adult, not banned)."""
    data = cache.get(LADDER_CACHE_KEY)
    if data is None:
        data = _compute()
        cache.set(LADDER_CACHE_KEY, data, LADDER_TTL)
    return data


def you_block(user, dist):
    """Where `user` stands against the public population. Works for accounts outside it (teens)."""
    total = dist["total_players"]
    position = leaderboard.rank_of(user)
    percentile = round(100 * position / total, 1) if total else 100.0
    percentile = min(99.9, max(0.1, percentile))
    same = next((row["players"] for row in dist["ladder"] if row["name"] == user.rank), 0)
    prog = ranks.progress(user.points, user.active_days)
    return {
        "rank": user.rank,
        "division": prog["division"],
        "position": position,
        "percentile": percentile,
        "ahead_of_pct": round(100 - percentile, 1),
        "same_rank_pct": round(min(100.0, 100 * same / total), 1) if total else 0.0,
        "next_rank": prog["next_rank"],
        "points_to_next": prog["points_to_next"],
        "days_to_next": prog["days_to_next"],
        "to_top": {p: max(0, pts - user.points) for p, pts in dist["percentiles"].items()},
    }


def rules():
    """The daily rules the UI explains, read from the code so the copy can't drift."""
    from trivia import awarding
    from users.views import GUEST_CARRYOVER_MAX

    return {
        "first_game_bonus": awarding.FIRST_GAME_BONUS,
        "daily_full": awarding.DAILY_FULL,
        "daily_half": awarding.DAILY_HALF,
        "daily_tail_rate": awarding.DAILY_TAIL_RATE,
        "streak_milestones": {str(k): v for k, v in awarding.STREAK_MILESTONES.items()},
        "max_freezes": awarding.MAX_FREEZES,
        "guest_carryover_max": GUEST_CARRYOVER_MAX,
    }
```

Check `YouBlockTests.test_you_block` arithmetic against `rank_of` ("players with strictly more points + 1"): 900 has 4 players above (2,000 / 6,000 / 20,000 / 50,000 / 160,000 = 5) → position 6, percentile 60.0. If the test's `position` line disagrees with your count, fix the test's expected number, not the code.

- [ ] **Step 4: View and route**

`backend/users/views.py` — add `from users import ladder` to the imports and, after `get_users`:

```python
@api_view(["GET"])
@permission_classes([AllowAny])
def get_ladder(request):
    """The ladder: rank distribution, percentile thresholds, the daily rules, and (signed in) where you stand."""
    try:
        dist = ladder.distribution()
        you = ladder.you_block(request.user, dist) if request.user.is_authenticated else None
        return Response({**dist, "rules": ladder.rules(), "you": you}, status=200)
    except Exception:
        logger.exception("could not build the ladder")
        return JsonResponse({"error": "Could not load the ladder."}, status=400)
```

`backend/users/urls.py`: import `get_ladder` and add `path('ranks/ladder/', get_ladder, name='ranks-ladder'),` after `get-users/`.

- [ ] **Step 5: Run the tests**

Run: `... manage.py test users.test_ladder users.test_leaderboard --noinput` → pass. Then `... manage.py test users --noinput` → pass.

- [ ] **Step 6: Commit**

```bash
git add backend/users/ladder.py backend/users/test_ladder.py backend/users/views.py backend/users/urls.py
git commit -m "ladder endpoint: rank distribution, percentile thresholds, you block"
```

---

### Task 2: Frontend data + copy helpers

**Files:**
- Create: `src/utils/ladder.ts`, `scripts/test-ladder.mjs`, `src/hooks/useLadder.ts`
- Modify: `src/utils/ranks.ts` (taglines + percentile share text), `package.json` (script)

**Interfaces:**
- Produces: types `LadderRow`, `LadderYou`, `LadderData`; `percentileHeadline(you, total)`, `aheadCopy(you)`, `sameRankCopy(you)`, `toTopCopy(pct, threshold, toTop)`, `nextRankCopy(you)`, `gateCopy(row)`, `softCapCopy(rules)`, `streakCopy(rules)`; `RANK_TAGLINES`, `percentileShareText(percentile, rank)`; `useLadder(): { loading, error, data, refresh }`.

- [ ] **Step 1: Write the failing test** — `scripts/test-ladder.mjs`:

```js
// Node test for src/utils/ladder.ts (the ladder's copy helpers), no dependencies:
//   npm run test:ladder      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  percentileHeadline, aheadCopy, sameRankCopy, toTopCopy, nextRankCopy, gateCopy, softCapCopy, streakCopy,
} from "../src/utils/ladder.ts";
import { RANK_TAGLINES, RANK_ORDER, percentileShareText } from "../src/utils/ranks.ts";

const you = { rank: "Starter", division: null, position: 287, percentile: 23.1, ahead_of_pct: 76.9, same_rank_pct: 18, next_rank: "All-Star", points_to_next: 1240, days_to_next: 2, to_top: { "1": 39800, "10": 3000, "25": 0 } };
const rules = { first_game_bonus: 100, daily_full: 1500, daily_half: 1500, daily_tail_rate: 0.1, streak_milestones: { "7": 200, "30": 1000, "100": 5000 }, max_freezes: 1, guest_carryover_max: 1000 };

test("headline: top x % with one decimal, early adopter under 20 players", () => {
  assert.equal(percentileHeadline(you, 1240), "Top 23.1%");
  assert.equal(percentileHeadline({ ...you, percentile: 0.04 }, 1240), "Top 0.1%");
  assert.equal(percentileHeadline(you, 19), "Early adopter");
});

test("ahead / same-rank copy use whole numbers", () => {
  assert.equal(aheadCopy(you), "You're ahead of 77% of players");
  assert.equal(sameRankCopy(you), "18% share your rank");
});

test("to-top copy", () => {
  assert.equal(toTopCopy(10, 5200, 3000), "Top 10% · 5,200 pts (+3,000 for you)");
  assert.equal(toTopCopy(25, 1800, 0), "Top 25% · 1,800 pts (you're in)");
  assert.equal(toTopCopy(10, 5200, null), "Top 10% · 5,200 pts");
});

test("next-rank copy", () => {
  assert.equal(nextRankCopy(you), "1,240 pts to All-Star · 2 more active days");
  assert.equal(nextRankCopy({ ...you, days_to_next: 1 }), "1,240 pts to All-Star · 1 more active day");
  assert.equal(nextRankCopy({ ...you, points_to_next: 0 }), "2 more active days to All-Star");
  assert.equal(nextRankCopy({ ...you, next_rank: null }), "Top of the ladder");
});

test("gate and rules copy", () => {
  assert.equal(gateCopy({ name: "Starter", points: 1500, days: 3 }), "1,500 pts · 3 days");
  assert.equal(gateCopy({ name: "Rookie", points: 0, days: 0 }), "Start here");
  assert.equal(gateCopy({ name: "Role Player", points: 100, days: 0 }), "100 pts");
  assert.equal(softCapCopy(rules), "First 1,500 pts a day count in full, the next 1,500 at half, the rest at 10%");
  assert.equal(streakCopy(rules), "One game a day keeps your streak · 1 freeze · +200 / +1,000 / +5,000 at day 7 / 30 / 100");
});

test("every rank has a tagline and the share line names the percentile", () => {
  for (const r of RANK_ORDER) assert.ok(RANK_TAGLINES[r]?.length > 0, r);
  const t = percentileShareText(23.1, "Starter");
  assert.match(t, /top 23\.1%/);
  assert.match(t, /Starter/);
  assert.match(t, /swishquest\.com/);
});
```

Add `"test:ladder": "node --experimental-strip-types scripts/test-ladder.mjs",` to `package.json` scripts. Run → module not found.

- [ ] **Step 2: Helpers** — create `src/utils/ladder.ts`:

```ts
// Copy helpers for the ladder modal (pure, no imports: scripts/test-ladder.mjs loads this under node).
// Numbers come from GET /api/ranks/ladder/ (users/ladder.py); nothing here recomputes ranks or thresholds.

export interface LadderRow { name: string; points: number; days: number; players: number; share_pct: number }
export interface LadderRules {
  first_game_bonus: number; daily_full: number; daily_half: number; daily_tail_rate: number;
  streak_milestones: Record<string, number>; max_freezes: number; guest_carryover_max: number;
}
export interface LadderYou {
  rank: string; division: number | null; position: number; percentile: number; ahead_of_pct: number;
  same_rank_pct: number; next_rank: string | null; points_to_next: number; days_to_next: number;
  to_top: Record<string, number>;
}
export interface LadderData {
  total_players: number; ladder: LadderRow[]; percentiles: Record<string, number>; rules: LadderRules; you: LadderYou | null;
}

/** Below this many public players a percentile is noise: the headline says "Early adopter" instead. */
export const EARLY_ADOPTER_BELOW = 20;

const n = (v: number) => v.toLocaleString("en-US");
const pct1 = (v: number) => `${Math.min(99.9, Math.max(0.1, v)).toFixed(1)}%`;
const pct0 = (v: number) => `${Math.round(v)}%`;

export function percentileHeadline(you: LadderYou, totalPlayers: number): string {
  return totalPlayers < EARLY_ADOPTER_BELOW ? "Early adopter" : `Top ${pct1(you.percentile)}`;
}
export function aheadCopy(you: LadderYou): string {
  return `You're ahead of ${pct0(you.ahead_of_pct)} of players`;
}
export function sameRankCopy(you: LadderYou): string {
  return `${pct0(you.same_rank_pct)} share your rank`;
}
/** `toTop` null = guest (no "for you" part). */
export function toTopCopy(pct: number, threshold: number, toTop: number | null): string {
  const base = `Top ${pct}% · ${n(threshold)} pts`;
  if (toTop === null) return base;
  return toTop > 0 ? `${base} (+${n(toTop)} for you)` : `${base} (you're in)`;
}
export function nextRankCopy(you: LadderYou): string {
  if (!you.next_rank) return "Top of the ladder";
  const days = you.days_to_next > 0 ? `${you.days_to_next} more active ${you.days_to_next === 1 ? "day" : "days"}` : "";
  if (you.points_to_next === 0) return `${days} to ${you.next_rank}`;
  return `${n(you.points_to_next)} pts to ${you.next_rank}${days ? ` · ${days}` : ""}`;
}
export function gateCopy(row: Pick<LadderRow, "name" | "points" | "days">): string {
  if (row.points === 0) return "Start here";
  return row.days > 0 ? `${n(row.points)} pts · ${row.days} days` : `${n(row.points)} pts`;
}
export function softCapCopy(r: LadderRules): string {
  return `First ${n(r.daily_full)} pts a day count in full, the next ${n(r.daily_half)} at half, the rest at ${Math.round(r.daily_tail_rate * 100)}%`;
}
export function streakCopy(r: LadderRules): string {
  const days = Object.keys(r.streak_milestones).map(Number).sort((a, b) => a - b);
  const bonuses = days.map((d) => `+${n(r.streak_milestones[String(d)])}`).join(" / ");
  return `One game a day keeps your streak · ${r.max_freezes} freeze · ${bonuses} at day ${days.join(" / ")}`;
}
```

`src/utils/ranks.ts` — add:

```ts
/** One line per rank for the ladder rows (marketing copy; keep each under 40 characters). */
export const RANK_TAGLINES: Record<string, string> = {
  "Rookie": "Everyone starts here",
  "Role Player": "First points on the board",
  "Sixth Man": "Off the bench, into the rotation",
  "Starter": "Three days in — you're in the lineup",
  "All-Star": "Top of the regulars",
  "All-NBA": "Elite company",
  "MVP": "Best in the building",
  "Hall of Famer": "Legend status",
  "GOAT": "The 180-day club",
};

/** The ladder's share line. */
export function percentileShareText(percentile: number, rank: string): string {
  const top = `${Math.min(99.9, Math.max(0.1, percentile)).toFixed(1)}%`;
  return `I'm in the top ${top} of Swish Quest players 🏀 ${rank} and climbing. Think you know the NBA better? Play free at swishquest.com`;
}
```

Run `node --experimental-strip-types scripts/test-ladder.mjs` → pass. (Also keep `scripts/test-ranks.mjs` passing.)

- [ ] **Step 3: Hook** — create `src/hooks/useLadder.ts` (same shape as `useLeaderboard`'s module cache, one scope):

```ts
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import type { LadderData } from "../utils/ladder";

/** The ladder changes slowly (the backend caches it for 10 min); match that here. */
export const LADDER_TTL_MS = 10 * 60 * 1000;

interface CacheEntry { data: LadderData | null; error: boolean; userKey: string | null; fetchedAt: number }

// One module-level cache shared by every consumer (the modal can open from three places).
let cache: CacheEntry | null = null;
let fetching = false;
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((fn) => fn());

async function fetchLadder(userKey: string | null): Promise<void> {
  if (fetching) return;
  fetching = true;
  notify();
  try {
    const res = await apiFetch(`${BACKEND_URL}/ranks/ladder/`);
    const body = await res.json();
    cache = body?.error || !Array.isArray(body?.ladder)
      ? { data: null, error: true, userKey, fetchedAt: Date.now() }
      : { data: body as LadderData, error: false, userKey, fetchedAt: Date.now() };
  } catch (err) {
    console.error("Failed to load the ladder:", err);
    cache = { data: null, error: true, userKey, fetchedAt: Date.now() };
  } finally {
    fetching = false;
    notify();
  }
}

/** Loads GET /ranks/ladder/ once per 10 minutes (or when the signed-in user changes) and shares it. */
export function useLadder(): { loading: boolean; error: boolean; data: LadderData | null; refresh: () => void } {
  const { user } = useSelector((state: RootState) => state.user);
  const userKey = user?.id ?? null;
  const [, force] = useState(0);

  useEffect(() => {
    const cb = () => force((n) => n + 1);
    subscribers.add(cb);
    return () => { subscribers.delete(cb); };
  }, []);

  useEffect(() => {
    const stale = !cache || cache.userKey !== userKey || Date.now() - cache.fetchedAt >= LADDER_TTL_MS;
    if (stale) fetchLadder(userKey);
  }, [userKey]);

  const refresh = useCallback(() => { fetchLadder(userKey); }, [userKey]);
  return { loading: !cache || (fetching && !cache.data), error: cache?.error ?? false, data: cache?.data ?? null, refresh };
}
```

Check `src/configurations/backend` exports `BACKEND_URL` with the `/api` prefix (useLeaderboard calls `${BACKEND_URL}/get-users/`, so `${BACKEND_URL}/ranks/ladder/` is right).

- [ ] **Step 4: Verify and commit**

Run: `npx next typegen && npx tsc --noEmit`, `node --experimental-strip-types scripts/test-ladder.mjs && node --experimental-strip-types scripts/test-ranks.mjs` → pass.

```bash
git add src/utils/ladder.ts src/utils/ranks.ts src/hooks/useLadder.ts scripts/test-ladder.mjs package.json
git commit -m "ladder copy helpers, taglines, useLadder hook"
```

---

### Task 3: The Ladder modal and its entry points

**Files:**
- Create: `src/components/modals/LadderModal.tsx`, `src/styles/Ladder.css`
- Modify: `src/context/ModalContext.tsx` (kind), `src/components/ModalHost.tsx` (render), `src/components/UserProfile.tsx` (rank stat → button), `src/components/Leaderboard.tsx` (head link), `src/components/modals/RankUpModal.tsx` (text link), `src/components/GuestPanel.tsx` (text link)

**Interfaces:**
- Consumes: `useLadder`, the Task 2 helpers, `RANK_COLORS / RANK_TAGLINES / rankLabel / percentileShareText`, `visibleGames` (`src/utils/GameUtils.tsx`), `useModal().open("login")`, `Button / Chip / CourtLoader` from `src/components/ui`, `SwapText`, `staggerContainer / staggerItem`.
- Produces: `ModalKind` gains `"ladder"` (no payload).

REQUIRED SUB-SKILL before Step 2: load `dataviz` (the rows are a horizontal bar chart: one series, label + value, accessible via `role="img"` + `aria-label`).

- [ ] **Step 1: Modal plumbing** — `ModalContext.tsx`: add `"ladder"` to `ModalKind`. `ModalHost.tsx`: import `LadderModal`; add the branch

```tsx
  } else if (kind === "ladder") {
    title = "The ladder";
    wide = true;
    content = <LadderModal onClose={close} />;
  }
```

- [ ] **Step 2: The modal** — `src/components/modals/LadderModal.tsx`:

```tsx
import { useRef, useState, type CSSProperties } from "react";
import copy from "copy-to-clipboard";
import { motion } from "framer-motion";
import "../../styles/Ladder.css";
import { useLadder } from "../../hooks/useLadder";
import { useModal } from "../../context/ModalContext";
import { Button, Chip, CourtLoader } from "../ui";
import SwapText from "../motion/SwapText";
import { staggerContainer, staggerItem } from "../../motion/variants";
import { visibleGames } from "../../utils/GameUtils";
import { RANK_COLORS, RANK_TAGLINES, rankLabel, percentileShareText } from "../../utils/ranks";
import {
  aheadCopy, gateCopy, nextRankCopy, percentileHeadline, sameRankCopy, softCapCopy, streakCopy, toTopCopy,
  type LadderData,
} from "../../utils/ladder";

interface LadderModalProps { onClose: () => void }

/** Rank distribution, percentile thresholds and the daily rules — the one screen that explains the climb. */
export default function LadderModal({ onClose }: LadderModalProps) {
  const { loading, error, data, refresh } = useLadder();
  const { open } = useModal();

  if (loading) return <div className="ld-center"><CourtLoader label="Reading the standings…" scale={0.7} /></div>;
  if (error || !data) {
    return (
      <div className="ld-center ld-error">
        <p>Couldn't load the ladder.</p>
        <Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>
      </div>
    );
  }
  return <Ladder data={data} onClose={onClose} onSignUp={() => open("login")} />;
}

function Ladder({ data, onClose, onSignUp }: { data: LadderData; onClose: () => void; onSignUp: () => void }) {
  const { you, ladder, percentiles, rules, total_players } = data;
  const [shared, setShared] = useState(false);
  const timer = useRef<number | null>(null);
  const share = async () => {
    if (!you) return;
    const text = percentileShareText(you.percentile, you.rank);
    try {
      if (typeof navigator !== "undefined" && navigator.share) { await navigator.share({ text }); return; }
    } catch { /* sheet dismissed: fall through */ }
    copy(text);
    setShared(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShared(false), 1600);
  };
  const myIndex = you ? ladder.findIndex((r) => r.name === you.rank) : -1;
  const games = visibleGames.filter((g) => g.maxPoints > 0);

  return (
    <div className="ld">
      {/* You / guest hero */}
      <section className="ld-hero" style={{ "--rank-color": you ? RANK_COLORS[you.rank] : "var(--brand)" } as CSSProperties}>
        <span className="ld-badge" aria-hidden="true">★</span>
        {you ? (
          <div className="ld-hero-text">
            <span className="ld-eyebrow">{rankLabel(you.rank, you.division)} · #{you.position.toLocaleString()} of {total_players.toLocaleString()}</span>
            <h3 className="font-display ld-headline">{percentileHeadline(you, total_players)}</h3>
            <p className="ld-sub">{aheadCopy(you)} · {sameRankCopy(you)}</p>
            <p className="ld-next tnum"><SwapText>{nextRankCopy(you)}</SwapText></p>
          </div>
        ) : (
          <div className="ld-hero-text">
            <span className="ld-eyebrow">Playing as guest</span>
            <h3 className="font-display ld-headline">Claim your rank</h3>
            <p className="ld-sub">Sign up to see where you stand against {total_players.toLocaleString()} players.</p>
          </div>
        )}
        <div className="ld-hero-actions">
          {you ? (
            <Button size="sm" onClick={share}><SwapText>{shared ? "Copied!" : "Share"}</SwapText></Button>
          ) : (
            <Button size="sm" onClick={onSignUp}>Sign up</Button>
          )}
        </div>
      </section>

      <div className="ld-cols">
        {/* The ladder */}
        <section aria-label="Rank ladder">
          <h4 className="ld-h">The ladder</h4>
          <motion.ol className="ld-rows" variants={staggerContainer} initial="hidden" animate="visible" role="img" aria-label="Share of players at each rank">
            {ladder.map((row, i) => {
              const state = myIndex < 0 ? "" : i < myIndex ? " is-passed" : i === myIndex ? " is-you" : i === myIndex + 1 ? " is-next" : "";
              return (
                <motion.li key={row.name} variants={staggerItem} className={`ld-row${state}`}>
                  <span className="ld-dot" style={{ background: RANK_COLORS[row.name] }} aria-hidden="true" />
                  <span className="ld-row-main">
                    <span className="ld-row-name">
                      {row.name}
                      {i === myIndex && <Chip variant="brand">you</Chip>}
                      {i === myIndex + 1 && <Chip>next</Chip>}
                    </span>
                    <span className="ld-row-tag">{RANK_TAGLINES[row.name]}</span>
                    <span className="ld-bar" aria-hidden="true"><span className="ld-bar-fill" style={{ width: `${Math.max(row.share_pct, row.players > 0 ? 1.5 : 0)}%`, background: RANK_COLORS[row.name] }} /></span>
                  </span>
                  <span className="ld-row-side tnum">
                    <span className="ld-row-gate">{gateCopy(row)}</span>
                    <span className="ld-row-pct">{row.share_pct.toFixed(row.share_pct < 10 && row.share_pct > 0 ? 1 : 0)}%</span>
                  </span>
                </motion.li>
              );
            })}
          </motion.ol>
          <h4 className="ld-h">Top percentiles</h4>
          <div className="ld-chips">
            {Object.entries(percentiles).map(([p, pts]) => (
              <Chip key={p} className="tnum">{toTopCopy(Number(p), pts, you ? you.to_top[p] ?? null : null)}</Chip>
            ))}
          </div>
        </section>

        {/* How points work */}
        <section aria-label="How points work">
          <h4 className="ld-h">How points work</h4>
          <ul className="ld-games">
            {games.map((g) => (
              <li key={g.id}><span>{g.name}</span><span className="tnum">up to {g.maxPoints} pts</span></li>
            ))}
          </ul>
          <ul className="ld-rules">
            <li><strong className="tnum">+{rules.first_game_bonus}</strong> for your first scoring game of the day</li>
            <li>{softCapCopy(rules)}</li>
            <li>{streakCopy(rules)}</li>
            <li>Ranks need points <em>and</em> active days — they never drop</li>
            {!you && <li>Sign up and keep up to <span className="tnum">{rules.guest_carryover_max.toLocaleString()}</span> guest points</li>}
          </ul>
        </section>
      </div>

      <div className="ld-foot">
        <Button block variant="secondary" onClick={onClose}>Back to the game</Button>
      </div>
    </div>
  );
}
```

`src/styles/Ladder.css` (tokens as the rest of the app; two columns from 640 px; bars never overflow):

```css
.ld { display: flex; flex-direction: column; gap: 18px; }
.ld-center { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 2rem 0; color: var(--muted); }
.ld-hero { display: grid; grid-template-columns: 56px 1fr; grid-template-areas: "badge text" "actions actions"; gap: 12px 14px; align-items: center; padding: 14px; border-radius: 14px; background: var(--surface2); }
.ld-badge { grid-area: badge; width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 26px; color: #101010; background: var(--rank-color); }
.ld-hero-text { grid-area: text; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ld-eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
.ld-headline { font-size: 26px; line-height: 1.1; }
.ld-sub, .ld-next { font-size: 13px; color: var(--muted); line-height: 1.45; }
.ld-hero-actions { grid-area: actions; }
.ld-cols { display: grid; grid-template-columns: 1fr; gap: 18px; }
.ld-h { font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.ld-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ld-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 10px; align-items: center; min-width: 0; }
.ld-row.is-passed { opacity: 0.6; }
.ld-row.is-you .ld-row-name { color: var(--brand); }
.ld-dot { width: 10px; height: 10px; border-radius: 50%; }
.ld-row-main { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.ld-row-name { font-weight: 700; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
.ld-row-tag { font-size: 11.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ld-bar { display: block; height: 6px; border-radius: 3px; background: var(--surface3); overflow: hidden; }
.ld-bar-fill { display: block; height: 100%; border-radius: 3px; transition: width 600ms cubic-bezier(0.22, 1, 0.36, 1); }
.ld-row-side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 12px; color: var(--muted); white-space: nowrap; }
.ld-row-pct { font-weight: 700; color: var(--text); }
.ld-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.ld-games { list-style: none; margin: 0 0 12px; padding: 0; display: grid; grid-template-columns: 1fr; gap: 4px 16px; font-size: 13px; }
.ld-games li { display: flex; justify-content: space-between; gap: 10px; color: var(--text); }
.ld-games li span:last-child { color: var(--brand); font-weight: 700; }
.ld-rules { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--muted); line-height: 1.45; }
.ld-rules strong { color: var(--good); }
.ld-foot { margin-top: 4px; }
@media (min-width: 560px) { .ld-games { grid-template-columns: 1fr 1fr; } }
@media (min-width: 640px) {
  .ld-hero { grid-template-columns: 64px 1fr auto; grid-template-areas: "badge text actions"; }
  .ld-badge { width: 64px; height: 64px; font-size: 30px; }
  .ld-cols { grid-template-columns: 1.2fr 1fr; gap: 24px; }
}
@media (prefers-reduced-motion: reduce) { .ld-bar-fill { transition: none; } }
```

Check the real token names in `src/styles/ui.css` (`--surface2`, `--surface3`, `--muted`, `--text`, `--brand`, `--good`) and adjust if a name differs.

- [ ] **Step 3: Entry points**

- `UserProfile.tsx`: the rank stat value becomes `<button type="button" className="font-display pc-stat-num pc-stat-btn" onClick={() => open("ladder")} aria-label="See the rank ladder">{rankLabel(...)} <span aria-hidden="true">›</span></button>` (import `useModal`; add `.pc-stat-btn { background: none; border: 0; padding: 0; color: inherit; font: inherit; cursor: pointer; }` and a hover colour `var(--brand)` to `src/styles/LandPage.css` next to `.pc-stat-num`).
- `Leaderboard.tsx` head: before the existing "View all →" button add `<button className="lb-viewall" onClick={() => open("ladder")}>Ranks</button>` (wrap both in a `<div style={{ display: "flex", gap: 10 }}>`).
- `RankUpModal.tsx`: add a prop `onLadder?: () => void` and under the button row `{onLadder && <button type="button" className="ld-link" onClick={onLadder}>See where you stand →</button>}`; in `ModalHost` pass `onLadder={() => open("ladder")}` (switching kinds replaces the modal). Style `.ld-link` in `Ladder.css`: `background: none; border: 0; color: var(--brand); font-size: 13px; cursor: pointer; margin-top: 8px;`.
- `GuestPanel.tsx`: under the perks, `<button type="button" className="ld-link" onClick={() => open("ladder")}>See the rank ladder →</button>` (the component already has `open`).

- [ ] **Step 4: Verify**

`npx next typegen && npx tsc --noEmit`, `npm run lint`, `npm run build` → clean. Browser pass (`npm run dev` + the local Django API with the v2 migrations applied, as in the v2 plan): as a guest open the ladder from GuestPanel (sign-up CTA, no "NaN"); sign in, open it from the profile card ("Top x %" or "Early adopter" with < 20 local players, the "you" chip on the right row, bars sized by share, "next" chip), from the leaderboard "Ranks" link, and from the rank-up modal link (modal swaps, no double overlay); Share copies the percentile line; resize to 375 px: one column, bars and chips inside the sheet, no horizontal scroll. Screenshots into the SDD workspace.

- [ ] **Step 5: Commit**

```bash
git add src/components/modals/LadderModal.tsx src/styles/Ladder.css src/context/ModalContext.tsx src/components/ModalHost.tsx src/components/UserProfile.tsx src/components/Leaderboard.tsx src/components/modals/RankUpModal.tsx src/components/GuestPanel.tsx src/styles/LandPage.css
git commit -m "ladder modal: distribution bars, percentiles, how points work, share; entry points"
```

---

### Task 4: Docs, marketing brief, ui-check note

**Files:**
- Modify: `docs/ARCHITECTURE.md` (endpoint list, next to `get-users`), `docs/team/CODE_MAP.md` (entries for `users/ladder.py`, `src/utils/ladder.ts`, `src/hooks/useLadder.ts`, `src/components/modals/LadderModal.tsx`), `docs/CACHING_SCALING_PLAN.md` (one row: the ladder is cached 10 min in the Django cache; five OFFSET queries), `../swish-quest-marketing-project-instructions.md` (outside git: one bullet under "Accounts, friends, points, ranks" — "The ladder modal shows rank distribution, your percentile and a share line; use 'top x %' in copy")
- Modify: `scripts/ui-check/CHECKS.md` — add a one-row note under the account suite that the ladder modal exists (a full check is a follow-up; list it under coverage gaps).

- [ ] **Step 1:** make the edits; `npm run lint` (check:ids) → pass.
- [ ] **Step 2:** `git add docs scripts/ui-check/CHECKS.md && git commit -m "docs: the ladder"`.

---

### Task 5: Whole-branch verification and PR to dev

- [ ] From `backend/`: `manage.py test users --noinput` + `trivia.tests.test_awarding`; from the root: `npm run lint && npx next typegen && npx tsc --noEmit && npm run build && node --experimental-strip-types scripts/test-ladder.mjs && node --experimental-strip-types scripts/test-ranks.mjs`.
- [ ] `git fetch origin dev && git rebase origin/dev`, re-run tsc; `git push -u origin feat/rank-ladder`; `gh pr create --base dev` (title "The ladder: rank distribution, percentiles and how points work"; body from the spec's Goals + §1/§2 summaries); `gh pr checks --watch`; `gh pr merge --merge --delete-branch`. Stop at `dev`.
