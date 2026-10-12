# Question Factory — Phase 4 (the Checker) Implementation Plan

> **For agentic workers:** executed inline by the planner (owner chose native execution, option A,
> 2026-10-12). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nothing new reaches production unless a validity-only Checker agent approved it; then
the supply run can be scheduled weekly and the whole factory promoted.

**Architecture:** New and changed questions of the four public question games get status `pending`
instead of `active`; publishing ships `active` only (unchanged). A daily GitHub workflow runs three
jobs: **export** (has the DB secret) writes pending questions as small JSON batches holding exactly
what a player sees; **check** (no DB secret, Claude via the Max-plan OAuth token, web limited to the
four approved sites by Claude Code permission rules) writes one verdict per question with
claim-by-claim evidence; **apply** (has the DB secret) re-validates each verdict in code, applies it,
journals it and triggers a publish of the question games. The weekly supply run is a cron on the
existing publish workflow.

**Tech stack:** Django 5.1, Python 3.13, GitHub Actions, `anthropics/claude-code-action@v1`.

**Spec:** `docs/superpowers/specs/2026-10-12-question-factory-design.md` §3 (principles 7 and 9),
§4.1 step 6, §4.12, §5, §6.

## Decisions taken in this plan (rulings against the spec)

- **Runs in GitHub Actions, not a claude.ai routine.** The repo is public (free Actions minutes) and
  already holds `CLAUDE_CODE_OAUTH_TOKEN` (Max plan, no API cost). Job separation gives principle 7
  (the AI never holds DB credentials) without the `factory-inbox` branch: artifacts carry batches and
  verdicts between jobs. The inbox branch stays the design for phase 5/6 routines.
- **Site restriction is enforced by Claude Code permissions** in the check job:
  `WebFetch(domain:<site>)` for the four sites only; `WebSearch`, `Bash` and every other tool denied.
- **What is checked is what is hashed.** Each staged module gets `checker_view(m, dataset)`, the
  facts a player is shown. Its sha256 (`payload_sha`) is stored in `Question.quality`. A live
  question whose view changes after a data refresh goes back to `pending` (re-check). A verdict
  only applies if its `payload_sha` still matches.
- **Throughput:** 60 questions a day in batches of 10 (2 Claude sessions in parallel), model `opus`,
  both workflow inputs. Contexto days are exported first (earliest day first), then games with the
  fewest active questions.
- **Scheduled publishing covers the four question games only.** Pool games (series, MVPs, logos,
  Starting Five, Fan Favorites) still publish by hand after a data sync, because their content has
  no Checker path yet.
- **`--no-stage`** keeps the old "new = active" behaviour for tests and an owner emergency only. The
  default, and every workflow, stages.
- **Second `unsure`** is journaled as `needs_owner` and raised as a workflow warning. Slack comes with
  the phase 5 doctor.

## Global constraints

- Curated row schema stays frozen; no new model fields (status is a free CharField, extra data goes
  in `Question.quality`).
- Statuses: `pending`, `active`, `quarantined`, `retired`. Only `active` is ever published.
- Staged games: `career-path`, `who-are-ya`, `tictactoe`, `contexto`. `superdraft` and `imposter`
  (hidden, legacy snapshot) are untouched.
- The MINIMUM gate and runway count `active` only; the top-up target counts `active + pending`, so
  pending questions are never generated twice.
- Approved sites: `www.basketball-reference.com`, `www.nba.com`, `en.wikipedia.org`, `www.espn.com`.
- A `valid` verdict needs every claim `confirmed` with at least one source URL on an approved site;
  an `invalid` verdict needs at least one `contradicted` claim with such a source. Anything else is
  treated as `unsure`. Code enforces this; the model's word is not enough.
- Tests: `backend/`, `$env:DATABASE_URL=""`, Python 3.13 with Django. One-line commit messages, no AI
  attribution. Ship to `dev` by PR; promotion per the owner's 2026-10-12 condition (Checker plugged in).

## Review focus

1. A data refresh that changes many live questions must not empty a game: changed questions go
   pending, and a game that falls below its minimum is held back at its live version (phase 1).
2. A verdict for a question that changed after export (stale sha) must not apply.
3. A model that answers `valid` without sources, with sources off the approved sites, or with a
   malformed file must not get anything published.
4. The check job must have no DB secret in its environment.
5. A scheduled run (empty `inputs`) must publish for real to Vercel and record trigger `schedule`.

---

### Task 1: Checker views and verdict rules (`trivia/questions/checker.py`)

**Produces:** `CHECKER_VERSION=1`, `STAGED_GAMES`, `ALLOWED_SITES`, `MAX_UNSURE=2`,
`player_profile(row) -> dict`, `payload_sha(view) -> str`, `judge(verdict: dict) -> (outcome, reason)`
where outcome is `valid|invalid|unsure`; and `checker_view(m, dataset)` in `who_are_ya`,
`career_path`, `contexto`, `tictactoe`.

Tests (`tests/test_questions_checker.py`): profile fields and "undrafted"; open-ended stint shows
"present"; `payload_sha` stable across key order; contexto view leaves out the day and the
ranking; tictactoe view lists labels and the 3 most famous answers per cell (no counts); `judge`:
all confirmed with an allowed source → valid; a confirmed claim without a source → unsure; a source
on another domain → unsure; a contradicted claim with an allowed source → invalid; empty claims →
unsure; malformed input → unsure.

### Task 2: Staging in the runner

**Produces:** `runner.maintain(..., stage=False)`; with `stage=True`, staged games read active and
pending rows, new rows are created `pending`, the top-up counts active and pending, the minimum gate
counts active, stats gain `pending`, a live row whose `payload_sha` changed goes `pending` (event
`staged_for_recheck`), and every materialization stores `quality["payload_sha"]` while keeping
`quality["checked"]` unless the view changed.

Tests (`test_questions_runner.py`): new rows pending and not in `per_game`; no over-generation (TARGET
5 → exactly 5 pending, second run adds 0); active rows unchanged keep status and get a sha; a changed
view moves an active row to pending and drops `checked`; minimum gate counts active only (pending
alone → held back with isolate); non-staged game (`imposter`) unaffected.

### Task 3: Command default staging

`publish_game_data_v3` stages by default; `--no-stage` restores the old behaviour. CommandTests'
`_call` passes `--no-stage`; new tests: default run leaves new questions pending and out of the
manifest; journal `generated` events carry `status: pending`.

### Task 4: `export_checker_batches` command

`manage.py export_checker_batches --out DIR --limit 60 --batch-size 10`: pending rows of staged
games, re-materialized against the curated dataset (rows that no longer materialize are skipped),
ordered contexto-by-day first then games by fewest active questions, written as
`DIR/batch-NNN.json` (`{"batch", "checker_version", "allowed_sites", "questions": [{"game", "qid",
"payload_sha", "view"}]}`), and `batches=["001",...]` (JSON) plus `count=N` to `$GITHUB_OUTPUT`.

Tests: ordering, limit and batch size, file shape, skipped invalid row, empty → `batches=[]`.

### Task 5: `apply_checker_verdicts` command

`manage.py apply_checker_verdicts DIR`: reads every `verdicts-*.json`; for each verdict: question
must exist and be `pending` (else `rejected/not_pending`); re-materialized `payload_sha` must match
(else `rejected/stale`); `judge()` decides; valid → `active` + `quality.checked`; invalid →
`quarantined` + evidence; unsure → stays pending, `quality.unsure_count += 1`, at `MAX_UNSURE`
event `needs_owner` and a `::warning::`. Journal kind `checker`, every event holds claims, sources and
summary. Writes `approved=N` and `games=<comma list>` to `$GITHUB_OUTPUT`. A malformed file is
journaled and skipped, never fatal.

Tests: each outcome; stale sha; not pending; malformed file; journal run and events; outputs.

### Task 6: Checker instructions

`.claude/skills/nba-question-writer/references/checker.md` (what the agent does, field meanings and
tolerances, site rules, output schema) and a pointer in `SKILL.md`.

### Task 7: Workflows

- `question-checker.yml`: daily cron + `workflow_dispatch` (inputs `limit`, `batch_size`, `model`);
  jobs export → check (matrix, `max-parallel: 2`, env only the OAuth token) → apply → dispatch
  `publish-game-data.yml` (`skip_maintain=true`) when `approved > 0`.
- `publish-game-data.yml`: weekly cron (Mon 05:00 UTC) on the four question games, `skip_maintain`
  input, `--trigger schedule` on cron, `target` defaulting to vercel when inputs are empty.

### Task 8: Ship and go live

Full suite; PR to `dev`; merge; promote (owner condition met); apply migration via the production
deploy; run the Checker once by hand on `main`, verify approvals are published live; confirm both
schedules are registered.
