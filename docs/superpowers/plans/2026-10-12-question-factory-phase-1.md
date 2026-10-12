# Question Factory — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-set fame tier with a computed fame score as the eligibility gate for Who Are Ya, Contexto and Career Path; make the game-data publish hold back a game that falls below its minimum instead of failing every game; and journal every supply run's decisions so the improvement loop has history from day one.

**Architecture:** A pure `trivia/questions/fame.py` computes a score and a band (STAR/KNOWN/DEEP/OBSCURE) from a curated row; the hand-set `fame_tier` only ever raises a band, so every new eligibility rule is a superset of today's. `runner.maintain(..., isolate=True)` wraps each game in its own savepoint; `publish_game_data_v3` drops held-back games from the run (their live manifest entries carry over) and reports them through `$GITHUB_OUTPUT`, which turns the workflow red after everything else has shipped. A `Journal` collects decisions in memory during the run and is written to two new tables (`FactoryRun`, `FactoryEvent`) after the run's transaction, so rolled-back and failed runs are on record too.

**Tech Stack:** Django 5.1, Python 3.13, Django `TestCase`/`SimpleTestCase`, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-12-question-factory-design.md` (§4.2 fame score, §4.5 isolation, §4.8 journal, §7 phase 1).

## Global Constraints

- The curated row schema is FROZEN (contract #1, `backend/trivia/data_pipeline/curated_players.py`): do not add, rename or remove row fields. The fame score is computed, never stored.
- Journal events are collected in memory and persisted only after the run's transaction has committed or rolled back (spec §4.8); journaling must never change what maintenance does.
- Fame formula, thresholds and tier floor exactly as spec §4.2: STAR ≥ 40, KNOWN ≥ 18, DEEP ≥ 10; tier 1 ⇒ ≥ STAR, tier 2 ⇒ ≥ KNOWN, tier 3 ⇒ ≥ DEEP; `fame.VERSION = 1`.
- Eligibility: Who Are Ya = KNOWN or better + ≥ 1 stint; Contexto secret = KNOWN or better; Career Path = 3–7 stints + DEEP or better, weight 3 for KNOWN/DEEP and 1 for STAR.
- Legacy `backend/trivia/games/*` modules are out of scope; do not touch them.
- Surgical changes, match existing style; remove only what your change orphans.
- Run backend tests from `backend/` with `$env:DATABASE_URL=""` (sqlite fallback). On the owner's PC the interpreter with Django is `C:\Users\stefa\AppData\Local\Programs\Python\Python313\python.exe` (the `nba-projects\venv` has no Django); below it is written as `python`.
- Commit messages: one plain line, no `Co-Authored-By` or AI attribution. Use the PowerShell tool for `git commit`.
- Ship to `dev` only (PR, checks, merge). Promotion to production and a non-dry-run publish happen only when the owner asks. **Phase 1 must be in production before 2026-11-20**, when Contexto runs out of scheduled days.

## Review Focus

1. A row with `awards`/`career` missing or `null` (roster-only rows) must score 0, never crash — pinned in Task 1.
2. A `fame_tier` that is missing, `None` or not an int must be ignored, never lower or crash — pinned in Task 1.
3. A live question whose player drops below the band after a data refresh must be retired with a readable reason, not crash maintenance — pinned in Tasks 2–4 (`materialize` raises `Invalid` with the band in the message).
4. Every question game held back in the same run must still exit cleanly, publish the rest (question-names) and report all of them — pinned in Task 6.
5. A dry run with a held-back game must report it and write nothing — pinned in Task 6.
6. A run that fails or rolls back must still leave a journal entry saying so, and events of a held-back game must be marked as rolled back — pinned in Task 7.

---

### Task 1: Fame score module

**Files:**
- Create: `backend/trivia/questions/fame.py`
- Test: `backend/trivia/tests/test_questions_fame.py`

**Interfaces:**
- Produces: `fame.VERSION: int`, band constants `fame.STAR=1`, `fame.KNOWN=2`, `fame.DEEP=3`, `fame.OBSCURE=4`, `fame.fame_score(row: dict) -> float`, `fame.fame_band(row: dict) -> int`, `fame.at_least(row: dict, band: int) -> bool`.

- [ ] **Step 1: Write the failing tests**

```python
# backend/trivia/tests/test_questions_fame.py
import json
import os

from django.test import SimpleTestCase

from trivia.data_pipeline.curated_players import playable_rows
from trivia.questions import fame

SHIPPED = os.path.join(os.path.dirname(__file__), "..", "data_static", "players_curated.json")


class FameScoreTests(SimpleTestCase):
    def test_empty_and_null_rows_score_zero(self):
        self.assertEqual(fame.fame_score({}), 0.0)
        self.assertEqual(fame.fame_score({"awards": None, "career": None}), 0.0)
        self.assertEqual(fame.fame_band({}), fame.OBSCURE)

    def test_weights(self):
        row = {"awards": {"allstar_count": 10, "mvp": [2000, 2001]}, "career": {}}
        self.assertEqual(fame.fame_score(row), 60.0)
        self.assertEqual(fame.fame_score({"awards": {"roty": 2004}}), 3.0)

    def test_caps(self):
        row = {"awards": {"allstar_count": 22, "allnba_count": 21, "rings": [1, 2, 3, 4, 5, 6, 7]},
               "career": {"pts": 43440, "seasons": 23}}
        self.assertEqual(fame.fame_score(row), 145.0)  # 60 + 45 + 5 + 25 + 10

    def test_band_edges(self):
        known = {"career": {"pts": 12000, "seasons": 12}}  # 12 + 6 = 18.0
        self.assertEqual(fame.fame_band(known), fame.KNOWN)
        deep = {"career": {"pts": 11900, "seasons": 12}}  # 17.9
        self.assertEqual(fame.fame_band(deep), fame.DEEP)
        self.assertEqual(fame.fame_band({"awards": {"allstar_count": 10}}), fame.STAR)  # 40.0

    def test_tier_is_a_floor_that_never_lowers(self):
        self.assertEqual(fame.fame_band({"fame_tier": 1}), fame.STAR)
        self.assertEqual(fame.fame_band({"fame_tier": 2}), fame.KNOWN)
        self.assertEqual(fame.fame_band({"fame_tier": 3}), fame.DEEP)
        star = {"fame_tier": 4, "awards": {"allstar_count": 10}}
        self.assertEqual(fame.fame_band(star), fame.STAR)

    def test_unexpected_tier_values_are_ignored(self):
        for tier in (None, 0, "2", 9):
            self.assertEqual(fame.fame_band({"fame_tier": tier}), fame.OBSCURE, tier)

    def test_at_least(self):
        row = {"fame_tier": 2}
        self.assertTrue(fame.at_least(row, fame.KNOWN))
        self.assertTrue(fame.at_least(row, fame.DEEP))
        self.assertFalse(fame.at_least(row, fame.STAR))


class ShippedCalibrationTests(SimpleTestCase):
    """Pins the bands against the real dataset (measured 2026-10-12: STAR 177,
    KNOWN+ 501, DEEP+ 1,038 of 4,900 playable). The ranges leave room for a data
    refresh; a failure here means the weights or the data moved a lot."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with open(SHIPPED, encoding="utf-8") as f:
            cls.rows = playable_rows(json.load(f))
        cls.by_name = {r["full_name"]: r for r in cls.rows}

    def test_band_sizes(self):
        bands = [fame.fame_band(r) for r in self.rows]
        self.assertTrue(150 <= bands.count(fame.STAR) <= 230, bands.count(fame.STAR))
        known = sum(b <= fame.KNOWN for b in bands)
        self.assertTrue(450 <= known <= 600, known)
        deep = sum(b <= fame.DEEP for b in bands)
        self.assertTrue(900 <= deep <= 1200, deep)

    def test_named_anchors(self):
        self.assertEqual(fame.fame_band(self.by_name["LeBron James"]), fame.STAR)
        self.assertTrue(fame.at_least(self.by_name["John Wall"], fame.KNOWN))
        self.assertEqual(fame.fame_band(self.by_name["Kyle Korver"]), fame.KNOWN)
        self.assertEqual(fame.fame_band(self.by_name["Brian Scalabrine"]), fame.OBSCURE)

    def test_every_tier_1_2_player_is_known_or_better(self):
        missing = [r["full_name"] for r in self.rows
                   if r.get("fame_tier") in (1, 2) and not fame.at_least(r, fame.KNOWN)]
        self.assertEqual(missing, [])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend; $env:DATABASE_URL=""; python manage.py test trivia.tests.test_questions_fame`
Expected: ERROR, `ImportError: cannot import name 'fame' from 'trivia.questions'`.

- [ ] **Step 3: Write the module**

```python
# backend/trivia/questions/fame.py
"""Fame score: how recognizable a player is, computed from his curated row.

The gate the question games use to pick players a fan can actually name
(docs/superpowers/specs/2026-10-12-question-factory-design.md §4.1). The row
schema is frozen, so the score is computed here and never stored. The
hand-set fame_tier stays as an editorial floor: it can raise a player's band
(a young star with no honours yet), never lower it.
"""

VERSION = 1

STAR, KNOWN, DEEP, OBSCURE = 1, 2, 3, 4  # lower is more famous, like fame_tier
THRESHOLDS = ((STAR, 40.0), (KNOWN, 18.0), (DEEP, 10.0))
_TIER_FLOOR = {1: STAR, 2: KNOWN, 3: DEEP}


def fame_score(row):
    a = row.get("awards") or {}
    c = row.get("career") or {}
    score = (
        4 * min(a.get("allstar_count") or 0, 15)
        + 3 * min(a.get("allnba_count") or 0, 15)
        + 10 * len(a.get("mvp") or [])
        + 6 * len(a.get("fmvp") or [])
        + 3 * len(a.get("dpoy") or [])
        + (3 if a.get("roty") else 0)
        + 2 * len(a.get("smoy") or [])
        + min(len(a.get("rings") or []), 5)
        + min((c.get("pts") or 0) / 1000, 25)
        + 0.5 * min(c.get("seasons") or 0, 20)
    )
    return round(score, 1)


def fame_band(row):
    score = fame_score(row)
    band = next((b for b, t in THRESHOLDS if score >= t), OBSCURE)
    return min(band, _TIER_FLOOR.get(row.get("fame_tier"), OBSCURE))


def at_least(row, band):
    return fame_band(row) <= band
```

Note on `"2"`: `_TIER_FLOOR.get("2")` misses because the key is the int 2, which is the intended "ignore anything that is not a real tier" behaviour.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_questions_fame`
Expected: `Ran 10 tests` … `OK`.

- [ ] **Step 5: Commit**

```powershell
git add backend/trivia/questions/fame.py backend/trivia/tests/test_questions_fame.py
git commit -m "feat(questions): computed fame score and bands"
```

---

### Task 2: Who Are Ya on fame bands

**Files:**
- Modify: `backend/trivia/questions/games/who_are_ya.py` (docstring, constants, `_eligible`, `materialize` message)
- Modify: `backend/trivia/tests/test_questions_mystery.py` (`WhoAreYaTests`)
- Modify: `.claude/skills/nba-question-writer/references/games/who-are-ya.md`

**Interfaces:**
- Consumes: `fame.KNOWN`, `fame.at_least`, `fame.fame_band` (Task 1).
- Produces: `who_are_ya.MIN_FAME_BAND = fame.KNOWN` (replaces `ELIGIBLE_FAME_TIERS`, which nothing else imports).

- [ ] **Step 1: Replace `WhoAreYaTests` with the new rule**

In `backend/trivia/tests/test_questions_mystery.py`, add `from trivia.questions import fame` to the imports and replace the whole `WhoAreYaTests` class with:

```python
class WhoAreYaTests(SimpleTestCase):
    def _ids(self, ds):
        return {d["person_id"] for d in who_are_ya.generate(ds, set(), random.Random(1), 10_000)}

    def test_generate_is_known_band_or_better(self):
        ds = fixture_dataset()
        ids = self._ids(ds)
        self.assertTrue(ids)
        self.assertTrue(all(fame.at_least(ds.by_id[i], fame.KNOWN) for i in ids))
        self.assertIsNone(who_are_ya.TARGET)

    def test_every_tier_1_2_player_is_still_eligible(self):
        ds = fixture_dataset()
        tier12 = {r["person_id"] for r in ds.playable if r["fame_tier"] in (1, 2)}
        self.assertLessEqual(tier12, self._ids(ds))

    def test_widens_beyond_tier_1_2(self):
        ds = fixture_dataset()
        self.assertTrue(any(ds.by_id[i]["fame_tier"] in (3, 4) for i in self._ids(ds)))

    def test_materialize_rejects_band_drop(self):
        ds = fixture_dataset()
        deep = next(r for r in ds.playable if not fame.at_least(r, fame.KNOWN))
        with self.assertRaises(Invalid) as ctx:
            who_are_ya.materialize({"person_id": deep["person_id"]}, ds)
        self.assertIn("fame band", str(ctx.exception))
```

- [ ] **Step 2: Run them to verify the new ones fail**

Run: `python manage.py test trivia.tests.test_questions_mystery.WhoAreYaTests`
Expected: FAIL in `test_widens_beyond_tier_1_2` (no tier 3/4 ids) and `test_materialize_rejects_band_drop` (message says "fame tier").

- [ ] **Step 3: Implement**

Replace the top of `backend/trivia/questions/games/who_are_ya.py` (docstring through `_eligible`) with:

```python
"""Who Are Ya — one recognizable mystery player (fame band KNOWN or better,
trivia.questions.fame). Rules moved from trivia/games/who_are_ya.py; the gate
moved from fame_tier 1-2 to fame bands in question-factory phase 1 (the tier
is a floor, so every tier 1-2 player stays eligible). TARGET None = every
eligible player gets a question."""
from trivia.questions import fame
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "who-are-ya"
TARGET = None
MINIMUM = 30
MIN_FAME_BAND = fame.KNOWN


def _eligible(row):
    return fame.at_least(row, MIN_FAME_BAND) and bool(row.get("teams"))
```

In `materialize`, replace the tier message line:

```python
    if not _eligible(row):
        raise Invalid(f"{row['full_name']} is fame band {fame.fame_band(row)}; need {MIN_FAME_BAND} or better")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_questions_mystery`
Expected: `OK`.

- [ ] **Step 5: Update the game reference**

In `.claude/skills/nba-question-writer/references/games/who-are-ya.md`:
- Replace `- Eligible: fame tier 1-2 and at least one team stint.` with
  `- Eligible: fame band KNOWN or better (\`trivia/questions/fame.py\`; fame_tier 1-2 always qualifies) and at least one team stint. About 500 players.`
- Replace the bullet starting `- Only famous players belong here.` (two lines) with
  `- Only recognizable players belong here. A deep cut makes 8 guesses feel unfair; widen or narrow the pool by changing \`MIN_FAME_BAND\` or the fame weights, never by hand-picking players.`

- [ ] **Step 6: Commit**

```powershell
git add backend/trivia/questions/games/who_are_ya.py backend/trivia/tests/test_questions_mystery.py .claude/skills/nba-question-writer/references/games/who-are-ya.md
git commit -m "feat(who-are-ya): pick mystery players by fame band, ~500 eligible"
```

---

### Task 3: Contexto secrets on fame bands

**Files:**
- Modify: `backend/trivia/questions/games/contexto.py` (imports, constant, `generate` candidates, `materialize` check)
- Modify: `backend/trivia/tests/test_questions_contexto.py`
- Modify: `.claude/skills/nba-question-writer/references/games/contexto.md`

**Interfaces:**
- Consumes: `fame.KNOWN`, `fame.at_least`, `fame.fame_band` (Task 1).
- Produces: `contexto.MIN_SECRET_BAND = fame.KNOWN` (replaces `SECRET_FAME_TIERS`, which nothing else imports).

- [ ] **Step 1: Update and add tests**

In `backend/trivia/tests/test_questions_contexto.py` add the imports

```python
import json
import os

from trivia.data_pipeline.curated_players import playable_rows
from trivia.questions import fame
from trivia.questions.base import Invalid
```

replace line 20 (`self.assertTrue(all(ds.by_id[d["secret_person_id"]]["fame_tier"] in (1, 2) for d in defs))`) with

```python
        self.assertTrue(all(fame.at_least(ds.by_id[d["secret_person_id"]], fame.KNOWN) for d in defs))
```

and add these methods to `ContextoQuestionTests` (the module is imported as `ctx` at the top of this file, so the exception context is named `raised` to avoid shadowing it):

```python
    def test_materialize_rejects_an_obscure_secret(self):
        ds = fixture_dataset()
        obscure = next(r for r in ds.playable if not fame.at_least(r, fame.KNOWN))
        with self.assertRaises(Invalid) as raised:
            ctx.materialize({"secret_person_id": obscure["person_id"], "day": "2026-09-12"}, ds)
        self.assertIn("fame band", str(raised.exception))

    def test_shipped_data_has_a_year_of_secrets(self):
        path = os.path.join(os.path.dirname(__file__), "..", "data_static", "players_curated.json")
        with open(path, encoding="utf-8") as f:
            rows = playable_rows(json.load(f))
        self.assertGreaterEqual(sum(1 for r in rows if fame.at_least(r, fame.KNOWN)), 365)
```

- [ ] **Step 2: Run them to verify the new ones fail**

Run: `python manage.py test trivia.tests.test_questions_contexto`
Expected: FAIL in `test_materialize_rejects_an_obscure_secret` (message says "fame tier"); `test_shipped_data_has_a_year_of_secrets` passes already (it measures data, not code).

- [ ] **Step 3: Implement**

In `backend/trivia/questions/games/contexto.py`:

```python
from trivia.questions import fame
from trivia.questions.base import Invalid, envelope
```

(add the `fame` import above the existing `base` import), replace `SECRET_FAME_TIERS = (1, 2)` with

```python
MIN_SECRET_BAND = fame.KNOWN  # ~500 candidates: a full year without a repeat
```

replace the candidates line in `generate` with

```python
    candidates = [r for r in dataset.playable if fame.at_least(r, MIN_SECRET_BAND) and r["person_id"] not in recent_secrets]
```

and the check in `materialize` with

```python
    if not fame.at_least(secret, MIN_SECRET_BAND):
        raise Invalid(f"{secret['full_name']} is fame band {fame.fame_band(secret)}; need {MIN_SECRET_BAND} or better")
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_questions_contexto trivia.tests.test_questions_similarity`
Expected: `OK` (similarity is untouched; its golden test must stay green).

- [ ] **Step 5: Update the game reference**

In `.claude/skills/nba-question-writer/references/games/contexto.md` replace `no secret repeats within 365 days. Secrets are fame tier 1-2.` with
`no secret repeats within 365 days. Secrets are fame band KNOWN or better (\`trivia/questions/fame.py\`), about 500 candidates.`

- [ ] **Step 6: Commit**

```powershell
git add backend/trivia/questions/games/contexto.py backend/trivia/tests/test_questions_contexto.py .claude/skills/nba-question-writer/references/games/contexto.md
git commit -m "feat(contexto): secrets by fame band so the schedule lasts a year"
```

---

### Task 4: Career Path on fame bands

**Files:**
- Modify: `backend/trivia/questions/games/career_path.py` (docstring, imports, constant, `_eligible`, `_weight`, `materialize` message, `validate` message)
- Modify: `backend/trivia/tests/test_questions_mystery.py` (`CareerPathTests`)
- Modify: `.claude/skills/nba-question-writer/references/games/career-path.md`

**Interfaces:**
- Consumes: `fame.DEEP`, `fame.KNOWN`, `fame.at_least`, `fame.fame_band` (Task 1).
- Produces: `career_path.MIN_FAME_BAND = fame.DEEP`. `MIN_STINTS`, `MAX_STINTS` unchanged.

Expected production effect: about 250 of the 500 live Career Path questions (players under DEEP) retire on the next maintenance run and are replaced from ~685 eligible players in the same run. Intended.

- [ ] **Step 1: Add tests**

In `backend/trivia/tests/test_questions_mystery.py` (make sure `from trivia.questions import fame` is imported; Task 2 adds it), add to `CareerPathTests`:

```python
    def test_generate_skips_obscure_journeymen(self):
        ds = fixture_dataset()
        defs = career_path.generate(ds, set(), random.Random(3), 10_000)
        self.assertTrue(defs)
        self.assertTrue(all(fame.at_least(ds.by_id[d["person_id"]], fame.DEEP) for d in defs))

    def test_materialize_rejects_an_obscure_journeyman(self):
        ds = fixture_dataset()
        obscure = next(r for r in ds.playable
                       if 3 <= len(r["teams"]) <= 7 and not fame.at_least(r, fame.DEEP))
        with self.assertRaises(Invalid) as raised:
            career_path.materialize({"person_id": obscure["person_id"]}, ds)
        self.assertIn("fame band", str(raised.exception))

    def test_weight_favours_known_and_deep_over_stars(self):
        ds = fixture_dataset()
        for d in career_path.generate(ds, set(), random.Random(4), 10_000):
            row = ds.by_id[d["person_id"]]
            m = career_path.materialize(d, ds)
            expected = 3 if fame.fame_band(row) in (fame.KNOWN, fame.DEEP) else 1
            self.assertEqual(career_path.index_item(d, m)[1], expected)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python manage.py test trivia.tests.test_questions_mystery.CareerPathTests`
Expected: FAIL in `test_generate_skips_obscure_journeymen` and `test_materialize_rejects_an_obscure_journeyman` (the fixture has 31 obscure journeymen with 3–7 stints).

- [ ] **Step 3: Implement**

Replace the top of `backend/trivia/questions/games/career_path.py` (docstring through `_weight`) with:

```python
"""Career Path — one mystery journeyman (3-7 stints, fame band DEEP or better),
weighted toward KNOWN/DEEP players over stars. Rules moved from
trivia/games/career_path.py; the fame gate was added in question-factory phase 1
(players nobody can name are no longer eligible)."""
from trivia.questions import fame
from trivia.questions.base import Invalid, envelope
from trivia.questions.hashing import content_hash

SLUG = "career-path"
# 2026-09-30: raised from 300 (expand-question-pools); eligible pool comfortably larger, see docs/team/designs/2026-09-30-expand-question-pools.md
TARGET = 500
MINIMUM = 50
MIN_STINTS, MAX_STINTS = 3, 7
MIN_FAME_BAND = fame.DEEP


def _eligible(row):
    return MIN_STINTS <= len(row.get("teams") or []) <= MAX_STINTS and fame.at_least(row, MIN_FAME_BAND)


def _weight(row):
    return 3 if fame.fame_band(row) in (fame.KNOWN, fame.DEEP) else 1
```

In `materialize`, replace the stint message:

```python
    if not _eligible(row):
        raise Invalid(f"{row['full_name']} has {len(row['teams'])} stints and fame band {fame.fame_band(row)}; "
                      f"need {MIN_STINTS}-{MAX_STINTS} stints and band {MIN_FAME_BAND} or better")
```

In `validate`, replace `problems.append("stint count out of range")` with `problems.append("stint count or fame band out of range")`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_questions_mystery trivia.tests.test_questions_runner`
Expected: `OK`.

- [ ] **Step 5: Update the game reference**

In `.claude/skills/nba-question-writer/references/games/career-path.md` replace
`fame tier 2-3 weighted 3x so journeymen appear more than superstars.` with
`fame band DEEP or better (\`trivia/questions/fame.py\`); KNOWN/DEEP players weighted 3x so journeymen appear more than superstars.`

- [ ] **Step 6: Commit**

```powershell
git add backend/trivia/questions/games/career_path.py backend/trivia/tests/test_questions_mystery.py .claude/skills/nba-question-writer/references/games/career-path.md
git commit -m "feat(career-path): drop unguessable journeymen via fame band"
```

---

### Task 5: Isolated maintenance in the runner

**Files:**
- Modify: `backend/trivia/questions/runner.py` (`maintain`)
- Test: `backend/trivia/tests/test_questions_runner.py` (`RunnerTests`)

**Interfaces:**
- Produces: `runner.maintain(games, dataset, rng, now=None, out=print, isolate=False) -> (per_game, stats)`. With `isolate=True`, a game that raises `BelowMinimum` is rolled back alone, is absent from `per_game`, and has `stats[slug] == {"held_back": "<BelowMinimum message>"}`. Default behaviour is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `RunnerTests` in `backend/trivia/tests/test_questions_runner.py`:

```python
    def test_isolated_maintain_holds_back_only_the_failing_game(self):
        with mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 50):
            per_game, stats = runner.maintain(["career-path", "who-are-ya"], self.ds, self.rng,
                                              out=lambda *_: None, isolate=True)
        self.assertNotIn("career-path", per_game)
        self.assertEqual(stats["career-path"], {"held_back": "career-path: 5 active < minimum 50"})
        self.assertEqual(Question.objects.filter(game="career-path").count(), 0)
        self.assertTrue(per_game["who-are-ya"])
        self.assertTrue(Question.objects.filter(game="who-are-ya", status="active").exists())

    def test_maintain_without_isolate_still_raises(self):
        with mock.patch("trivia.questions.games.career_path.TARGET", 5), \
             mock.patch("trivia.questions.games.career_path.MINIMUM", 50):
            with self.assertRaises(runner.BelowMinimum):
                runner.maintain(["career-path"], self.ds, self.rng, out=lambda *_: None)
```

- [ ] **Step 2: Run them to verify the first fails**

Run: `python manage.py test trivia.tests.test_questions_runner`
Expected: `test_isolated_maintain_holds_back_only_the_failing_game` ERROR, `TypeError: maintain() got an unexpected keyword argument 'isolate'`.

- [ ] **Step 3: Implement**

Replace `maintain` in `backend/trivia/questions/runner.py` with:

```python
def maintain(games, dataset, rng, now=None, out=print, isolate=False):
    """Re-materialize, retire, top up and gate each game; no publishing.

    Returns ({slug: [(qid, index_item, materialized), ...]}, {slug: stats}).
    Writes to the questions table, so call it inside transaction.atomic(): a
    BelowMinimum (or any later failure in the caller's block) rolls every game's
    writes back. Used by run() (Supabase snapshot) and publish_game_data_v3.

    isolate=True (publish_game_data_v3): each game runs in its own savepoint. A
    game below its minimum is rolled back alone, left out of the result and
    reported as stats[slug] = {"held_back": reason}; the other games go on.
    """
    now = now or timezone.now()
    per_game, stats = {}, {}
    for slug in games:
        if not isolate:
            per_game[slug], stats[slug] = _process_game(slug, dataset, rng, now, out)
            continue
        try:
            with transaction.atomic():
                per_game[slug], stats[slug] = _process_game(slug, dataset, rng, now, out)
        except BelowMinimum as e:
            stats[slug] = {"held_back": str(e)}
            out(f"  {slug}: held back, {e}")
    return per_game, stats
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_questions_runner`
Expected: `OK`.

- [ ] **Step 5: Commit**

```powershell
git add backend/trivia/questions/runner.py backend/trivia/tests/test_questions_runner.py
git commit -m "feat(questions): isolate per-game maintenance in savepoints"
```

---

### Task 6: Publish holds back a failing game; the workflow turns red

**Files:**
- Modify: `backend/trivia/management/commands/publish_game_data_v3.py` (`handle`, module docstring)
- Modify: `backend/trivia/tests/test_publish_v3_questions.py` (`CommandTests`)
- Modify: `.github/workflows/publish-game-data.yml` (new last step)

**Interfaces:**
- Consumes: `runner.maintain(..., isolate=True)` and the `held_back` stats key (Task 5).
- Produces: `$GITHUB_OUTPUT` line `held_back=<comma-separated slugs, sorted>` (empty when none) on every non-check run; stdout warning `  warning: <slug> held back at its live version: <reason>`.

- [ ] **Step 1: Replace the all-or-nothing test and add the new ones**

In `CommandTests` (`backend/trivia/tests/test_publish_v3_questions.py`), delete `test_minimum_gate_aborts_with_nothing_published_and_rolls_back` and add:

```python
    def _gh_output(self):
        with open(os.path.join(self.tmp, "gh-output"), encoding="utf-8") as f:
            return f.read()

    def test_a_game_below_minimum_is_held_back_and_the_rest_publish(self):
        with patch("trivia.questions.games.contexto.MINIMUM", 10_000):
            output = self._call("--games", "career-path,contexto")
        self.assertIn("contexto held back", output)
        manifest = _load(self.out, "manifest.json")
        self.assertIn("career-path", manifest["games"])
        self.assertNotIn("contexto", manifest["games"])
        self.assertEqual(Question.objects.filter(game="contexto").count(), 0)  # its writes rolled back
        self.assertTrue(Question.objects.filter(game="career-path").exists())
        self.assertIn("held_back=contexto\n", self._gh_output())

    def test_a_held_back_game_keeps_its_live_entry(self):
        self._call("--games", "career-path,contexto")
        live = _load(self.out, "manifest.json")
        row = Question.objects.filter(game="career-path", status="active").first()
        row.status = "retired"  # forces a career-path change so the second run publishes
        row.save()
        second = os.path.join(self.tmp, "second")
        with patch("trivia.questions.games.contexto.MINIMUM", 10_000):
            call_command("publish_game_data_v3", "--out", second, "--rng-seed", "8",
                         "--games", "career-path,contexto",
                         "--previous", os.path.join(self.out, "manifest.json"), stdout=StringIO())
        manifest = _load(second, "manifest.json")
        self.assertEqual(manifest["games"]["contexto"], live["games"]["contexto"])
        self.assertNotEqual(manifest["games"]["career-path"], live["games"]["career-path"])

    def test_dry_run_reports_a_held_back_game_and_writes_nothing(self):
        with patch("trivia.questions.games.contexto.MINIMUM", 10_000):
            output = self._call("--games", "career-path,contexto", "--dry-run")
        self.assertIn("contexto held back", output)
        self.assertFalse(os.path.exists(self.out))
        self.assertEqual(Question.objects.count(), 0)

    def test_every_question_game_held_back_still_exits_cleanly(self):
        with patch("trivia.questions.games.contexto.MINIMUM", 10_000), \
             patch("trivia.questions.games.career_path.MINIMUM", 10_000):
            self._call("--games", "career-path,contexto")
        self.assertIn("held_back=career-path,contexto\n", self._gh_output())
        self.assertEqual(Question.objects.count(), 0)

    def test_no_held_back_games_writes_an_empty_output(self):
        self._call("--games", "career-path")
        self.assertIn("held_back=\n", self._gh_output())
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python manage.py test trivia.tests.test_publish_v3_questions.CommandTests`
Expected: the five new tests FAIL or ERROR (`CommandError: Publish aborted ... contexto: ... < minimum 10000`, or no `held_back=` line).

- [ ] **Step 3: Implement in the command**

In `handle` of `backend/trivia/management/commands/publish_game_data_v3.py`, replace

```python
                maintained, dataset = {}, None
                if to_maintain:
                    dataset = publish_v3.curated_dataset()
                    self.stdout.write(f"Question maintenance ({', '.join(to_maintain)}) against dataset "
                                      f"{dataset.version}: {len(dataset.playable)} playable players")
                    maintained, _ = runner.maintain(to_maintain, dataset, random.Random(opts["rng_seed"]),
                                                    out=self.stdout.write)
```

with

```python
                maintained, dataset, held_back = {}, None, []
                if to_maintain:
                    dataset = publish_v3.curated_dataset()
                    self.stdout.write(f"Question maintenance ({', '.join(to_maintain)}) against dataset "
                                      f"{dataset.version}: {len(dataset.playable)} playable players")
                    maintained, stats = runner.maintain(to_maintain, dataset, random.Random(opts["rng_seed"]),
                                                        out=self.stdout.write, isolate=True)
                    # A game below its minimum is held back: left out of this publish so
                    # its live manifest entry carries over, while every other game ships.
                    held_back = sorted(slug for slug, s in stats.items() if "held_back" in s)
                    games = [g for g in games if g not in held_back]
                    for slug in held_back:
                        self.stdout.write(self.style.WARNING(
                            f"  warning: {slug} held back at its live version: {stats[slug]['held_back']}"))
```

and replace

```python
        _github_output({"result": report["result"], "version": report["version"] or ""})
```

with

```python
        _github_output({"result": report["result"], "version": report["version"] or "",
                        "held_back": ",".join(held_back)})
```

In the module docstring, replace `in ONE transaction with every game's build: a gate or build failure rolls the maintenance back and writes nothing.` with
`in ONE transaction with every game's build: a build failure rolls the maintenance back and writes nothing. A game below its minimum is held back instead (its own writes rolled back, left out of the publish so its live entry carries over) and reported as held_back=<games> in $GITHUB_OUTPUT.`

Leave the `except runner.BelowMinimum` clause: `--skip-maintain` still raises it from the read-only builders, and that path stays all-or-nothing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_publish_v3_questions`
Expected: `OK` (including the unchanged `test_a_failing_pool_game_rolls_the_maintenance_back`).

- [ ] **Step 5: Turn the workflow red when a game is held back**

Append this step at the end of the `steps:` list in `.github/workflows/publish-game-data.yml` (after `Verify live data`):

```yaml
      - name: Fail if a game was held back
        if: steps.build.outputs.held_back != ''
        shell: bash
        env:
          HELD_BACK: ${{ steps.build.outputs.held_back }}
        run: |
          echo "::error::Held back at their last published version (below minimum): $HELD_BACK. Every other game was published."
          exit 1
```

- [ ] **Step 6: Commit**

```powershell
git add backend/trivia/management/commands/publish_game_data_v3.py backend/trivia/tests/test_publish_v3_questions.py .github/workflows/publish-game-data.yml
git commit -m "feat(publish): hold back a game below minimum instead of failing every game"
```

---

### Task 7: Run journal for supply runs

**Files:**
- Modify: `backend/trivia/models.py` (append `FactoryRun`, `FactoryEvent`)
- Create: `backend/trivia/migrations/<next>_factory_journal.py` (generated)
- Create: `backend/trivia/questions/journal.py`
- Modify: `backend/trivia/questions/runner.py` (`_materialize_row`, `_process_game`, `maintain`)
- Modify: `backend/trivia/management/commands/publish_game_data_v3.py` (`add_arguments`, `handle`, imports)
- Test: `backend/trivia/tests/test_questions_journal.py` (new), `backend/trivia/tests/test_questions_runner.py`, `backend/trivia/tests/test_publish_v3_questions.py`

**Interfaces:**
- Consumes: `runner.maintain(..., isolate=True)` and the held-back handling in the command (Tasks 5–6); `fame.VERSION` (Task 1).
- Produces:
  - `trivia.models.FactoryRun` (fields `kind`, `trigger`, `status`, `started_at`, `finished_at`, `versions`, `summary`, `report_md`; constants `STATUS_OK="ok"`, `STATUS_DEGRADED="degraded"`, `STATUS_FAILED="failed"`) and `trivia.models.FactoryEvent` (fields `run` FK with `related_name="events"`, `game`, `qid`, `action`, `reason`, `detail`, `created_at`).
  - `trivia.questions.journal.Journal(kind: str, trigger: str = "")` with `.versions: dict`, `.events: list[dict]`, `.log(action, reason="", game="", qid="", **detail)`, `.summary() -> {game: {action: count}}`, `.report_md(status) -> str`, `.save(status) -> FactoryRun`.
  - `runner.maintain(..., journal=None)`: logs `refill_decision` (detail `active`, `target`, `retired`), `generated` (detail `definition`), `retired` (detail `problems`), `held_back` (detail `active`, `minimum`); events of a held-back game get `detail["rolled_back"] = True`.
  - `publish_game_data_v3 --trigger <name>` (default `manual`); a `--dry-run`/`--no-commit` run is journaled with trigger `dry-run`.

- [ ] **Step 1: Write the failing journal tests**

```python
# backend/trivia/tests/test_questions_journal.py
from django.test import TestCase

from trivia.questions.journal import Journal


class JournalTests(TestCase):
    def test_log_summary_and_save(self):
        j = Journal("supply", trigger="manual")
        j.versions = {"fame": 1}
        j.log("generated", "top_up", game="career-path", qid="cp-000001", definition={"person_id": 1})
        j.log("generated", "top_up", game="career-path", qid="cp-000002", definition={"person_id": 2})
        j.log("held_back", "below_minimum", game="contexto", active=3, minimum=30)
        self.assertEqual(j.summary(), {"career-path": {"generated": 2}, "contexto": {"held_back": 1}})
        run = j.save("degraded")
        self.assertEqual((run.kind, run.trigger, run.status), ("supply", "manual", "degraded"))
        self.assertEqual(run.events.count(), 3)
        self.assertEqual(run.summary, j.summary())
        self.assertEqual(run.versions, {"fame": 1})
        self.assertIn("contexto held_back: below_minimum", run.report_md)
        self.assertEqual(run.events.get(qid="cp-000002").detail, {"definition": {"person_id": 2}})

    def test_events_without_a_game_stay_out_of_the_summary(self):
        j = Journal("cleanup")
        j.log("cleaned", "past_window", rows=10)
        self.assertEqual(j.summary(), {})
        self.assertEqual(j.save("ok").events.get().detail, {"rows": 10})
```

Add to `RunnerTests` in `backend/trivia/tests/test_questions_runner.py` (import `from trivia.questions.journal import Journal`):

```python
    def test_maintain_journals_its_decisions(self):
        journal = Journal("supply")
        with mock.patch("trivia.questions.games.career_path.TARGET", 5):
            runner.maintain(["career-path"], self.ds, self.rng, out=lambda *_: None, journal=journal)
        first = journal.events[0]
        self.assertEqual((first["action"], first["reason"], first["game"]),
                         ("refill_decision", "below_target", "career-path"))
        self.assertEqual(first["detail"], {"active": 0, "target": 5, "retired": 0})
        self.assertEqual(sum(1 for e in journal.events if e["action"] == "generated"), 5)

    def test_retirements_are_journaled_with_the_problem(self):
        Question.objects.create(game="career-path", qid="cp-999999", definition={"person_id": -1},
                                content_hash=content_hash({"person_id": -1}))
        journal = Journal("supply")
        with mock.patch("trivia.questions.games.career_path.TARGET", 5):
            runner.maintain(["career-path"], self.ds, self.rng, out=lambda *_: None, journal=journal)
        retired = [e for e in journal.events if e["action"] == "retired"]
        self.assertEqual(retired[0]["qid"], "cp-999999")
        self.assertIn("not in the playable pool", retired[0]["detail"]["problems"][0])
```

Add to `CommandTests` in `backend/trivia/tests/test_publish_v3_questions.py` (import `FactoryRun` from `trivia.models` next to `Question`):

```python
    def test_a_run_is_journaled(self):
        self._call("--games", "career-path")
        run = FactoryRun.objects.get()
        self.assertEqual((run.kind, run.trigger, run.status), ("supply", "manual", "ok"))
        self.assertEqual(run.versions["fame"], 1)
        self.assertEqual(run.events.filter(game="career-path", action="generated").count(),
                         Question.objects.filter(game="career-path").count())
        self.assertTrue(run.events.filter(game="career-path", action="refill_decision").exists())
        self.assertIn("career-path", run.report_md)

    def test_a_held_back_run_is_degraded_and_marks_rolled_back_events(self):
        with patch("trivia.questions.games.contexto.MINIMUM", 10_000):
            self._call("--games", "career-path,contexto")
        run = FactoryRun.objects.get()
        self.assertEqual(run.status, "degraded")
        self.assertTrue(run.events.filter(game="contexto", action="held_back").exists())
        generated = list(run.events.filter(game="contexto", action="generated"))
        self.assertTrue(generated)
        self.assertTrue(all(e.detail.get("rolled_back") for e in generated))

    def test_a_dry_run_is_journaled_as_dry_run(self):
        self._call("--games", "career-path", "--dry-run")
        self.assertEqual(FactoryRun.objects.get().trigger, "dry-run")
        self.assertEqual(Question.objects.count(), 0)

    def test_a_failed_run_is_journaled_as_failed(self):
        with patch.object(publish_v3, "default_builders",
                          side_effect=lambda **kw: {**publish_v3.question_builders(kw.get("maintained"), self.ds),
                                                    "mvps": lambda: []}):
            with self.assertRaises(CommandError):
                self._call("--games", "career-path,mvps")
        self.assertEqual(FactoryRun.objects.get().status, "failed")
        self.assertEqual(Question.objects.count(), 0)
```

- [ ] **Step 2: Run them to verify they fail**

Run: `python manage.py test trivia.tests.test_questions_journal trivia.tests.test_questions_runner trivia.tests.test_publish_v3_questions`
Expected: ERROR, `ModuleNotFoundError: No module named 'trivia.questions.journal'` / `ImportError: cannot import name 'FactoryRun'`.

- [ ] **Step 3: Add the models and the migration**

Append to `backend/trivia/models.py`:

```python
class FactoryRun(models.Model):
    """One run of the question factory: what it did and why (spec §4.8 of
    docs/superpowers/specs/2026-10-12-question-factory-design.md).

    Written after the run's own transaction, so rolled-back (dry-run) and failed
    runs are on record too. The review loop reads these through factory_digest.
    """

    STATUS_OK, STATUS_DEGRADED, STATUS_FAILED = "ok", "degraded", "failed"

    kind = models.CharField(max_length=16)  # supply | doctor | editorial | rollup | cleanup
    trigger = models.CharField(max_length=16, blank=True)  # manual | schedule | dry-run | data-refresh
    status = models.CharField(max_length=10)
    started_at = models.DateTimeField()
    finished_at = models.DateTimeField()
    versions = models.JSONField(default=dict, blank=True)  # {"dataset": ..., "fame": 1, ...}
    summary = models.JSONField(default=dict, blank=True)  # {game: {action: count}}
    report_md = models.TextField(blank=True)

    class Meta:
        indexes = [models.Index(fields=["kind", "-started_at"])]

    def __str__(self):
        return f"{self.kind} {self.status} @ {self.started_at:%Y-%m-%d %H:%M}"


class FactoryEvent(models.Model):
    """One decision inside a FactoryRun: action, machine reason, and the numbers
    (or, for model steps, the rationale and sources) behind it."""

    run = models.ForeignKey(FactoryRun, on_delete=models.CASCADE, related_name="events")
    game = models.CharField(max_length=32, blank=True)
    qid = models.CharField(max_length=48, blank=True)
    action = models.CharField(max_length=24)  # refill_decision | generated | retired | held_back | ...
    reason = models.CharField(max_length=64, blank=True)
    detail = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField()

    class Meta:
        indexes = [
            models.Index(fields=["run", "game"]),
            models.Index(fields=["action", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.game}/{self.qid} {self.action} ({self.reason})"
```

Run: `python manage.py makemigrations trivia --name factory_journal`
Expected: `Migrations for 'trivia': trivia/migrations/0008_factory_journal.py` (the number is whatever comes next) creating both models. Then `python manage.py makemigrations --check --dry-run` prints `No changes detected`.

- [ ] **Step 4: Write the journal**

```python
# backend/trivia/questions/journal.py
"""In-memory journal of one factory run, persisted as FactoryRun + FactoryEvent.

Events are collected during the run and written by save() AFTER the run's
transaction, so a rolled-back or failed run still leaves its record
(docs/superpowers/specs/2026-10-12-question-factory-design.md §4.8).
"""
import json

from django.utils import timezone


class Journal:
    def __init__(self, kind, trigger=""):
        self.kind = kind
        self.trigger = trigger
        self.started_at = timezone.now()
        self.versions = {}
        self.events = []

    def log(self, action, reason="", game="", qid="", **detail):
        self.events.append({
            "action": action, "reason": reason, "game": game, "qid": qid or "",
            "detail": detail, "created_at": timezone.now(),
        })

    def summary(self):
        out = {}
        for e in self.events:
            if e["game"]:
                per_game = out.setdefault(e["game"], {})
                per_game[e["action"]] = per_game.get(e["action"], 0) + 1
        return out

    def report_md(self, status):
        lines = [f"# {self.kind} run ({self.trigger or 'manual'}): {status}", ""]
        if self.versions:
            lines += ["Versions: " + ", ".join(f"{k} {v}" for k, v in sorted(self.versions.items())), ""]
        for game, counts in sorted(self.summary().items()):
            lines.append(f"- **{game}**: " + ", ".join(f"{a} {n}" for a, n in sorted(counts.items())))
        decisions = [e for e in self.events if e["action"] in ("refill_decision", "held_back")]
        if decisions:
            lines += ["", "## Decisions"]
            lines += [f"  - {e['game']} {e['action']}: {e['reason']} "
                      f"{json.dumps(e['detail'], default=str, sort_keys=True)}" for e in decisions]
        return "\n".join(lines)

    def save(self, status):
        from trivia.models import FactoryEvent, FactoryRun

        run = FactoryRun.objects.create(
            kind=self.kind, trigger=self.trigger, status=status, started_at=self.started_at,
            finished_at=timezone.now(), versions=self.versions, summary=self.summary(),
            report_md=self.report_md(status),
        )
        FactoryEvent.objects.bulk_create([FactoryEvent(run=run, **e) for e in self.events], batch_size=500)
        return run
```

- [ ] **Step 5: Journal the runner's decisions**

In `backend/trivia/questions/runner.py` add `from trivia.questions.journal import Journal` to the imports, then:

`_materialize_row` takes the journal and logs a retirement (the rest of the function is unchanged):

```python
def _materialize_row(mod, row, dataset, now, journal):
    m, problems = _materialize(mod, row.definition, dataset)
    if problems:
        row.status = Question.STATUS_RETIRED
        row.retired_at = now
        row.retired_reason = "; ".join(problems)[:2000]
        row.save(update_fields=["status", "retired_at", "retired_reason", "updated_at"])
        journal.log("retired", "no_longer_valid", game=row.game, qid=row.qid, problems=problems[:5])
        return None
```

`_process_game` takes the journal as its last parameter (`def _process_game(slug, dataset, rng, now, out, journal):`), passes it to both `_materialize_row(...)` calls (`_materialize_row(mod, row, dataset, now, journal)`), logs the refill decision right after the `target = ...` line:

```python
    target = mod.TARGET if mod.TARGET is not None else 10 ** 9
    active_before = _active_count(slug, kept, today)
    journal.log("refill_decision", "below_target" if active_before < target else "enough", game=slug,
                active=active_before, target=mod.TARGET, retired=retired)
```

and logs each kept new question inside the generation loop:

```python
            if result is not None:
                kept.append(result)
                added += 1
                journal.log("generated", "top_up", game=slug, qid=row.qid, definition=d)
```

`maintain` gains `journal=None` (Task 5's version, extended):

```python
def maintain(games, dataset, rng, now=None, out=print, isolate=False, journal=None):
    """(docstring from Task 5, plus:)

    journal (trivia.questions.journal.Journal) receives every decision; events of a
    held-back game are marked rolled_back. Without one, decisions are discarded.
    """
    now = now or timezone.now()
    journal = journal or Journal("supply")
    per_game, stats = {}, {}
    for slug in games:
        if not isolate:
            per_game[slug], stats[slug] = _process_game(slug, dataset, rng, now, out, journal)
            continue
        mark = len(journal.events)
        try:
            with transaction.atomic():
                per_game[slug], stats[slug] = _process_game(slug, dataset, rng, now, out, journal)
        except BelowMinimum as e:
            for event in journal.events[mark:]:
                event["detail"]["rolled_back"] = True
            journal.log("held_back", "below_minimum", game=slug, active=e.count, minimum=e.minimum)
            stats[slug] = {"held_back": str(e)}
            out(f"  {slug}: held back, {e}")
    return per_game, stats
```

- [ ] **Step 6: Journal every maintaining publish run**

In `backend/trivia/management/commands/publish_game_data_v3.py`:

Imports: replace `from trivia.questions import runner` with

```python
from trivia.models import FactoryRun
from trivia.questions import fame, runner
from trivia.questions.journal import Journal
```

In `add_arguments`, add:

```python
        parser.add_argument("--trigger", default="manual",
                            help="What started this run, recorded in the factory journal "
                                 "(manual | schedule | data-refresh); dry runs record dry-run")
```

In `handle`, right after `rollback = opts["dry_run"] or opts["no_commit"]`, add:

```python
        journal = Journal("supply", trigger="dry-run" if rollback else opts["trigger"])
        status = FactoryRun.STATUS_FAILED
```

Inside the `if to_maintain:` block, right after `dataset = publish_v3.curated_dataset()`, add:

```python
                    journal.versions = {"dataset": dataset.version, "fame": fame.VERSION}
```

pass `journal=journal` to the `runner.maintain(...)` call, and right after the `report = publish_v3.publish(...)` call (still inside `try`) add:

```python
            status = FactoryRun.STATUS_DEGRADED if held_back else FactoryRun.STATUS_OK
```

Then add a `finally:` clause after the two `except` clauses of that same `try`:

```python
        finally:
            # Written after the transaction, so a rolled-back or failed run is journaled too.
            # Journaling must never fail a publish (e.g. before the migration reaches a DB).
            if to_maintain:
                try:
                    run = journal.save(status)
                    self.stdout.write(f"Journal: factory run {run.pk} ({status}, {len(journal.events)} events)")
                except Exception as e:  # noqa: BLE001 - report and carry on
                    self.stdout.write(self.style.WARNING(f"  warning: journal not saved: {e}"))
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `python manage.py test trivia.tests.test_questions_journal trivia.tests.test_questions_runner trivia.tests.test_publish_v3_questions`
Expected: `OK`. `test_skip_maintain_publishes_current_rows_without_writes` must still pass: `--skip-maintain` journals nothing.

- [ ] **Step 8: Commit**

```powershell
git add backend/trivia/models.py backend/trivia/migrations backend/trivia/questions/journal.py backend/trivia/questions/runner.py backend/trivia/management/commands/publish_game_data_v3.py backend/trivia/tests/test_questions_journal.py backend/trivia/tests/test_questions_runner.py backend/trivia/tests/test_publish_v3_questions.py
git commit -m "feat(questions): journal every supply run's decisions (FactoryRun, FactoryEvent)"
```

---

### Task 8: Full test run, real-data dry run, ship to dev

**Files:** none new.

- [ ] **Step 1: Run the whole trivia suite**

Run: `python manage.py test trivia`
Expected: `OK`. Any failure in a file this plan did not touch is a real regression: stop and fix it in the owning task.

- [ ] **Step 2: Push the branch and open the PR to dev**

```powershell
gh auth switch -u stefanroman22
git push -u origin HEAD
gh pr create --base dev --title "Question factory phase 1: fame bands + per-game publish isolation" --body "Implements docs/superpowers/plans/2026-10-12-question-factory-phase-1.md (spec: docs/superpowers/specs/2026-10-12-question-factory-design.md). Who Are Ya ~500 players, Contexto ~500 secrets (fixes the 2026-11-20 run-out), Career Path drops unguessable journeymen, a game below its minimum is held back instead of failing the whole publish, and every supply run is journaled (FactoryRun / FactoryEvent)."
```

- [ ] **Step 3: Dry-run the publish against the real data from the branch**

```powershell
gh workflow run publish-game-data.yml --ref <branch> -f games=career-path,who-are-ya,contexto -f dry_run=true
gh run watch (gh run list --workflow publish-game-data.yml --limit 1 --json databaseId -q ".[0].databaseId")
```

A dry run passes `--no-commit`, so every DB write is rolled back. Read the "Build game data" log and check:
- `who-are-ya: active` ≈ 501, `retired 0`
- `career-path: active 500`, `retired` between 200 and 300, `added` equal to `retired`
- `contexto: retired 0`, and no `held back` line for any game
- a `Journal: factory run <id> (ok, <n> events)` line. Before the new migration has reached the production database (the backend deploy runs `manage.py migrate`) this prints `warning: journal not saved: ...` instead; that is expected on the branch and must be gone in a dry run after the merge has deployed.

If GitHub refuses to dispatch from the branch (the workflow is only dispatchable from refs that contain it, which this branch does), wait for the merge in Step 4 and dispatch with `--ref dev`.

- [ ] **Step 4: Merge to dev**

```powershell
gh pr checks <n> --watch
gh pr merge <n> --merge --delete-branch
```

- [ ] **Step 5: Report and hand off production**

Report the dry-run numbers. Production is the owner's call: promote dev to main (the `promote-to-prod` skill), then run "Publish game data" with `dry_run=false`. **This must happen before 2026-11-20**; after that date Contexto falls below 30 scheduled days and, without this phase, blocks every game's publish.
