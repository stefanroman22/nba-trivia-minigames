# UI check

An automated UI audit of the app with no account, with one logged-in account, and with two
accounts playing online, on 7 phone / tablet / desktop viewports, covering every visible game and
its end cases. Findings land in one report with source files, fix instructions and machine-checkable
acceptance criteria, and the frontend / backend engines can take a finding, fix it, re-check it and
loop until it passes.

Design: `docs/superpowers/specs/2026-10-11-ui-check-design.md`. Check catalogue and ownership:
`scripts/ui-check/CHECKS.md`. Everything runs locally; nothing here is paid.

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
 report.mjs --validate ── schema + DSL check, merge by fingerprint (rule|route|selector),
   │                       drop accepted.json, prove every acceptance fails (verify --expect-fail)
   ▼
 <runDir>/findings.json + REPORT.md (+ rejected.json)
   │
   ▼
 ui-fix loop ── per file cluster: engine fixes → verify.mjs (dev; perf criteria in prod) → repeat
                (≤ 4) → 7-viewport sweep → code-reviewer (+ motion-reviewer) → regression run
                → verify --mark (the finding's validated mode) → commit → PR to dev, merge, stop at dev
```

Scripts measure, agents judge: agents never explore the app from scratch, so a run costs tens of
thousands of tokens, not millions.

## Running it

| what | how |
|---|---|
| full audit + findings + report | the `ui-check` skill (`.claude/skills/ui-check/SKILL.md`) |
| fix open findings and ship to dev | the `ui-fix` skill (`.claude/skills/ui-fix/SKILL.md`) |
| suites only (no judges) | `npm run ui:check -- --suite all --mode prod` (= `node scripts/ui-check/run.mjs …`) |
| one finding's acceptance | `npm run ui:verify -- <findingId> --keep-stack` |
| one ad-hoc assertion | `npm run ui:probe -- --assert-file <file.json> --keep-stack` |
| merge judge files into REPORT.md | `npm run ui:report -- --run <runId> --validate` |
| harness self-test (no app server) | `npm run ui:selftest` |
| catalogue check | `node scripts/ui-check/catalog.mjs` |
| stop a kept stack | `node scripts/ui-check/run.mjs --stop` |
| where are the runs | `node scripts/ui-check/run.mjs --where` |

`run.mjs` flags: `--suite guest,account,games,multiplayer|all`, `--vp <ids>|core|all` (mp pairs as
`pairA`…`pairD`), `--only ID,ID` (`*` inside an id: `GM-wordle-*`), `--mode prod|dev`,
`--keep-stack`, `--headed`, `--skip-slow` (leaves out `@slow` real-time waits such as
MP-TIMEOUT-01). It exits 1 when any check failed, which is the normal input for the judges.
`verify.mjs`, `probe.mjs` and `report.mjs` print their usage with `--help`. In any loop pass
`--keep-stack` and stop once at the end with `run.mjs --stop`.

From Windows PowerShell 5.1 pass assertions with `--assert-file`: it splits JSON arguments that
contain spaces.

## Where artifacts live

Run output never goes into the repo; the only repo files a run changes are
`scripts/ui-check/notes/<suite>.md`, where the judges append what they learned (the `ui-fix` skill
commits them as `ui-check: notes from <runId>`). `lib/home.mjs` (`uicHome()`) picks:
`UI_CHECK_HOME` when set; on Windows with the repo under OneDrive `%LOCALAPPDATA%\nba-ui-check`
(OneDrive would sync thousands of JPEGs); otherwise `<repo>/.ui-check` (git-ignored).

```
<uicHome>/
  latest                 last run id (verify, probe and report restore it after their own children)
  stack.json             services the stack helper started (only those are ever stopped)
  accounts.json          test usernames + the one generated password (secret, never committed)
  logs/, pw-output/
  runs/<YYYYMMDD-HHMM>/
    results.json  digest.md  run-meta.json  shots/<checkId>/…jpg  sheets/<checkId>.jpg
    findings/<suite>.json      judge output
    findings.json  REPORT.md  rejected.json
    verify/<id>.json  verify/shots/  probe/shots/   (verify and probe detail and crops)
```

Every `run.mjs` call (including a fix loop's regression run) creates a new run and moves `latest`;
the skills and agents always pass `--run <runId>` to `verify.mjs`, `probe.mjs` and `report.mjs`.

The digest caps each section per suite (FAIL lines 80, coverage gaps 15, warnings 20, metric rows
25; about 600 lines in all), so one noisy suite never pushes another out. A capped part ends with
`- +N more … (suite <s>) — see results.json …`; each judge pages through the rest of its own suite
with a bounded `results.json` filter (≤ 40 lines per call) given in its agent file.

## Modes

| mode | Django | socket | frontend | for |
|---|---|---|---|---|
| `prod` (audits) | :8200 sqlite | :4200 | `next build` + `next start` :5374 | real speed numbers, budgets enforced |
| `dev` (default for verify / probe) | :8000 | :4000 | `npm run dev` :5173 | fix loops with HMR; budgets informational |

The stack helper starts only what is not already listening and stops only what it started. Prod
mode rebuilds only when the source stamp changed (about 70 s or more). Django and the relay run
without autoreload: after a server-side edit, `run.mjs --stop` and the next call starts them again.
`report.mjs --validate` uses the run's own mode. Without `--mode`, `verify.mjs` uses prod for
findings validated in prod (`validatedMode`), dev otherwise. In the fix loop the engines verify with
`--mode dev` (HMR, no rebuild) and switch to `--mode prod` only for perf criteria (`maxCls`,
`maxLoafMs`, an `@perf` check, or a finding with rule perf / loaf / cls / slow-action / slow-api),
because budgets are enforced only in prod. The `ui-fix` skill's final `verify --mark` passes no
`--mode`, so it is the one gate in the finding's validated mode.

## Accounts

Local sqlite only: tokens are minted inside `manage.py shell` (`lib/mint_tokens.py`), and a
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
| `report.mjs --validate` | about 5-10 min for 30 assertion-only findings; each check-based finding adds a check run |
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

The judges are `.claude/agents/ui-check-{guest,account,games,multiplayer}.md`; each owns a fixed,
disjoint checklist (its suite's digest lines plus visual judgement on its own surfaces). The
engines' protocol is "Fixing a UI-check finding" in `.claude/agents/frontend-engine.md` and
`backend-engine.md`: they never edit `scripts/ui-check/**` to make a finding pass; a wrong check is
reported as `check-bug` and the `ui-fix` orchestrator rules on it.

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
  pane, and the 428 consent hand-off. The account suite only proves the button renders, is sized,
  opens the Google window or frame, and shows the in-app-browser warning (AC-GOOGLE-01).

## Cost and throttles

- No paid service is used. Chrome (or Edge) runs locally; the judges run on Sonnet with
  `effort: medium` and see at most 15 images each.
- Local throttles: sign-up 10/h and log-in 30/h per IP; export, delete and set-age 10/h per account;
  score-submit 60/h per account; guess-log 120/h. The suites hit throttled endpoints only on the core
  viewports. Counters live in Django's LocMem cache, so a second full run on the same kept stack
  within the hour can reach a limit (`HTTP 429` in the digest): `run.mjs --stop` resets them.
- Each minted session adds one `OutstandingToken` row to `backend/db.sqlite3` (local, harmless).
