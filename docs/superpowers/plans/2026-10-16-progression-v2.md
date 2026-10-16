# Progression v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebalance per-game points, replace the points-only rank ladder with a points + active-days ladder with divisions, add the first-game bonus, daily soft cap, streaks, a weekly leaderboard, rank badges, a rank-up share moment and guest-points carry-over.

**Architecture:** All point/rank/streak writes move into one backend module (`trivia/awarding.py` + `users/ranks.py`); `log_session` and `multiplayer_result` only clamp and call it. The response of an award is a "receipt" (`awarded`, `rank`, `rank_up`, `progress`, `streak`) that the browser applies to the Redux user with one reducer (`applyAward`), whether it came over HTTP (solo) or the relay socket (online). Scoring formulas on the frontend move into a pure `src/utils/gameScoring.ts` so they can be unit-tested with the existing `node --test` scripts.

**Tech Stack:** Django 5.1 + DRF (backend, `manage.py test`), Next.js 16 / React 19 / Redux Toolkit (frontend, `node --experimental-strip-types` test scripts), Node Socket.IO relay (`multiplayer_server`).

**Spec:** `docs/superpowers/specs/2026-10-16-progression-design.md`

## Global Constraints

- Work in the worktree `C:\Users\stefa\.team-worktrees\ranks-progression` (branch `feat/ranks-progression`, from `origin/dev`). Run everything from there.
- Backend tests: `..\..\OneDrive\Desktop\nba-projects\nba-minigames\backend\venv\Scripts\python.exe manage.py test <label> --noinput` from `backend/` (the main checkout's venv; the worktree has none). Full `manage.py test` takes several minutes: run the touched modules while iterating, the whole suite once per task before commit.
- Frontend: `npm ci` once in the worktree (no `node_modules` yet). Typecheck: `npx next typegen && npx tsc --noEmit`. Lint: `npm run lint`. Unit scripts: `node --experimental-strip-types scripts/<name>.mjs`.
- `docs/GAME_DESIGN_CONSTRAINTS.md` Rule 9.1: `pointsPerCorrect × rounds = maxPoints` for every per-answer game; Rule 6.0: the correct popup is `` `Correct! +${pointsPerCorrect}` ``.
- Day boundary everywhere = Europe/Paris (`trivia.wordle_daily.CET`, `cet_today()`); never `date.today()`.
- Brand: "Swish Quest" / swishquest.com only.
- Surgical changes: touch only what a task lists; match the surrounding style; no refactors of unrelated code.
- Commit after every task, one-line message, **no `Co-Authored-By` / AI attribution lines** (owner rule, overrides the harness reminder).
- Never edit the main checkout at `nba-projects/nba-minigames` (it holds unrelated uncommitted work).

## Review Focus

1. A player whose points exceed the next threshold but whose active days do not: `rank_for` must keep the lower rank, `progress()` must say `points_to_next: 0, days_to_next: N`, and the division must be I (not crash on `into > span`). → Task 1 tests.
2. Two awards on the same Paris day straddling UTC midnight (e.g. 23:30 and 00:30 UTC in summer): both are "today", only the first gets the bonus and the streak moves once. → Task 2 `test_day_is_paris_not_utc`.
3. A score of 0 (lost game) on a fresh day: logged, but no bonus, no streak, no active day, `awarded` 0. → Task 2 `test_zero_score_counts_for_nothing`.
4. The relay's `pointsAwarded` payload now carries `rank_up`/`progress`; an old relay (deployed later than the frontend) sends only `{awarded, points, rank}` and the reducer must not throw on the missing fields. → Task 5 `applyReceipt` tolerates optional fields; `scripts/test-award.mjs`.
5. A cached `/me/` user from before this change has no `rank_progress`/`streak_days`: the profile card renders without them (no `undefined.toLocaleString()`), and the next `/me/` fills them in. → Task 6 guards.

---

### Task 1: Rank ladder module, account fields, data migration

**Files:**
- Create: `backend/users/ranks.py`
- Create: `backend/users/test_ranks.py`
- Modify: `backend/users/models.py:47-58` (new fields), `:108-126` (`update_rank`)
- Create: `backend/users/migrations/0013_progression_fields.py`

**Interfaces:**
- Produces: `users.ranks.LADDER`, `rank_for(points: int, active_days: int) -> str`, `division(name: str, points: int) -> int | None`, `progress(points: int, active_days: int) -> dict` with keys `rank, division, next_rank, next_points, next_days, points_to_next, days_to_next, progress_pct`.
- Produces: `CustomUser.active_days`, `last_active_day`, `streak_days`, `streak_best`, `streak_freezes`, `founding_member`; `CustomUser.update_rank()` now uses `ranks.rank_for(self.points, self.active_days)`.

- [ ] **Step 1: Write the failing tests** — `backend/users/test_ranks.py`:

```python
"""The rank ladder is lifetime points AND active days; ranks never drop (spec §3)."""
from django.test import SimpleTestCase

from users import ranks


class RankForTests(SimpleTestCase):
    def test_bottom_and_early_ranks_need_only_points(self):
        self.assertEqual(ranks.rank_for(0, 0), "Rookie")
        self.assertEqual(ranks.rank_for(99, 0), "Rookie")
        self.assertEqual(ranks.rank_for(100, 0), "Role Player")
        self.assertEqual(ranks.rank_for(500, 0), "Sixth Man")

    def test_days_gate_holds_the_rank_down(self):
        # Enough points for All-NBA, only 10 active days -> All-Star (7-day gate met, 20-day gate not).
        self.assertEqual(ranks.rank_for(20_000, 10), "All-Star")
        self.assertEqual(ranks.rank_for(20_000, 20), "All-NBA")
        # A weekend grinder with GOAT points stays Starter on day 3.
        self.assertEqual(ranks.rank_for(150_000, 3), "Starter")

    def test_goat_needs_both(self):
        self.assertEqual(ranks.rank_for(150_000, 180), "GOAT")
        self.assertEqual(ranks.rank_for(149_999, 400), "Hall of Famer")
        self.assertEqual(ranks.rank_for(150_000, 179), "Hall of Famer")

    def test_ladder_is_monotonic(self):
        pts = [r.points for r in ranks.LADDER]
        days = [r.days for r in ranks.LADDER]
        self.assertEqual(pts, sorted(pts))
        self.assertEqual(days, sorted(days))
        self.assertEqual(ranks.RANK_NAMES[0], "Rookie")
        self.assertEqual(ranks.RANK_NAMES[-1], "GOAT")


class DivisionTests(SimpleTestCase):
    def test_no_divisions_below_all_star_or_at_goat(self):
        self.assertIsNone(ranks.division("Starter", 3_000))
        self.assertIsNone(ranks.division("GOAT", 200_000))

    def test_thirds_of_the_span(self):
        # All-Star spans 5,000 -> 15,000: thirds at 8,333 and 11,667.
        self.assertEqual(ranks.division("All-Star", 5_000), 3)
        self.assertEqual(ranks.division("All-Star", 8_000), 3)
        self.assertEqual(ranks.division("All-Star", 9_000), 2)
        self.assertEqual(ranks.division("All-Star", 12_000), 1)

    def test_points_past_the_next_threshold_are_division_one(self):
        # Gated by days: points already beyond All-NBA's 15,000.
        self.assertEqual(ranks.division("All-Star", 20_000), 1)


class ProgressTests(SimpleTestCase):
    def test_points_to_next(self):
        p = ranks.progress(300, 1)
        self.assertEqual(p["rank"], "Role Player")
        self.assertEqual(p["next_rank"], "Sixth Man")
        self.assertEqual(p["points_to_next"], 200)
        self.assertEqual(p["days_to_next"], 0)
        self.assertEqual(p["progress_pct"], 50)
        self.assertIsNone(p["division"])

    def test_gated_by_days_only(self):
        p = ranks.progress(20_000, 10)
        self.assertEqual(p["rank"], "All-Star")
        self.assertEqual(p["next_rank"], "All-NBA")
        self.assertEqual(p["points_to_next"], 0)
        self.assertEqual(p["days_to_next"], 10)
        self.assertEqual(p["progress_pct"], 100)
        self.assertEqual(p["division"], 1)

    def test_goat_has_no_next(self):
        p = ranks.progress(200_000, 365)
        self.assertEqual(p["rank"], "GOAT")
        self.assertIsNone(p["next_rank"])
        self.assertEqual(p["progress_pct"], 100)
        self.assertEqual(p["points_to_next"], 0)
```

- [ ] **Step 2: Run them to see them fail**

Run (from `backend/`): `..\..\..\OneDrive\Desktop\nba-projects\nba-minigames\backend\venv\Scripts\python.exe manage.py test users.test_ranks --noinput`
Expected: ImportError / ModuleNotFoundError on `users.ranks`.

- [ ] **Step 3: Create `backend/users/ranks.py`**

```python
"""The rank ladder: lifetime points AND active days, both required.

Points alone used to decide the rank (GOAT at 5,000 pts was 1-2 hours of play). The day gates make the
top ranks a record of sticking around, not of one long weekend: GOAT is 150,000 points and 180 active
days (a Paris day with at least one scoring game, trivia.awarding). Ranks never drop. The frontend holds
no thresholds; it displays `progress()` as the backend sends it (users.views.user_payload).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Rank:
    name: str
    points: int
    days: int


LADDER = (
    Rank("Rookie", 0, 0),
    Rank("Role Player", 100, 0),
    Rank("Sixth Man", 500, 0),
    Rank("Starter", 1_500, 3),
    Rank("All-Star", 5_000, 7),
    Rank("All-NBA", 15_000, 20),
    Rank("MVP", 40_000, 45),
    Rank("Hall of Famer", 80_000, 90),
    Rank("GOAT", 150_000, 180),
)
RANK_NAMES = [r.name for r in LADDER]
# Divisions (III -> II -> I) split the long climbs from All-Star up into thirds of the point span, so a
# promotion still lands every few weeks. GOAT (the top) has none.
DIVISIONS_FROM = RANK_NAMES.index("All-Star")


def rank_for(points, active_days):
    """The highest rank whose points AND days are both met."""
    current = LADDER[0]
    for r in LADDER:
        if points >= r.points and active_days >= r.days:
            current = r
    return current.name


def _index(name):
    return RANK_NAMES.index(name) if name in RANK_NAMES else 0


def division(name, points):
    """3, 2 or 1 for ranks that have divisions, else None. Points past the next threshold (held back by
    the day gate) are division 1."""
    i = _index(name)
    if i < DIVISIONS_FROM or i == len(LADDER) - 1:
        return None
    span = LADDER[i + 1].points - LADDER[i].points
    into = max(0, points - LADDER[i].points)
    if into < span / 3:
        return 3
    if into < 2 * span / 3:
        return 2
    return 1


def progress(points, active_days):
    """What the profile card shows: the rank, its division, and what the next rank still needs."""
    name = rank_for(points, active_days)
    i = _index(name)
    here = LADDER[i]
    nxt = LADDER[i + 1] if i + 1 < len(LADDER) else None
    if nxt is None:
        pct = 100
    else:
        span = nxt.points - here.points
        pct = int(round(100 * min(max(points - here.points, 0), span) / span))
    return {
        "rank": name,
        "division": division(name, points),
        "next_rank": nxt.name if nxt else None,
        "next_points": nxt.points if nxt else None,
        "next_days": nxt.days if nxt else None,
        "points_to_next": max(0, nxt.points - points) if nxt else 0,
        "days_to_next": max(0, nxt.days - active_days) if nxt else 0,
        "progress_pct": pct,
    }
```

- [ ] **Step 4: Run the ranks tests**

Run: `... manage.py test users.test_ranks --noinput`
Expected: all pass. (If `test_points_to_next` disagrees on `progress_pct`, check the rounding: 300 pts in Role Player (100→500) is 200/400 = 50.)

- [ ] **Step 5: Add the account fields and rewire `update_rank`** — `backend/users/models.py`.

Add after the `rank` field (line 58):

```python
    # Progression (trivia.awarding is the only writer; users.ranks reads). `active_days` = distinct Paris
    # days with a scoring game and gates the top ranks; the streak needs one scoring game a day and a
    # held freeze covers one missed day. `founding_member`: the account predates the 2026-10 ladder.
    active_days = models.PositiveIntegerField(default=0)
    last_active_day = models.DateField(null=True, blank=True)
    streak_days = models.PositiveIntegerField(default=0)
    streak_best = models.PositiveIntegerField(default=0)
    streak_freezes = models.PositiveSmallIntegerField(default=1)
    founding_member = models.BooleanField(default=False)
```

Add `from .ranks import rank_for` under the existing `from .identity import ...` import, and replace the whole `update_rank` body (lines 108-126) with:

```python
    def update_rank(self):
        self.rank = rank_for(self.points, self.active_days)
```

- [ ] **Step 6: Write the migration** — `backend/users/migrations/0013_progression_fields.py` (hand-written: the data step needs the session history).

```python
# Progression v2 (docs/superpowers/specs/2026-10-16-progression-design.md §3): the new account fields,
# then every existing account gets its active days recounted from its GameSession history (distinct
# Europe/Paris days), its rank recalculated under the new ladder, and the Founding Member flag.
import datetime
from zoneinfo import ZoneInfo

from django.db import migrations, models

CET = ZoneInfo("Europe/Paris")

LADDER = (
    ("Rookie", 0, 0), ("Role Player", 100, 0), ("Sixth Man", 500, 0), ("Starter", 1_500, 3),
    ("All-Star", 5_000, 7), ("All-NBA", 15_000, 20), ("MVP", 40_000, 45),
    ("Hall of Famer", 80_000, 90), ("GOAT", 150_000, 180),
)


def _rank_for(points, days):
    current = LADDER[0][0]
    for name, p, d in LADDER:
        if points >= p and days >= d:
            current = name
    return current


def recount(apps, schema_editor):
    User = apps.get_model("users", "CustomUser")
    GameSession = apps.get_model("trivia", "GameSession")
    for user in User.objects.all():
        days = set()
        last = None
        for finished_at in GameSession.objects.filter(user_id=user.pk, score__gt=0).values_list("finished_at", flat=True):
            day = finished_at.astimezone(CET).date()
            days.add(day)
            last = day if last is None or day > last else last
        user.active_days = len(days)
        user.last_active_day = last
        user.founding_member = True
        user.rank = _rank_for(user.points, user.active_days)
        user.save(update_fields=["active_days", "last_active_day", "founding_member", "rank"])


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0012_customuser_consent_source"),
        ("trivia", "0008_factory_journal"),
    ]

    operations = [
        migrations.AddField(model_name="customuser", name="active_days", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="customuser", name="last_active_day", field=models.DateField(blank=True, null=True)),
        migrations.AddField(model_name="customuser", name="streak_days", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="customuser", name="streak_best", field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name="customuser", name="streak_freezes", field=models.PositiveSmallIntegerField(default=1)),
        migrations.AddField(model_name="customuser", name="founding_member", field=models.BooleanField(default=False)),
        migrations.RunPython(recount, migrations.RunPython.noop),
    ]
```

- [ ] **Step 7: Check the migration matches the models and add its test**

Run: `... manage.py makemigrations --check --dry-run`
Expected: "No changes detected". If it lists a change, the field definitions in the migration and the model differ: make them identical.

Append to `backend/users/test_ranks.py`:

```python
from django.contrib.auth import get_user_model
from django.test import TestCase


class UpdateRankTests(TestCase):
    def test_update_rank_uses_points_and_days(self):
        user = get_user_model().objects.create_user(username="u", email="u@example.com", password="x")
        user.points, user.active_days = 20_000, 10
        user.update_rank()
        self.assertEqual(user.rank, "All-Star")
        user.active_days = 20
        user.update_rank()
        self.assertEqual(user.rank, "All-NBA")

    def test_new_accounts_start_with_one_freeze_and_no_founding_flag(self):
        user = get_user_model().objects.create_user(username="u", email="u@example.com", password="x")
        self.assertEqual(user.streak_freezes, 1)
        self.assertFalse(user.founding_member)
        self.assertEqual(user.active_days, 0)
```

Run: `... manage.py test users.test_ranks --noinput` → all pass.

- [ ] **Step 8: Run the users test module and the account-data tests** (they touch `rank`/`points`)

Run: `... manage.py test users --noinput`
Expected: pass. `test_account_data.py` asserts the anonymised account is `Rookie` with 0 points — still true (`rank_for(0, n) == "Rookie"`).

- [ ] **Step 9: Commit**

```bash
git add backend/users/ranks.py backend/users/test_ranks.py backend/users/models.py backend/users/migrations/0013_progression_fields.py
git commit -m "ranks: points + active-days ladder, divisions, progression fields"
```

---

### Task 2: Awarding module — per-game caps, daily soft cap, first-game bonus, streak

**Files:**
- Create: `backend/trivia/awarding.py`
- Create: `backend/trivia/tests/test_awarding.py`
- Modify: `backend/trivia/models.py:138-158` (`GameSession.awarded`)
- Create: `backend/trivia/migrations/0009_gamesession_awarded.py`
- Modify: `backend/trivia/views.py:262-272, 309-417` (`log_session`, `_award`, `multiplayer_result`)
- Modify: `backend/trivia/tests/test_score_award.py` (expectations)

**Interfaces:**
- Consumes: `users.ranks.progress`, `CustomUser` fields from Task 1, `trivia.wordle_daily.CET/cet_today`.
- Produces: `trivia.awarding.GAME_MAX_POINTS`, `MATCH_MAX_POINTS`, `cap_for(game, mode) -> int`, `clamp_score(game, mode, raw) -> int`, `day_start_utc(day)`, `week_start_utc(day)`, `soft_capped(score, earned_today) -> int`, `award(user, game, mode, score, duration_ms) -> dict` (the receipt: `awarded, base, first_game_bonus, streak_bonus, points, rank, rank_up, progress, streak`).
- Produces: `GameSession.awarded` (int, default 0). `log_session` response = `{ok, awarded, points, rank, rank_up, progress, streak, first_game_bonus, streak_bonus}`; `multiplayer_result` rows = `{public_id, ...receipt}`.

- [ ] **Step 1: Model field + migration**

In `backend/trivia/models.py` `GameSession`, after `score = models.IntegerField(default=0)` add:

```python
    # What actually landed on the account for this play (score after the daily soft cap, plus any
    # first-game / streak bonus) — trivia.awarding writes it; the weekly board sums it. 0 for guests,
    # friend rooms and before 2026-10.
    awarded = models.IntegerField(default=0)
```

Create `backend/trivia/migrations/0009_gamesession_awarded.py`:

```python
# GameSession.awarded (docs/superpowers/specs/2026-10-16-progression-design.md §2). Past credited plays
# (an account, single or match) are backfilled with their score: before this column, score == awarded.
from django.db import migrations, models
from django.db.models import F


def backfill(apps, schema_editor):
    GameSession = apps.get_model("trivia", "GameSession")
    GameSession.objects.filter(user__isnull=False, mode__in=["single", "match"]).update(awarded=F("score"))


class Migration(migrations.Migration):

    dependencies = [("trivia", "0008_factory_journal")]

    operations = [
        migrations.AddField(model_name="gamesession", name="awarded", field=models.IntegerField(default=0)),
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
```

Run: `... manage.py makemigrations --check --dry-run` → "No changes detected".

- [ ] **Step 2: Write the failing tests** — `backend/trivia/tests/test_awarding.py`:

```python
"""Everything between a finished game's score and the points on the account (spec §2).

Day boundaries are Europe/Paris; tests pin `cet_today` so they don't depend on the wall clock.
"""
import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase

from trivia import awarding
from trivia.models import GameSession

User = get_user_model()
DAY = datetime.date(2026, 10, 16)  # a Friday


def _user(**kw):
    return User.objects.create_user(username="Baller", email="baller@example.com", password="x", **kw)


class CapTests(SimpleTestCase):
    def test_every_public_game_has_its_own_ceiling(self):
        self.assertEqual(awarding.cap_for("series-winner", "single"), 100)
        self.assertEqual(awarding.cap_for("starting-five", "single"), 150)
        self.assertEqual(awarding.cap_for("career-path", "single"), 200)
        self.assertEqual(awarding.cap_for("wordle", "single"), 500)
        self.assertEqual(awarding.cap_for("who-would-win", "single"), 100)
        self.assertEqual(awarding.cap_for("tictactoe", "match"), 200)

    def test_online_wordle_pays_less(self):
        self.assertEqual(awarding.cap_for("wordle", "match"), 200)

    def test_unknown_game_gets_the_default(self):
        self.assertEqual(awarding.cap_for("not-a-game", "single"), awarding.DEFAULT_MAX_POINTS)

    def test_clamp(self):
        self.assertEqual(awarding.clamp_score("wordle", "single", 10**9), 500)
        self.assertEqual(awarding.clamp_score("wordle", "single", -5), 0)
        self.assertEqual(awarding.clamp_score("wordle", "single", "lots"), 0)
        self.assertEqual(awarding.clamp_score("wordle", "single", "250"), 250)


class SoftCapTests(SimpleTestCase):
    def test_first_1500_count_in_full(self):
        self.assertEqual(awarding.soft_capped(500, 0), 500)
        self.assertEqual(awarding.soft_capped(500, 1_000), 500)

    def test_next_1500_count_half(self):
        self.assertEqual(awarding.soft_capped(500, 1_600), 250)
        # Straddles the boundary: 300 full + 200 half.
        self.assertEqual(awarding.soft_capped(500, 1_200), 400)

    def test_beyond_3000_counts_a_tenth(self):
        self.assertEqual(awarding.soft_capped(500, 3_000), 50)
        self.assertEqual(awarding.soft_capped(500, 10_000), 50)
        # Straddles both boundaries: 200 full + 1500 half + 300 tenth.
        self.assertEqual(awarding.soft_capped(2_000, 1_300), 200 + 750 + 30)


class DayTests(SimpleTestCase):
    def test_day_and_week_start_are_paris_midnight(self):
        start = awarding.day_start_utc(DAY)
        self.assertEqual(start.isoformat(), "2026-10-15T22:00:00+00:00")  # CEST = UTC+2
        self.assertEqual(awarding.week_start_utc(DAY).isoformat(), "2026-10-11T22:00:00+00:00")  # Monday the 12th


@patch("trivia.awarding.cet_today", return_value=DAY)
class AwardTests(TestCase):
    def setUp(self):
        self.user = _user()

    def receipt(self, score, game="series-winner", mode="single"):
        return awarding.award(User.objects.get(pk=self.user.pk), game, mode, score, 5_000)

    def test_first_scoring_game_of_the_day_gets_the_bonus(self, _):
        r = self.receipt(80)
        self.assertEqual(r["first_game_bonus"], 100)
        self.assertEqual(r["awarded"], 180)
        self.assertEqual(r["points"], 180)
        self.assertEqual(GameSession.objects.get().awarded, 180)
        r2 = self.receipt(80)
        self.assertEqual(r2["first_game_bonus"], 0)
        self.assertEqual(r2["awarded"], 80)

    def test_zero_score_counts_for_nothing(self, _):
        r = self.receipt(0)
        self.assertEqual(r["awarded"], 0)
        self.assertEqual(r["first_game_bonus"], 0)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.points, user.active_days, user.streak_days), (0, 0, 0))
        self.assertEqual(GameSession.objects.count(), 1)  # still logged
        # The bonus is still waiting for the first game that scores.
        self.assertEqual(self.receipt(50)["first_game_bonus"], 100)

    def test_daily_soft_cap_applies_to_game_points_only(self, _):
        self.receipt(500, game="wordle")          # 500 + 100 bonus
        self.receipt(500, game="wordle")          # 1,000 earned so far
        self.receipt(500, game="wordle")          # 1,500
        r = self.receipt(500, game="wordle")      # earned_today 1,500 -> half
        self.assertEqual(r["base"], 250)
        self.assertEqual(r["awarded"], 250)
        self.assertEqual(User.objects.get(pk=self.user.pk).points, 100 + 1_500 + 250)

    def test_first_day_counts_as_active_and_starts_the_streak(self, _):
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.active_days, user.streak_days, user.streak_best, user.last_active_day), (1, 1, 1, DAY))

    def test_consecutive_days_extend_the_streak(self, today):
        self.receipt(80)
        today.return_value = DAY + datetime.timedelta(days=1)
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.active_days, user.streak_days), (2, 2))

    def test_missed_day_uses_the_freeze_then_breaks(self, today):
        self.receipt(80)
        today.return_value = DAY + datetime.timedelta(days=2)   # skipped the 17th
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.streak_days, user.streak_freezes), (2, 0))
        today.return_value = DAY + datetime.timedelta(days=4)   # skipped the 19th, no freeze left
        self.receipt(80)
        user = User.objects.get(pk=self.user.pk)
        self.assertEqual((user.streak_days, user.streak_best, user.active_days), (1, 2, 3))

    def test_day_seven_pays_the_milestone_and_refills_the_freeze(self, today):
        User.objects.filter(pk=self.user.pk).update(streak_freezes=0)
        for i in range(6):
            today.return_value = DAY + datetime.timedelta(days=i)
            self.receipt(80)
        today.return_value = DAY + datetime.timedelta(days=6)
        r = self.receipt(80)
        self.assertEqual(r["streak_bonus"], 200)
        self.assertEqual(r["streak"]["days"], 7)
        self.assertEqual(r["streak"]["freezes"], 1)
        self.assertEqual(r["awarded"], 80 + 100 + 200)

    def test_rank_up_is_reported_once(self, _):
        r = self.receipt(100)   # 100 + 100 bonus = 200 -> Role Player
        self.assertEqual(r["rank_up"], {"from": "Rookie", "to": "Role Player"})
        self.assertEqual(r["rank"], "Role Player")
        self.assertEqual(r["progress"]["next_rank"], "Sixth Man")
        self.assertIsNone(self.receipt(50)["rank_up"])

    def test_day_is_paris_not_utc(self, today):
        """Two plays on the same Paris day either side of UTC midnight share one day."""
        early = datetime.datetime(2026, 10, 15, 23, 30, tzinfo=datetime.timezone.utc)   # 01:30 Paris, the 16th
        late = datetime.datetime(2026, 10, 16, 0, 30, tzinfo=datetime.timezone.utc)
        with patch("django.utils.timezone.now", return_value=early):
            self.receipt(80)
        with patch("django.utils.timezone.now", return_value=late):
            r = self.receipt(80)
        self.assertEqual(r["first_game_bonus"], 0)
        self.assertEqual(User.objects.get(pk=self.user.pk).active_days, 1)
```

`auto_now_add` reads `timezone.now()`, so patching it stamps `finished_at`; the awarding code must look sessions up by `finished_at__gte=day_start_utc(today)`.

- [ ] **Step 3: Run them to see them fail**

Run: `... manage.py test trivia.tests.test_awarding --noinput`
Expected: ImportError on `trivia.awarding`.

- [ ] **Step 4: Create `backend/trivia/awarding.py`**

```python
"""Everything between a finished game's score and the points that land on the account.

`award()` is the ONLY writer of points, rank, active days and the streak (AUTH-6). Per-game ceilings,
the daily soft cap, the first-game-of-the-day bonus and the streak live here so `log_session` (solo,
the signed-in browser) and `multiplayer_result` (online, the relay) can't drift apart. Day boundaries
are Europe/Paris, like the daily Wordle. Design: docs/superpowers/specs/2026-10-16-progression-design.md.
"""
import datetime

from django.db import transaction
from django.db.models import Sum

from trivia.models import GameSession
from trivia.wordle_daily import CET, cet_today
from users import leaderboard, ranks

# The highest honest score of each game (src/utils/GameUtils.tsx maxPoints): a forged submission is
# clamped to it. Hidden games keep their renderer's maximum.
GAME_MAX_POINTS = {
    "series-winner": 100, "name-logo": 100, "guess-mvps": 100, "starting-five": 150,
    "wordle": 500, "fan-favorites": 200, "career-path": 200, "who-are-ya": 200,
    "tictactoe": 200, "contexto": 200, "who-would-win": 100,
    "heatmap": 300, "connections": 200, "nba-grid": 270, "bingo": 200, "pack-five": 220, "superdraft": 100,
}
# Online rounds that pay less than the solo game: online Wordle has no daily lock, so no daily jackpot.
MATCH_MAX_POINTS = {"wordle": 200}
# A game id in neither table (new or unknown).
DEFAULT_MAX_POINTS = 300

FIRST_GAME_BONUS = 100
# Daily soft cap on GAME points (bonuses excluded): the first DAILY_FULL of a day count in full, the
# next DAILY_HALF at 50%, the rest at DAILY_TAIL_RATE. Rewards coming back tomorrow over farming today.
DAILY_FULL = 1_500
DAILY_HALF = 1_500
DAILY_TAIL_RATE = 0.10
# Paid once, on the day the streak reaches the milestone.
STREAK_MILESTONES = {7: 200, 30: 1_000, 100: 5_000}
# A held freeze covers one missed day; refilled whenever the streak reaches a multiple of 7.
MAX_FREEZES = 1

ACTIVITY_FIELDS = ["points", "rank", "active_days", "last_active_day", "streak_days", "streak_best", "streak_freezes"]


def cap_for(game, mode):
    if mode == "match" and game in MATCH_MAX_POINTS:
        return MATCH_MAX_POINTS[game]
    return GAME_MAX_POINTS.get(game, DEFAULT_MAX_POINTS)


def clamp_score(game, mode, raw):
    try:
        score = int(raw)
    except (TypeError, ValueError):
        return 0
    return min(max(0, score), cap_for(game, mode))


def day_start_utc(day):
    """Paris civil midnight of `day`, as a UTC datetime (what finished_at is compared against)."""
    return datetime.datetime.combine(day, datetime.time.min, tzinfo=CET).astimezone(datetime.timezone.utc)


def week_start_utc(day):
    """Monday 00:00 Paris of the week containing `day`, in UTC (the weekly board's window)."""
    return day_start_utc(day - datetime.timedelta(days=day.weekday()))


def soft_capped(score, earned_today):
    """How much of `score` still counts after `earned_today` game points already earned today."""
    total = 0.0
    remaining = score
    take = min(remaining, max(0, DAILY_FULL - earned_today))
    total += take
    remaining -= take
    take = min(remaining, max(0, DAILY_FULL + DAILY_HALF - max(earned_today, DAILY_FULL)))
    total += take * 0.5
    remaining -= take
    total += remaining * DAILY_TAIL_RATE
    return int(round(total))


def _touch_activity(user, today):
    """Count `today` once, move the streak. Returns the streak milestone bonus (0 when none)."""
    if user.last_active_day == today:
        return 0
    if user.last_active_day == today - datetime.timedelta(days=1):
        user.streak_days += 1
    elif user.last_active_day == today - datetime.timedelta(days=2) and user.streak_freezes > 0:
        user.streak_freezes -= 1  # the freeze covers yesterday
        user.streak_days += 1
    else:
        user.streak_days = 1
    user.active_days += 1
    user.last_active_day = today
    user.streak_best = max(user.streak_best, user.streak_days)
    if user.streak_days % 7 == 0:
        user.streak_freezes = min(MAX_FREEZES, user.streak_freezes + 1)
    return STREAK_MILESTONES.get(user.streak_days, 0)


def award(user, game, mode, score, duration_ms):
    """Log the play and credit the account. `score` is already clamped (clamp_score). Returns the receipt
    the client applies: awarded, base, first_game_bonus, streak_bonus, points, rank, rank_up, progress, streak."""
    today = cet_today()
    since = day_start_utc(today)
    with transaction.atomic():
        user = type(user).objects.select_for_update().get(pk=user.pk)
        rank_before = user.rank
        todays = GameSession.objects.filter(user=user, finished_at__gte=since, mode__in=("single", "match"))
        earned_today = todays.aggregate(s=Sum("score"))["s"] or 0
        scoring = score > 0
        base = soft_capped(score, earned_today) if scoring else 0
        first_bonus = FIRST_GAME_BONUS if scoring and not todays.filter(score__gt=0).exists() else 0
        streak_bonus = _touch_activity(user, today) if scoring else 0
        awarded = base + first_bonus + streak_bonus
        GameSession.objects.create(user=user, game=game, mode=mode, score=score, duration_ms=duration_ms, awarded=awarded)
        user.points += awarded
        user.update_rank()
        user.save(update_fields=ACTIVITY_FIELDS)
    leaderboard.record_score(user)
    return {
        "awarded": awarded,
        "base": base,
        "first_game_bonus": first_bonus,
        "streak_bonus": streak_bonus,
        "points": user.points,
        "rank": user.rank,
        "rank_up": {"from": rank_before, "to": user.rank} if user.rank != rank_before else None,
        "progress": ranks.progress(user.points, user.active_days),
        "streak": {"days": user.streak_days, "best": user.streak_best, "freezes": user.streak_freezes},
    }
```

- [ ] **Step 5: Run the awarding tests**

Run: `... manage.py test trivia.tests.test_awarding --noinput`
Expected: all pass. (SQLite ignores `select_for_update`; fine.)

- [ ] **Step 6: Rewire the views** — `backend/trivia/views.py`.

Delete the block at lines 262-272 (`_MAX_DURATION_MS` stays; remove the `MAX_SESSION_POINTS` / `PER_GAME_MAX_POINTS` constants and their comments) and keep only:

```python
# A day in ms — sanity ceiling for client-reported durations.
_MAX_DURATION_MS = 86_400_000
```

Add `from trivia import awarding` to the imports at the top of the file (next to the other `trivia` imports).

Replace `log_session`'s body from `try: score = ...` through the final `return JsonResponse(...)` (lines 327-359) with:

```python
    # Clamped to the game's own ceiling (awarding.GAME_MAX_POINTS), so a forged submission is worth at
    # most one honest perfect game.
    score = awarding.clamp_score(game, mode, body.get('score', 0))
    try:
        duration = max(0, min(int(body.get('duration_ms', 0)), _MAX_DURATION_MS))
    except (TypeError, ValueError):
        duration = 0

    user = request.user if request.user.is_authenticated else None

    # Online results are credited by the relay (multiplayer_result), never by the browser (AUTH-7),
    # and guests have no account to credit: both are logged and awarded nothing.
    if user is None or mode != 'single':
        GameSession.objects.create(user=user, game=game, mode=mode, score=score, duration_ms=duration)
        return JsonResponse({
            'ok': True,
            'awarded': 0,
            'points': user.points if user is not None else 0,
            'rank': user.rank if user is not None else None,
            'rank_up': None,
        })

    return JsonResponse({'ok': True, **awarding.award(user, game, mode, score, duration)})
```

Delete the `_award` function (lines 362-368) entirely.

In `multiplayer_result`, replace `cap = PER_GAME_MAX_POINTS.get(game, MAX_SESSION_POINTS)` and the per-row block from `try: score = min(...)` to `out.append(...)` (lines 398-416) with:

```python
    out = []
    for r in results:
        if not isinstance(r, dict):
            continue
        user = User.objects.filter(public_id=str(r.get('public_id', ''))[:20], banned_at__isnull=True).first()
        if user is None:
            continue
        score = awarding.clamp_score(game, mode, r.get('score', 0))
        try:
            duration = max(0, min(int(r.get('duration_ms') or 0), _MAX_DURATION_MS))
        except (TypeError, ValueError):
            duration = 0
        out.append({'public_id': user.public_id, **awarding.award(user, game, mode, score, duration)})
```

Update the `log_session` docstring's last sentence to "and the score passes the same per-game clamping as the relay's results (trivia.awarding)." and `multiplayer_result`'s "(clamped there and again here), the same per-game caps as a solo game" stays true.

- [ ] **Step 7: Update `test_score_award.py` to the new numbers**

Replace `from trivia.views import MAX_SESSION_POINTS` with `from trivia.awarding import FIRST_GAME_BONUS, cap_for`. Then:

- `test_finishing_a_game_awards_its_score`: `awarded == 250 + FIRST_GAME_BONUS`, `points() == 350`, the audit row filter becomes `GameSession.objects.filter(user=self.user, score=250, awarded=350).count() == 1`.
- `test_inflated_score_is_clamped`: `awarded == cap_for("wordle", "single") + FIRST_GAME_BONUS` (600) and `points() == 600`.
- `test_who_would_win_is_capped_at_its_own_ceiling`: score 999 → `awarded == 100 + FIRST_GAME_BONUS`, points 200.
- `test_who_would_win_honest_max_is_awarded_in_full`: `_finish(game="who-would-win", score=100)` → awarded `100 + FIRST_GAME_BONUS`.
- `test_multiplayer_results_award_nothing`, guests, non-numeric, rate-limit: unchanged (a 0 award is still 0; the throttle still returns 60 × 200).
- Add after `test_finishing_a_game_awards_its_score`:

```python
    def test_response_carries_the_receipt(self):
        res = self._finish(score=250).json()
        self.assertEqual(res["rank_up"], {"from": "Rookie", "to": "Role Player"})
        self.assertEqual(res["progress"]["rank"], "Role Player")
        self.assertEqual(res["streak"]["days"], 1)
        self.assertEqual(res["first_game_bonus"], FIRST_GAME_BONUS)
```

- `MultiplayerResultTests.test_credits_every_player_and_logs_sessions`: `points(a) == 300`, `points(b) == 150`, `awarded == {a: 300, b: 150}`.
- `test_scores_are_clamped_and_banned_players_skipped`: `points(a) == cap_for("wordle", "match") + FIRST_GAME_BONUS` (300).
- Add to `MultiplayerResultTests`:

```python
    def test_rows_carry_the_receipt_for_the_relay(self):
        row = self._post(self._body()).json()["results"][0]
        for key in ("awarded", "points", "rank", "rank_up", "progress", "streak"):
            self.assertIn(key, row)
```

- [ ] **Step 8: Run the trivia award tests and the whole trivia suite**

Run: `... manage.py test trivia.tests.test_score_award trivia.tests.test_awarding --noinput` → pass.
Run: `... manage.py test --noinput` (full backend) → pass. If `test_admin_api.py` or the feedback tab counts sessions/points, read the failure: expectations that assumed `awarded == score` without the bonus need `+ 100` on the first play of the day.

- [ ] **Step 9: Commit**

```bash
git add backend/trivia/awarding.py backend/trivia/tests/test_awarding.py backend/trivia/models.py backend/trivia/migrations/0009_gamesession_awarded.py backend/trivia/views.py backend/trivia/tests/test_score_award.py
git commit -m "awarding: per-game caps, daily soft cap, first-game bonus, streak and active days"
```

---

### Task 3: User payload, guest carry-over, leaderboard rank names + weekly scope

**Files:**
- Modify: `backend/users/views.py:77-92` (`user_payload`), `:191-198` (Google new account), `:305-313` (signup), `:602-630` (`get_users`)
- Modify: `backend/users/leaderboard.py` (`top`, `friends_board`, new `weekly_board`)
- Modify: `backend/users/account_data.py` (export fields, after line 134)
- Modify: `backend/users/test_leaderboard.py` (new tests), `backend/users/tests.py` or new `backend/users/test_progression_api.py`

**Interfaces:**
- Consumes: `users.ranks.progress`, `trivia.awarding.week_start_utc`, `GameSession.awarded`.
- Produces: `/api/me/` + login/signup payload gains `founding_member, active_days, streak_days, streak_best, streak_freezes, rank_progress`; signup/Google-signup accept `guest_points` (≤ 1000); `/api/get-users/` rows gain `rank`; `?scope=weekly` returns `{top_100_users, user_rank, number_users}` with weekly points.

- [ ] **Step 1: Write the failing tests** — `backend/users/test_progression_api.py`:

```python
"""The progression fields the client reads, guest carry-over at signup, and the weekly board (spec §4-5)."""
import datetime
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import Client, TestCase
from django.utils import timezone

from trivia.models import GameSession

User = get_user_model()
SIGNUP = {"username": "Newbie", "email": "new@example.com", "password": "Str0ng!Passw0rd",
          "accept_terms": True, "age_confirmed": True}


class PayloadTests(TestCase):
    def test_me_carries_progression(self):
        User.objects.create_user(username="Baller", email="b@example.com", password="Str0ng!Passw0rd", points=300, founding_member=True)
        c = Client()
        tokens = c.post("/api/login/", {"id": "b@example.com", "password": "Str0ng!Passw0rd"}, content_type="application/json").json()
        me = c.get("/api/me/", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}").json()["user"]
        self.assertTrue(me["founding_member"])
        self.assertEqual(me["streak_days"], 0)
        self.assertEqual(me["streak_freezes"], 1)
        self.assertEqual(me["active_days"], 0)
        self.assertEqual(me["rank_progress"]["next_rank"], "Sixth Man")
        self.assertEqual(me["rank_progress"]["points_to_next"], 200)


class GuestCarryOverTests(TestCase):
    def _signup(self, **extra):
        body = dict(SIGNUP, **extra)
        return Client().post("/api/signup/", body, content_type="application/json")

    def test_guest_points_are_credited_and_capped(self):
        res = self._signup(guest_points=340)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.json()["user"]["points"], 340)
        self.assertEqual(res.json()["user"]["rank"], "Role Player")

    def test_guest_points_cap_at_1000(self):
        res = self._signup(guest_points=999_999)
        self.assertEqual(res.json()["user"]["points"], 1000)

    def test_junk_guest_points_are_ignored(self):
        self.assertEqual(self._signup(guest_points="lots").json()["user"]["points"], 0)
        self.assertEqual(self._signup(email="x@example.com", guest_points=-50).json()["user"]["points"], 0)


class WeeklyBoardTests(TestCase):
    def setUp(self):
        self.a = User.objects.create_user(username="alice", email="a@example.com", password="x", points=9_000, age_group="adult")
        self.b = User.objects.create_user(username="bob", email="b@example.com", password="x", points=100, age_group="adult")
        self.teen = User.objects.create_user(username="kid", email="k@example.com", password="x", points=5, age_group="teen")
        now = timezone.now()
        # This week: bob 300, alice 120, the teen 900 (hidden). Last week: alice 5,000 (ignored).
        GameSession.objects.create(user=self.b, game="wordle", score=200, awarded=300)
        GameSession.objects.create(user=self.a, game="wordle", score=100, awarded=120)
        GameSession.objects.create(user=self.teen, game="wordle", score=500, awarded=900)
        old = GameSession.objects.create(user=self.a, game="wordle", score=500, awarded=5_000)
        GameSession.objects.filter(pk=old.pk).update(finished_at=now - datetime.timedelta(days=14))

    def test_weekly_scope_sums_this_weeks_awards(self):
        res = Client().get("/api/get-users/?scope=weekly").json()
        self.assertEqual([(r["username"], r["points"]) for r in res["top_100_users"]], [("bob", 300), ("alice", 120)])
        self.assertEqual(res["number_users"], 2)
        self.assertIsNone(res["user_rank"])

    def test_weekly_position_of_the_signed_in_player(self):
        c = Client()
        tokens = c.post("/api/login/", {"id": "a@example.com", "password": "x"}, content_type="application/json").json()
        res = c.get("/api/get-users/?scope=weekly", HTTP_AUTHORIZATION=f"Bearer {tokens['access']}").json()
        self.assertEqual(res["user_rank"], 2)

    def test_global_rows_carry_rank_names(self):
        res = Client().get("/api/get-users/").json()
        self.assertEqual(res["top_100_users"][0]["rank"], "Rookie")
```

(If `check_consent` in `users/consent.py` expects different consent keys than `accept_terms`/`age_confirmed`, copy the ones `test_signup_age_checkbox.py` sends.)

- [ ] **Step 2: Run them to see them fail**

Run: `... manage.py test users.test_progression_api --noinput` → KeyError `founding_member`, `points` 0 after carry-over, weekly scope returns the global board.

- [ ] **Step 3: `user_payload` and guest carry-over** — `backend/users/views.py`.

Add `from users import leaderboard, photo_moderation, ranks, strikes` (extend the existing import on line 19). In `user_payload`, after `"points": user.points,` add:

```python
        # Progression (users.ranks / trivia.awarding). The frontend displays these; it never computes them.
        "founding_member": user.founding_member,
        "active_days": user.active_days,
        "streak_days": user.streak_days,
        "streak_best": user.streak_best,
        "streak_freezes": user.streak_freezes,
        "rank_progress": ranks.progress(user.points, user.active_days),
```

Add after `USERNAME_TRIES = 10` (line 113):

```python
# Points a guest scored in this browser before signing up (src/utils/guestPoints.ts). Display-only and
# client-reported, so it is capped: a new account can start as a Sixth Man at most, never on the ladder's
# day-gated ranks. No session row, no streak, no active day.
GUEST_CARRYOVER_MAX = 1000


def apply_guest_points(user, data):
    try:
        pts = int(data.get("guest_points") or 0)
    except (TypeError, ValueError):
        pts = 0
    pts = min(max(pts, 0), GUEST_CARRYOVER_MAX)
    if pts <= 0:
        return 0
    user.points += pts
    user.update_rank()
    user.save(update_fields=["points", "rank"])
    return pts
```

In `signup_view`, after `user.save(update_fields=CONSENT_FIELDS)` (line 308) and inside the same `try`, add `apply_guest_points(user, request.data)`. In the Google new-account path, after `stamp_consent(user, age_group, consent_source)` and its save (lines 196-197), add `apply_guest_points(user, data)` where `data` is the request body that function receives (read the enclosing function's signature: it is the `request.data`-derived dict passed down to it; if only `request` is in scope use `request.data`).

- [ ] **Step 4: Leaderboard rank names and the weekly board** — `backend/users/leaderboard.py`.

In `top()`, Postgres path: `.values("public_id", "username", "points", "rank")` and each row gets `"rank": u["rank"]`. Redis path: replace the `names` dict with

```python
    info = {pid: (name, rank) for pid, name, rank in _ranked().filter(public_id__in=ids).values_list("public_id", "username", "rank")}
    return [
        {"id": m, "username": info.get(m, ("Player", "Rookie"))[0], "rank": info.get(m, ("Player", "Rookie"))[1], "points": int(s)}
        for m, s in entries
    ]
```

In `friends_board()`, add `"rank"` to the `.values(...)` and to each board row.

Append:

```python
def weekly_board(user=None):
    """This week's board (Monday 00:00 Paris to now) as (rows, my_rank, count): each public account's
    summed GameSession.awarded. Postgres only — the window is small and resets weekly, so the ZSET's
    advantage doesn't apply. `my_rank` is None for a guest or a player with nothing this week."""
    from django.db.models import Sum

    from trivia.awarding import week_start_utc
    from trivia.models import GameSession
    from trivia.wordle_daily import cet_today

    rows = list(
        GameSession.objects.filter(user__in=_ranked(), finished_at__gte=week_start_utc(cet_today()), awarded__gt=0)
        .values("user__public_id", "user__username", "user__rank")
        .annotate(points=Sum("awarded"))
        .order_by("-points", "user__public_id")
    )
    board = [{"id": r["user__public_id"], "username": r["user__username"], "rank": r["user__rank"], "points": r["points"]} for r in rows]
    my_rank = None
    if user is not None:
        mine = next((r["points"] for r in rows if r["user__public_id"] == user.public_id), None)
        if mine is not None:
            my_rank = sum(1 for r in rows if r["points"] > mine) + 1
    return board[:100], my_rank, len(board)
```

In `get_users` (`users/views.py`), before the global branch add:

```python
        if scope == "weekly":
            board, user_rank, number_users = leaderboard.weekly_board(request.user if request.user.is_authenticated else None)
            return Response({"top_100_users": board, "user_rank": user_rank, "number_users": number_users}, status=200)
```

- [ ] **Step 5: Export the new fields** — `backend/users/account_data.py`, in `export_account`'s `"account"` dict after `"rank": user.rank,` add:

```python
            "active_days": user.active_days,
            "streak_days": user.streak_days,
            "streak_best": user.streak_best,
            "founding_member": user.founding_member,
```

- [ ] **Step 6: Run the tests**

Run: `... manage.py test users.test_progression_api users.test_leaderboard users.test_account_data trivia.tests.test_score_award --noinput` → pass. If `test_leaderboard.py` compares whole row dicts, add `"rank": "Rookie"` to its expected rows.

- [ ] **Step 7: Full backend suite, then commit**

Run: `... manage.py test --noinput` → pass.

```bash
git add backend/users
git commit -m "progression payload, guest carry-over at signup, weekly board, rank names on boards"
```

---

### Task 4: Frontend scoring rebalance (renderers, registry, relay, ui-check adapters)

**Files:**
- Create: `src/utils/gameScoring.ts`, `scripts/test-game-scoring.mjs`
- Modify: `package.json` (script), `src/utils/whoWouldWinPoints.ts`, `scripts/test-www-points.mjs`
- Modify: `src/utils/GameUtils.tsx` (points, maxPoints, copy for series-winner, name-logo, guess-mvps, starting-five, fan-favorites, career-path, who-are-ya, tictactoe, who-would-win)
- Modify: `src/Game Renderers/CareerPath.tsx:30,177,269`, `WhoAreYa.tsx:56-57,302`, `FanFavorites.tsx:26,175,206`, `Wordle.tsx:11-13,27-35,95,195`, `TicTacToe.tsx:22,326`, `StartingFive.tsx:24`, `RenderGame.tsx:116-124`
- Modify: `multiplayer_server/src/turnGames.js:55-57`, `multiplayer_server/src/index.js:90`
- Modify: `scripts/ui-check/games/{series-winner,name-logo,guess-mvps,starting-five,tictactoe,career-path,who-are-ya,fan-favorites,who-would-win}.mjs`

**Interfaces:**
- Produces: `src/utils/gameScoring.ts` exports `CAREER_PATH_MAX, careerPathScore(wrong)`, `WHO_ARE_YA_MAX, whoAreYaScore(wrong)`, `FAN_FAVORITES_MAX, fanFavoritesScore(found, total)`, `WORDLE_MAX_GUESSES, wordlePoints(attemptIndex, multiplayer)`, `TTT_CELL_POINTS, TTT_SOLO_MAX`, `STARTING_FIVE_BONUS`. Wordle renderer gains `multiplayer?: boolean`.

- [ ] **Step 1: Write the failing test** — `scripts/test-game-scoring.mjs`:

```js
// Node test for src/utils/gameScoring.ts (the pure scoring rules the renderers import), no dependencies:
//   npm run test:game-scoring      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAREER_PATH_MAX, careerPathScore,
  WHO_ARE_YA_MAX, whoAreYaScore,
  FAN_FAVORITES_MAX, fanFavoritesScore,
  WORDLE_MAX_GUESSES, wordlePoints,
  TTT_CELL_POINTS, TTT_SOLO_MAX,
  STARTING_FIVE_BONUS,
} from "../src/utils/gameScoring.ts";

test("career path: 200 minus 40 per miss, never below 40", () => {
  assert.equal(CAREER_PATH_MAX, 200);
  assert.equal(careerPathScore(0), 200);
  assert.equal(careerPathScore(2), 120);
  assert.equal(careerPathScore(6), 40);
  assert.equal(careerPathScore(9), 40);
});

test("who are ya: 200 minus 25 per miss", () => {
  assert.equal(WHO_ARE_YA_MAX, 200);
  assert.equal(whoAreYaScore(0), 200);
  assert.equal(whoAreYaScore(7), 25);
});

test("fan favorites: proportional to answers found, 200 for a clear", () => {
  assert.equal(FAN_FAVORITES_MAX, 200);
  assert.equal(fanFavoritesScore(8, 8), 200);
  assert.equal(fanFavoritesScore(3, 8), 75);
  assert.equal(fanFavoritesScore(0, 8), 0);
  assert.equal(fanFavoritesScore(0, 0), 0);
});

test("wordle: 500 jackpot solo, 200 online, minus one step per used attempt", () => {
  assert.equal(WORDLE_MAX_GUESSES, 5);
  assert.equal(wordlePoints(0, false), 500);
  assert.equal(wordlePoints(4, false), 100);
  assert.equal(wordlePoints(0, true), 200);
  assert.equal(wordlePoints(4, true), 40);
});

test("tic-tac-toe solo: 20 per cell, 180 for the board", () => {
  assert.equal(TTT_CELL_POINTS, 20);
  assert.equal(TTT_SOLO_MAX, 180);
});

test("starting five bonus", () => {
  assert.equal(STARTING_FIVE_BONUS, 50);
});
```

Add to `package.json` scripts after `"test:www-points"`: `"test:game-scoring": "node --experimental-strip-types scripts/test-game-scoring.mjs",`.

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types scripts/test-game-scoring.mjs` → module not found.

- [ ] **Step 3: Create `src/utils/gameScoring.ts`**

```ts
// Pure scoring rules shared by the renderers — no imports, so scripts/test-game-scoring.mjs can load it
// under `node --experimental-strip-types`. The backend caps each game at the same maxima
// (backend/trivia/awarding.py GAME_MAX_POINTS); change both together.

/** Career Path: solved = 200 minus 40 per wrong guess, floor 40; out of guesses = 0 (the renderer). */
export const CAREER_PATH_MAX = 200;
export const CAREER_PATH_COST = 40;
export const CAREER_PATH_MIN = 40;
export function careerPathScore(wrong: number): number {
  return Math.max(CAREER_PATH_MIN, CAREER_PATH_MAX - CAREER_PATH_COST * wrong);
}

/** Who Are Ya?: 200 minus 25 per wrong guess (8 guesses, so the lowest win is 25). */
export const WHO_ARE_YA_MAX = 200;
export const WHO_ARE_YA_COST = 25;
export function whoAreYaScore(wrong: number): number {
  return Math.max(0, WHO_ARE_YA_MAX - WHO_ARE_YA_COST * wrong);
}

/** Fan Favorites: the board's share of 200. */
export const FAN_FAVORITES_MAX = 200;
export function fanFavoritesScore(found: number, total: number): number {
  return total > 0 ? Math.round((FAN_FAVORITES_MAX * found) / total) : 0;
}

/** Wordle: first try = 500 solo / 200 online, one step less per used attempt. Online has no daily
 *  lock, so it can't pay the daily jackpot. */
export const WORDLE_MAX_GUESSES = 5;
export const WORDLE_SOLO_PER_GUESS = 100;
export const WORDLE_ONLINE_PER_GUESS = 40;
export function wordlePoints(attemptIndex: number, multiplayer: boolean): number {
  return (WORDLE_MAX_GUESSES - attemptIndex) * (multiplayer ? WORDLE_ONLINE_PER_GUESS : WORDLE_SOLO_PER_GUESS);
}

/** Tic-Tac-Toe solo: per claimed cell. Online scores are fixed by the relay (turnGames.js). */
export const TTT_CELL_POINTS = 20;
export const TTT_SOLO_MAX = 9 * TTT_CELL_POINTS;

/** Starting 5: a full lineup adds this to 5 × pointsPerCorrect. */
export const STARTING_FIVE_BONUS = 50;
```

Run the test → pass.

- [ ] **Step 4: Who Would Win numbers** — `src/utils/whoWouldWinPoints.ts`: `WWW_POINTS_MAJORITY = 10` (comment "// 10 matchups x 10 = 100"), minority stays 5, `WWW_MAX_POINTS` comment `// 100`. In `scripts/test-www-points.mjs` change every `20` → `10` and `200` → `100`, and the test names "majority earns 10" etc. Run `node --experimental-strip-types scripts/test-www-points.mjs` → pass.

- [ ] **Step 5: Renderers**

- `CareerPath.tsx`: replace `const POINTS_PER_CARD = 100;` with `import { CAREER_PATH_MAX, careerPathScore } from "../utils/gameScoring";` (keep the import block together); line 177 → `const finalScore = careerPathScore(wrong);`; line 269 `outOf={stints * POINTS_PER_CARD}` → `outOf={CAREER_PATH_MAX}`. Grep the file for any other `POINTS_PER_CARD` and replace.
- `WhoAreYa.tsx`: delete `const MAX_SCORE = 240;` and the `COST_PER_WRONG` constant (line 55-57 area), import `{ WHO_ARE_YA_MAX, whoAreYaScore }`; line 302 → `const finalScore = whoAreYaScore(wrongCount);`; any `outOf={MAX_SCORE}` → `outOf={WHO_ARE_YA_MAX}`.
- `FanFavorites.tsx`: delete `const MAX_SCORE = 300;`, import `{ FAN_FAVORITES_MAX, fanFavoritesScore }`; line 175 popup → `` `Board cleared! +${FAN_FAVORITES_MAX}` ``; line 180/181 `MAX_SCORE` → `FAN_FAVORITES_MAX`; line 206 → `const finalScore = fanFavoritesScore(found, total);`; line 321 `outOf={MAX_SCORE}` → `outOf={FAN_FAVORITES_MAX}`.
- `Wordle.tsx`: replace lines 11-13 with `import { WORDLE_MAX_GUESSES as MAX_GUESSES, wordlePoints } from "../utils/gameScoring";` (keep `WORD_LENGTH`); add `multiplayer?: boolean;` to `WordleProps` with the doc comment `/** Online round: 200-point scale (no daily lock online). */`; destructure it in the component; line 95 → `const points = wordlePoints(firstNullIndex, !!multiplayer);`; line 195 `outOf={MAX_SCORE}` → `outOf={wordlePoints(0, !!multiplayer)}`.
- `RenderGame.tsx` wordle case: add `multiplayer={multiplayer}` to `<Wordle …/>`.
- `TicTacToe.tsx`: replace `const CELL_POINTS = 25; // …` with `import { TTT_CELL_POINTS as CELL_POINTS, TTT_SOLO_MAX } from "../utils/gameScoring";`; line 326 → `` finishSolo(TTT_SOLO_MAX, `Board cleared! +${TTT_SOLO_MAX}`, "var(--good)") ``; `outOf={9 * CELL_POINTS}` → `outOf={TTT_SOLO_MAX}`.
- `StartingFive.tsx`: replace `const COMPLETION_BONUS = 50; // …` with `import { STARTING_FIVE_BONUS as COMPLETION_BONUS } from "../utils/gameScoring";`.

- [ ] **Step 6: Registry numbers and copy** — `src/utils/GameUtils.tsx`

| id | pointsPerCorrect | maxPoints | copy changes (rules, instruction, seoDescription) |
|---|---|---|---|
| series-winner | 20 | 100 | "10 points" → "20 points" everywhere in the entry |
| name-logo | 20 | 100 | same |
| guess-mvps | 20 | 100 | same |
| starting-five | 20 | 150 | "Complete the lineup for 100 points" → "150 points"; instruction "100 points for a perfect completion" → "150 points"; seoDescription "for 100 points" → "for 150 points" |
| fan-favorites | 50 (unchanged, unused) | 200 | "300 points" → "200 points" (rules + instruction) |
| career-path | 100 → 40 | 200 | rules n3: "Score = 200, minus 40 per wrong guess. Run out and it's 0."; instruction reward: "200 points, −40 per wrong guess."; seoDescription last sentence: "Fewer misses, more points." |
| who-are-ya | 30 → 25 | 200 | "240 points minus 30" → "200 points minus 25"; instruction "240 points, −30" → "200 points, −25" |
| tictactoe | 25 → 20 | 180 → 200 (online max) | no copy mentions numbers; rail chip shows "up to 200 pts" |
| who-would-win | 20 → 10 | 100 | rules n3 "Side with the crowd for 10 points, go against it for 5."; instruction "10 points when … 5 when … Up to 100." |

- [ ] **Step 7: Relay** — `multiplayer_server/src/turnGames.js` lines 55-57: `TTT_WIN_SCORE = 200`, `TTT_LOSS_SCORE = 30`, `TTT_DRAW_SCORE = 120`, comment "// a finished duel: win / loss / draw (the game's maxPoints is the win)". `index.js:90` comment → `// above every game's maxPoints (the daily Wordle's 500 is the largest)`.

- [ ] **Step 8: ui-check adapters** — in `scripts/ui-check/games/`: `series-winner.mjs`, `name-logo.mjs`, `guess-mvps.mjs`, `starting-five.mjs`: `pointsPerCorrect: 10` → `20` and `"Correct! +10"` in the header comment → `+20`. `tictactoe.mjs`: wherever `CELL_POINTS` is defined set it to 20; `'Correct! +25'` → `'Correct! +20'`, `'Board cleared! +225'` → `'Board cleared! +180'`, header comment likewise. `career-path.mjs` header: "(cards − misses) × 100" → "200 − 40 × misses (floor 40)". `who-are-ya.mjs` header: "240 − 30 × misses" → "200 − 25 × misses". `fan-favorites.mjs` header: 300 → 200 (both mentions). `who-would-win.mjs`: any "20"/"200" expectation → 10/100 (grep the file).

- [ ] **Step 9: Verify**

Run: `node --experimental-strip-types scripts/test-game-scoring.mjs && node --experimental-strip-types scripts/test-www-points.mjs` → pass.
Run: `npx next typegen && npx tsc --noEmit` → no errors. Run: `npm run lint` → pass (`check:games` reads GameUtils ids and the renderers' `onGameEnd` calls, which are untouched).
Run: `grep -rn "POINTS_PER_CARD\|COST_PER_WRONG\|MAX_SCORE" "src/Game Renderers/CareerPath.tsx" "src/Game Renderers/WhoAreYa.tsx" "src/Game Renderers/FanFavorites.tsx" "src/Game Renderers/Wordle.tsx"` → no hits.

- [ ] **Step 10: Commit**

```bash
git add src scripts package.json multiplayer_server/src
git commit -m "rebalance game points: ~100 per good game, per-game caps, online wordle and tic-tac-toe scales"
```

---

### Task 5: Receipt plumbing — Redux user, solo + online award paths, relay passthrough

**Files:**
- Create: `src/store/award.ts`, `scripts/test-award.mjs`
- Modify: `src/store/userSlice.tsx` (User type, `applyAward`, `pendingRankUp`); `src/utils/session.ts` needs nothing (`isSessionUser` already tolerates extra fields)
- Modify: `src/views/Trivia/MiniGame.tsx:17, 218-226`
- Modify: `src/context/MultiplayerContext.tsx:599-604`
- Modify: `multiplayer_server/src/index.js:371-373`
- Modify: `package.json` (script)

**Interfaces:**
- Consumes: the backend receipt (Task 2) over `/trivia/log-session/` and the relay's `pointsAwarded`.
- Produces: `AwardReceipt` type, `applyAward(receipt)` and `clearRankUp()` actions, `state.user.pendingRankUp: {from, to, division} | null`; `User` gains `rank_progress?, streak_days?, streak_best?, streak_freezes?, active_days?, founding_member?`.

- [ ] **Step 1: Write the failing test** — `scripts/test-award.mjs`. The receipt logic lives in a pure `.ts` helper (`src/store/award.ts`, no React/RTK imports) so Node's type stripping can load it; the slice's reducer just calls it.

```js
// Node test for src/store/award.ts (how an award receipt lands on the signed-in user), no dependencies:
//   npm run test:award      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { applyReceipt } from "../src/store/award.ts";

const user = () => ({ id: "K7F3QD", username: "Baller", email: "b@example.com", rank: "Rookie", points: 50, profile_photo: null });

test("a full receipt sets the server's totals, rank, progress, streak and a pending rank-up", () => {
  const { user: u, rankUp } = applyReceipt(user(), {
    awarded: 180, points: 230, rank: "Role Player", rank_up: { from: "Rookie", to: "Role Player" },
    progress: { rank: "Role Player", division: null, next_rank: "Sixth Man", next_points: 500, next_days: 0, points_to_next: 270, days_to_next: 0, progress_pct: 32 },
    streak: { days: 1, best: 1, freezes: 1 },
  });
  assert.equal(u.points, 230);
  assert.equal(u.rank, "Role Player");
  assert.equal(u.rank_progress.next_rank, "Sixth Man");
  assert.equal(u.streak_days, 1);
  assert.equal(u.streak_freezes, 1);
  assert.deepEqual(rankUp, { from: "Rookie", to: "Role Player", division: null });
});

test("an old relay payload with only awarded/points/rank still applies", () => {
  const { user: u, rankUp } = applyReceipt(user(), { awarded: 90, points: 140, rank: "Role Player" });
  assert.equal(u.points, 140);
  assert.equal(u.rank, "Role Player");
  assert.equal(u.rank_progress, undefined);
  assert.equal(rankUp, null);
});

test("a receipt without points falls back to adding the delta", () => {
  const { user: u } = applyReceipt(user(), { awarded: 90, rank: "Rookie" });
  assert.equal(u.points, 140);
});

test("a rank_up whose from and to match is not a promotion", () => {
  const { rankUp } = applyReceipt(user(), { awarded: 1, points: 51, rank: "Rookie", rank_up: { from: "Rookie", to: "Rookie" } });
  assert.equal(rankUp, null);
});

test("the division on the pending rank-up comes from the progress", () => {
  const { rankUp } = applyReceipt(user(), {
    awarded: 1, points: 5_001, rank: "All-Star", rank_up: { from: "Starter", to: "All-Star" },
    progress: { rank: "All-Star", division: 3, next_rank: "All-NBA", next_points: 15_000, next_days: 20, points_to_next: 9_999, days_to_next: 13, progress_pct: 0 },
  });
  assert.deepEqual(rankUp, { from: "Starter", to: "All-Star", division: 3 });
});
```

Add `"test:award": "node --experimental-strip-types scripts/test-award.mjs",` to `package.json`.

- [ ] **Step 2: Run it to see it fail**

Run: `node --experimental-strip-types scripts/test-award.mjs` → module not found.

- [ ] **Step 3: Create `src/store/award.ts`**

```ts
// How an award receipt lands on the signed-in user. Pure (no React, no Redux Toolkit) so
// scripts/test-award.mjs can load it; userSlice's `applyAward` reducer calls it.
import type { User } from "./userSlice";

/** What the backend sends back for a credited play (backend/trivia/awarding.py `award`) — over HTTP for a
 *  solo game (MiniGame.awardPoints) or through the relay's `pointsAwarded` for an online one. Everything
 *  but `awarded`/`rank` is optional so a relay deployed before this change still applies. */
export interface RankProgress {
  rank: string;
  division: number | null;
  next_rank: string | null;
  next_points: number | null;
  next_days: number | null;
  points_to_next: number;
  days_to_next: number;
  progress_pct: number;
}
export interface AwardReceipt {
  awarded: number;
  points?: number;
  rank: string;
  rank_up?: { from: string; to: string } | null;
  progress?: RankProgress;
  streak?: { days: number; best: number; freezes: number };
  first_game_bonus?: number;
  streak_bonus?: number;
}
export interface PendingRankUp { from: string; to: string; division: number | null }

/** The user after the receipt, and the promotion to show (null when the rank didn't change). The
 *  server's totals win over ours: the award may land after Play again, and a delta would drift. */
export function applyReceipt(user: User, r: AwardReceipt): { user: User; rankUp: PendingRankUp | null } {
  const next: User = { ...user };
  next.points = typeof r.points === "number" ? r.points : user.points + (r.awarded || 0);
  if (r.rank) next.rank = r.rank;
  if (r.progress) next.rank_progress = r.progress;
  if (r.streak) {
    next.streak_days = r.streak.days;
    next.streak_best = r.streak.best;
    next.streak_freezes = r.streak.freezes;
  }
  const rankUp = r.rank_up && r.rank_up.to !== r.rank_up.from
    ? { from: r.rank_up.from, to: r.rank_up.to, division: r.progress?.division ?? null }
    : null;
  return { user: next, rankUp };
}
```

- [ ] **Step 4: Run the award test** → pass. Then extend the slice — `src/store/userSlice.tsx`:

Add `import { applyReceipt, type AwardReceipt, type PendingRankUp, type RankProgress } from "./award";` and `export type { AwardReceipt, PendingRankUp, RankProgress } from "./award";` (callers import the types from the slice).

Extend `User` with:

```ts
  /** Progression (users.ranks / trivia.awarding); absent on a cached /me/ from before it existed. */
  rank_progress?: RankProgress;
  streak_days?: number;
  streak_best?: number;
  streak_freezes?: number;
  active_days?: number;
  founding_member?: boolean;
```

Add `pendingRankUp: PendingRankUp | null;` to `UserState` (doc: `/** A rank-up the player hasn't been shown yet; ModalHost opens the rank-up modal and clears it. */`) and `pendingRankUp: null` to `initialState`. Add reducers:

```ts
    /** Apply a credited play's receipt (store/award.ts): totals, rank, progress, streak, pending rank-up. */
    applyAward: (state, action: PayloadAction<AwardReceipt>) => {
      if (!state.user) return;
      const { user, rankUp } = applyReceipt(state.user, action.payload);
      state.user = user;
      if (rankUp) state.pendingRankUp = rankUp;
    },
    clearRankUp: (state) => {
      state.pendingRankUp = null;
    },
```

Export both in the `userSlice.actions` destructuring. Keep `updatePoints`/`updateRank` (other callers may exist; `updateRank` stays unused as before).

Run: `npx next typegen && npx tsc --noEmit` → clean (the `import type` cycle between `award.ts` and `userSlice.tsx` is type-only and erased).

- [ ] **Step 5: Solo path** — `src/views/Trivia/MiniGame.tsx`: change the import to `import { applyAward, type AwardReceipt } from '../../store/userSlice';` and replace lines 221-226 with:

```ts
      } else if (typeof data.awarded === "number") {
        // The server has already credited the account; the receipt carries its totals, the new rank
        // and progress, so applying it late (even after Play again) can't drift from the backend.
        dispatch(applyAward(data as AwardReceipt));
      }
```

- [ ] **Step 6: Online path** — `src/context/MultiplayerContext.tsx` lines 599-604: import `applyAward` and `type AwardReceipt` instead of `updatePoints` (keep `updatePoints` only if something else in the file uses it — grep) and:

```ts
      // The relay credited this match to the account (Django already saved it); the receipt carries the totals.
      pointsAwarded: (d: AwardReceipt) => {
        if (!d || typeof d.awarded !== "number" || d.awarded <= 0) return;
        reduxDispatch(applyAward(d));
        dispatch({ t: "NOTICE", notice: { kind: "points", text: `+${d.awarded} pts added to your profile` } });
      },
```

- [ ] **Step 7: Relay passthrough** — `multiplayer_server/src/index.js` line 372: `if (r.awarded > 0) toUid(r.public_id, "pointsAwarded", r);` (the whole row: `awarded, points, rank, rank_up, progress, streak, …`). Update the comment above `creditRoom` to mention that the receipt is forwarded as-is.

- [ ] **Step 8: Verify**

Run: `npx next typegen && npx tsc --noEmit` → clean. `node --experimental-strip-types scripts/test-award.mjs` → pass. `grep -rn "updatePoints" src` → only the slice's own definition/export (or list the remaining callers; leave them).

- [ ] **Step 9: Commit**

```bash
git add src/store/award.ts src/store/userSlice.tsx scripts/test-award.mjs package.json src/views/Trivia/MiniGame.tsx src/context/MultiplayerContext.tsx multiplayer_server/src/index.js
git commit -m "apply award receipts: rank, progress, streak and pending rank-up in the user store"
```

---

### Task 6: UI — profile progress + streak, rank names on boards, weekly tab, rank-up modal, guest carry-over

**Files:**
- Create: `src/utils/ranks.ts`, `scripts/test-ranks.mjs`, `src/components/modals/RankUpModal.tsx`
- Modify: `package.json` (script)
- Modify: `src/components/UserProfile.tsx:131-141`, `src/styles/LandPage.css` (after `.pc-stat-num.is-brand`, line 228)
- Modify: `src/views/ProfileSettings.tsx:189`
- Modify: `src/context/ModalContext.tsx` (kind + payload), `src/components/ModalHost.tsx` (open on `pendingRankUp`, render)
- Modify: `src/hooks/useLeaderboard.ts` (scope, rankName, self fallback), `src/constants/leaderboard.ts` (scopes, `rankName`), `src/components/Leaderboard.tsx`, `src/components/modals/LeaderboardModal.tsx`
- Modify: `src/components/GuestPanel.tsx`, `src/components/LogInSignUp.tsx:309, 318-321, 388, 421`, `src/utils/guestPoints.ts`

**Interfaces:**
- Consumes: `User.rank_progress/streak_*/founding_member`, `state.user.pendingRankUp`, `clearRankUp`, `/api/get-users/?scope=weekly`, board rows' `rank`.
- Produces: `src/utils/ranks.ts` exports `RANK_ORDER`, `RANK_COLORS`, `rankLabel(rank, division?)`, `shareText(rank)`; `ModalKind` gains `"rankUp"` with `RankUpPayload = PendingRankUp`; `LeaderboardScope = "global" | "weekly" | "friends"`; `LeaderRow.rankName?`; `clearGuestPoints()`.

- [ ] **Step 1: Write the failing test** — `scripts/test-ranks.mjs`:

```js
// Node test for src/utils/ranks.ts (display helpers; thresholds live in the backend):
//   npm run test:ranks      (node --experimental-strip-types; Node >= 22.6)
import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK_ORDER, RANK_COLORS, rankLabel, shareText } from "../src/utils/ranks.ts";

test("nine ranks, Rookie to GOAT, each with a colour", () => {
  assert.equal(RANK_ORDER.length, 9);
  assert.equal(RANK_ORDER[0], "Rookie");
  assert.equal(RANK_ORDER[8], "GOAT");
  for (const r of RANK_ORDER) assert.match(RANK_COLORS[r], /^#[0-9a-f]{6}$/i);
});

test("rankLabel adds the roman division only when there is one", () => {
  assert.equal(rankLabel("All-Star", 2), "All-Star II");
  assert.equal(rankLabel("All-Star", 1), "All-Star I");
  assert.equal(rankLabel("Starter", null), "Starter");
  assert.equal(rankLabel("GOAT", undefined), "GOAT");
});

test("shareText names the rank and the site", () => {
  const t = shareText("All-NBA");
  assert.match(t, /All-NBA/);
  assert.match(t, /swishquest\.com/);
  assert.doesNotMatch(t, /undefined/);
});
```

Add `"test:ranks": "node --experimental-strip-types scripts/test-ranks.mjs",` to `package.json`. Run → module not found.

- [ ] **Step 2: Create `src/utils/ranks.ts`**

```ts
// Rank display helpers. The ladder's thresholds and day gates live in the backend (users/ranks.py) and
// arrive as `rank_progress` on the user; this file only knows the order, a colour per rank and copy.
export const RANK_ORDER = [
  "Rookie", "Role Player", "Sixth Man", "Starter", "All-Star", "All-NBA", "MVP", "Hall of Famer", "GOAT",
] as const;

export const RANK_COLORS: Record<string, string> = {
  "Rookie": "#8a8f98",
  "Role Player": "#7fb2e5",
  "Sixth Man": "#4f9de0",
  "Starter": "#2fc762",
  "All-Star": "#ff6a1a",
  "All-NBA": "#ff8a3d",
  "MVP": "#ffd166",
  "Hall of Famer": "#c084fc",
  "GOAT": "#f5f3ef",
};

const ROMAN = ["", "I", "II", "III"];

/** "All-Star II" for ranks with divisions, the bare name otherwise. */
export function rankLabel(rank: string, division?: number | null): string {
  return division ? `${rank} ${ROMAN[division] ?? ""}`.trim() : rank;
}

export function rankIndex(rank: string): number {
  return Math.max(0, RANK_ORDER.indexOf(rank as (typeof RANK_ORDER)[number]));
}

/** The rank-up share line (navigator.share / clipboard). */
export function shareText(rank: string): string {
  return `I just made ${rank} on Swish Quest 🏀 Think you know the NBA better? Play free at swishquest.com`;
}
```

Run `node --experimental-strip-types scripts/test-ranks.mjs` → pass.

- [ ] **Step 3: Profile card** — `src/components/UserProfile.tsx`. Add imports `import { Chip, ProgressBar } from "./ui";` and `import { rankLabel } from "../utils/ranks";`. Replace the `pc-stats` block (lines 131-141) with:

```tsx
            <div className="pc-stats">
              <div className="pc-stat">
                <span className="pc-stat-lbl">Points</span>
                <span className="font-display tnum pc-stat-num is-brand">{user?.points}</span>
              </div>
              <span className="pc-stat-divider" aria-hidden="true" />
              <div className="pc-stat">
                <span className="pc-stat-lbl">Rank</span>
                <span className="font-display pc-stat-num">{rankLabel(user?.rank ?? "Rookie", user?.rank_progress?.division)}</span>
              </div>
            </div>

            {/* Next rank + streak. A cached /me/ from before progression existed has no rank_progress:
                the bar simply waits for the next fetch (every field is optional). */}
            {user?.rank_progress && (
              <div className="pc-progress">
                <ProgressBar value={user.rank_progress.progress_pct} max={100} label="Progress to the next rank" />
                <span className="pc-progress-note tnum">
                  {user.rank_progress.next_rank
                    ? `${user.rank_progress.points_to_next.toLocaleString()} pts to ${user.rank_progress.next_rank}` +
                      (user.rank_progress.days_to_next > 0
                        ? ` · ${user.rank_progress.days_to_next} more active ${user.rank_progress.days_to_next === 1 ? "day" : "days"}`
                        : "")
                    : "Top of the ladder"}
                </span>
              </div>
            )}
            <div className="pc-badges">
              {typeof user?.streak_days === "number" && (
                <Chip>🔥 {user.streak_days}-day streak{user.streak_freezes ? ` · ${user.streak_freezes} freeze` : ""}</Chip>
              )}
              {user?.founding_member && <Chip variant="brand">Founding Member</Chip>}
            </div>
```

(`Chip` takes `variant="brand"` — see its use in `MiniGame.tsx:416`.) Add to `src/styles/LandPage.css` after `.pc-stat-num.is-brand { … }`:

```css
.pc-progress { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 6px; }
.pc-progress-note { font-size: 11.5px; color: var(--muted); }
.pc-badges { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; }
```

Check `.pc-grid` in the same stylesheet: if it is not a CSS grid, drop the `grid-column` lines and let the two blocks flow full-width (match whatever layout `.pc-settings` uses, which already spans the card).

In `src/views/ProfileSettings.tsx:189`: `{user.rank}` → `{rankLabel(user.rank, user.rank_progress?.division)}` with the import.

- [ ] **Step 4: Rank-up modal** — `src/context/ModalContext.tsx`: add `"rankUp"` to `ModalKind`, `import type { PendingRankUp } from "../store/userSlice";`, `export type RankUpPayload = PendingRankUp;` and add it to the `ModalPayload` union.

Create `src/components/modals/RankUpModal.tsx`:

```tsx
import { useRef, useState } from "react";
import copy from "copy-to-clipboard";
import { motion } from "framer-motion";
import { Button } from "../ui";
import SwapText from "../motion/SwapText";
import { RANK_COLORS, rankLabel, shareText } from "../../utils/ranks";

interface RankUpModalProps {
  from: string;
  to: string;
  division: number | null;
  onClose: () => void;
}

/** The rank-up moment: shown once per promotion (ModalHost opens it from user.pendingRankUp) after the
 *  game's own result, with a one-tap share. */
export default function RankUpModal({ from, to, division, onClose }: RankUpModalProps) {
  const [shared, setShared] = useState(false);
  const timer = useRef<number | null>(null);
  const share = async () => {
    const text = shareText(to);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text });
        return;
      }
    } catch {
      /* dismissed the sheet: fall through to the clipboard */
    }
    copy(text);
    setShared(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShared(false), 1600);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, textAlign: "center" }}>
      <motion.div
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 260, damping: 18 }}
        className="font-display"
        style={{ width: 96, height: 96, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, color: "#101010", background: RANK_COLORS[to] ?? "var(--brand)" }}
        aria-hidden="true"
      >
        ★
      </motion.div>
      <h2 className="font-display" style={{ fontSize: 26 }}>{rankLabel(to, division)}</h2>
      <p style={{ fontSize: 13.5, color: "var(--muted)", maxWidth: 300, lineHeight: 1.5 }}>
        {from} → {to}. Keep playing a game a day to climb the ladder.
      </p>
      <div style={{ display: "flex", gap: 10, marginTop: 10, width: "100%" }}>
        <Button block onClick={share}><SwapText>{shared ? "Copied!" : "Share"}</SwapText></Button>
        <Button block variant="secondary" onClick={onClose}>Keep playing</Button>
      </div>
    </div>
  );
}
```

`src/components/ModalHost.tsx`: import `RankUpModal`, `type RankUpPayload`, `useDispatch`/`useSelector`, `RootState`, `clearRankUp`. Add after the answer-review effect:

```tsx
  // A promotion waits in the store until nothing else is open, then shows once (a beat after the
  // game's own result so the score lands first).
  const pendingRankUp = useSelector((s: RootState) => s.user.pendingRankUp);
  const reduxDispatch = useDispatch();
  const { open } = useModal();
  useEffect(() => {
    if (!pendingRankUp || kind !== null) return;
    const id = window.setTimeout(() => {
      open("rankUp", pendingRankUp);
      reduxDispatch(clearRankUp());
    }, 1200);
    return () => window.clearTimeout(id);
  }, [pendingRankUp, kind, open, reduxDispatch]);
```

(`useModal()` is already called at the top for `kind, payload, close` — add `open` to that destructuring instead of calling it twice.) Add the render branch:

```tsx
  } else if (kind === "rankUp") {
    const p = payload as RankUpPayload | undefined;
    title = "Rank up!";
    content = p ? <RankUpModal from={p.from} to={p.to} division={p.division} onClose={close} /> : null;
  }
```

- [ ] **Step 5: Leaderboard: rank names + weekly scope**

`src/hooks/useLeaderboard.ts`: `export type LeaderboardScope = "global" | "weekly" | "friends";`; `caches`/`fetching` gain `weekly: null` / `weekly: false`; `const qs = scope === "global" ? "" : \`?scope=${scope}\`;`; the row map adds `rankName: u.rank,` (type the row as `{ username: string; id?: string; points: number; rank?: string }`); line 127 → `rank: cache?.userRank ?? 0,` (the old `Number(user.rank)` was always 0 — rank is a name).

`src/constants/leaderboard.ts`: scopes `[{ key: "global", label: "Global" }, { key: "weekly", label: "This week" }, { key: "friends", label: "Friends" }]`; export `GUEST_LEADERBOARD_SCOPES = LEADERBOARD_SCOPES.filter((s) => s.key !== "friends");`; add `rankName?: string;` to `LeaderRow`.

`src/components/Leaderboard.tsx`: the heading `SwapText` → `{scope === "friends" ? "Friends Leaderboard" : scope === "weekly" ? "This Week" : "Global Top 100"}`; the scope row renders for everyone with `options={loggedIn ? LEADERBOARD_SCOPES : GUEST_LEADERBOARD_SCOPES}` (remove the `loggedIn &&` guard; import `GUEST_LEADERBOARD_SCOPES`); the empty state copy → `{scope === "weekly" ? "No games this week yet." : "No players yet."}`; under the name, line 95 → `{(u.id || u.rankName) && <span className="tnum" style={{ fontSize: 10, fontWeight: 600, color: "var(--muted)" }}>{[u.id && \`#${u.id}\`, u.rankName].filter(Boolean).join(" · ")}</span>}`.

`src/components/modals/LeaderboardModal.tsx`: same scope-row change (`GUEST_LEADERBOARD_SCOPES` for guests), the head copy → `{scope === "friends" ? "You and your friends" : scope === "weekly" ? "Points since Monday" : "Top players worldwide"}`, and the row's id line gets the rank name the same way as the card. `ModalHost.tsx:77`: title → `leaderboardScope === "friends" ? "Friends leaderboard" : leaderboardScope === "weekly" ? "This week" : "Global Top 100"`.

- [ ] **Step 6: Guest carry-over** — `src/utils/guestPoints.ts`: add

```ts
/** After signup: the total was credited to the new account (users.views.apply_guest_points), so drop it here. */
export function clearGuestPoints(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing was stored
  }
}
```

and update the header comment: "…is sent once, at signup, so the new account starts with it (capped server-side)". `src/components/LogInSignUp.tsx`: import `{ readGuestPoints, clearGuestPoints }`; line 309 body gains `guest_points: readGuestPoints(),`; line 388 and 421 (`sendGoogle({...})`) gain `guest_points: readGuestPoints()` in the object; after `dispatch(login(data.user));` in both the signup success path (line 320) and the Google success path (find `dispatch(login(data.user))` in `sendGoogle`), call `clearGuestPoints();`.

`src/components/GuestPanel.tsx`: `PERKS = ["Keep the points you score", "Daily streaks & rank progress", "1v1 online multiplayer"]`; the >0 copy → `You've scored <strong …>{guestPoints} pts</strong> as a guest. Sign up now to keep them, claim a rank, and play head-to-head online.`; the 0 copy → `"Sign up to keep the points you score, build a streak, and play head-to-head online."`.

- [ ] **Step 7: Verify**

Run: `node --experimental-strip-types scripts/test-ranks.mjs` → pass. `npx next typegen && npx tsc --noEmit` → clean. `npm run lint` → pass. `npm run build` → succeeds.

Browser pass (`npm run dev`, then the `run` skill or `npm run chrome:debug`): sign in with a local account, finish a Series Winner game → the result shows, ~1 s later "Rank up!" (first play crosses 100), Share copies text; the profile card shows the bar, "N pts to …", the streak chip; the leaderboard shows "This week" with the rank name under the row; as a guest, the GuestPanel shows the new copy and the scope tabs show Global / This week only.

- [ ] **Step 8: Commit**

```bash
git add src scripts package.json
git commit -m "profile progress bar, streak chip, rank names on boards, weekly tab, rank-up share modal, guest carry-over"
```

---

### Task 7: Docs and constraints

**Files:**
- Modify: `docs/constraints/AUTH_CONSTRAINTS.md:167-193` (AUTH-6), `:195-210` (AUTH-7 mention of caps)
- Modify: `docs/GAME_DESIGN_CONSTRAINTS.md:458-465` (Rule 9.1 numbers), `:480-482` (accepted deviations: Who Would Win numbers)
- Modify: `docs/constraints/MULTIPLAYER_CONSTRAINTS.md` (search "225", "pointsAwarded", "MAX_SCORE")
- Modify: `../swish-quest-marketing-project-instructions.md` lines 113-133 (the marketing brief lives one directory above the repo, in `nba-projects/`; edit it in place, it is not under git)
- Modify: `docs/ARCHITECTURE.md` only if it lists the award endpoints' response shape (grep "log-session")

- [ ] **Step 1: AUTH-6** — rewrite the paragraph to: `trivia.awarding.award` is the only writer of `points`, `rank`, `active_days`, `last_active_day`, `streak_*`; callers `log_session` and `multiplayer_result` clamp with `awarding.clamp_score` (per-game `GAME_MAX_POINTS`, online Wordle `MATCH_MAX_POINTS`); the award applies the daily soft cap (1,500 full / 1,500 half / 10 %), the +100 first-scoring-game bonus and streak milestones; the response is the receipt `{awarded, points, rank, rank_up, progress, streak, first_game_bonus, streak_bonus}` which `userSlice.applyAward` applies; `CustomUser.update_rank()` uses `users.ranks.rank_for(points, active_days)` (table in the spec); `users.views.apply_guest_points` is the one other write, capped at 1,000, signup only. Replace the `✅ RIGHT` code block with the two-line `log_session` tail (`score = awarding.clamp_score(...)` / `return JsonResponse({'ok': True, **awarding.award(...)})`). Remove the "updateRank is defined but never dispatched" sentence (still true, but no longer worth a constraint line) — keep it if the constraint-id checker (`npm run check:ids`) references that sentence; run `npm run check:ids` after editing.

- [ ] **Step 2: AUTH-7** — "clamps with the same per-game caps" stays; add that the relay forwards the receipt as `pointsAwarded` and the browser applies it with `applyAward`.

- [ ] **Step 3: Rule 9.1** — "Aim for about 50 points per correct answer and 100–300 per session." → "Aim for about 20 points per correct answer and 100–200 per session (a perfect game 100–200; the daily Wordle's 500 is the one jackpot). The backend caps each game at its `maxPoints` (`trivia/awarding.py GAME_MAX_POINTS`): change both together." In the deviations table, Who Would Win: "20 with the crowd, 5 against" → "10 with the crowd, 5 against".

- [ ] **Step 4: Multiplayer constraints** — update any "225 / 150 / 90" to "200 / 120 / 30" and the `pointsAwarded` payload description.

- [ ] **Step 5: Marketing brief** — lines 113-115: Who Would Win? is available 1v1 (remove "not Who Would Win?"); line 129: "Points: about 20 per correct answer, a good game ≈ 100, a perfect one 100–200, the daily Wordle up to 500; +100 for the first game of the day; streaks pay at day 7/30/100; a weekly board resets Monday."; lines 131-133: the new ladder with its day gates — "Rookie (0) → Role Player (100) → Sixth Man (500) → Starter (1,500 · 3 days) → All-Star (5,000 · 7 days) → All-NBA (15,000 · 20 days) → MVP (40,000 · 45 days) → Hall of Famer (80,000 · 90 days) → **GOAT (150,000 · 180 active days)**; divisions III/II/I from All-Star up; ranks never drop."

- [ ] **Step 6: Verify and commit**

Run: `npm run lint` (covers `check:ids` and `check:legal`) → pass.

```bash
git add docs
git commit -m "docs: progression v2 constraints and rules"
```

(The marketing brief is outside the repo; just report that it was edited.)

---

### Task 8: Whole-branch verification and PR to dev

- [ ] **Step 1:** From `backend/`: full `manage.py test --noinput` → pass. From the worktree root: `npm run lint && npx next typegen && npx tsc --noEmit && npm run build` → pass; `node --experimental-strip-types scripts/test-game-scoring.mjs && … test-www-points.mjs && … test-ranks.mjs && … test-award.mjs` → pass. From `multiplayer_server/`: `npm ci && npm test` → pass (TTT constants are not asserted; the run proves nothing else broke).
- [ ] **Step 2:** `git fetch origin dev && git rebase origin/dev` (resolve conflicts if `dev` moved), re-run typecheck.
- [ ] **Step 3:** `git push -u origin feat/ranks-progression`; `gh pr create --base dev --title "Progression v2: rebalanced points, points+days rank ladder, streaks, weekly board" --body-file docs/superpowers/specs/2026-10-16-progression-design.md` (`gh` on the `stefanroman22` account); `gh pr checks <n> --watch`; `gh pr merge <n> --merge --delete-branch`. Stop at `dev`: no promotion to `main`. The backend migrations run on the next backend deploy (manual, per `docs/DEPLOYMENT.md`) — say so in the report.
