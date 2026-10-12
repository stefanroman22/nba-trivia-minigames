# Question Factory — Design

**Date:** 2026-10-12 (v2, same day: adds self-healing, storage at scale, the run journal and
the improvement loop, at the owner's request)
**Status:** design, ready for phase 1
**Scope:** how every game gets new, correct, interesting and consistent questions forever,
finds and repairs its own mistakes, keeps its storage small, and records everything it does so
a reviewing agent can make it better. Covers the 11 visible games and any game added later.
Hidden games (heatmap, connections, nba-grid, bingo, pack-five, superdraft, imposter) plug in
when they are surfaced again.
**Builds on:** `docs/superpowers/specs/2026-09-10-questions-store-design.md` (`Question` table,
per-game module contract, runner), `docs/team/designs/2026-10-02-independent-game-data-publishing.md`
(manifest-v3 data host, `publish_game_data_v3`), `backend/users/retention.py` (privacy retention).

## 1. Goal

A question machine that runs without anyone feeding it:

1. **Supply.** It notices when a game is running low, measured against how much the game is
   played, and builds more.
2. **Quality.** Every question is correct, interesting and fits the difficulty mix the owner sets.
   Questions are consistent with each other: no player in every round, a spread across eras,
   no near-duplicates. It reports the gaps it cannot fill.
3. **Self-healing.** It spots questions that are probably broken (from how players answer, from
   player reports, from data changes, from its own random audits). It takes them out of play,
   researches the truth online, and then fixes the data, fixes the question, or retires it,
   whichever is the best course of action. Every step is logged with evidence.
4. **Storage that scales.** Answer logs are rolled up into small anonymous statistics, and the
   raw rows are cleaned up on a schedule. Cleanup can never change what the generator does.
5. **Learning.** Every run writes a journal of what it did and why. A reviewing agent (Fable or
   Opus at high effort) reads the journals regularly and turns what it finds into improvements.

The north star: a regular player does not see a repeat and does not meet a wrong answer.

## 2. Where we start (measured 2026-10-11/12)

**Data.** `players_curated.json` has 5,208 rows (4,900 playable) with draft, stints, awards and
career totals; 464 All-Stars vs 466 real ones. The DB has 30 `Team` rows (current franchises
only), 912 playoff series (all of them, 1946-47 to 2025-26), 71 MVP seasons and 600 Starting
Five games (2010–2026). The last NBA sync ran 2026-06-25. The whole database is **21 MB**.

| Game | Live | Per play | Picker | Logs answers? |
|---|---|---|---|---|
| Series Winner | 912 | 5 | random, no memory | **no** |
| Name the Logo | 30 | 5 | random, no memory | **no** |
| Guess the MVP | 71 | 5 | random, no memory | **no** |
| Starting Five | 503 | 1 | random, no memory | **no** |
| Wordle | 525 | 1/day | daily word | **no** |
| Fan Favorites | 40 | 1 | random, no memory | yes |
| Career Path | 500 | 1 | weighted random | yes |
| Who Are Ya | 99 | 1 | random | yes |
| Tic-Tac-Toe | 120 | 1 | random | yes |
| Contexto | 79 (51 days ahead) | 1/day | daily schedule | yes |
| Who Would Win | 60 | 10 | random, no memory | yes (votes) |

**Problems.**

1. **Pools are capped by the fame tier, not by history.** Only 134 players are fame tier 1–3, so
   Who Are Ya and Contexto are capped at 99 players, although about 500 are recognizable.
2. **Contexto runs dry.** It has 99 candidates for a 365-day no-repeat rule and has used 79.
   Around **2026-11-20** fewer than 30 days remain scheduled, maintenance raises `BelowMinimum`,
   and because maintenance shares one transaction with every game's build, **the whole publish
   fails**. Around 2026-12-20 the schedule ends.
3. **Career Path is padded:** 259 of its 500 questions are players with under 3,000 career points.
4. **Every picker samples with replacement and remembers nothing.** With N questions a repeat is
   more likely than not after about 1.2·√N picks: the second play for Name the Logo and Guess
   the MVP, around the seventh for Series Winner.
5. **The editorial games are small and hand-written:** Fan Favorites 40, Who Would Win 60,
   Connections 60.
6. **Nothing measures difficulty, interest or correctness after publishing.** 5 games do not log
   answers at all, and the 12 that do keep raw rows only (deleted after 365 days by
   `users/retention.py`), with no rolled-up statistics.
7. **Runs leave no record of their decisions**, only console output.

## 3. Principles

From Anthropic's *Building effective agents*: fixed workflows for well-defined work, agents only
where they demonstrably help, and keep each model step small and checkable.

1. **Our data is the source of truth, and corrections to it are sourced.** A model may propose
   or research. Code computes every answer. A fact changes only with two independent sources.
2. **One machine, many games.** Games differ in data and settings, not machinery: a module (the
   existing contract) and a spec file per game. No agent, skill or cron per game.
3. **Content and corrections live in the database; code lives in git.** The machine can act on
   content without a code deploy. Changes to how it works go through PRs.
4. **Nothing is destroyed by the machine.** Questions are quarantined or retired, never deleted.
   Corrections can be switched off. Every action is reversible and journaled.
5. **Deterministic and versioned.** Same dataset + same versions ⇒ same output. Fame, difficulty,
   similarity and every spec carry a version that the question records.
6. **Games fail alone.** A game that cannot meet its minimum is held back at its last good
   publication. Every other game still ships, and the run is marked degraded.
7. **The AI never holds database credentials.** Model steps send proposals to a GitHub workflow
   that validates and applies them; that workflow already holds the DB secret.
8. **Everything is journaled.** Every decision is written down with its reason, its numbers and,
   for model steps, its rationale and sources.

## 4. The machine: four loops

```
 SUPPLY (weekly)            DOCTOR (nightly scan + weekly research)
 count runway ─► generate   signals ─► quarantine ─► research online ─► verdict ─► act
 ─► gates ─► publish                                                    (fix data / fix
        │                                                                question / retire)
        ▼                               ▼
 ┌───────────────── JOURNAL (every run, every decision) ─────────────────┐
 └────────────────────────────────┬──────────────────────────────────────┘
                                  ▼
 MEMORY (nightly): roll up answers ─► stats tables; clean raw rows past their window
                                  ▼
 IMPROVE (every 2 weeks): reviewing agent reads journal + stats ─► report + task cards / PRs
```

### 4.1 Supply loop (weekly, plus after every data refresh)

GitHub Actions, code only (the Claude part for editorial games is §4.6):

1. **Data gate.** Parity, plausibility and freshness checks on the dataset; stop and alert on failure.
2. **Re-materialize** every live question against the dataset with active corrections applied (§4.9).
   Questions that no longer hold are retired with the reason.
3. **Runway per game and difficulty band** (§4.4). Games with enough runway are skipped.
4. **Over-generate and select.** Generate about 3× the shortfall as candidates, then pick the set
   that maximizes quality score + coverage gain (§4.3). Fill the difficulty bands that are under
   their target share first.
5. **Hard gates** (code): facts against the dataset, solvable, not ambiguous, not a duplicate or
   near-duplicate, inside consistency limits. A rejected candidate is journaled with the failed gate.
6. **Publish each game separately** (§4.5).
7. **Gap report**: coverage holes it could not fill, games bound by capacity, data it would need.

### 4.2 Fame score (phase 1)

`backend/trivia/questions/fame.py`, a pure function of a curated row. The row schema is frozen
(contract #1 in `curated_players.py`), so the score is computed, never stored.

```
fame_score = 4·min(All-Star, 15) + 3·min(All-NBA, 15) + 10·MVP + 6·Finals MVP
           + 3·DPOY + 3·(ROY ? 1 : 0) + 2·Sixth Man + min(rings, 5)
           + min(career points / 1000, 25) + 0.5·min(seasons, 20)
```

| Band | Name | Rule | Playable players (shipped data) |
|---|---|---|---|
| 1 | STAR | score ≥ 40 | 177 |
| 2 | KNOWN | score ≥ 18 | 501 cumulative |
| 3 | DEEP | score ≥ 10 | 1,038 cumulative |
| 4 | OBSCURE | below 10 | rest |

The hand-set `fame_tier` stays as an editorial floor: tier 1 ⇒ at least STAR, tier 2 ⇒ at least
KNOWN, tier 3 ⇒ at least DEEP. It can raise a band, never lower it, so every new eligibility rule
is a superset of today's. Spot checks: LeBron 211 (STAR), John Wall 40.6 (STAR), Kyle Korver
24.5 (KNOWN), Zion Williamson 17.6 (KNOWN via the floor), Brian Scalabrine 8.1 (OBSCURE).
`fame.VERSION = 1`.

Phase-1 consumers: Who Are Ya (KNOWN+, ~501 questions), Contexto secrets (KNOWN+, 501
candidates, a full year without repeats), Career Path (3–7 stints and DEEP+, 685 eligible;
weight 3 for KNOWN/DEEP, 1 for STAR).

### 4.3 Game spec files: difficulty, interest, coverage (phase 2)

One JSON file per game, `backend/trivia/questions/specs/<slug>.json`, loaded and validated by
`trivia/questions/specs.py`. JSON because the backend has no YAML dependency. Module constants
(`TARGET`, `MINIMUM`, eligibility) come from it.

```json
{
  "slug": "who-are-ya",
  "version": 1,
  "eligibility": {"min_band": 2, "requires": ["teams"]},
  "difficulty": {
    "features": {"fame_band": 0.6, "era_age_years": 0.25, "stints": 0.15},
    "bands": {"easy": [0, 0.35], "medium": [0.35, 0.65], "hard": [0.65, 1]},
    "mix": {"easy": 0.4, "medium": 0.4, "hard": 0.2}
  },
  "interest": {"features": {"memorable_stop": 0.5, "distinct_clues": 0.5}, "min": 0.3},
  "coverage": {"axes": ["decade", "team", "position"], "min_decades": 4},
  "refill": {"runway_days": 90, "minimum": 30, "max_new_per_run": 200},
  "consistency": {"max_player_share": 0.02}
}
```

- **Difficulty** (0 = easiest) is a weighted sum of normalized features the module computes.
  The owner sets weights, band edges and mix. Phase 6 recalibrates the weights from real solve
  rates (§4.8).
- **Interest** is a separate score: a question can be easy and dull, or hard and great. Each
  module defines its features. Career Path: at least one memorable stop (a title, an All-Star
  season or a famous franchise). Fan Favorites: 6–15 answers, at least 2 deep cuts. Who Would
  Win: a small strength gap, and later the measured vote split near 50/50. Candidates below
  `interest.min` are rejected.
- **Coverage** is a matrix over the spec's axes (decade × team × position for player games).
  Selection prefers candidates that fill empty cells. Cells that stay empty go into the gap report.
- **Near-duplicates** are caught by a per-game key (Tic-Tac-Toe: the sorted set of row and column
  criteria) on top of the existing `content_hash`.

### 4.4 Demand-driven refill (phase 3)

```
daily_use = plays in the last 14 days (from the daily stats table, §4.7) / 14 × questions per play
target    = clamp(ceil(daily_use × runway_days), minimum, eligible capacity)
```

Daily games (Wordle, Contexto) use `runway_days` directly. A game whose capacity is below its
target is reported as **capacity-bound**, the signal that it needs new data or a new question
type rather than more generation.

**Seen tracking.** Each picker deals from questions the player has not seen: a per-game seen set
in `localStorage` (pruned to qids still in the index, reset when exhausted). It is used by the pool
games (`sampleN` in `src/utils/pool.ts`) and the question games (`PICKERS` in
`src/utils/gameData.ts`, mirrored in `multiplayer_server/src/gameData.js`). A second refill
trigger: 20% of the last 14 days' players have seen 70% or more of a pool, measured from the stats
tables.

### 4.5 Per-game publish isolation (phase 1)

`runner.maintain(..., isolate=True)` runs each game in its own savepoint. A game raising
`BelowMinimum` is rolled back alone and held back. `publish_game_data_v3` drops it from the run,
so its live manifest entry carries over (`publish_v3` already does this for games it did not
build). The command writes `held_back=<games>` to `$GITHUB_OUTPUT`, and the workflow's last step
fails when that is non-empty: the run is red, but everything else has shipped. The legacy
`runner.run` (Supabase snapshot, hidden games) keeps all-or-nothing.

### 4.6 Editorial games (phase 5)

Fan Favorites, Connections and Who Would Win need ideas a generator cannot have.

- **Content becomes DB-authoritative.** `FanFavoritesQuestion` already is; Who Would Win and
  Connections get tables of their own. The seed files become a one-time import.
- **Claude proposes, code decides.** For Fan Favorites and Connections Claude proposes a *rule* in
  a small JSON query language over the dataset (`{"all": [{"award": "dpoy", "min": 2}]}`); code
  evaluates it to get the complete answer set and rejects empty, oversized or unanswerable rules.
  Who Would Win is a vote: Claude proposes notable team-season pairs, and code checks that both
  sides exist (`playoff.json` season + franchise) and that the pair is new.
- **Author and verifier.** The author subagent proposes. The verifier subagent sees only the
  proposal and the dataset (never the author's reasoning) and approves, rejects with a reason, or
  asks for one revision.
- **Delivery.** Approved items go to the factory inbox (§4.10). The inbox workflow runs the hard
  gates again before anything reaches the DB, so a model can never write content that fails them.
- **Skill.** `.claude/skills/nba-question-writer` becomes the factory skill: `SKILL.md` gets the
  author, verifier and doctor workflows, and `references/games/<slug>.md` stays the per-game
  page, loaded only for that game. No per-game skill.

### 4.7 Memory: answer statistics, storage and cleanup (phase 3)

**What is logged.** Every game logs every answer to `GuessLog` (game, question id, answer,
correct, time) and every play to `GameSession`. Phase 3 adds logging to the 5 games that lack it.

**Roll-ups (nightly, code).** Raw rows are folded into two small anonymous tables, idempotently
and up to a watermark:

| Table | One row per | Holds |
|---|---|---|
| `QuestionStats` | game × question × day | attempts, correct, skips, total and p50 time, players |
| `WrongAnswerStats` | game × question × normalized wrong answer | count, distinct players, first and last seen |
| `GameDailyStats` | game × day × mode | plays, distinct players |

They contain no user ids, so they are not personal data and may be kept for as long as the
question exists. Everything downstream (doctor signals, difficulty calibration, demand, the
reviewing agent) reads the roll-ups, never the raw rows.

**Why roll-ups matter at scale.** One `GuessLog` row costs about 200 bytes with its indexes. At
1,000 daily players × 30 answers that is ~6 MB a day; the current 365-day retention would hold
~2.2 GB, over the 500 MB Supabase free tier. Roll-ups cost a few hundred bytes per question per
day of activity, regardless of player count.

**Cleanup (nightly, code).**
- Raw `GuessLog` older than the window is deleted only **below the roll-up watermark**. A row is
  never deleted before it has been counted.
- The window starts at today's 365 days (privacy policy). **Owner decision:** cut it to 30 days
  once roll-ups have run for a month. That is privacy-positive, keeps the DB small at any scale,
  and requires the policy text to change in the three places `retention.py` names.
- Retired questions older than 180 days are compacted: `definition`, `quality` and
  `players_referenced` are emptied; `game`, `qid`, `content_hash`, `retired_reason` and dates stay.
  The generator only needs the hash (dedupe) and Contexto only the secret and day (kept in a
  slim `definition`), so generation is unchanged. A test asserts the generator makes the same
  output before and after compaction.
- Journal events (§4.8) older than 180 days are deleted; run summaries are kept forever (one
  small row per run).
- Each cleanup reports what it removed to the journal.

**Answers as a quality signal.** `WrongAnswerStats` is what finds missing answers and missing
aliases: when many different players type the same "wrong" answer, either the answer list is
incomplete or our data is wrong.

### 4.8 Journal and improvement loop (journal phase 1, review phase 4)

**Journal tables.**

| Table | One row per | Holds |
|---|---|---|
| `FactoryRun` | run | kind (supply, doctor, editorial, cleanup, rollup), trigger, status (ok, degraded, failed), started/finished, versions (dataset, fame, specs, similarity), per-game summary, a short markdown report |
| `FactoryEvent` | decision | run, game, qid, action, reason code, detail JSON |

Actions: `refill_decision`, `generated`, `rejected`, `retired`, `held_back`, `flagged`,
`quarantined`, `researched`, `verdict`, `corrected`, `restored`, `compacted`, `cleaned`.
`detail` holds the numbers behind the decision (runway, target, scores, failed gate). For model
steps it also holds the rationale and the source URLs. Events are collected in memory and written
**after** the run's transaction, so a rolled-back or failed run is still journaled.

**Improvement loop (every 2 weeks).** A cloud routine running Fable (or Opus) at high effort:
1. runs `manage.py factory_digest --days 14`, a markdown digest built from the journal and the
   roll-ups: KPIs (below), rejections by gate, false alarms, verdicts, calibration error,
   capacity-bound games, coverage gaps, slowest steps;
2. writes `docs/factory/reviews/YYYY-MM-DD.md` with findings and proposed changes;
3. turns each change into a Notion task card for the existing team pipeline (code changes) or a PR
   that changes spec numbers (tuning). Both land on `dev` with tests; production promotion stays
   the owner's call.

**KPIs the machine is judged on:**

| KPI | Target |
|---|---|
| Audit error rate (random audit, §4.9) | < 1% |
| Questions quarantined per week / false-alarm share | tracked; false alarms < 30% |
| Runway per game | ≥ the spec's `runway_days` |
| Difficulty calibration (solve rate monotonic easy → hard) | holds for every game with ≥ 300 answers |
| Coverage cells empty | trending down |
| Held-back games per run | 0 |

### 4.9 Doctor loop: find, research and repair broken questions (phase 4)

**Signals (nightly scan, code).**

| Signal | Rule (starting values, tuned by the review loop) |
|---|---|
| Data drift | a question no longer materializes against the new dataset (exists today: retire) |
| Solve-rate anomaly | ≥ 30 attempts and solve rate < 3%, or far below its difficulty band's norm |
| Wrong-answer cluster | the same wrong answer from ≥ 5 distinct players and ≥ 15% of a question's wrong answers |
| Player report | a "Report a problem" button on the answer reveal (new; stored as `Feedback` with `qid`) |
| Random audit | 20 random live questions per week, fact-checked even with no signal |

**Quarantine.** A strong signal (≥ 3 reports, or a solve-rate anomaly together with a
wrong-answer cluster) sets the question to the new status `quarantined` immediately. Quarantined
questions are not published, so players stop seeing them before anyone researches. A weak signal
only queues the question for research.

**Research (weekly cloud routine, Claude).** For each queued question the doctor subagent gets the
question, our dataset rows, the wrong-answer clusters and the reports. It then looks up the truth
on the web: basketball-reference.com, NBA.com, Wikipedia. Two independent sources must agree
before a fact counts. It returns a verdict with its rationale and the source URLs.

| Verdict | Best course of action | Automatic? |
|---|---|---|
| Our data is wrong (2 sources agree) | add a **data correction** (below), re-materialize every question that uses the fact, release from quarantine | yes |
| Answer list incomplete (Fan Favorites, grids) | add the missing answers, computed by code from the corrected rule | yes |
| Correct answer typed differently | add an alias | yes |
| Question is fine, just hard or easy | move it to the right difficulty band, release | yes |
| Ambiguous or unfixable wording | retire, journal the reason | yes |
| Sources disagree or confidence is low | keep quarantined, post the evidence to Slack `#agent-backend` | **owner** |
| False alarm | release, journal it (feeds threshold tuning) | yes |

**Data corrections.** `players_curated.json` is generated from nba_api and is never hand-edited.
Corrections live in a DB table, `DataCorrection` (person_id, field path, old value, new value,
sources, reason, run, active), and are applied on top of the dataset whenever the factory loads it
(`publish_v3.curated_dataset()`). Because they are data, not code, the next publish picks them up
with no deploy. When a regeneration from nba_api already has the corrected value, the correction
is marked redundant and deactivated. Every two weeks the review loop proposes folding long-lived
corrections back into the generator.

**The inbox: how model steps act without DB credentials.** The routine commits its verdicts and
editorial proposals as JSON files to the `factory-inbox` branch. A GitHub workflow triggered by
that push validates each file against a schema, re-runs the hard gates, applies what passes,
journals everything, deletes the processed files, and triggers a publish. Anything that fails
validation is journaled as `rejected` with the reason.

**Routine setup the owner does once.** Add `www.basketball-reference.com`, `www.nba.com` and
`en.wikipedia.org` to the cloud routine's network allowlist (today it allows Notion and Slack only).
No new secret is needed.

### 4.10 Contexto similarity v2 (phase 6)

Today `similarity.py` v1 uses hand weights (franchise-season Jaccard 35, era 20, position 15,
country 10, draft pick 10, awards 10), frozen by a golden test and never checked against anyone's
sense of "similar". v2:

- **Spec file** `specs/contexto-similarity.json`. Each scheduled day records `sim_version`, and a
  day is never re-ranked with a different version.
- **Better features:** playing-style profile (normalized ppg/rpg/apg + height), fame score, draft
  class (year), teammate overlap (kept), country region instead of an exact match.
- **Anchor set** `specs/contexto-anchors.json`: 50–100 pairs that must be in each other's top 20
  (Shaq–Kobe, Stockton–Malone) and pairs that must rank below 500. Claude may propose pairs; the
  owner approves them. A weight change ships only if every anchor holds.
- **Per-secret gate:** a secret's top 10 must not come from one team-season and must include at
  least 6 KNOWN+ players.
- **Learning:** the doctor's solve-rate and guess-path data (how many guesses it took) show which
  secrets were unfair; the review loop proposes weight changes, which must still pass the anchors.

### 4.11 New data that unlocks capacity (phase 6)

- **Award seasons** for Guess the MVP's format: Finals MVP, ROY, DPOY, Sixth Man, MIP, All-Star
  Game MVP, Coach of the Year, scoring champion (~480 seasons beyond the 71 MVPs).
- **Team history:** former names, relocations, defunct franchises, team-seasons. Historical logos
  are trademarks we would hotlink, so that part is an owner decision first.

## 5. When things run

There is no cron per game. Five schedules cover everything:

| When | What | Where | Model? |
|---|---|---|---|
| Nightly | roll-ups → cleanup → doctor signal scan (and quarantine) | GitHub Actions | no |
| Weekly (Mon) | supply run: re-materialize, refill, gates, publish | GitHub Actions | no |
| After a data refresh | the supply run, once | GitHub Actions | no |
| Weekly (Tue) | doctor research + random audit → inbox → publish | cloud routine + inbox workflow | yes |
| Weekly (Wed) | editorial author/verifier → inbox → publish | cloud routine + inbox workflow | yes |
| Every 2 weeks | improvement review → report, cards, PRs | cloud routine (Fable/Opus, high effort) | yes |

All model work runs on the Max subscription; GitHub Actions stays within free minutes at this size.

## 6. What runs alone and what waits for the owner

| Runs alone | Waits for the owner |
|---|---|
| Generating, gating and publishing question data | Promoting **code** changes to production |
| Quarantining, retiring and releasing questions | Anything that costs money (a bigger Supabase plan, paid APIs) |
| Data corrections backed by 2 sources | Verdicts where sources disagree (posted to Slack with evidence) |
| Adding answers and aliases, re-banding difficulty | Changing the privacy retention periods (policy text) |
| Roll-ups, cleanup and compaction | Approving the Contexto anchor set |
| Opening task cards and tuning PRs to `dev` | Historical logos (trademark question) |

**Standing authorization needed.** Today `CLAUDE.md` says production changes happen only on an
explicit ask, and the publish workflow is manual with `dry_run` on by default. For the machine to
be autonomous, the owner grants once: *"The question factory may publish game data (questions,
corrections, answer lists) to production on its own schedule. Code changes still need my
promote."* Phase 3 records this in `CLAUDE.md` and gives the publish workflow its schedules.

## 7. Phases

| Phase | Delivers | Done when |
|---|---|---|
| **1** | Fame score; Who Are Ya, Contexto, Career Path on fame bands; per-game publish isolation; **run journal** (`FactoryRun`, `FactoryEvent`) for supply runs | Tests green on `dev`; a dry-run publish shows Who Are Ya ≈501, Career Path 500 with the obscure picks retired, Contexto ≥ 60 days ahead, and a journaled run. **In production before 2026-11-20.** |
| 2 | Spec files; difficulty, interest and coverage scores; over-generate-and-select; near-duplicate and consistency gates; gap report | Every active question has a difficulty band and interest score; mix within 5 points of spec |
| 3 | Answer logging in all games; roll-ups and cleanup; demand-driven targets; seen tracking; scheduled publishing (after the owner's authorization) | No repeat until a player has seen the whole pool; raw logs below the watermark cleaned nightly |
| 4 | Doctor: signals, quarantine, "Report a problem", research routine, verdicts, `DataCorrection`, the inbox; `factory_digest` and the improvement review | A planted wrong fact is quarantined, researched, corrected and republished with no human step |
| 5 | Editorial factory: DB-authoritative content, rule language, author/verifier; Fan Favorites → Who Would Win → Connections | A routine run lands new content through the inbox that passes every gate |
| 6 | Contexto similarity v2 + anchors; difficulty recalibration from solve rates; award seasons; team history | All anchors hold; calibration KPI holds; Guess the MVP ≥ 500 seasons |

Each phase gets its own implementation plan in `docs/superpowers/plans/` when it starts.

## 8. Risks

| Risk | Prevention |
|---|---|
| Widening a pool retires live questions | Fame bands use the tier as a floor, so new rules are supersets; only Career Path retires on purpose and refills in the same run |
| A bad fame weight floods a game with unknowns | Shipped-data calibration test pins band sizes and named anchors |
| The doctor "corrects" a true fact | Two independent sources required; corrections are switchable rows; every change journaled with sources; random audits measure the error rate |
| A model writes a bad question or answer | Models never write answers; the inbox re-runs every hard gate; the verifier is a separate context |
| Cleanup deletes data the machine still needs | Raw rows deleted only below the roll-up watermark; compaction keeps hashes and Contexto history; a test asserts identical generator output before and after |
| Isolation hides a broken game | Red workflow step + `held_back` in the journal + daily freshness check |
| Feedback loops (tuning chases noise) | Review changes need ≥ 300 answers of evidence and land as reviewed PRs, never direct edits |
| Contexto rankings shift for scheduled days | `sim_version` recorded per day |
| Storage outgrows the free tier | Roll-ups + the 30-day raw window keep the DB small; the digest reports DB size every run |

## 9. Out of scope

Legacy `backend/trivia/games/*` modules (pre-question-store builders used by tests and
`live_pool.py`), hidden games until surfaced, the 2026 off-season data sync itself (the existing
`sync_nba_data` + `generate_players_curated` run), and any paid service.

## 10. Decisions

- **No agent or skill per game.** The shared steps are most of the work; per-game agents would
  duplicate and drift. Per-game knowledge lives in spec files (numbers) and per-game skill pages (prose).
- **Fame is computed, not stored.** The row schema is frozen, and a computed score re-ranks itself
  when awards or stats change.
- **Who Are Ya widens on purpose.** The game reference used to say "keep tier 1-2 rather than
  widening it". The owner now wants a pool without repeats, and KNOWN-band players (Kyle Korver,
  Derek Fisher, Robert Horry) are fair over 8 attribute clues. Phase 2's difficulty bands are where
  a "stars only" easy mode would live.
- **Hold back a failing game instead of failing the publish.** The 2026-10-02 design chose one
  transaction for safety; per-game savepoints keep that safety per game.
- **Corrections are DB rows, not edits to the generated file or to code.** That way the machine can
  fix a fact without a code deploy, the fix stays sourced and reversible, and a later regeneration
  that agrees makes it redundant.
- **The AI acts through an inbox, never with DB credentials.** Validation lives in code that holds
  the secret; the model only proposes.
- **The journal starts in phase 1**, so the reviewing agent has months of history by the time the
  review loop exists.
- **Roll-ups before retention.** Statistics are folded into anonymous tables before raw rows reach
  their deletion date. Without that, today's 365-day retention would silently erase a year of
  calibration data.
