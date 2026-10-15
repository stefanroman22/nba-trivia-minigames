# Checks Phase B — Logic Check, shared test users, channel, scheduler, retention

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second checker, Logic Check, proves that actions work (API/socket level, minimal browser), runs nightly before UI check, hands it a block/unblock channel, shares one test-user registry, pushes grouped Notion cards through the same path as UI check, and both checkers prune their own data.

**Architecture:** Logic Check is a second Playwright Test project set (`scripts/logic-check/`) that reuses `scripts/check-core/` (stack, checkout, accounts, findings, notion-push, digest reporter via ui-check's `lib/`) and ui-check's `verify.mjs` (extended with API assertions and `lc` check criteria). API suites use Playwright's `request` context; the rooms suite uses `socket.io-client` ×2 in node; three browser cases cover what has no API. One triage agent runs only on failures. `check-core/channel.mjs` holds blocks/deferred; `check-run.ps1` orders the nightly run; `retain.mjs` prunes.

**Tech Stack:** `@playwright/test` 1.62.1 (`request` fixture, one Chromium project), `socket.io-client` (already in `multiplayer_server/node_modules`; add to root devDependencies pinned to the relay's version), node ESM `.mjs`, PowerShell Task Scheduler, GitHub Actions cron (live probes only).

**Spec:** `docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §4–§8 (binding; §5 no-overlap matrix is enforced by `catalog.mjs`).

## Global Constraints

- Logic Check never asserts layout/motion/styling and never opens a browser for what the API or socket can do; UI check never asserts data correctness (§5 matrix). `catalog.mjs` rejects an `LC-` spec that imports `audit.layout`/`audit.motion`/`audit.a11y`/`audit.perf`, and a `G-/AC-/GM-/MP-` spec that imports `scripts/logic-check/lib/*`.
- Local-only writes: local stack from a checkout of `main` (prod mode) with sqlite; `mint_tokens.py` keeps refusing non-sqlite; the `live` suite is GET-only under the same guard as `--live` (abort non-GET to remote origins).
- Test users per spec §4; `lgc<digits>` throwaways deleted by the check that made them and swept at teardown; admin role via `promote_admin` on local sqlite only.
- Check IDs `LC-<SUITE>-NN` (`LC-LIVE-`, `LC-PAGES-`, `LC-AUTH-`, `LC-SIGNUP-`, `LC-PROFILE-`, `LC-FRIENDS-`, `LC-GAMEDATA-`, `LC-ROOMS-`), each once, documented in `scripts/logic-check/CHECKS.md` with a `services` column; every UI check row in `scripts/ui-check/CHECKS.md` also gets a `services` column (Task 1).
- Services taxonomy exactly: `pages, auth, signup, profile, friends, leaderboard, games.<id>, game-data, rooms, matchmaking, relay`.
- Runs/artifacts under `uicHome()` (`<home>/runs/<runId>` with `checker` in run-meta; logic run ids `YYYYMMDD-HHmm-logic`); `<home>/channel.json`, `<home>/notion-cards.json`, `<home>/logs/`.
- Money: GitHub Actions only for the live probes (≤ 5 min per run, 4×/day); the nightly local run is Task Scheduler. Never deploy the relay.
- Token rules: the triage agent runs only when a suite failed and reads capped digests; no images; orchestrator scripts never read bodies.
- Commit messages one plain line, no AI trailer. No edits to `src/`, `backend/`, `multiplayer_server/` (read-only; findings describe what to fix there).

## Review Focus

1. A signup matrix case that the backend accepts although the spec expects rejection → must become a FAIL (finding), not a silently "expected" pass; the matrix is derived from the backend's validators and the frontend's rule list, and the two are compared.
2. Logic Check blocks service `auth` → every UI check tagged `auth` is skipped with the block reason, listed under Coverage gaps and in `channel.json.deferred`; when the card is Done and its commit is on `origin/main`, the next nightly run re-runs the LC auth checks first and then the deferred UI checks.
3. Rooms suite: two socket clients identifying as `testuser4`/`testuser5` must never collide with UI check's `testuser1/2` (sequential nightly order + distinct users) and must leave no room/queue behind (leave/close in `finally`).
4. Live suite on GitHub Actions with a transient outage → Slack line, no card on the first failure, card on the second consecutive failure, deduped by `Source`.
5. Retention must never delete a run referenced by an open card or the newest run of each checker.

---

### Task 1: check-core additions — services, roles, schema, verify API assertions, channel, retain

**Files:**
- Create: `scripts/check-core/lib/services.mjs`, `lib/channel.mjs`, `lib/retain.mjs`, `lib/slack-line.mjs`, tests `scripts/check-core/{services,channel,retain}.test.mjs`
- Modify: `scripts/check-core/lib/accounts.mjs` (+ `mint_tokens.py`: roles, `lgc*`, `promote_admin` op, sweep), `scripts/ui-check/findings.schema.json` (`checker`, `api` assertion, `lc` check), `scripts/check-core/lib/findings.mjs` (parse/validate `api`/`lc`), `scripts/ui-check/lib/verify-core.mjs` + `verify.mjs` (run `api` assertions against the Django of the active stack; `lc` criteria via the logic-check runner), `scripts/ui-check/catalog.mjs` (both CHECKS.md files, `services` column required, no-overlap import lint), `scripts/ui-check/CHECKS.md` (services column on every row), `scripts/check-core/notion-push.mjs` (`--checker logic` enabled: title prefix `[logic-check]`, engine protocol pointer "Fixing a Logic-check finding"), `card-body.mjs` (verify command per checker)

**Interfaces (Produces):**
```js
// lib/services.mjs
export const SERVICES = ['pages','auth','signup','profile','friends','leaderboard','game-data','rooms','matchmaking','relay']; // plus games.<id>
export function parseServices(checksMd) // → Map<checkId, string[]>; throws on a row without services
export function servicesOf(checkId, maps)
// lib/accounts.mjs additions
export const ROLES = { 'ui.host':'testuser1','ui.joiner':'testuser2','ui.solo':'testuser3','logic.actor':'testuser4','logic.peer':'testuser5','logic.admin':'testuser6' };
export function userForRole(role)              // + ui.solo pool via soloUsername()
export async function ensureAdmin(username)    // mint op promote_admin (local sqlite only)
export const isTestUsername = (u) => /^(testuser\d(w\d{1,2})?|uic\d{4,17}|lgc\d{4,17})$/.test(u)
// lib/channel.mjs  (<home>/channel.json = {blocks:[], deferred:[], resolved:[]})
export function readChannel(); export function writeChannel(c)
export function block({service, by, finding, card, runId})         // idempotent per (service, by)
export function blockedServices()                                    // → Set
export function defer({checker, checkId, project, blockedBy, runId})
export async function resolve({isDone, isOnMain})                    // → {resolved:[…], catchUp:{ui:[checkIds], logic:[services]}}
// lib/retain.mjs
export async function retain({home, keepRuns=5, openRunIds=new Set(), notesMax=150, notesDays=90, channelDays=30, cardsDays=60, dryRun=false}) // → report of deletions
// findings.schema.json additions
//   finding.checker: 'ui'|'logic' (default 'ui'); acceptance.assertions[] may be
//   { api:{persona:'guest'|'logic.actor'|'logic.peer'|'logic.admin', method, path, body?, headers?}, expect:{status, json?:[[jsonPath, op, value]], headers?:{…}} }
//   acceptance.checks[] entries may be { lc:'LC-…', projects:[…] } in addition to { id:'G-…', projects }
// verify.mjs: `api` assertions run with node fetch against the stack's Django (token minted per persona); `lc` checks run `node scripts/logic-check/run.mjs --only <ids> --vp - --mode <mode>` (Task 2 provides) and parse the same results.json shape.
```
- [ ] Steps: TDD per module (services parse + no-overlap lint; channel block/defer/resolve with fake isDone/isOnMain; retain on a fixture home dir; accounts roles + sweep regex), implement, `catalog.mjs` extended and green on the current ui-check CHECKS.md once the `services` column is filled (fill it: every row gets its services from its description — e.g. `G-MODAL-01` → `pages`, `AC-LOGIN-01` → `auth`, `GM-wordle-*` → `games.wordle,game-data`, `MP-*` → `rooms`/`matchmaking`/`relay`), selftests 18/18 still green, commit `check-core: services, roles, channel, retention, API acceptance`.

### Task 2: Logic Check harness, live + pages suites, GitHub Actions cron

**Files:**
- Create: `scripts/logic-check/playwright.config.mjs` (projects: `live` (no stack; baseURL = live site; GET guard), `pages` (stack, one Chromium browser), `api` (stack, `request` only, no browser), `rooms` (stack, node socket clients)), `lib/fixtures.mjs` (`test`, `expect`, `api` = request context with persona tokens, `lc` = {violation, metric, done} thin audit reusing ui-check's reporter attachment shape, `guard` for live), `lib/api.mjs` (`call(persona, method, path, body)` with minted tokens, status/json helpers), `run.mjs` (`--suite live|pages|auth|signup|profile|friends|game-data|rooms|all`, `--ref main`, `--live`, `--only`, `--mode`, `--keep-stack`, `--skip-blocked`, writes `<home>/runs/<id>-logic/` via the shared reporter; prints digest path), `CHECKS.md`, `specs/live/live.spec.mjs` (`LC-LIVE-01..07`: routes 200+shell, health, per-game data endpoints shape+non-empty, public leaderboard rules (ranks unique ascending, points non-increasing, total ≥ rows), Google GIS script reachable + client id configured, relay handshake, TTFB budget), `specs/pages/pages.spec.mjs` (`LC-PAGES-01`: same routes on the checkout + one hydration click), `.github/workflows/logic-live.yml` (cron `0 */6 * * *`, `npm ci`, `node scripts/logic-check/run.mjs --suite live --live`, on failure: `node scripts/slack.mjs post-text <general> "…"`; second consecutive failure (state via `actions/cache` key `logic-live-state`) → `node scripts/check-core/notion-push.mjs --run <id> --checker logic --target main` after a scripted minimal triage (`lib/live-triage.mjs` turns each failing LC-LIVE check into a finding with owner `ci`, no agent))
- Modify: `scripts/ui-check/lib/digest-reporter.mjs` (checker-agnostic: suite names from project; `checker` in results), `scripts/ui-check/run.mjs` (`--skip-blocked` default on: reads `channel.blockedServices()` → `--grep-invert` of blocked check ids built from the services map; records `defer()` for each skipped id; Coverage gaps section lists them), `package.json` (`logic:check`, `logic:live` scripts; `socket.io-client` devDependency)
- [ ] Steps: config + fixtures + `LC-LIVE-01` first (TDD against the live site — read-only), then the rest; prove `node scripts/logic-check/run.mjs --suite live --live` (digest, 0 writes), `--suite pages --ref main`; prove ui-check `--skip-blocked` with a hand-written block in `channel.json` (deferred list appears; Coverage gaps names the block). Commit `logic-check: harness, live and pages suites, ui-check honours channel blocks`.

### Task 3: auth + signup suites

**Files:** Create `scripts/logic-check/specs/api/auth.spec.mjs` (`LC-AUTH-01..08`), `specs/api/signup.spec.mjs` (`LC-SIGNUP-01..NN`), `lib/matrix.mjs` (the validation matrix as data: `{case, body, expectStatus, expectError}` for username/email/password/consent, derived once from `backend/users/views.py` + `backend/backend/settings.py` validators + `src/utils/passwordRules.ts`; a `LC-SIGNUP-00` check asserts the frontend rule list and the backend validators agree (same min length, same forbidden classes)), `specs/pages/signup-ui.spec.mjs` (`LC-SIGNUP-UI-01`: one browser case per category shows the backend's error text), `specs/pages/google.spec.mjs` (`LC-AUTH-GOOGLE-01`: GIS script loads, button present, `/api/login/google/` with a bad code → 4xx not 5xx), notes `scripts/logic-check/notes/logic.md`.
- Auth cases: login by username / by email: empty, wrong, unknown, correct → exact status + error key; refresh rotates + blacklists old; logout invalidates; `/me/` matches; throttle headers present (no 429 hunting). Throwaway `lgc<digits>` per signup happy path, deleted at the end of the check; core run only (signup 10/h).
- [ ] Steps: TDD; run `--suite auth,signup --ref main`; triage: every FAIL is a real backend/frontend defect or a matrix mistake (fix the matrix only when the backend's documented behaviour proves it); commit `logic-check: auth and signup suites`.

### Task 4: profile + friends suites
**Files:** `specs/api/profile.spec.mjs` (`LC-PROFILE-01..06`), `specs/api/friends.spec.mjs` (`LC-FRIENDS-01..08`), cleanup in `finally` (names/photos restored, friendships cleared) + teardown sweep. Cases per spec §5 rows. Commit `logic-check: profile and friends suites`.

### Task 5: game-data + rooms suites
**Files:** `specs/api/game-data.spec.mjs` (`LC-GAMEDATA-01..04`: each visible game's data endpoint shape, `log-session` adds exactly the score once (`/me/` + leaderboard rank consistent with points), Wordle second play 423), `specs/rooms/rooms.spec.mjs` (`LC-ROOMS-01..10` via `socket.io-client` ×2 as `logic.actor`/`logic.peer`: identify, createFriendRoom → code, join → both lobby updates, wrong code → error, setRoomSize, changeFriendGame, startRoomNow → roundData both, submitScore both → matchResult correct winner, leave/close events, findMatch ×2 → matchFound, propose/accept/decline), `lib/socket.mjs` (client helper with event waits + timeouts, always disconnects). Commit `logic-check: game-data and rooms suites`.

### Task 6: triage agent, logic-check skill, nightly orchestration, retention wiring, docs

**Files:**
- Create: `.claude/agents/logic-check-triage.md` (sonnet, medium; input runDir; reads capped digest + `notes/logic.md` + the constraint sections cited; writes `findings/logic.json` with `checker:'logic'`, owner routing backend/ci/frontend, acceptance = failing `lc` checks and/or `api` assertions confirmed with `node scripts/logic-check/probe.mjs --api '<json>'` (create: one API assertion runner printing ≤10 lines); no images), `.claude/skills/logic-check/SKILL.md` (run → triage (only if failures) → `report.mjs --run <id>-logic --validate` → `notion-push --checker logic --target main` → `channel.block()` for each pushed finding's services → stop stack → hand-over), `scripts/check-run.ps1` (nightly: `channel resolve` → catch-up (logic re-run of resolved services; ui `--only` deferred) → logic full → push → blocks → ui full `--ref main` + `--live` → judges (4) → push → `retain` → Slack one line; logs to `<home>/logs/check-<ts>.log`; lockfile), `scripts/register-check-cron.ps1` / `unregister-check-cron.ps1` (task `nba-checks`, daily 02:00, 4 h limit, StartWhenAvailable), `docs/logic-check/README.md`
- Modify: `.claude/skills/ui-check/SKILL.md` (channel awareness + catch-up), `.claude/agents/backend-engine.md` + `frontend-engine.md` ("Fixing a Logic-check finding": `verify.mjs <id> --run <id>-logic …` same loop), `CLAUDE.md` (doc-map row), `docs/ui-check/README.md` (cross-link), `scripts/check-core/README.md`
- [ ] Steps: write; validate commands; dry-run `check-run.ps1 -DryRun` (prints the plan without running suites); commit `logic-check: triage agent, skill, nightly scheduler, retention, docs`.

### Task 7: end to end (controller)
- [ ] Full nightly simulation by hand in order: `logic-check` (local main + live) → triage → validate → push (dry, then real for blocker/major) → `channel.json` shows blocks → `ui-check --ref main --suite guest,account --vp core` shows blocked checks deferred → mark one logic card Done with a commit on main (use the already-shipped hotfix commit as the "fix" of a synthetic block) → `channel resolve` → catch-up lists the deferred UI checks → run them.
- [ ] `retain --dry-run` on the real home; then real.
- [ ] Register the Task Scheduler job; enable the GitHub Actions cron (merge).
- [ ] Final whole-branch review; PR → `dev`; merge.
