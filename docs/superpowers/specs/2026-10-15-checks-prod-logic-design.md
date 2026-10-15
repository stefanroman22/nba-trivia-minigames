# Checks on production code, Notion hand-off, and Logic Check — design

Owner request 2026-10-15 (standing autonomy grant). Two phases:
**A.** UI check audits production code and its fixes ship to production; grouped findings become
Notion cards the team pipeline can solve efficiently. **B.** A second checker, **Logic Check**,
proves that actions *work* (not how they look), runs before UI check, hands it a block/unblock
channel, shares test users, and both keep their own data pruned. Nothing in either phase may
cost money or write to the live site.

## 1. Vocabulary

| term | meaning |
|---|---|
| **prod code** | `origin/main` — what swishquest.com runs |
| **live site** | https://swishquest.com and its API/relay origins |
| **checkout** | a git worktree of a ref under the team worktree root, built in prod mode, served on the checker ports |
| **service** | a coarse feature area both checkers tag their checks with: `pages`, `auth`, `signup`, `profile`, `friends`, `leaderboard`, `games.<id>`, `game-data`, `rooms`, `matchmaking`, `relay` |
| **finding** | the JSON record from `findings.schema.json` (unchanged); Logic Check adds `checker: "logic"` and the API acceptance form (§6) |
| **card** | a Notion row in the team DB; one per *cluster* of findings |

## 2. Where checks run — and never run

| layer | target | writes | accounts | cost |
|---|---|---|---|---|
| **local** (both checkers) | a checkout of prod code, prod build, local sqlite, local relay | yes (local only) | minted local test users | none |
| **live probes** (Logic Check L1, UI check `@live` subset) | the live site, guest only, GET-only | **never** | none | none |

The live leaderboard has no test-user exclusion and the live relay is billed per use, so no
checker ever signs up, logs in, plays, or opens a room on the live site. The local checkout is
built from `origin/main` by default (`--ref main`); `--ref dev` and `--ref .` (the current
checkout) stay available for manual runs.

## 3. Phase A — UI check on prod code, fixes to prod, cards to the pipeline

### 3.1 Checkout
`scripts/check-core/lib/checkout.mjs#ensureCheckout(ref)` → worktree `<worktreeRoot>/check-<ref>`
(`worktreeRoot` from `.claude/team/config.json`, same root the pipeline uses), detached at
`origin/<ref>`, `npm ci` only when the lockfile changed, `backend/.venv` and
`multiplayer_server/node_modules` as junctions to the main checkout's (the pipeline's pattern),
`copy-data`. The stack runs with `repo` = the checkout; `run-meta.json` records `ref` and `head`.
Artifacts stay under `uicHome()`.

### 3.2 Live subset
`run.mjs --live` runs the guest checks tagged `@live` (routes, idle screens, perf, a11y,
permissions) against the live site on core viewports, no stack, no accounts. Findings carry
`where.env: "live"`; the same fingerprint seen locally and live merges with both envs listed.

### 3.3 Fixes ship to production (hotfix flow)
Explicit standing exception to "stop at dev", for checker findings only, written into
`CLAUDE.md`: `ui-fix` (and pipeline cards with `Target = main`) branch from `origin/main`, PR into
`main`, merge, then **back-merge** `main → dev` (merge commit, auto-merged PR) so `dev` stays a
superset. Deploys: frontend is git-connected to `main` (auto). Backend: the first implementation
task verifies in Vercel whether the backend project is git-connected; if not, the ship step runs
`cd backend && vercel deploy --prod` (free tier) when `backend/` changed. Relay (`multiplayer_server/`)
changes are never deployed by a checker: the card/PR is parked with a note for the owner
(Railway is billed). `promote-to-prod`'s "verify production" step runs after any prod deploy.

### 3.4 Notion cards (`scripts/check-core/notion-push.mjs`)
One card per **cluster** (same clustering as `ui-fix`: owner, then shared files/checks), after
`report.mjs --validate`:
- Name `[ui-check] <cluster title> (<n> findings)`; Category frontend / backend / CI/CD from
  `owner`; Priority P0 blocker, P1 major, P2 minor/polish; Difficulty hard for blockers and
  backend security, else standard; Status To Do; **new properties** `Source` (rich_text:
  `ui-check fp:<fp1>,<fp2> ids:<ids> run:<runId>`) and `Target` (select `dev|main`, here `main`).
- Body (markdown-lite the pipeline already parses): one line of context; `## Findings` with, per
  finding, severity · owner · route · viewports, **Current**, **Expected**, **Evidence** (one
  contact-sheet image uploaded, paths of the rest), **Files** (path:line — why), **How to fix**
  (change / reuse / build / rules), **Acceptance** (criteria + the verify command);
  `## Pipeline`: the engine protocol pointer ("Fixing a UI-check finding" in the engine files) and
  the QA line. Attachment: `findings.json` with the cluster's finding objects (code blocks are
  flattened by `get-spec`, files are not).
- **Dedupe:** `notion.mjs find-cards --source-fp <fp>` (new) over non-archived rows. A match that
  is not Done → no new card; one comment "seen again in run <id>" per run at most. A match that is
  Done and whose `Commit` is on `origin/main` → the finding is a regression: new card
  `[ui-check] Regression: …` linking the old one. `<home>/notion-cards.json` mirrors
  fingerprint → card for speed; Notion is the truth.

### 3.5 Pipeline support (efficient path for check cards)
- `notion.mjs`: `migrate-v3` (adds `Source`, `Target`), `create-card --source --target --attach <file>`,
  `find-cards`. `row()` exposes `source`, `target`.
- `intake.mjs`: downloads attachments (already) → `.team/attachments/<pageId>/findings.json`.
- `classify`: a card whose `Source` starts with `ui-check`/`logic-check` is pre-classified
  (areas from Category, tier from Difficulty, docs from the findings' `fix.rules`) — no plan
  writer, no design round.
- `brief.mjs`: `## Check findings` section (Current / Expected / Files / How to fix / Acceptance
  per finding, verbatim from the attachment, capped) and a `## QA assertions` entry
  `{"verify": ".team/attachments/<pageId>/findings.json"}`.
- `qa.mjs`: a `verify` assertion runs `node scripts/ui-check/verify.mjs --from <file> --mode dev
  --repo <worktree> --ports django=<lane>,socket=<lane>,web=<lane>`; PASS/FAIL merges into the
  verdict. `verify.mjs` gains `--from`, `--repo`, `--ports`.
- `ship`: honours `Target = main` (rebase on `origin/main`, ff push to `main`, back-merge to `dev`,
  backend deploy rule of §3.3, relay parked); `main-sync` marks the card Done as today.
- Cloud routine: `infra/routine/setup.sh` adds `--with-deps` to the Chromium install and
  `npm ci --prefix multiplayer_server` so `verify.mjs` can run on the VM (the owner re-pastes
  setup.sh into the routine). The cloud `uicHome` is `<repo>/.ui-check` (already).

## 4. Phase B — shared core

`scripts/check-core/` (extracted from `scripts/ui-check/lib/`, which re-exports): `home`,
`stack` (+`--ports`, `--repo`), `checkout`, `accounts` + `mint_tokens.py`, `findings`
(schema/merge/report renderer), `notion-push`, `slack`, `channel`, `retain`, `services`
(taxonomy + `CHECKS.md` column parser). Both checkers import it; `catalog.mjs` validates both.

**Test users (one registry, roles are exclusive):**

| role | username | used by |
|---|---|---|
| ui.host / ui.joiner | testuser1 / testuser2 | UI multiplayer |
| ui.solo pool | testuser3, testuser3w1..w15 | UI account + games |
| logic.actor / logic.peer | testuser4 / testuser5 | Logic auth, profile, friends, rooms |
| logic.admin | testuser6 (`promote_admin`) | Logic admin-API checks |
| signup throwaways | `uic<digits>` (UI), `lgc<digits>` (Logic) | created through the real signup path, deleted at the end of the check, swept at teardown |

All local sqlite only; `mint_tokens.py` keeps refusing any other database.

## 5. Phase B — Logic Check (`scripts/logic-check/`, ids `LC-`)

**Rule:** Logic Check asks "can the action be done and is the result right"; it never asserts
motion, layout or styling. It prefers the API and a socket.io client; it opens a browser only
for what has no API (page hydration, the signup form surfacing a backend error, the Google
button). Scripts measure; one triage agent judges, and only when something failed.

| suite | runs | what it proves (each row = one or more `LC-` checks; every check tags its services) |
|---|---|---|
| **live** (L1) | live site, GET-only, also GitHub Actions cron every 6 h | every public route returns 200 with the app shell (landing, all visible games, privacy, terms, profile, admin prompt, 404 → 404); `/api/health/`; each game's question/data endpoint loads with the expected shape and non-empty pool; public leaderboard: ranks unique and ascending, points non-increasing, total ≥ rows; Google sign-in: GIS script reachable, client id configured; relay: socket.io handshake answers; TTFB budget |
| **pages** | local | same route set on the checkout, plus hydration (a click works) |
| **auth** | local, API | login by username and by email: empty / wrong / unknown / correct → exact status + error key; token refresh rotates and blacklists the old one; logout invalidates; `/me/` matches the minted user; Google `/api/login/google/` with a bad code → 4xx (never 5xx) |
| **signup** | local, API + 1 browser case per category | the full validation matrix: username (short, long, bad chars, moderated word, taken-or-not per the display-name rule), email (missing, invalid, taken), password (every `AUTH_PASSWORD_VALIDATORS` case: too short, common, numeric, similar to username; plus empty), consent (`accepted_terms` / `age_confirmed` missing or false) → expected status + error key; happy path → 201 and the user can log in; the browser case checks that the form shows the backend's error text; the throwaway is deleted |
| **profile** | local, API | username change valid / invalid / too long; photo upload → 428 age prompt → set age → upload ok; teen → 403; remove photo; export contains the user's rows; delete needs password + `DELETE`, afterwards login fails |
| **friends** | local, API, actor ↔ peer | request appears in peer's incoming and actor's sent; accept → both lists symmetric; decline / cancel / remove / block / unblock; search by name and id; blocked can't request |
| **game-data** | local, API | every visible game's data endpoint loads with its shape; `log-session` with a known score adds exactly that many points once (`/me/`, leaderboard rank consistent); Wordle second play → 423 |
| **rooms** | local, socket.io client ×2 | identify; createFriendRoom → code; join with the code → both get `friendLobbyUpdate`; wrong code → `friendJoinError`; setRoomSize; changeFriendGame; startRoomNow → `roundData` to both; both `submitScore` → `matchResult` with the right winner; leave/close events; `findMatch` ×2 → `matchFound`; rematch propose/accept/decline |

**No-overlap matrix** (binding for both `CHECKS.md` files; `catalog.mjs` rejects a UI check that
asserts data correctness and a Logic check that asserts layout/motion):

| feature | Logic Check owns | UI check owns |
|---|---|---|
| signup / login | validation matrix, statuses, tokens, throwaway lifecycle | form layout, tab motion, rule text updating live, busy states |
| profile | that each change persists and is enforced | the card's motion and layout while changing |
| friends | that requests arrive and lists are symmetric (all actions via API) | the panel's rendering of states seeded via API (no UI sends) |
| games | data loads, score logged once, daily gate | playing through the UI: shell rules, motion, end states |
| rooms / matches | the socket protocol end to end (no browser) | the two-browser UI of rooms, results, proposals |
| pages | HTTP status, shell present, hydration | layout, overflow, perf, a11y, permissions UI |

`AC-SURF-02` changes accordingly: it seeds the friendship via API and asserts rendering only.

**Triage agent** `logic-check-triage` (sonnet, medium): input the run dir; reads the Logic digest
(capped), `notes/logic.md`, and the backend/auth/multiplayer constraint sections the failing
checks cite; maps to files via CODE_MAP + grep; writes `findings/logic.json` (owner mostly
backend; `ci` for deploy/config; frontend when the UI calls the wrong endpoint); acceptance =
the failing `LC-` check ids and/or **API assertions** (§6); never opens screenshots (there are
none except the 3 browser cases).

## 6. Acceptance DSL extension (shared `findings.schema.json`)
```json
{ "api": { "persona": "guest|logic.actor|logic.peer", "method": "POST", "path": "/api/signup/", "body": {…} },
  "expect": { "status": 400, "json": [["error", "==", "password_too_short"]] } }
```
plus `{"lc": "LC-SIGNUP-03"}` check criteria. `verify.mjs` runs both kinds (API assertions need
only the Django part of the stack).

## 7. Orchestration: order, channel, loop

**Nightly on the owner's PC** (`scripts/check-run.ps1`, Task Scheduler task `nba-checks`, 02:00,
registered by `register-check-cron.ps1`, logs in `<home>/logs/`): Logic Check (local, `main`) →
triage → `report --validate` → Notion push → **UI check** (local `main`, `@live` subset on the
live site) → judges → validate → push → retention. Each step is a script; agents run only when
there are failures. **Every 6 h on GitHub Actions** (`logic-live.yml`): Logic L1 only; Slack
`#pipeline` on failure; a card after two consecutive failures (deduped by `Source`).

**Channel** (`<home>/channel.json`, managed by `check-core/channel.mjs`):
- `blocks[]`: `{service, by: "LC-…", finding, card, since}` — written by Logic Check for every
  failed check's services once its card exists.
- UI check reads the blocks before running: every check tagged with a blocked service is
  `test.skip`ped with reason `blocked by LC-… (card …)` and appended to `deferred[]`
  `{checkId, project, blockedBy, since}`; the digest lists them under Coverage gaps.
- `channel.mjs resolve` (start of every nightly run, and on demand): a block is resolved when its
  card is Done **and** the card's `Commit` is an ancestor of `origin/main`. Resolved blocks are
  moved to `resolved[]`; their deferred checks form the **catch-up list**: Logic re-runs the
  service's checks first; if green, UI check runs the deferred checks (`--only`), then the normal
  run. Slack posts one line per resolution.
- The loop: Logic finds → card → pipeline fixes → main → Logic confirms → UI catches up.

**Retention** (`check-core/retain.mjs`, end of every nightly run): keep the last 5 runs per
checker plus any run an open card references; delete shots of older runs first, then the run;
`notes/*.md` bullets carry a date, files are capped at 150 lines, bullets older than 90 days that
name no open finding are moved to `notes/archive/<file>.md`; `channel.json` drops resolved blocks
and their deferred items after 30 days; `notion-cards.json` drops Done entries after 60 days.
Notion itself is never pruned.

**Token rules:** orchestrating scripts never read bodies; judge/triage agents run only when a
suite failed, read capped digests, one image per finding on cards; Logic Check has no images;
Slack gets one line per run.

## 8. Dedupe across checkers
Overlap is prevented structurally (§5 matrix), so the same defect reaches Notion once. The
`Source` fingerprint lookup is the backstop within a checker; across checkers the fingerprints
differ by rule, and a Logic block on a service suppresses the UI checks that would have reported
its symptoms.

## 9. Out of scope / parked
Full Google OAuth round trip (bot-blocked; manual owner check). Relay deploys (Railway, billed;
parked for the owner). Running account/game/room checks against the live site (would pollute
the live leaderboard and bill the relay). The pre-existing broken `nba-team-digest` task
(`daily-digests` is not in `slack.mjs`) is noted, not fixed.
