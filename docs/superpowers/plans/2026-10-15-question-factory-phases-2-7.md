# Question Factory — Phases 2–7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (owner's choice 2026-10-15: implementers and reviewers on Opus 5.5 at high effort). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the autonomous question machine: it measures how questions are played, refills by demand without repeats, scores quality, finds and repairs broken questions, writes new editorial content, refreshes its data in the cloud, and reviews itself — with the Checker approving everything and no human step except the owner's promote to production.

**Architecture:** Everything is a GitHub Actions workflow on the public repo. AI steps are `claude-code-action` jobs with the Max-plan OAuth token and no database secret, sandwiched between code jobs that prepare their input and validate their output (the Checker pattern, `.github/workflows/question-checker.yml`). Editorial content becomes `Question` rows of new question modules, so the existing runner, Checker, journal and publisher cover it unchanged. The NBA refresh runs in Actions through a Cloudflare Worker relay (the NBA API refuses datacenter addresses; a Worker gets 200, probed 2026-10-15).

**Tech stack:** Django 5.1 / Python 3.13 backend (sqlite in tests, Postgres on Supabase in prod), Next.js 16 + React 19 + TypeScript frontend, GitHub Actions, `anthropics/claude-code-action@v1`, Cloudflare Workers (wrangler 4, logged in on the owner's PC), `nba_api` 1.11.

**Spec:** `docs/superpowers/specs/2026-10-12-question-factory-design.md` — §4.3 (quality), §4.4 (demand, seen tracking), §4.6 (editorial), §4.7 (memory), §4.8 (journal, review), §4.9 (doctor), §4.10 (Contexto v2), §4.11 (award seasons), §4.12 (Checker, unchanged), §4.13 (refresh), §5 (schedules), §6 (owner decisions of 2026-10-15).

## Global constraints

- **Nothing new or changed reaches players without the Checker.** Every new content path in this plan creates `pending` rows; only `active` publishes. Tests prove it for each new module and each new workflow (search for "unchecked" in Review focus).
- **AI jobs never hold a database secret** and get only `Read`, `Write` and `WebFetch` on the four approved domains (`checker.ALLOWED_SITES`); everything else disallowed. Copy the `check` job of `question-checker.yml` for every new AI job, including `github_token: ${{ secrets.GITHUB_TOKEN }}` (without it scheduled runs are refused — the 2026-10-13 bug).
- **No spending.** No paid plan, API or add-on. Cloudflare free plan only. If a task cannot proceed without money, stop and report; do not work around it.
- **Owner's PC is never required at runtime.** Local commands are for building and testing only.
- The curated row schema stays frozen (`curated_players.py` contract #1). Computed values live in `Question.quality`, specs or new tables.
- Statuses: `pending`, `active`, `quarantined`, `retired`. `STAGED_GAMES` grows to every question module that publishes (see Task 15); `superdraft` and `imposter` stay out (hidden, legacy snapshot).
- Backend tests from `backend/` with `$env:DATABASE_URL=""` and `C:\Users\stefa\AppData\Local\Programs\Python\Python313\python.exe manage.py test <labels>`; full suite `trivia users` takes 40–60 min on this PC, run it once per task group, never edit the worktree while it runs. Frontend: `npx next typegen && npx tsc --noEmit` and `npm run lint`.
- UI changes (Tasks 11, 21) follow `docs/GAME_DESIGN_CONSTRAINTS.md` and go through the `ui-check` skill before the task is done; the implementer reads `.claude/agents/frontend-engine.md` first.
- Commits: one plain line, no AI attribution. Ship each task group to `dev` by PR (`gh pr create --base dev`, wait for checks, merge). **Never promote to `main`** in this plan; the owner promotes after Task 25's report.
- Privacy: any new personal data (seen rows, reports) gets a row in `docs/legal/RECORD_OF_PROCESSING.md` and the matching text in `src/app/privacy/page.tsx` in the same commit as the model; `npm run check:legal` must pass.
- Journal everything: each new command creates a `Journal(kind=...)` and saves it in a `finally`, as `apply_checker_verdicts` does.

## Review focus

1. A `GuessLog` row must never be deleted before it was counted: a row above the roll-up watermark survives cleanup even when older than 30 days — pinned in Task 4.
2. A seen set that excludes every question (small pool, long-time player) must fall back to the full pool, never to an empty deal or a hung start — pinned in Task 7.
3. A corrupt or oversized AI output (doctor verdict, editorial proposal, review cards) must be rejected and journaled, never applied; a proposal naming a player not in the dataset is rejected — pinned in Tasks 14, 17, 19.
4. A data correction may only change a value when two sources on two different approved domains agree, and it never applies before the Checker confirmed it — pinned in Task 14.
5. A refresh that produces a dataset failing the validators (parity, plausibility, cross-stint) must leave the previous dataset in place and post to Slack; a relay without the key header returns 401 — pinned in Task 23.
6. The nightly health line must fire when a Checker run approved nothing while questions were pending (the exact failure of 2026-10-13/14) — pinned in Task 1.

---

## Part A — Watchdog and cap

### Task 1: Factory health check and Checker cap

**Files:**
- Create: `backend/trivia/questions/health.py`, `backend/trivia/management/commands/factory_health.py`
- Modify: `backend/trivia/questions/checker_jobs.py` (`export_batches`: `limit="auto"`), `backend/trivia/management/commands/export_checker_batches.py` (`--limit` accepts `auto`), `.github/workflows/question-checker.yml` (default `limit` input `auto`)
- Test: `backend/trivia/tests/test_factory_health.py`, `backend/trivia/tests/test_checker_jobs.py`

**Interfaces:**
- `health.check(now) -> list[dict]`: each `{"code", "severity": "warn"|"error", "text"}`. Codes: `checker_idle` (the newest `FactoryRun(kind="checker")` in the last 36 h has no `approved`/`quarantined`/`unsure` events while ≥ 1 question was `pending` at its start), `checker_missing` (no checker run in 36 h while pending > 0), `held_back` (newest supply run has a `held_back` event), `refresh_failed` (newest `kind="refresh"` run is `failed`), `backlog` (pending > 300), `needs_owner` (any `needs_owner` event in the last 7 days not yet followed by a status change of that question).
- `manage.py factory_health [--slack]`: prints the lines; with `--slack` writes them to stdout in the shape `node scripts/slack.mjs post-text backend -` consumes (one block, prefixed `Factory health —`), exit code 0 always; journals a `health` run with one event per finding.
- `export_batches(..., limit="auto")`: 150 while pending ≥ 150, else 60 (owner decision 2).

- [ ] Tests first: a fixture journal with a checker run of 0 events + 5 pending rows → `checker_idle`; a run with 1 `approved` → no finding; no run for 48 h + pending → `checker_missing`; `held_back` event → finding; `limit="auto"` with 200 pending exports 150, with 20 pending exports 20 (capped by 60).
- [ ] Implement; wire the health command into the nightly workflow created in Task 5 (that task adds the step; here the command only).
- [ ] Commit `feat(factory): health check and auto Checker cap`.

## Part B — Phase 3: memory, no repeats, demand

### Task 2: Answer logging for the five pool games (frontend)

**Files:**
- Modify: `src/Game Renderers/PlayOffSeries.tsx`, `NameLogo.tsx`, `GuessMvps.tsx`, `StartingFive.tsx`, `Wordle.tsx`; `src/types/types.tsx` (`PlayoffSeries.match_id: string`, `StartingFiveGame.game_id: string`, `NbaTeamLogo.team_id` required); `src/types/review.ts`
- Create: `src/utils/guessLog.ts` (`createGuessLogger(game) -> {add(entry), flush()}`; one `apiFetch` POST to `/trivia/log-guesses/` with `keepalive: true`, max 100 entries, swallow errors)

**Interfaces (question_id per game, used by roll-ups, the doctor and reports):** series-winner → `match_id`; name-logo → `String(team_id)`; guess-mvps → `season`; starting-five → `game_id`; wordle → the solution word (the server maps it to `WordleDailyWord`).
**Review ids:** add `matchId` to `series-winner.rounds[]`, `gameId` to `starting-five.matchup`, keep `teamId`/`season`; add `qid` to `fan-favorites`, `tictactoe`, `who-would-win` (new union member `{game:"who-would-win"; rounds:{qid,a,b,pick}[]}`) in `src/types/review.ts` and the renderers that build them.

- [ ] Each renderer: log one entry per answered round (`correct`, `elapsed_ms`), flush on game end and unmount, exactly the CareerPath pattern (`CareerPath.tsx:119-129`) through the new helper. Refactor no other renderer.
- [ ] `npx tsc --noEmit` and `npm run lint` pass; a Playwright smoke (the `qa-protocol` skill) shows one `log-guesses` POST per finished game for the five games.
- [ ] Commit `feat(games): log answers in the five pool games`.

### Task 3: Roll-up tables and nightly roll-up

**Files:**
- Modify: `backend/trivia/models.py` (+ migration): `QuestionStats(game, question_id, day, attempts, correct, skips, time_ms_sum, time_ms_p50, players)` unique `(game, question_id, day)`; `WrongAnswerStats(game, question_id, answer_norm, count, players, first_seen, last_seen)` unique `(game, question_id, answer_norm)`; `GameDailyStats(game, day, mode, plays, players)` unique `(game, day, mode)`; `RollupWatermark(name, last_id, updated_at)`.
- Create: `backend/trivia/questions/rollup.py`, `backend/trivia/management/commands/rollup_answers.py`
- Test: `backend/trivia/tests/test_rollup.py`

**Interfaces:**
- `rollup.run(journal, batch=5000) -> dict`: processes `GuessLog` rows with `id > watermark("guess_log")` in id order, batches of 5000, each batch in one transaction that also advances the watermark; `players` = distinct `user_id` (guests counted once per day as one anonymous player); `answer_norm` = `trivia.utils.text_utils`'s normalization used by Fan Favorites (`normalizeAnswer` twin), only for wrong answers; p50 over the day's rows merged with the existing row by a stored sorted sample capped at 200 values in `QuestionStats.time_sample` (JSON). `GameSession` rows roll into `GameDailyStats` with watermark `"game_session"`.
- Idempotent: running twice adds nothing.

- [ ] Tests first: 3 rows → counts; rerun → unchanged; batch boundary (7 rows, batch 3) → all counted and watermark = max id; wrong answers normalized and merged; guests vs users in `players`; `GameDailyStats` from sessions.
- [ ] Implement; `makemigrations --check` clean.
- [ ] Commit `feat(factory): nightly roll-ups of answers and plays`.

### Task 4: Cleanup, 30-day retention, compaction

**Files:**
- Create: `backend/trivia/questions/cleanup.py`, `backend/trivia/management/commands/factory_cleanup.py`
- Modify: `backend/users/retention.py` (`GUESS_LOG_DAYS = 30`, and `prune_personal_data` deletes `GuessLog` only where `id <= watermark("guess_log")`), `src/app/privacy/page.tsx` (rows 47 and 53: "Answers: 30 days"), `docs/legal/RECORD_OF_PROCESSING.md` (row 6)
- Test: `backend/users/test_retention.py`, `backend/trivia/tests/test_cleanup.py`

**Interfaces:** `cleanup.run(journal, now)`: (a) retired `Question` rows with `retired_at < now-180d` get `definition` reduced to `{}` except contexto (`{secret_person_id, day}` kept), `quality={}`, `players_referenced=[]`, event `compacted`; (b) `FactoryEvent` older than 180 d deleted, runs kept; (c) `SeenQuestion` rows whose question is retired deleted (Task 6 model; guard with `apps.get_model`); (d) returns counts, journals `cleaned`.

- [ ] Tests first: a 40-day-old GuessLog row above the watermark survives `prune_personal_data`; one below it is deleted; compaction keeps `content_hash` and the contexto slim definition; the runner's `_next_seq`/dedupe is unchanged after compaction (generate twice, same output).
- [ ] `npm run check:legal` passes after the policy edits.
- [ ] Commit `feat(factory): cleanup job; raw answers kept 30 days`.

### Task 5: Nightly workflow

**Files:** Create `.github/workflows/factory-nightly.yml` (cron `0 2 * * *` + dispatch): checkout, Python, `rollup_answers` → `factory_cleanup` → `doctor_scan` (Task 13; add the step there) → `factory_health --slack | node scripts/slack.mjs post-text backend -` only when the health output is non-empty (`SLACK_BOT_TOKEN`). A failing step must not skip health (use `if: always()` on the health step).

- [ ] YAML parses (`python -c "import yaml,..."`), dispatched once on the branch via a push trigger limited to the branch name (remove the push trigger before merge).
- [ ] Commit `ci(factory): nightly roll-up, cleanup and health`.

### Task 6: Seen tracking — backend

**Files:**
- Modify: `backend/trivia/models.py` (+ migration): `SeenQuestion(user FK CASCADE, game 40, qid 60, seen_at)` unique `(user, game, qid)`, index `(user, game)`.
- Modify: `backend/trivia/views.py`, `backend/trivia/urls.py`: `GET /trivia/seen/<game>/` → `{"qids": [...]}` (IsAuthenticated, ≤ 5,000 ids, newest first); `POST /trivia/seen/` `{game, qids[≤200]}` → `{"added": n}` (IsAuthenticated, `ignore_conflicts`), throttle scope `"seen": "240/hour"`.
- Modify: `backend/users/account_data.py` (export + delete include `SeenQuestion`), `docs/legal/RECORD_OF_PROCESSING.md` (new row "Questions already shown to you — account holders — no repeats — contract — until the question is retired or the account is deleted"), `src/app/privacy/page.tsx` (one line in the table).
- Test: `backend/trivia/tests/test_seen.py`

- [ ] Tests first: anonymous → 401; POST then GET round-trips; duplicate POST → `added 0`; 201st id ignored; export contains the rows; delete-account removes them.
- [ ] Commit `feat(seen): account-level seen questions`.

### Task 7: Seen tracking — frontend, no repeats

**Files:**
- Create: `src/utils/seen.ts`: `loadSeen(game) -> Set<string>` (localStorage `seen:<game>`, try/catch), `markSeen(game, ids)`, `pruneSeen(game, validIds)`, `syncSeenFromServer(game)` (once per game start for signed-in users, `apiFetch` GET, merged into the set, 1.5 s timeout, errors ignored), `flushSeenToServer(game)` (batched POST of ids not yet acknowledged, on game end and `pagehide` with `keepalive`).
- Modify: `src/utils/pool.ts` (`sampleN` → `sampleUnseen(pool, n, idOf, seen)`: prefer unseen; when fewer than `n` unseen remain, take all unseen then reset the set and fill from the rest), `src/utils/gameData.ts` (`fetchGameRows` and the question pickers filter `index.items` by seen qids, same reset rule; `contexto` and `wordle` excluded), `src/views/Trivia/MiniGame.tsx` (`handleStart` awaits `syncSeenFromServer` with the timeout; `onGameEnd` calls `flushSeenToServer`).
- Ids per game: pool games use the Task 2 question ids; question games use `qid`.
- Test: `src/utils/__tests__/seen.test.ts` (vitest if present, else a `scripts/check-seen.mjs` run by `npm run lint`'s `check:*` family) covering: unseen preferred, reset when exhausted, prune drops ids no longer in the pool, localStorage unavailable → in-memory set.

- [ ] Starting a game never waits more than 1.5 s on the server set (measured in the test with a hanging fetch mock).
- [ ] Multiplayer untouched (`multiplayer_server/` has no diff).
- [ ] `tsc`, `lint`; `qa-protocol` smoke: play Name the Logo twice signed in; the second game shows five logos not seen in the first.
- [ ] Commit `feat(seen): no repeats until the pool is exhausted`.

### Task 8: Demand-driven refill

**Files:**
- Modify: `backend/trivia/questions/runner.py` (`_process_game` target), new `backend/trivia/questions/demand.py`
- Test: `backend/trivia/tests/test_demand.py`, `test_questions_runner.py`

**Interfaces:** `demand.target_for(slug, mod, now) -> (target, detail)`: `daily_use` = plays of the game over the last 14 days from `GameDailyStats` (all modes) / 14 × `ROUNDS_PER_PLAY[slug]` (career-path 1, who-are-ya 1, tictactoe 1, contexto 1, editorial games from Task 15: fan-favorites 1, who-would-win 10, connections 1); `target = clamp(ceil(daily_use × runway_days), mod.MINIMUM, capacity)` with `runway_days` from the spec (Task 9; 90 default) and `capacity = mod.capacity(dataset)` (new optional module function; default `None` = unbounded). With no stats in 14 days → the spec's static target. `detail` carries the numbers; the runner logs them in `refill_decision` and logs `capacity_bound` when `target == capacity < demand`.

- Second trigger (spec §4.4, saturation): `demand.saturation(slug, now)` = share of users with a `GameSession` of this game in the last 14 days who have `SeenQuestion` rows for ≥ 70% of the game's active qids. When ≥ 0.2, `target = max(target, ceil(active × 1.5))` (still capped by capacity) and the runner logs `saturation` with the share.
- [ ] Tests: no stats → static; 20 plays/day × 10 rounds × 90 days → 18,000 clamped to capacity; below minimum clamps up; saturation 0.25 raises the target by half, 0.1 does not.
- [ ] Commit `feat(factory): refill by demand`.

## Part C — Phase 2: quality

### Task 9: Spec files per game

**Files:**
- Create: `backend/trivia/questions/specs.py` (`load(slug) -> dict`, schema check with clear errors, cached), `backend/trivia/questions/specs/{career-path,who-are-ya,tictactoe,contexto}.json` with the §4.3 shape (`eligibility`, `difficulty.features/bands/mix`, `interest.features/min`, `coverage.axes/min_decades`, `refill.runway_days/minimum/target/max_new_per_run`, `consistency.max_player_share`). Mix default 40/40/20.
- Modify: the four modules read `TARGET`, `MINIMUM` and eligibility thresholds from their spec at import (module attributes kept, so existing `mock.patch("…TARGET")` tests still work).
- Test: `backend/trivia/tests/test_specs.py` (every spec loads; a bad spec fails with the field name; module constants equal the spec).

- [ ] Commit `feat(factory): per-game spec files`.

### Task 10: Difficulty, interest, coverage, selection

**Files:**
- Create: `backend/trivia/questions/quality.py`: `score(mod, materialized, dataset, spec) -> {"difficulty": 0..1, "band": "easy|medium|hard", "interest": 0..1, "coverage": {axis: value}, "dup_key": str}`; each module implements `features(m, dataset) -> dict` (career-path: fame band of the player, stint count, has memorable stop = a ring/All-Star season/one of 10 marquee franchises; who-are-ya: fame band, era age, distinct clues; tictactoe: mean cell size, min cell size, famous answers per cell; contexto: fame band, era) and `dup_key(definition, m)` (tictactoe: sorted row+col values; others: the person id).
- Modify: `runner._process_game`: over-generate `3 × shortfall` (capped by `max_new_per_run`), score each, drop `interest < spec.interest.min` and duplicate `dup_key`s (against active+pending), then select greedily: the band furthest below its mix share first, then the empty coverage cell first; store the scores in `quality`; log `rejected` (reason `low_interest|duplicate|consistency`) and a `gap_report` event with empty coverage cells and the final mix.
- Test: `backend/trivia/tests/test_quality.py` (features and bands on fixture players; selection fills the under-target band; a low-interest candidate is rejected; two candidates with one dup_key keep one; `max_player_share` enforced).

- [ ] Commit `feat(factory): difficulty, interest and coverage selection`.

## Part D — Phase 5: doctor and reviewer

### Task 11: "Report a problem" (backend + shell UI)

**Files:**
- Modify: `backend/trivia/models.py` (+ migration): `QuestionReport(user null SET_NULL, game, question_id, note ≤ 500, status new|handled, created_at)`; `views.py`/`urls.py`: `POST /trivia/report-question/` `{game, question_id, note?}` (AllowAny, throttle `"report": "10/hour"`), returns `{"ok": true}`; `users/account_data.py` export/delete; privacy row.
- Modify: `src/views/Trivia/MiniGame.tsx` (keep `opts.review` in state; pass `onReport` to `GameResult`; when `endedInPlace`, the `.exit-link` element becomes the "Report a problem" link in the same box — no layout shift), `src/components/GameResult.tsx` (optional `onReport` → a small text link under the buttons), new `src/components/modals/ReportQuestionModal.tsx` (lists the rounds from the review with a per-game label mapper in `src/utils/reviewRounds.ts` returning `{question_id, label}[]`; a 500-char note; POST; thanks state), `src/Game Renderers/*` already carry ids after Task 2.
- Test: backend `test_reports.py`; frontend `reviewRounds` unit test for every `AnswerReview` member.

- [ ] Read `.claude/agents/frontend-engine.md` and `docs/GAME_DESIGN_CONSTRAINTS.md` (rules 4.5, 4.6, 6.2, 7.3, 7.4) before touching the shell; the control is shell-owned (allowed by 7.3/7.4 as the shell's own change), no per-game markup.
- [ ] Run the `ui-check` skill on the games suite; fix findings with `ui-fix` before the task is done.
- [ ] Commit `feat(games): report a problem on any question`.

### Task 12: Data corrections model and dataset overlay

**Files:**
- Modify: `backend/trivia/models.py` (+ migration): `DataCorrection(person_id, field_path "awards.smoy"|"teams[2].end_year"|…, old_value JSON, new_value JSON, sources JSON, reason, status proposed|checking|active|rejected|redundant, created_by, run FK null, created_at, decided_at)`.
- Create: `backend/trivia/questions/corrections.py`: `apply(rows) -> rows` (active corrections overlaid by a JSON-pointer-like path; invalid path → journaled and skipped), `mark_redundant(rows)` (an active correction whose `new_value` now equals the regenerated value becomes `redundant`).
- Modify: `publish_v3.curated_dataset()` applies `corrections.apply` and appends `+c<n>` (count of active corrections) to the dataset version so the Checker shas change exactly when a correction lands.
- Test: `test_corrections.py` (overlay a stint year; invalid path skipped; version suffix; redundant marking).

- [ ] Commit `feat(factory): data corrections overlay`.

### Task 13: Doctor signal scan (nightly, code)

**Files:**
- Create: `backend/trivia/questions/doctor.py` (`scan(now, journal) -> summary`), `backend/trivia/management/commands/doctor_scan.py`
- Modify: `.github/workflows/factory-nightly.yml` (step after cleanup; when `quarantined > 0` dispatch `publish-game-data.yml` with the staged games, default branch only)

**Signals (from the spec, §4.9), read from the roll-ups and `QuestionReport`:** solve-rate anomaly (≥ 30 attempts, solve rate < 3%, or < 0.4 × the game's band median), wrong-answer cluster (same `answer_norm` from ≥ 5 players and ≥ 15% of wrong answers), reports (≥ 1). **Strong** (≥ 3 reports, or anomaly + cluster, or an `invalid` audit verdict) → `status=quarantined`, `quality.doctor={"signals":[...],"at":...}`, event `quarantined/signal`. **Weak** → `quality.doctor_queue=true`, event `flagged`. Also marks 20 random `active` questions per week (Thursdays) with `quality.audit_due=true` (event `audit_selected`). The scan is idempotent and never touches `pending` rows.

- [ ] Tests: each rule; strong vs weak; a question with `doctor_queue` is not re-flagged; audit selection is 20 and only on Thursday.
- [ ] Extend `export_checker_batches --audit` (Task 1's file) to export `audit_due` active rows as `audit-NNN.json` batches and `apply_checker_verdicts` to accept them: `valid` → clear `audit_due`, refresh `checked`; `invalid` → quarantine + event `checker_miss` when the row had a prior `checked`. `question-checker.yml` gets a second cron `0 3 * * 4` and an input `mode: pending|audit|corrections` (schedule picks `audit` on Thursdays by the same slot test the publish gate uses); `references/checker.md` gains an "Audit batches" paragraph (same rules; the question is live, so be strict).
- [ ] Commit `feat(doctor): nightly signal scan and random audit`.

### Task 14: Doctor research (weekly, AI) and correction confirmation

**Files:**
- Create: `backend/trivia/management/commands/export_doctor_cases.py` (quarantined + `doctor_queue` rows → `doctor/case-NNN.json`: checker view, the referenced curated rows, wrong-answer clusters, report notes, signals; ≤ 40 cases), `backend/trivia/management/commands/apply_doctor_verdicts.py`, `backend/trivia/questions/doctor_verdicts.py`, `.claude/skills/nba-question-writer/references/doctor.md` (the agent's instructions: research on the four sites, two independent domains for any correction, output schema), `.github/workflows/doctor-research.yml` (Tue 03:00 + dispatch; export → AI (matrix) → apply).
- Verdict schema: `{"game","qid","verdict": "data_correction"|"fix_answers"|"add_alias"|"reband"|"retire"|"false_alarm"|"needs_owner", "corrections":[{"person_id","field_path","old_value","new_value","sources":[...]}], "answers":[...], "alias":{...}, "rationale", "sources"}`.
- Apply rules (code, untrusted input): `data_correction` → `DataCorrection(status="proposed")` only if ≥ 2 sources on ≥ 2 distinct approved domains, `old_value` equals the current value, `person_id` exists; the question stays quarantined until the Checker confirms the correction (next step); `false_alarm` → `status=pending` (re-check, never straight to active); `retire` → retired; `reband` → `quality.band` set; `needs_owner` → event + Slack line via health; anything else → rejected.
- Correction confirmation (`references/checker.md` gains a "Correction batches" paragraph: confirm the *new* value on two domains): `export_checker_batches --corrections` exports proposed corrections as `correction-NNN.json` (`{"kind":"correction","person_id","player","field_path","old_value","new_value","sources"}`), `apply_checker_verdicts` on a `valid` verdict sets the correction `active` and moves every quarantined/pending question referencing that player to `pending` (re-materialized next supply run; the view changes, so it is re-checked); `invalid` → `rejected`.
- Test: `test_doctor_research.py` (each verdict kind; one-domain sources rejected; old_value mismatch rejected; malformed file journaled; correction confirmation flips status and re-pends the question).

- [ ] Commit `feat(doctor): weekly research with Checker-confirmed corrections`.

### Task 15: Editorial games as question modules

**Files:**
- Create: `backend/trivia/questions/rules.py`: a small JSON rule language over curated rows — predicates `award(kind, min)`, `allstar(min)`, `allnba(min)`, `career(stat, min)`, `draft(pick_max|round|year_from|year_to|undrafted)`, `country(code)|international`, `stint(abbr)`, `debut_decade(y)`, `seasons(min)`, `position(P)`, `playoff_team(season, franchise)` (over `trivia/data/playoff.json`), combinators `all`, `any`, `not`; `evaluate(rule, dataset) -> list[row]`; `describe(rule) -> str`; a strict validator (`RuleError`).
- Create: `backend/trivia/questions/games/fan_favorites.py` (definition `{prompt, category, rule, survey_date}`; materialize = answers from `evaluate`, counts = fame-weighted shares normalized to 100 with `estimated: true` until live standings (≥ 500 guesses from the roll-ups) replace them; validate 6–17 answers; `checker_view` = prompt + answer list + category; `dup_key` = normalized prompt), `who_would_win.py` (definition `{a:{season, franchise, sub}, b:{...}}`; materialize validates both sides exist in `playoff.json` and renders `label`/`sub` like the seed; `checker_view` = both team-seasons; `dup_key` = sorted pair), `connections.py` (definition `{groups:[{label, rule, members[4], difficulty}]}`; materialize checks every member satisfies its rule and the cross-trap check of `connections_validate._derive`; `checker_view` = labels + members).
- Modify: `questions/games/__init__.py` (register), `checker.STAGED_GAMES` (+ the three), `publish_v3` (`fan-favorites` built from active Question rows, keeping the chunk-per-qid layout and merging live standings from `FanFavoritesQuestion`/roll-ups as today; **`who-would-win` added to the v3 `GAMES` specs** (kind `single`, sorted by qid, built from active rows) and to the frontend `POOL_GAMES` in `src/utils/gameData.ts` so new matchups publish through the data host like the other pool games; `connections` stays on the legacy static file while hidden: `trivia/games/connections.build_pool` reads active Question rows, falling back to the seed, so the next `build_pools_from_db` picks approved boards up), `.claude/skills/nba-question-writer/references/checker.md` (one paragraph per editorial view: what each claim means and how strict to be — a Fan Favorites answer list must be complete for its rule; a Who Would Win side must be a real team-season; every Connections member must fit its own label).
- Row shapes published for the three games stay field-for-field identical to today's (a test compares against the committed `trivia/data/*.json`), so no renderer changes.
- Create: `backend/trivia/management/commands/import_editorial_seeds.py`: one-time import of the three seed files into `Question` rows (`status=active`, `quality.checked={"verdict":"legacy"}`, `created_by="seed"`), idempotent by qid.
- Test: `test_rules.py` (every predicate on fixture rows; invalid rule errors), `test_questions_editorial.py` (materialize/validate/checker_view/dup_key per module; published row shape equals the current seed-built shape field for field).

- [ ] Commit `feat(editorial): fan favorites, who would win and connections as question modules`.

### Task 16: Editorial author (weekly, AI)

**Files:**
- Create: `backend/trivia/management/commands/export_editorial_brief.py` (→ `editorial/brief.json`: the rule language reference with examples, the dataset's field catalogue with value ranges, existing prompts/pairs/groups (to avoid duplicates), coverage gaps per game, 5 per-game quotas, and 40 sample players with their rows), `backend/trivia/management/commands/apply_editorial_proposals.py` (→ `pending` Question rows through each module's `materialize`+`validate`+quality gates; rejects duplicates, oversized answer sets, unknown players; ≤ 5 per game per run), `.claude/skills/nba-question-writer/references/author.md` (instructions and output schema: `{"game","definition","why"}`), `.github/workflows/editorial-author.yml` (Wed 03:00 + dispatch; export → AI → apply).
- Test: `test_editorial_author.py` (a good proposal lands pending; a duplicate, an unknown player and a malformed file are rejected and journaled; nothing becomes active).

- [ ] Commit `feat(editorial): weekly author run, Checker-gated`.

### Task 17: Improvement review (every two weeks, AI) and calibration

**Files:**
- Create: `backend/trivia/management/commands/factory_digest.py` (`--days 14` → `build/digest.md` + `digest.json`: KPIs of §4.8 incl. Checker miss rate, unsure share, audit error rate, runway per game, band solve-rate monotonicity, coverage gaps, held-back count, DB size via `pg_database_size` when Postgres, run durations, rejections by reason), `backend/trivia/questions/calibration.py` (`propose_band_edges(game) -> new bands or None` when solve rates are not monotonic easy→hard over ≥ 300 answers), `.claude/skills/nba-question-writer/references/reviewer.md`, `.github/workflows/factory-review.yml` (every other Sunday 06:00 via a week-parity gate job + dispatch; digest job (DB) → AI job writes `docs/factory/reviews/<date>.md` and `review/cards.json` (≤ 3 cards `{title, category, priority, body}`) → apply job: opens a PR to `dev` with the review file and any calibration spec change (`gh pr create` + `gh pr merge --auto --merge`), and creates the Notion cards with `node scripts/notion.mjs create-card … --body-file` (`NOTION_TOKEN`)).
- Test: `test_factory_digest.py` (digest from fixture journal/stats; calibration proposes edges only when non-monotonic; cards.json validation rejects > 3 or missing fields).

- [ ] Commit `feat(factory): fortnightly self-review`.

## Part E — Phase 7

### Task 18: Contexto similarity v2 with anchors

**Files:**
- Create: `backend/trivia/questions/specs/contexto-similarity.json` (v2 features and weights: franchise-season Jaccard 30, era overlap 15, position family 10, draft class year proximity 10, style profile 15 (cosine over normalized ppg/rpg/apg + height), fame closeness 10 (1 − |Δfame_score| / 100), country region 10 (same country 1.0, same region 0.5, map in the spec)), `backend/trivia/questions/specs/contexto-anchors.json` (≥ 60 pairs: `near` pairs that must be in each other's top 20 — teammates and era peers, e.g. Stockton–Malone, Shaq–Kobe, Splash Brothers, Duncan–Parker–Ginobili, Jordan–Pippen, Magic–Kareem, Bird–McHale, Jokić–Murray; `far` pairs that must rank beyond 500, e.g. a 1950s center vs a 2020s guard).
- Modify: `similarity.py` (`similarity_v2`, `rank_pool(secret, playable, year, version)`), `questions/games/contexto.py` (definitions created from now on carry `"sim_version": 2`; materialize uses the definition's version, default 1, so scheduled days never change; `validate` adds the per-secret gate for v2: the top 10 must not all share one team-season and must include ≥ 6 KNOWN-or-better players, else `Invalid` and `generate` skips that secret), `multiplayer_server`/frontend untouched (ranking is server-computed).
- Test: `test_questions_similarity.py` (v1 golden unchanged; every anchor holds for v2 on the shipped dataset; a scheduled v1 day re-materializes identically; the per-secret gate rejects a constructed one-team-season top 10).

- [ ] Commit `feat(contexto): similarity v2 with anchor pairs`.

### Task 19: Award seasons for Guess the MVP

**Files:**
- Create: `backend/trivia/data_pipeline/award_seasons.py` (`build(rows, mvps_csv) -> rows`: `{season, award: "MVP"|"Finals MVP"|"Defensive Player of the Year"|"Rookie of the Year"|"Sixth Man of the Year", winners: [{name, person_id, team, team_logo_url|null}], prompt}` from `awards.fmvp/dpoy/roty/smoy` years and the MVP CSV; team = the stint covering the award season's end year, logo from the Team table's CDN URL when one franchise matches, else null; co-winners kept (ROY 1971/1995/2000); the 1989 Sixth Man gap is filled by a `DataCorrection` created in this task for person 698 with its two sources).
- Modify: `build_pools_from_db.build_mvps` → the new rows (the `mvps` pool keeps `season`, `mvp`, `team`, `team_logo_url` for the MVP rows so old clients still work, plus `award`, `winners`, `prompt`), `src/Game Renderers/GuessMvps.tsx` (prompt from the row: "Who was the {award} in {season}?"; accepts any co-winner; `question_id = f"{season}:{award}"`), multiplayer relay deals the same rows (no change needed; assert in a test that the row shape is additive).
- Test: `test_award_seasons.py` (counts: MVP 71, FMVP 58, DPOY 44, ROY 74, SMOY 44 after the correction; co-winner rows; team inference on a trade season gives null), frontend unit test for the prompt and co-winner match; `ui-check` games suite.

- [ ] Commit `feat(guess-mvps): every major award season`.

## Part F — Data refresh in the cloud and go-live

### Task 20: Cloudflare Worker relay

**Files:** Create `infra/nba-relay/wrangler.toml` (name `nba-relay`, `account_id` = the owner's personal account `8d0328eded45f6ea471f9dd240cacf2d`, `workers_dev = true`), `infra/nba-relay/src/index.js` (only `GET /stats/<endpoint>?<query>`; requires header `X-Relay-Key` equal to the Worker secret `RELAY_KEY`, else 401; forwards to `https://stats.nba.com/stats/<endpoint>` with the NBA browser headers; passes status and body through; 25 s timeout; no other paths), `infra/nba-relay/README.md` (deploy: `wrangler deploy`, `wrangler secret put RELAY_KEY`; rotation).

- [ ] Deploy from this PC (wrangler is logged in); generate a 32-byte key, store it as the Worker secret and as GitHub secret `NBA_RELAY_KEY` (`gh secret set`), the URL as repo variable `NBA_RELAY_BASE` (`gh variable set`). Verify: without the header → 401; with it → `commonplayerinfo` 200.
- [ ] Commit `infra(nba-relay): Cloudflare relay for the NBA stats API`.

### Task 21: Backend relay support

**Files:** Create `backend/trivia/data_pipeline/relay.py` (`configure()`: when `NBA_RELAY_BASE` is set, sets `nba_api.library.http.NBAStatsHTTP.base_url = f"{base}/stats/{{endpoint}}"` and adds `X-Relay-Key` to `NBAStatsHTTP.headers`; idempotent); call it at the top of `sources.py`'s fetch functions (one call in a module-level guard); `docs/DATA_PIPELINE.md` (replace the residential-IP section with the relay).
- Test: `test_relay.py` (with the env set, a `responses`-style mocked session sees the relay URL and header; unset → the real base URL).

- [ ] Commit `feat(pipeline): route nba_api through the relay when configured`.

### Task 22: Refresh workflow

**Files:** Create `.github/workflows/data-refresh.yml`: `schedule: "0 1 1 * *"` + dispatch + `push` on `refresh/**` branches (so it can run before promotion). Jobs: **sync** (`sync_nba_data --seasons 2 --max-games 20 --timeout 25` with `DATABASE_URL`, `NBA_RELAY_BASE`, `NBA_RELAY_KEY`; journals `kind="refresh"` via a new `--journal` flag) → **curated** (`generate_players_curated --rewrite-all-players --cache-dir .nba_api_cache` with the cache dir saved/restored as a workflow artifact `nba-raw-cache` so a retry resumes; timeout 330 min) → **validate** (`curated_validate` + `check_parity`; on failure: Slack + stop, previous dataset untouched) → **land** (commit `players_curated.json` and `all-players.json` to a branch `refresh/<date>` — award seasons derive from the curated file at build time, Task 19 —, `gh pr create --base dev`, `gh pr merge --auto --merge`; `upload_dataset`) → **supply** (`gh workflow run publish-game-data.yml` with `trigger=data-refresh`, only on the default branch).
- Also: `sync_nba_data` gains `--journal` (FactoryRun kind `refresh`, status failed on any exception) so Task 1's `refresh_failed` fires.
- Test: `test_sync_journal.py`; a dispatched run from a `refresh/test` branch completes `sync` and `curated` with `--limit 25` (input `limit` for test runs) and opens a PR.

- [ ] Commit `ci(refresh): monthly data refresh in the cloud`.

### Task 23: Full refresh now; retire the PC task

- [ ] Run `data-refresh.yml` from a `refresh/2026-10` branch without a limit (the full ~16k-call run). Watch it; merge its PR into `dev` when the validators pass. Record counts (players, playable, award seasons) in the ledger.
- [ ] Disable the Windows task: `schtasks /Change /TN "NBA Data Refresh" /DISABLE` (never delete), and note it in `docs/DATA_PIPELINE.md` and `docs/DEPLOYMENT.md`.
- [ ] Commit `docs(pipeline): refresh runs in the cloud; PC task disabled`.

### Task 24: Full suite, PR to dev, hand-off review

- [ ] Full backend suite green; `tsc`, `lint`, `next build` green; `ui-check` report has no new findings.
- [ ] Branch merged to `dev` (one PR per part is fine). No promotion.

### Task 25: Check everything, then report for promotion

- [ ] Dispatch `question-checker.yml` with `--ref dev` and `limit=150` daily (or manually several times with `limit=300`) until `pending = 0` across all staged games, including the editorial games' first author run and the audit batches. The publish step is default-branch-only, so nothing goes live from dev.
- [ ] Report to the owner: per game active/pending/quarantined counts, the Checker's miss and unsure rates, refresh counts, what the promotion will ship (`git log main..dev`), and the one command to promote. **Stop there.**
