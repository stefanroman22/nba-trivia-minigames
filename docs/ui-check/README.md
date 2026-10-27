# UI check

An automated UI audit of the app with no account, with one logged-in account, and with two
accounts playing online, on 7 phone / tablet / desktop viewports, covering every visible game and
its end cases. Findings land in one report with source files, fix instructions and machine-checkable
acceptance criteria, and the frontend / backend engines can take a finding, fix it, re-check it and
loop until it passes.

Design: `docs/superpowers/specs/2026-10-11-ui-check-design.md`. Check catalogue and ownership:
`scripts/ui-check/CHECKS.md`. Its sibling, Logic Check (API, socket protocol, page status; it runs first every week
and blocks the services it finds broken, so UI check defers their checks): `docs/logic-check/README.md`. Everything runs locally except the read-only `--live` subset (GET/HEAD
against the live site); nothing here is paid.

## How it fits together

```
 run.mjs ── Playwright: guest · account · games · multiplayer suites × 7 viewports
   │          (detectors on every page: overflow, snap, cls, occluded, tap-target, console, a11y …)
   ▼
 <runDir>/results.json, shots/ (JPEG crops), sheets/ (one contact sheet per failing check)
   │
   ▼
 digest.md ── compact: one section per failing check, coverage gaps, warnings, metrics
              (each capped per suite; a `+N more … (suite <s>)` trailer points at results.json)
   │
   ▼
 judges (4 Sonnet agents, one per suite, in parallel)
   │   read their digest slice + ≤ 15 images + notes/<suite>.md,
   │   confirm each issue with probe.mjs (an assertion that FAILS now),
   │   map it to real files, write the fix
   ▼
 <runDir>/findings/<suite>.json
   │
   ▼
 report.mjs --validate ── schema + DSL check, merge by fingerprint (rule|route|selector), then one
   │                       per cause, drop accepted.json, prove every acceptance fails (verify --expect-fail)
   ▼
 <runDir>/findings.json + REPORT.md (+ rejected.json)
   │
   ▼
 ui-fix loop ── per file cluster: engine fixes → verify.mjs (dev; perf criteria in prod) → repeat
                (≤ 4) → 7-viewport sweep → code-reviewer (+ motion-reviewer) → regression run
                → verify --mark (the finding's validated mode) → commit
                → a `--ref main` run: PR to main, merge, back-merge PR main → dev, verify production
                  (any other run: PR to dev, merge, stop at dev)
 notion-push ── one Notion card per cluster (Target main for a `--ref main` run) for the team pipeline, deduped by fingerprint
```

Scripts measure, agents judge: agents never explore the app from scratch, so a run costs tens of
thousands of tokens, not millions.

## Running it

| what | how |
|---|---|
| full audit + findings + report | the `ui-check` skill (`.claude/skills/ui-check/SKILL.md`) |
| fix open findings and ship them (production for a `--ref main` run) | the `ui-fix` skill (`.claude/skills/ui-fix/SKILL.md`) |
| plan the fix clusters of a run | `node scripts/check-core/lib/clusters.mjs <runId> [severities] [owners] [suites] [ids]` |
| Notion cards from a validated run | `node scripts/check-core/notion-push.mjs --run <runId> --checker ui --target main [--dry-run]` |
| read-only checks on the live site | `node scripts/ui-check/run.mjs --live` (default https://swishquest.com) |
| suites only (no judges) | `npm run ui:check -- --suite all --mode prod` (= `node scripts/ui-check/run.mjs …`) |
| one finding's acceptance | `npm run ui:verify -- <findingId> --keep-stack` |
| one ad-hoc assertion | `npm run ui:probe -- --assert-file <file.json> --keep-stack` |
| merge judge files into REPORT.md | `npm run ui:report -- --run <runId> --validate` |
| harness self-test (no app server) | `npm run ui:selftest` |
| catalogue check | `node scripts/ui-check/catalog.mjs` |
| stop a kept stack | `node scripts/ui-check/run.mjs --stop` (checker ports; a lane: `--stop --ports …`) |
| where are the runs | `node scripts/ui-check/run.mjs --where` |

`run.mjs` flags: `--suite guest,account,games,multiplayer|all`, `--vp <ids>|core|all` (mp pairs as
`pairA`…`pairD`), `--only ID,ID` (`*` inside an id: `GM-wordle-*`), `--mode prod|dev`,
`--ref main|dev|.|<sha>` (the app code under test, see Modes), `--repo <dir>`, `--ports django=…,socket=…,web=…`,
`--keep-stack`, `--headed`, `--skip-slow` (leaves out `@slow` real-time waits such as
MP-TIMEOUT-01), `--live [url]` (see Prod code and the live site), `--stop`, `--where`. It exits 1 when any check failed, which is the normal input for the judges.
`verify.mjs`, `probe.mjs` and `report.mjs` print their usage with `--help`; `verify.mjs --from <findings.json>`
verifies finding objects from a file (a Notion card's attachment) with no run, output in `<uicHome>/adhoc/<ts>/`. In any loop pass
`--keep-stack` and stop once at the end with `run.mjs --stop`.

From Windows PowerShell 5.1 pass assertions with `--assert-file`: it splits JSON arguments that
contain spaces. The inline `node` snippets in the `ui-fix` skill must run from the repo root (they
import `./scripts/check-core/lib/…` relative to it).

## Where artifacts live

Run output never goes into the repo; the only repo files a run changes are
`scripts/ui-check/notes/<suite>.md`, where the judges append what they learned. They stay
uncommitted in the main checkout and go to `dev` with the next tooling PR (`ui-fix` never commits
them: its branch can be cut from `main`, which has no checker tooling yet). `scripts/check-core/lib/home.mjs` (`uicHome()`) picks:
`UI_CHECK_HOME` when set; on Windows with the repo under OneDrive `%LOCALAPPDATA%\nba-ui-check`
(OneDrive would sync thousands of JPEGs); otherwise `<repo>/.ui-check` (git-ignored).

```
<uicHome>/
  latest                 last run id (verify, probe and report restore it after their own children)
  stack.json             per port set: the stack's repo/mode/URLs, and every service the helper started with its
                         {repo, ports} (only those are ever stopped; a lane's and a checker's stack coexist)
  accounts.json          test usernames + the one generated password (secret, never committed)
  logs/, pw-output/
  runs/<YYYYMMDD-HHMM>/
    results.json  digest.md  run-meta.json  shots/<checkId>/…jpg  sheets/<checkId>.jpg
    findings/<suite>.json      judge output
    findings.json  REPORT.md  rejected.json
    verify/<id>.json  verify/shots/  probe/shots/   (verify and probe detail and crops)
  adhoc/<YYYYMMDD-HHMMSS>/verify/   verify.mjs --from output (no run)
```

Every `run.mjs` call (including a fix loop's regression run) creates a new run and moves `latest`;
the skills and agents always pass `--run <runId>` to `verify.mjs`, `probe.mjs` and `report.mjs`.
With `--run`, `verify.mjs` and `probe.mjs` test the checkout that run audited (`run-meta.json` `repo`,
for a `--ref main` run the `check-main` worktree). The `ui-fix` loop edits its own worktree
`<worktreeRoot>/fix-ui-check-<runId>`, so its `verify.mjs`, `probe.mjs` and regression `run.mjs` calls
add `--repo <worktree>`; they still run from the main checkout, which holds the tooling.

The digest caps each section per suite (FAIL lines 80, coverage gaps 15, warnings 20, metric rows
25; about 600 lines in all), so one noisy suite never pushes another out. A capped part ends with
`- +N more … (suite <s>) — see results.json …`; each judge pages through the rest of its own suite
with a bounded `results.json` filter (≤ 40 lines per call) given in its agent file.

## Modes

| mode | Django | socket | frontend | for |
|---|---|---|---|---|
| `prod` (audits) | :8200 sqlite | :4200 | `next build` + `next start` :5374 | real speed numbers, budgets enforced |
| `dev` (default for verify / probe) | :8000 | :4000 | `npm run dev` :5173 | fix loops with HMR; budgets informational |

Shared modules (stack, accounts, findings, home, the worktree checkout, port sets) live in
`scripts/check-core/lib/`; `scripts/ui-check/lib/` re-exports them. The app under test comes from
`--ref`: `main` by default in prod mode (a worktree `<worktreeRoot>/check-main` of `origin/main`, built
there; `npm ci` only when its lockfile changed; `backend/.venv` and `multiplayer_server/node_modules`
are junctions to this checkout's), `.` (this checkout) by default in dev mode; `--repo <dir>` runs any
checkout. The harness (specs, Playwright) always runs from this checkout. `--ports` moves the whole
stack (a pipeline QA lane: `django=8100,socket=4100,web=5273`); in dev mode on non-default ports the
frontend is `next dev -p <web>` pinned to the lane's Django and socket, and since Next allows one
`next dev` per directory a lane runs from its own worktree (`--repo`). `UI_CHECK_BASE` overrides the
Playwright baseURL.

The stack helper starts only what is not already listening and stops only what it started. Prod
mode rebuilds only when the source stamp changed (about 70 s or more). Django and the relay run
without autoreload: after a server-side edit, `run.mjs --stop` and the next call starts them again.
Prod mode leaves its build in `<repo>/.next/` (stamp `.next/UICHECK_STAMP`), with `localhost` API and socket URLs baked in: run
`npm run build` before `npm run preview` (or any deploy-like check) so you never serve that build.
The local relay and the prod build read the public data hosts (`VITE_DATA_BASE`,
`VITE_QUESTIONS_BASE`) from the env files; they are read-only CDN URLs, nothing is written there.
`report.mjs --validate` uses the run's own mode. Without `--mode`, `verify.mjs` uses prod for
findings validated in prod (`validatedMode`), dev otherwise. In the fix loop the engines verify with
`--mode dev` (HMR, no rebuild) and switch to `--mode prod` only for perf criteria (`maxCls`,
`maxLoafMs`, an `@perf` check, or a finding with rule perf / loaf / cls / slow-action / slow-api),
because budgets are enforced only in prod. Every fix-loop verify passes `--repo <worktree>`.
The `ui-fix` skill's final `verify --repo <worktree> --mark` passes no `--mode`, so it is the one gate
in the finding's validated mode.

## Accounts

Local sqlite only (the app repo's `backend/db.sqlite3`): tokens are minted inside `manage.py shell`
(`scripts/check-core/lib/mint_tokens.py`), and a
logged-in persona refuses to run when the API host is not `localhost`.

- `testuser1` (host) + `testuser2` (joiner): the multiplayer pair, one worker.
- `testuser3` (solo): account and games suites; each parallel worker has its own
  (`testuser3w<n>`), and the games suite rotates every test over a pool of 16 (`testuser3`,
  `testuser3w1`…`w15`) to stay under the 60/h score-submit throttle.
- Throwaways `uic<run digits><n>`: real sign-ups and delete-account flows, deleted at the end.
- Emails `<username>@uicheck.test`; one password in `<uicHome>/accounts.json`.
- The `stack-teardown` sweep runs after every invocation: it deletes leaked `uic<digits>` users,
  clears testuser3-family ↔ testuser2 friendships, requests and blocks, and restores testuser3-family
  names and photos, even after a crash.

## Runtime (this machine)

| what | time |
|---|---|
| full audit, all suites, prod | 1-3 h (games ≈ 35-55 min, multiplayer ≈ 35 min, plus guest and account) |
| judges (4 in parallel) | tens of minutes, mostly probes (20-40 s each on a warm stack) |
| `report.mjs --validate`, reuse path (app code unchanged since the run) | about 3 min: run 20261014-1153's 30 findings took 175 s, its 78 check × project criteria read from results.json, only the assertions ran (one invocation) |
| `report.mjs --validate`, re-run path (app code changed) | the assertions plus one check invocation per distinct project set; on 20261014-1153 the old per-finding runs took almost 2 h |
| one `verify` on a warm stack | 20-60 s; a cold dev stack adds about 90 s, a prod rebuild about 70 s |

## Findings and the fix loop

A finding (`scripts/ui-check/findings.schema.json`) carries `rule` (part of the fingerprint),
severity, owner (`frontend`: UI / CSS / components; `backend`: API status, latency, data shape,
relay; `ci`: build warnings, env / config, deploy), where, current / expected, evidence, real files
with lines, a fix (`change`, `reuse`, `build`, `rules`) and acceptance: existing check ids with
projects and / or DSL assertions (`scripts/ui-check/lib/findings.mjs`). `report.mjs --validate`
keeps a finding only when at least one criterion FAILS cleanly before the fix and none errors;
criteria that already pass are kept as guards. `verify.mjs <id> --mark` marks it fixed once every
criterion passes.

Validation cost. `run.mjs` records the app code it tested in `run-meta.json` (`code`: HEAD, the
trees of `src/`, `backend/`, `multiplayer_server/` plus their uncommitted diff, the frontend build
stamp, the mode). When `report.mjs --validate` finds the same code (a change under
`scripts/ui-check/` does not count), it takes every check × project verdict from the run's
`results.json`: FAILED there = the criterion fails, passed = a guard; only absent or skipped ones
re-run. Otherwise every check re-runs. Re-runs are batched over all findings: per check id the union
of the projects any finding names, then one Playwright invocation per distinct project set (`@perf`
ids in their own single-worker invocation). DSL assertions always run, all in one invocation. The
first output line says which path was taken. `verify.mjs` (the fix loop) never reuses: it always
re-runs, batched the same way.

Merging: equal fingerprints merge first; then one finding per cause: the same rule family (`snap`
and `stage-resized` on `.stage-shell` / `.playing-wrap` count as one) on the same route, one
selector an ancestor of the other (or both the stage shell / playing wrap), with the first metric
within 10 px or 10 % or a shared `file:line`. The outermost selector keeps its fingerprint and id;
`mergedFingerprints` lists the absorbed ones.

The judges are `.claude/agents/ui-check-{guest,account,games,multiplayer}.md`; each owns a fixed,
disjoint checklist (its suite's digest lines plus visual judgement on its own surfaces). The
engines' protocol is "Fixing a UI-check finding" in `.claude/agents/frontend-engine.md` and
`backend-engine.md`: they never edit `scripts/ui-check/**` to make a finding pass; a wrong check is
reported as `check-bug` and the `ui-fix` orchestrator rules on it. A pipeline check card hands the
engine the card's `findings.json` attachment instead of a run; the pipeline's QA gate then runs
`verify.mjs --from <findingsFile> --mode dev --repo <worktree> --ports <lane>` and relays the FAILs.

## Prod code and the live site

Design: `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §2-3.

- **Prod code, locally.** The default audit (`--ref main`) tests `origin/main`, what swishquest.com
  runs. `scripts/check-core/lib/checkout.mjs` keeps a worktree `<worktreeRoot>/check-main` (the
  pipeline's root from `.claude/team/config.json`), re-detached at `origin/main` on every run, reset
  when dirty, `npm ci` only when its lockfile changed. It is built in prod mode and served on the
  checker ports with its own local sqlite and minted test users. `run-meta.json` records `ref`,
  `head`, `repo`, `mode` and `ports`; `report.mjs --validate`, `verify.mjs --run` and
  `probe.mjs --run` use that checkout again. `--ref dev`, `--ref .` or a sha audit other code.
- **The live site, read-only.** `run.mjs --live [url]` runs only the guest checks tagged `@live`
  (CHECKS.md `live` column) against https://swishquest.com on the core viewports, as its own run
  (run id ending in `-live`), with no stack and no accounts. The fixture's guard aborts every
  request to a non-localhost origin that is not GET/HEAD (and any remote websocket) and fails that
  test as `live-write`; the run prints `live requests: N GET/HEAD · M live-write` and exits 1 when
  M > 0. Findings carry `where.env: ["live"]`. No checker ever signs up, logs in, plays or opens a
  room on the live site: the live leaderboard has no test-user exclusion and the relay is billed.

## Notion cards

`node scripts/check-core/notion-push.mjs --run <runId> --checker ui --target main [--dry-run] [--severities blocker,major,minor|all]`
turns a validated run into one card per cluster (`scripts/check-core/lib/clusters.mjs`, the same
clustering `ui-fix` dispatches) in the team pipeline's Notion database, Status To Do. Only findings
with `validatedAt` are pushed; `--dry-run` reads Notion and prints the cards but writes nothing.

- **Card.** Name `[ui-check] <lead finding title> (+N)`; Category from the owner; Priority P0
  blocker, P1 major, P2 minor/polish; Difficulty hard for a blocker or backend security, else
  standard; `Target` main (dev for a run of other code); `Source`
  `ui-check fp:<keys> ids:<ids> run:<runId>`, where a key is the first 12 hex of the sha1 of a
  fingerprint (each finding's fingerprint and its `mergedFingerprints`). Notion keeps 1900 chars of
  `Source`; a longer one is warned about.
- **Body.** One line of context, `## Findings` (the top 8 findings in full: current, expected,
  evidence with one contact-sheet image, files, how to fix, acceptance with the verify command;
  the rest listed by id) and `## Pipeline` (engine protocol, QA line, the ship target). Bodies over
  100 blocks are appended in batches of 100.
- **Attachment.** `findings.json` with the cluster's full finding objects
  (`{checker, runId, mode, ref, head, source, generatedAt, findings}`); the pipeline downloads it to
  `.team/attachments/<pageId>/findings.json` and `verify.mjs --from` reads it.
- **Dedupe**, per cluster, through `notion.mjs find-cards --source-fp <key>` over non-archived
  cards: a card not Done → no new card and at most one "seen again in run <id>" comment per run
  (new sibling findings are named in that comment and wait for the next run); Done with an empty
  `Commit` (closed by hand) → skipped; Done with a `Commit` not on `origin/main` yet → skipped;
  Done and shipped → one `[ui-check] Regression: …` card linking the old ones.
  `<uicHome>/notion-cards.json` mirrors fingerprint → card; Notion is the truth.

The `ui-check` skill pushes after validation (step 3b). The weekly run (`scripts/check-run.mjs` on GitHub Actions or
the PC's Task Scheduler task `nba-checks`, Sundays 02:00 Europe/Paris) runs Logic Check first, then the audit, the judges and the push on its own, and skips the checks
whose services Logic Check blocked (`docs/logic-check/README.md`, "The channel and the catch-up loop").

## Shipping fixes to production

Checker findings are the standing exception to "stop at dev" (CLAUDE.md "Shipping"). For a
`--ref main` run, `ui-fix` works in a worktree `<worktreeRoot>/fix-ui-check-<runId>` on branch
`fix/ui-check-<runId>` cut from `origin/main` (`node scripts/check-core/lib/checkout.mjs fix <runId>
main`; the main checkout never switches branches, because a `main`-based branch has no checker
tooling), verifies with `--repo <worktree>` from the main checkout, opens a PR to `main` and merges it, then opens and merges a back-merge PR `main → dev`
(merge commit) so `dev` stays a superset; a failed back-merge is retried once, then left to the
owner with Needs human on the cards (`main` stays shipped). A push to `main` deploys both Vercel
projects (frontend and backend); the skill then runs the `ship` skill's read-only production check
(both Vercel commit statuses `success`, swishquest.com and the API health URL answer; a failure sets
Needs human, it never rolls back or fixes forward) and may re-run the fixed findings' `@live` checks
with `run.mjs --live --only …` (account, game and multiplayer findings cannot be checked live; their
proof is the prod-mode `verify --mark`). Before the merge it moves the
findings' cards to QA with the commit (`notion.mjs ship-card`), so `main-sync.yml` marks them Done.
At the end it removes the worktree (`checkout.mjs remove-fix <runId>`). Pipeline cards with
`Target = main` take the same route through the `ship` skill. Runs of other code ship to dev as
before, from a worktree cut from `origin/dev`.

**Relay rule.** The relay (`multiplayer_server/`, Railway) is billed and never deployed by a
checker or the pipeline, and its code must not reach production before that deploy: a fix that
changes it goes out as an unmerged PR to `main` (`ui-fix` moves those whole commits, `src/` changes included, into their own PR),
its card waits in QA with Needs human, and the owner merges the PR with a merge commit and runs
`railway up` in the same window (`main-sync` then marks the card Done).

## Adding a check

1. Put the test in `scripts/ui-check/specs/<suite>/…spec.mjs`, built on `test` / `expect` / `L`
   from `lib/fixtures.mjs` and the `audit` fixture (`audit.goto`, `layout`, `motion`, `timing`,
   `a11y`, `console`, `shot`, `violation`; end with `await audit.done()`).
2. Title it `[<ID>] what it proves`. Prefixes: `G-` guest, `AC-` account, `GM-` games,
   `MP-` multiplayer, `ST-` selftest. Each id exists once across all specs. Tags after the id:
   `@perf` (runs in the single-worker timing pass), `@slow` (real-time waits; `--skip-slow` drops it).
   A generated family (titles built at runtime) gets a `// @catalog-family GM-<game>-<scenario>` comment.
3. Locators go in `scripts/ui-check/pagemap/<area>.json` (used as `L(page, 'area.key')` and as
   `@area.key` in assertions). The app has no `data-testid`: see the selector tips in the notes.
4. Add a row (or a family pattern) to the suite's table in `scripts/ui-check/CHECKS.md`.
5. `node scripts/ui-check/catalog.mjs` must print `catalog: ok` (it fails on duplicate,
   wrongly prefixed or undocumented ids).
6. A new detector or rule gets a selftest that shows it firing on a bad fixture and staying quiet
   on good ones (`specs/selftest/`, `fixtures/detectors/`), then `npm run ui:selftest`.
   A check stays strict: when it finds an app bug, the bug becomes a finding, never a looser check.

## Adding a game adapter

The contract is written out at the top of `scripts/ui-check/games/index.mjs`; the how-to and its
pitfalls are "Writing an adapter" in `scripts/ui-check/notes/games.md`. In short:
`games/<id>.mjs` default-exports `{ id, path, online, lives, timerMs, scenarios, answer, isOver, … }`,
it is added to `ADAPTERS` in `games/index.mjs`, `answer()` plays exactly one turn and reads the
right answer only from `ctx.pool(key)` (or `ctx.fiber`), and a scenario it cannot drive is a reason
string (a coverage gap, never a silent pass). The scenarios, shell and latency specs pick it up for
every viewport, and the multiplayer suite reuses it online. A game that ends in place needs
`endReveal` (Rule 7.3).

## accepted.json

`scripts/ui-check/accepted.json` lists fingerprints that are never reported again: a string
`"rule|/route|selector"` or `{ "fingerprint": "…", "reason": "…" }`. Use it for deviations the owner
accepted and for findings the `ui-fix` orchestrator ruled false positives (always with a reason).
`report.mjs` drops matching findings before validation.

## Notes files

`scripts/ui-check/notes/{guest,account,games,multiplayer}.md` hold per-suite learnings: intentional
exemptions, measurement notes, false positives, flaky spots, selector tips, throttle budgets. Each
starts with "How judges use this file"; judges append dated bullets and never rewrite.

## Manual owner checks

Not automated, check by hand after changes to sign-in:
- **Google OAuth round trip**: the Google consent screen, the code exchange, the new-account name
  pane, and that a new Google account is created in one step (no tick-box or second step since
  2026-10-26.2; its consent source is `google_continue`). The account suite only proves the button
  renders, is sized, opens the Google window or frame from both tabs, and shows the in-app-browser
  warning (AC-GOOGLE-01).

## Cost and throttles

- No paid service is used. Chrome (or Edge) runs locally; the judges run on Sonnet with
  `effort: medium` and see at most 15 images each.
- Local throttles: sign-up 10/h and log-in 30/h per IP; export and delete 10/h per account;
  score-submit 60/h per account; guess-log 120/h. The suites hit throttled endpoints only on the core
  viewports. Counters live in Django's LocMem cache, so a second full run on the same kept stack
  within the hour can reach a limit (`HTTP 429` in the digest): `run.mjs --stop` resets them.
- Each minted session adds one `OutstandingToken` row to `backend/db.sqlite3` (local, harmless).
