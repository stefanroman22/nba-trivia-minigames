# Logic Check

Logic Check proves that the app's actions work: every sign-up, login, profile, friends, game-data and room action is
called through the API or a socket.io client and its answer is checked (status, error text, data, points, events),
the public pages answer with the app shell and hydrate, and a read-only live suite watches swishquest.com. It never
looks at layout, motion or styling: that is UI check (`docs/ui-check/README.md`). It runs before UI check every night
and tells UI check which services are broken, so the same defect reaches Notion once.

Design: `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §4-§8. Catalogue: `scripts/logic-check/CHECKS.md`.
Notes the triage agent reads: `scripts/logic-check/notes/logic.md`. Shared code: `scripts/check-core/README.md`.

## How it fits together

```
 run.mjs ── Playwright projects: live (the live site, GET/HEAD only) · pages (1 Chromium) · api (node fetch) · rooms (2 socket.io clients)
   │          on a local stack built from a checkout of main (prod mode, local sqlite), one worker
   ▼
 <uicHome>/runs/<YYYYMMDD-HHmm>-logic/ results.json, digest.md (FAIL sections, capped), run-meta.json (checker logic)
   │
   ▼  only when the digest has FAIL sections
 logic-check-triage (one Sonnet agent) ── digest slice + notes/logic.md + the cited constraint sections, probe.mjs per
   │                                       API case, real files; files the owner advisories once
   ▼
 findings/logic.json ── report.mjs --validate (each acceptance FAILS now) ── findings.json + REPORT.md
   │
   ▼
 notion-push --checker logic ── one [logic-check] card per cluster (Target main), deduped by Source
   │
   ▼
 channel.mjs block-run ── <uicHome>/channel.json blocks the services of the failing checks
   │
   ▼
 UI check (next in the nightly run) skips and defers every check tagged with a blocked service
```

## Suites and what each checker owns

| suite | ids | runs | proves |
|---|---|---|---|
| live | `LC-LIVE-` | live site, GET/HEAD only, also every 6 h on GitHub Actions | public routes 200 + shell, API health, each game's data source, public leaderboard consistency, Google sign-in config, relay handshake, TTFB |
| pages | `LC-PAGES-` | local, 1 browser | the same routes on the checkout, plus hydration (a click works) |
| auth | `LC-AUTH-` | local, API (+1 browser case) | login by username / email / Name#ID, `/me/`, refresh rotation + blacklist, logout, throttle config, Google login's bad input, a deleted account's tokens |
| signup | `LC-SIGNUP-` | local, API (+1 browser case) | the validation matrix (`lib/matrix.mjs`), frontend/backend rule agreement, the happy path, the form showing the backend's error |
| profile | `LC-PROFILE-` | local, API | username change, photo age gate, teen refusal, photo removal, export, account deletion |
| friends | `LC-FRIENDS-` | local, API, actor ↔ peer | requests arrive on both sides, accept / decline / cancel / remove / block / unblock, symmetric lists, search |
| game-data | `LC-GAMEDATA-` | local, API | each visible game's data sources, `log-session` credit, leaderboard rank, the Wordle daily gate |
| rooms | `LC-ROOMS-` | local, socket.io client ×2 | the relay protocol: identify, friend rooms, matchmaking, scores and results, leaving, play-again proposals |

No-overlap matrix (spec §5; `node scripts/ui-check/catalog.mjs` rejects a Logic spec that calls
`audit.layout/motion/a11y/perf` and a UI spec that imports `scripts/logic-check/lib`):

| feature | Logic Check owns | UI check owns |
|---|---|---|
| signup / login | validation matrix, statuses, tokens, throwaway lifecycle | form layout, tab motion, rule text updating live, busy states |
| profile | that each change persists and is enforced | the card's motion and layout while changing |
| friends | that requests arrive and lists are symmetric (all actions via API) | the panel's rendering of states seeded via API (no UI sends) |
| games | data loads, score logged once, daily gate | playing through the UI: shell rules, motion, end states |
| rooms / matches | the socket protocol end to end, points credit (`LC-ROOMS-08/10`) | the two-browser UI of rooms, results, proposals, the "+N pts" toast |
| pages | HTTP status, shell present, hydration | layout, overflow, perf, a11y, permissions UI |

## Running it

| what | how |
|---|---|
| full check + triage + cards + blocks | the `logic-check` skill (`.claude/skills/logic-check/SKILL.md`) |
| suites only | `node scripts/logic-check/run.mjs --suite all --ref main --keep-stack --live` (`npm run logic:check -- …`) |
| some checks | `node scripts/logic-check/run.mjs --only LC-AUTH-01,LC-ROOMS-* --ref main` |
| the live suite only | `node scripts/logic-check/run.mjs --live` (`npm run logic:live`; default https://swishquest.com) |
| one API case on a run's stack | `node scripts/logic-check/probe.mjs --api '<json>' --run <runId> --keep-stack` |
| validate the triage's findings | `node scripts/ui-check/report.mjs --run <runId> --validate` |
| Notion cards | `node scripts/check-core/notion-push.mjs --run <runId> --checker logic --target main [--dry-run]` |
| blocks for the pushed findings | `node scripts/check-core/lib/channel.mjs block-run --run <runId> [--dry-run]` |
| stop a kept stack | `node scripts/logic-check/run.mjs --stop [--ports …]` |
| harness selftests | `npm run logic:selftest` |

`<runId>` is the run's id including `-logic` (`20261017-0200-logic`). `run.mjs` exits 0 when everything passed, 1 when
a check failed, 2 on infra (arguments, checkout, stack, nothing ran). `--suite all` includes the live suite.
`--ports django=…,socket=…,web=…` picks the stack's ports (default prod 8200/4200/5374); `--repo <dir>` runs an
existing checkout instead of `--ref`. `--skip-blocked` (opt-in) leaves out Logic's own blocked checks; by default
Logic re-runs them, because that is how it sees a fix land.

## Test users

One registry for both checkers (`scripts/check-core/lib/accounts.mjs` `ROLES`), minted in the local sqlite only
(`mint_tokens.py` refuses any other database):

| role | username | used by |
|---|---|---|
| ui.host / ui.joiner | testuser1 / testuser2 | UI multiplayer |
| ui.solo pool | testuser3, testuser3w1..w15 | UI account + games |
| logic.actor / logic.peer | testuser4 / testuser5 | Logic auth, profile, friends, game-data, rooms |
| logic.admin | testuser6 (`promote_admin`) | Logic admin API checks, the third seat of `LC-ROOMS-09` |
| throwaways | `uic<digits>` (UI), `lgc<digits>` (Logic) | made by one check, deleted by it, swept at teardown |

`lgc` throwaways are `lgc<12 digits of the process start><2-digit slot>`; the slots in use are listed in
`notes/logic.md` (matrix 01-26, game-data 41, profile 60-63, browser 70-73, `LC-AUTH-08` 80, `LC-SIGNUP-05` 90).

## Findings and the fix loop

Findings use the shared schema (`scripts/ui-check/findings.schema.json`) with `checker: "logic"`, the Logic suites and
personas, `where.viewports` `["api"]` / `["socket"]`, and acceptance made of Logic checks (`{"lc": "LC-…"}`) and API
assertions (`{"api": {persona, method, path, body?, headers?}, "expect": {status, json?, headers?}}`). Owners:
`backend` (API, status, data, relay), `ci` (deploy, config, env), `frontend` (the site calls the wrong endpoint or
shows another text). Engines follow "Fixing a Logic-check finding" in `.claude/agents/backend-engine.md` /
`frontend-engine.md`: `node scripts/ui-check/verify.mjs <id> --run <runId> --repo <worktree> --keep-stack` locally,
`verify.mjs --from <attached findings.json>` on a pipeline card. Live-only criteria (`LC-LIVE-…`) wait for the live cron
after promotion; `verify.mjs --live` evaluates them on the live site.

## The channel and the catch-up loop

`<uicHome>/channel.json` (`scripts/check-core/lib/channel.mjs`) is how Logic Check tells UI check what is broken:

- **blocks** `{service, by: LC-id, finding, card, runId, since}`: written by `channel.mjs block-run` after notion-push,
  one per service of each pushed finding's failing `lc` checks (CHECKS.md `services` column). A violation note
  `service games.<id>` (`LC-LIVE-03`, `LC-GAMEDATA-01`) blocks `games.<id>` instead of all of `game-data`. A card
  closed by hand (Done without a Commit: a won't-fix) is never re-blocked.
- **deferred**: UI check (`--skip-blocked`, on by default) skips every check tagged with a blocked service, records it
  here and lists it under the digest's Coverage gaps as `blocked by LC-… (card …)`.
- **resolve** (start of every nightly run, or `node scripts/check-core/lib/channel.mjs resolve` by hand): a block is
  resolved when its card is Done and the card's Commit is an ancestor of `origin/main` (`notion.mjs get-card`, then
  `git merge-base --is-ancestor`), or Done without a Commit (closed by hand). It prints `catchup-logic <LC ids>` and
  `catchup-ui <ids>` (the deferred UI checks it released). `catchup-logic` is every local Logic check tagged with a
  resolved service, never an `LC-LIVE-` check (catch-up runs on local main; the live site may not carry the fix yet,
  the live cron confirms it); a `games.<id>` block also re-runs `LC-GAMEDATA-01`, and for an online game the rooms
  checks that deal a round (`LC-ROOMS-07`, `LC-ROOMS-10`), so a game's UI catch-up is always gated by a Logic re-run.
- **catch-up**: Logic re-runs the `catchup-logic` ids first; only when they pass does UI check run the `catchup-ui`
  ids (`--only … --vp all`). Then the normal nightly run follows. Catch-up runs are not judged and not pushed (the full
  runs that follow cover the same checks); they are ordinary runs for retention, so they count toward each checker's
  last 5.

The loop: Logic finds → card → the pipeline fixes → main → Logic confirms → UI check catches up.
`node scripts/check-core/lib/channel.mjs show` prints the blocks and pending deferrals.

## The nightly run

Task Scheduler task `nba-checks` (daily 02:00, StartWhenAvailable, stopped after 6 h) runs `scripts/check-run.ps1`.
Register it with `scripts/register-check-cron.ps1`, remove it with `scripts/unregister-check-cron.ps1`. It is
registered with the owner's interactive token, so it runs only while the owner is logged on; a 02:00 missed while
logged off (or with the PC off) runs at the next logon (StartWhenAvailable).

**Where it runs.** The tooling (these scripts, the skills, the agents, the notes) runs from a dedicated worktree,
`<worktreeRoot>\checks-nightly` on branch `checks-nightly`, which the register script creates from `origin/dev` (with
junctions `backend\.venv` and `multiplayer_server\node_modules` to the main checkout's, and its own `npm ci`); the
task's working directory is that worktree. The app under test is always `--ref main` (`<worktreeRoot>\check-main`).
`check-run.ps1` refuses to run from the main checkout (the owner's working tree) unless `-AllowMainCheckout` is
passed. `UI_CHECK_HOME` is pinned to `%LOCALAPPDATA%\nba-ui-check`, the same home the skills use from the main
checkout, so the channel, the cards ledger and the runs are shared. `.env.team` (`NOTION_TOKEN`, `SLACK_BOT_TOKEN`)
is read from the worktree, else from the main checkout.

Order:

0. take the lock; stop whatever still runs on the checker ports (a killed night, a daytime `--keep-stack`: a stale
   stack is never reused); commit leftover notes; update the tooling: `git fetch origin dev`, `git merge --ff-only
   origin/dev`, else `git rebase origin/dev` (its notes commits on top); a rebase conflict aborts the rebase, stops the
   night and says so on Slack; `npm ci` when `package-lock.json` changed (this script itself takes the update the
   next night: PowerShell has already read it);
1. `channel.mjs resolve` → resolved blocks and catch-up lists;
2. catch-up: Logic `--only <catchup-logic>`, then (if green) UI check `--only <catchup-ui> --vp all`;
3. Logic Check `--suite all --ref main --live` → triage (only on FAIL sections) → `report.mjs --validate` →
   `notion-push --checker logic` → `channel.mjs block-run`;
4. UI check `--suite all --ref main`, then `--live` → the four judges (only on FAIL sections) → validate →
   `notion-push --checker ui`;
5. `retain.mjs --home <uicHome>`;
6. stop the stack; commit the notes the agents and retention changed on `checks-nightly` (`checks: notes <date>`) and
   push `origin/checks-nightly` (never `dev`); one Slack line; release the lock.

**Slack.** One line per run in #pipeline (`check-summary.mjs`): the duration, the catch-up runs, each checker's run id
and exit code, cards created per checker (regressions, push errors), blocks written, blocks resolved (spec §7's "one
line per resolution" is folded into this count), deferred checks pending, and notes (`triage needed`, `agent timed
out: <step>`, infra exits, a stopped rebase, a failed notes push).

**Agents** run through `claude -p` (Sonnet), as `scripts/team-run.ps1` does: the triage with the logic-check skill's
step 2, the judges with the ui-check skill's steps 2-3. Each runs in a child process under a watchdog: after
`-AgentTimeoutSec` (default 2700 s = 45 min) its whole process tree is killed and the step is noted as
`agent timed out: <step>`; validation and the push still run on what it wrote. When `claude` is not on PATH the digest
path goes to the log and the Slack line says "triage needed" / "judges needed".

**Exits.** Every run writes `<uicHome>/logs/check-<ts>.log` (and the `.json` state the Slack line is built from);
`<uicHome>/check-run.lock` keeps two runs from overlapping (a lock whose PID is gone is taken over). A normal or failed
exit stops the stack and releases the lock. A hard kill (the task's 6 h limit, a reboot) cannot: the stack stays up
until the next night's step 0 stops it, and the stale lock is taken over then.
`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-run.ps1 -DryRun` prints the plan and runs nothing;
`-Ports django=…,socket=…,web=…` moves the whole run to another port set.

**Getting the notes to dev.** `checks-nightly` only ever receives the tooling from `dev` and its own notes commits;
they reach `dev` with the next tooling PR (merge `checks-nightly` → `dev`), or a weekly owner PR of `checks-nightly`
→ `dev` when no tooling PR is due.

The live suite also runs every 6 h on GitHub Actions (`.github/workflows/logic-live.yml`): a Slack line on a failure,
a card (owner `ci`, scripted triage `lib/live-triage.mjs`, no agent) only when the same check failed in two consecutive
runs, deduped by Source; CI writes no channel blocks (it has no `<uicHome>`). GitHub runs scheduled workflows only
from the default branch, so this cron becomes active once the workflow file reaches `main`; until then the nightly's
`--live` run is the only live probe.

## Known residual overlap

These still assert in both checkers (spec §5) and move in a later pass:

- `AC-GOOGLE-01` and `LC-AUTH-GOOGLE-01` both click "Continue with Google" and expect Google's window.
- `AC-PROFILE-01` reads `/me/` after a username change to prove it persisted, which is `LC-PROFILE-01`'s.
- `G-PERM-01` asserts the admin API's 401/403 statuses; there is no `LC-ADMIN-` suite yet to own them.

## Retention

`node scripts/check-core/lib/retain.mjs --home <uicHome>` runs at the end of every nightly run (`--dry-run` prints what it
would do). It keeps the last 5 runs of each checker plus every run an open card references (the cards ledger
`<uicHome>/notion-cards.json`); older runs lose `shots/` first, then the directory; directories that are not run ids are
never touched. Notes bullets (`scripts/{ui,logic}-check/notes/*.md`) dated by run id or `(YYYY-MM-DD)` and older than
90 days, naming no open finding, move to `notes/archive/<file>.md`; a file over 150 lines then moves its oldest dated
bullets older than 30 days, and is otherwise reported, never cut. `channel.json` drops resolved blocks and deferrals after 30 days; the cards ledger
drops Done entries after 60 days. Notion is never pruned.

## Owner advisories

Decisions for the owner that are not failing checks live in `notes/logic.md` "Owner advisories": the guest throttles
keyed on a client-supplied X-Forwarded-For (minor, `ci`) and the replayable `log-session` with its 1000-point fallback
for unknown games (minor, `backend`). The triage files each once (`scripts/logic-check/lib/advisories.mjs`): fixed
fingerprints, an API acceptance that fails on today's code, and no second filing once the cards ledger knows them.
Validating them is cheap: the X-Forwarded-For case sends 11 empty sign-ups (each with its own header value, so no
real bucket is spent and no account is created); the log-session case spends one of testuser4's `score-submit` POSTs
and credits it 1000 points on the local sqlite.

## Running checkers in parallel

Two checker runs at the same time (two agents, a skill run while the nightly runs, Logic and UI check side by side)
each need **their own port set** (`--ports`) **and their own throwaway slots**: a stack's sqlite is shared by
everything that runs on it, Logic's teardown sweep deletes every `lgc<digits>` account in it, and two processes using
the same slot in one sqlite are the same account. Logic runs share `logic.actor` / `logic.peer`, so two Logic runs never
share a stack. Port sets in use here: prod 8200/4200/5374 (the nightly), 8300/4300/5474 and 8400/4400/5574 for agent
work, the pipeline's QA lanes 8100/4100/5273 and 8101/4101/5274. A run that finds another checkout's Django on its
ports stops at `stack-setup` ("serves a different sqlite") instead of testing the wrong code. Two **prod** stacks also
need **their own checkout**: `next build` writes one `.next` per checkout with the API base baked in, so a second port
set from the same checkout (e.g. two `--ref main` runs, both in `check-main`) would rebuild `.next` under the first
stack's running `next start` — which then serves a build pointing at the other Django and every signed-in and game
test fails. `ensureStack` refuses that ("already serves the … stack from its .next"); run the second checker from a
worktree of its own (`--repo`) or after the first stack is stopped.

## Adding a check

1. Pick the suite (its prefix and project: `scripts/logic-check/lib/suites.mjs`) and the next free id `LC-<SUITE>-NN`.
2. Put the test in `scripts/logic-check/specs/<project>/<name>.spec.mjs`, titled `[LC-<SUITE>-NN] …`, using the `api` /
   `lc` fixtures (`scripts/logic-check/lib/fixtures.mjs`): one test per check, `lc.violation(...)` for every problem,
   `await lc.done()` at the end; cases as `test.step`. Prefer the API or a socket client; open a browser only for what
   has no API. Never call `audit.layout/motion/a11y/perf`.
3. Clean up in `finally` (names, photos, friendships, rooms: `close()`); a throwaway gets an unused slot (add it to
   `notes/logic.md`), and the throttle budget of the accounts it uses is noted there.
4. Add its row to `scripts/logic-check/CHECKS.md` with a `services` column (`pages, auth, signup, profile, friends,
   leaderboard, games.<id>, game-data, rooms, matchmaking, relay`); a per-game violation carries the note
   `service games.<id>`.
5. `node scripts/ui-check/catalog.mjs` must print `catalog: ok`; run the check with `run.mjs --only <id>` and prove it
   fails on a deliberately wrong expectation before trusting a pass.
