# Question Factory — Design

**Date:** 2026-10-12
**Status:** design written from the owner's request, ready for phase 1
**Scope:** how every game gets new, correct, consistent questions over time, without
anyone hand-feeding them. Covers the 11 visible games and any game added later.
Hidden games (heatmap, connections, nba-grid, bingo, pack-five, superdraft, imposter)
plug into the same system when they are surfaced again.
**Builds on:** `docs/superpowers/specs/2026-09-10-questions-store-design.md` (the
`Question` table, the per-game module contract, the runner) and
`docs/team/designs/2026-10-02-independent-game-data-publishing.md` (manifest-v3 data
host, `publish_game_data_v3`).

## 1. Goal

The player dataset and team dataset change all the time, more games are coming, and
some games burn through questions much faster than others. We want one autonomous
loop that:

1. notices when a game is running low, measured against how much it is actually played;
2. builds new questions that follow difficulty rules the owner sets as numbers;
3. proves every new question correct against our own data before it can ship;
4. keeps questions consistent with each other (no player in every round, a spread
   across eras and difficulty, no near-duplicates);
5. publishes each game on its own, so one game's problem never blocks another;
6. learns from real play (solve rates) which questions are miscalibrated or wrong.

The north star is a trivia environment where a regular player does not see a repeat.

## 2. Where we start (measured 2026-10-11)

**Data.** `players_curated.json` has 5,208 rows (4,900 playable) with draft, stints,
awards and career totals. Coverage matches real history: 464 All-Stars in the data vs
466 real ones. The DB has 30 `Team` rows (current franchises only: id, name, abbr,
logo), 912 playoff series (every completed series 1946-47 to 2025-26), 71 MVP seasons,
600 Starting Five games (2010–2026). The last NBA sync ran 2026-06-25, so the 2026
off-season moves are missing.

**Question counts (live).**

| Game | Live | Per play | Picker |
|---|---|---|---|
| Series Winner | 912 | 5 | random, no memory |
| Name the Logo | 30 | 5 | random, no memory |
| Guess the MVP | 71 | 5 | random, no memory |
| Starting Five | 503 | 1 | random, no memory |
| Wordle | 525 | 1/day | daily word |
| Fan Favorites | 40 | 1 | random, no memory |
| Career Path | 500 | 1 | weighted random |
| Who Are Ya | 99 | 1 | random |
| Tic-Tac-Toe | 120 | 1 | random |
| Contexto | 79 (51 days ahead) | 1/day | daily schedule |
| Who Would Win | 60 | 10 | random, no memory |

**What is wrong with the current setup.**

1. **The fame tier is the bottleneck, not real history.** Only 134 players are fame
   tier 1–3; 5,074 are tier 4 by default. Who Are Ya and Contexto only use tier 1–2, so
   both are capped at 99 players although ~500 recognizable players exist in the data.
2. **Contexto runs dry.** It must not repeat a secret within 365 days and has 99
   candidates; 79 are used. Around **2026-11-20** fewer than 30 days remain scheduled
   ahead, maintenance raises `BelowMinimum`, and because maintenance shares one
   transaction with every game's build, **the whole game-data publish fails**. Around
   2026-12-20 the schedule ends.
3. **Career Path is padded with unguessable players.** 259 of its 500 questions are
   players with under 3,000 career points.
4. **Every picker samples with replacement and remembers nothing.** With uniform picks a
   repeat is more likely than not after about 1.2·√N questions: Name the Logo repeats in
   the second play, Guess the MVP in the second, Series Winner around the seventh.
5. **Editorial games are tiny.** Fan Favorites (40), Who Would Win (60) and Connections
   (60) are hand-written; nothing grows them.
6. **Difficulty is not modeled.** Nothing measures it, so nothing can keep a mix.

## 3. Principles

These follow Anthropic's guidance in *Building effective agents*: prefer fixed
workflows for well-defined tasks, add agents only where they demonstrably improve the
outcome, and keep a model's job small and checkable.

1. **Our data is the only source of truth for a fact.** A model may propose; code
   computes and verifies. No answer is ever typed by a model.
2. **One pipeline, many games.** Games differ in *data*, not in machinery: each game is a
   module (the existing contract) plus a spec file. No agent or skill per game.
3. **Deterministic and versioned.** Same dataset + same spec version ⇒ same questions.
   Every scoring rule (fame, difficulty, similarity) carries a version number, and a
   question records the versions it was built with.
4. **The owner sets the rules as numbers.** Difficulty mix, thresholds, runway, limits
   live in spec files the owner can edit; prose guidelines live in the skill for the
   few places a model writes text.
5. **Games fail alone.** A game that cannot meet its minimum is held back at its last
   good publication; every other game still ships, and the run is loud about it.
6. **Content written by a model goes through a PR.** Reviewable, revertable, in git.

## 4. Architecture

```
trigger: after each data sync  +  weekly cron (GitHub Actions)
  │
  1. Data gate           sync → parity, plausibility, freshness checks      → fail: stop, alert
  2. Re-materialize      every live question against the new dataset         → retire broken ones
  3. Measure shortfall   per game × difficulty band: days of runway left
                         at the current play rate (GameSession, 14-day window)
  4. Generate            code generators (most games)
                         editorial games: Claude proposes a rule → code computes answers
  5. Hard gates (code)   facts · solvable · not ambiguous · not a duplicate ·
                         difficulty score · consistency limits               → reject with reason
  6. Review (Claude)     editorial games only; separate verifier, fresh context:
                         wording, fairness, fun                              → one retry, then drop
  7. Publish per game    held back on failure; others ship; run is marked red
  8. Learn               GuessLog solve rates → recalibrate difficulty, flag outliers
```

Steps 1–5, 7 and 8 are code that runs in GitHub Actions (the existing
`publish-game-data.yml` already does 2, a fixed-target 3, 4 and 7). Steps 4 (editorial
part) and 6 are the only model steps; they run in the existing cloud routine on the Max
subscription and land as a PR.

### 4.1 Fame score (phase 1)

`backend/trivia/questions/fame.py`, a pure function of a curated row. The row schema is
frozen (contract #1 in `curated_players.py`), so the score is computed, never stored.

```
fame_score = 4·min(All-Star, 15) + 3·min(All-NBA, 15) + 10·MVP + 6·Finals MVP
           + 3·DPOY + 3·(ROY ? 1 : 0) + 2·Sixth Man + min(rings, 5)
           + min(career points / 1000, 25) + 0.5·min(seasons, 20)
```

Bands (lower is more famous, matching the tier convention):

| Band | Name | Rule | Playable players (shipped data) |
|---|---|---|---|
| 1 | STAR | score ≥ 40 | 177 |
| 2 | KNOWN | score ≥ 18 | 501 cumulative |
| 3 | DEEP | score ≥ 10 | 1,038 cumulative |
| 4 | OBSCURE | below 10 | rest |

The hand-set `fame_tier` stays as an **editorial floor**: tier 1 ⇒ at least STAR,
tier 2 ⇒ at least KNOWN, tier 3 ⇒ at least DEEP. It can raise a band, never lower it.
That makes every new eligibility rule a superset of today's, so no live question is
retired by the switch except where we intend it (Career Path's obscure picks).
Spot checks: LeBron 211 (STAR), John Wall 40.6 (STAR), Kyle Korver 24.5 (KNOWN), Zion
Williamson 17.6 (KNOWN via tier floor), Brian Scalabrine 8.1 (OBSCURE).
Known weakness: rookies and young stars score low until they accumulate honours; the
tier floor is the override for them. `fame.VERSION = 1`.

Phase-1 consumers: Who Are Ya (KNOWN+, ~501 questions), Contexto secrets (KNOWN+, 501
candidates ⇒ a full year without repeats), Career Path (3–7 stints and DEEP+, 685
eligible; weight 3 for KNOWN/DEEP, 1 for STAR). Other games keep `fame_tier` until
their phase moves them.

### 4.2 Game spec files (phase 2)

One JSON file per game: `backend/trivia/questions/specs/<slug>.json`, loaded and
validated by `trivia/questions/specs.py`. JSON because the backend has no YAML
dependency. The module constants (`TARGET`, `MINIMUM`, eligibility) are read from it.

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
  "refill": {"runway_days": 90, "minimum": 30, "max_new_per_run": 200},
  "consistency": {"max_player_share": 0.02, "min_decades": 4}
}
```

- **Difficulty** is a weighted sum of normalized features the module computes from the
  materialized question (0 = easiest). The owner edits weights, band edges and mix.
  The generator fills the bands that are under their mix share first.
- **Consistency** checks run over the whole active set after generation: no player in
  more than `max_player_share` of a game's questions, at least `min_decades` decades
  represented, and per-game extras (for example Tic-Tac-Toe: no two boards with the same
  three rows).
- **Duplicates**: `content_hash` (exists) plus a per-game near-duplicate key (for example
  Tic-Tac-Toe: the sorted set of row and column criteria).

### 4.3 Demand-driven refill (phase 3)

The fixed `TARGET` becomes a computed one:

```
daily_use  = GameSession plays of the game over the last 14 days / 14 × rounds per play
target     = clamp(ceil(daily_use × runway_days), minimum, eligible capacity)
```

Daily games (Wordle, Contexto) use `runway_days` directly (one per day). The run reports
each game's runway; a game whose eligible capacity is below its target is reported as
**capacity-bound**, the signal that it needs new data or a new question type rather than
more generation.

### 4.4 Seen tracking (phase 3)

Each picker deals from the questions the player has not seen yet: a per-game seen set
in `localStorage`, keyed by game and pruned to qids still in the current index, reset
when the unseen set is empty. Pool games (`sampleN` in `src/utils/pool.ts`) and question
games (`PICKERS` in `src/utils/gameData.ts`, mirrored in `multiplayer_server/src/gameData.js`)
both use it. Once seen sets exist, step 3 gets a second trigger: refill when 20% of
the last 14 days' active players have seen 70% or more of a game's pool (measured from
`GuessLog`, which already records `question_id` per answer).

### 4.5 Per-game publish isolation (phase 1)

`runner.maintain(..., isolate=True)` runs each game inside its own savepoint. A game
that raises `BelowMinimum` is rolled back alone and reported as held back;
`publish_game_data_v3` drops it from this publish, so its live manifest entry carries
over unchanged (`publish_v3` already carries over entries for games it did not build).
The command writes `held_back=<games>` to `$GITHUB_OUTPUT`, and the workflow fails its
last step when that is non-empty, so the run is red but every other game has shipped.
The legacy `runner.run` (Supabase snapshot, hidden games) keeps all-or-nothing.

### 4.6 Editorial games (phase 4)

Fan Favorites, Connections and Who Would Win need ideas a generator cannot have.

- **Fan Favorites / Connections:** Claude proposes a *rule* in a small JSON query
  language over the dataset (`{"all": [{"award": "dpoy", "min": 2}]}`,
  `{"stint": {"abbr": "SAS"}, "draft_round": 2}`). Code evaluates it to get the complete
  answer set and rejects it if the set is empty, too large, or depends on a field the
  dataset does not have. Prompt wording is Claude's; answers never are.
- **Who Would Win** is a vote, not a fact. Claude proposes notable team-season pairs;
  code verifies each side exists (`playoff.json` season + franchise) and that the pair
  is new.
- **Skill:** the existing `.claude/skills/nba-question-writer` becomes the factory skill:
  its `SKILL.md` gains the factory workflow, and `references/games/<slug>.md` stays the
  per-game file loaded only for the game being worked on. No per-game skill.
- **Two roles, two contexts:** an *author* subagent proposes; a *verifier* subagent sees
  only the proposal and the dataset (never the author's reasoning) and approves,
  rejects with a reason, or asks for one revision. Then a PR to `dev`.

### 4.7 Contexto similarity v2 (phase 5)

Today: `similarity.py` v1, hand weights (franchise-season Jaccard 35, era 20, position 15,
country 10, draft pick 10, awards 10), frozen by a golden test, never checked against
anyone's sense of "similar".

v2:
- **Spec file** `specs/contexto-similarity.json` with features and weights; every
  scheduled day records `sim_version` in its definition, and a day is never re-ranked
  with a different version.
- **Better features:** playing-style profile (normalized ppg/rpg/apg + height), fame
  score, draft class (year), teammate overlap (kept), country region instead of exact
  match.
- **Anchor set** `specs/contexto-anchors.json`, written by the owner (Claude may propose,
  the owner approves): 50–100 pairs that must be in each other's top 20 (Shaq–Kobe,
  Stockton–Malone) and pairs that must rank below 500. A weight change ships only if
  every anchor holds. This is the consistency test.
- **Per-secret gate:** a secret's top 10 must not come from a single team-season, and
  must include at least 6 KNOWN+ players.

### 4.8 Learning loop (phase 6)

A weekly job aggregates `GuessLog` per `(game, question_id)`: plays, solve rate, median
time. It flags questions with a solve rate of 0% or 100% over at least 30 plays (likely
wrong, or trivially easy), and refits each game's difficulty weights so that measured
solve rate is monotonic across easy → medium → hard. Flags are posted to Slack
`#agent-backend`; a flagged question is retired only by the owner.

### 4.9 New data that unlocks capacity (phase 6)

- **Award seasons** for Guess the MVP's format: Finals MVP, ROY, DPOY, Sixth Man, MIP,
  All-Star Game MVP, Coach of the Year, scoring champion (~480 seasons beyond the 71 MVPs).
- **Team history:** former names, relocations, defunct franchises, team-seasons
  (record, coach). Unlocks Name the Logo history and stronger Who Would Win sides.
  Historical logos are trademarks we would hotlink; that is an owner decision first.

## 5. Phases

| Phase | Delivers | Done when |
|---|---|---|
| **1** | Fame score; Who Are Ya, Contexto, Career Path on fame bands; per-game publish isolation | On dev with tests green; a dry-run publish shows Who Are Ya ≈501, Career Path 500 with the obscure picks retired, Contexto ≥ 60 days ahead. **Must be in production before 2026-11-20.** |
| 2 | Spec files, difficulty scores, consistency and near-duplicate gates for the 4 question games | Every active question has a difficulty band; mix within 5 points of spec |
| 3 | Demand-driven targets; seen tracking in web + multiplayer pickers | No repeat until a player has seen the whole pool; run report shows runway per game |
| 4 | Factory skill + author/verifier + rule language; Fan Favorites, then Who Would Win, then Connections | A routine run opens a PR with new content that passes every gate |
| 5 | Contexto similarity v2 + anchor set | All anchors hold; new days carry `sim_version: 2` |
| 6 | Learning loop; award seasons; team history | Weekly flags in Slack; Guess the MVP ≥ 500 seasons |

Each phase gets its own implementation plan in `docs/superpowers/plans/` when it starts.

## 6. Risks

| Risk | Prevention |
|---|---|
| Widening a pool retires live questions | Fame bands use the tier as a floor, so new rules are supersets; only Career Path retires on purpose, and its target is refilled in the same run |
| A bad fame weight floods a game with unknowns | Shipped-data calibration test pins band sizes and named anchors |
| Isolation hides a broken game | `held_back` output + red workflow step; the freshness check also reports it daily |
| A model writes a wrong fact | Models never write answers; rule language is evaluated by code; verifier is a separate context |
| Contexto rankings shift for already-scheduled days | `sim_version` recorded per day; a day is never re-ranked across versions |
| Seen tracking is per browser | Accepted for phase 3; account-level sync is a later option |

## 7. Out of scope

Legacy `backend/trivia/games/*` modules (the pre-question-store builders, used by tests and
`live_pool.py`), hidden games until they are surfaced, the 2026 off-season data sync
itself (it is the existing `sync_nba_data` + `generate_players_curated` run), and any
paid service.

## 8. Decisions

- **No agent or skill per game.** Shared steps are ~80% of the work; per-game agents
  would duplicate and drift. Per-game knowledge lives in spec files (numbers) and the
  skill's per-game reference files (prose).
- **Fame is computed, not stored.** The row schema is frozen; a computed score also
  re-ranks itself automatically when awards or stats change.
- **Who Are Ya widens on purpose.** The game reference used to say "keep tier 1-2 rather
  than widening it". The owner now wants a pool where players do not see repeats, and
  KNOWN-band players (Kyle Korver, Derek Fisher, Robert Horry) are fair over 8 attribute
  clues. Phase 2's difficulty bands are where a "stars only" easy mode would live.
- **Hold back a failing game instead of failing the publish.** The 2026-10-02 design chose
  one transaction for safety; per-game savepoints keep that safety per game, and the
  carried-over manifest entry keeps the failing game playable at its last good state.
