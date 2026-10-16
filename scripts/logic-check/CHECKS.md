# Logic Check catalogue

Logic Check proves that actions work: the API, the socket protocol, page status and hydration. It never asserts
layout, motion or styling (that is UI check, `scripts/ui-check/CHECKS.md`); the no-overlap matrix is in
`docs/superpowers/specs/2026-10-15-checks-prod-logic-design.md` §5 and `scripts/ui-check/catalog.mjs` enforces it.

## How IDs work

- A test title starts with its ID in brackets: `[LC-LIVE-01] every public route answers 200 …`. Ids are `LC-<SUITE>-NN`,
  each appears once across both checkers' specs (`node scripts/ui-check/catalog.mjs`), and every one is listed below.
- A check is one test that collects every problem it sees (`lc.violation`) and fails once at `lc.done()`; its cases
  are `test.step`s. The digest groups by ID; results carry `checker: 'logic'` and the suite of the ID's prefix.
- Every row's `services` column names the app services the check depends on (`scripts/check-core/lib/services.mjs`:
  `pages, auth, signup, profile, friends, leaderboard, games.<id>, game-data, rooms, matchmaking, relay`; `-` only for
  the `LC-ST-` selftests). When a Logic finding's card exists, its services are blocked in `<uicHome>/channel.json`;
  UI check then defers its checks tagged with those services (its `--skip-blocked` is on by default). Logic Check itself
  skips nothing by default: it wrote the blocks and must keep re-running the blocked checks to see the fix land;
  `run.mjs --skip-blocked` (opt-in, ignored with `--only`) leaves them out and defers them like UI check does.
- Runs: `node scripts/logic-check/run.mjs --suite <suites>|all` → `<uicHome>/runs/<YYYYMMDD-HHmm>-logic/`
  (`results.json`, `digest.md`, `run-meta.json` with `checker: 'logic'`). A Logic run never moves the UI check `latest`
  pointer.

## Suites

| suite | prefix | project | runs against | owns |
|---|---|---|---|---|
| live | `LC-LIVE-` | `live` | the live site, guest, GET/HEAD only, no stack; also every 6 h on GitHub Actions (`.github/workflows/logic-live.yml`) | public routes' status and shell, API health, each visible game's data source, the public leaderboard's consistency, Google sign-in configuration, the relay handshake, TTFB |
| pages | `LC-PAGES-` | `pages` | the local stack (checkout of `--ref`, default main), one Chromium context at desktop-1366 | the same routes on the checkout: status, shell, hydration (a click works) |
| auth | `LC-AUTH-` | `api`, `pages` | local stack | Task 3 |
| signup | `LC-SIGNUP-` | `api`, `pages` | local stack | Task 3 |
| profile | `LC-PROFILE-` | `api` | local stack | Task 4 |
| friends | `LC-FRIENDS-` | `api` | local stack | Task 4 |
| game-data | `LC-GAMEDATA-` | `api` | local stack | Task 5 |
| rooms | `LC-ROOMS-` | `rooms` | local stack, socket.io clients | Task 5 |
| selftest | `LC-ST-` | `selftest` | nothing (no app server) | the harness: live guard, blocked-check mapping, live triage |

The live suite reads the app's facts from its checkout (`lib/app.mjs`): routes and games from `src/utils/GameUtils.tsx`,
origins from `.env.production` (`VITE_BACKEND_URL`, `VITE_SOCKET_URL`, `VITE_DATA_BASE`, `VITE_QUESTIONS_BASE`), the
Google client id from `src/components/LogInSignUp.tsx`. Every request goes through the `api` fixture's guard: a
request other than GET/HEAD to a remote origin is refused before it leaves the machine and is a `live-write`
violation; `run.mjs` prints `live requests: N GET/HEAD · M refused write(s)` and fails on any write. A browser context
opened by a check (`lc.page(page)`) is guarded like `ui-check --live` (non-GET aborted, websockets refused).

Live findings (`.github/workflows/logic-live.yml` → `lib/live-triage.mjs`): a card only for a check that failed in two
consecutive cron runs; acceptance = `{ lc: <id>, projects: ['live'] }` plus a local equivalent where one exists
(`LC-LIVE-01` → `LC-PAGES-01`; `LC-LIVE-04` → the game-data suite's leaderboard check, Task 5). A live-only criterion
neither passes nor fails in a local `verify` ("confirmed by the live cron after promotion"); `verify --live` evaluates it.
The TTFB finding (`LC-LIVE-07`) uses rule `perf`, route `/`, selector `document`, so it merges with UI check's live
`G-PERF-01` finding (spec §8).

## Live (LC-LIVE-)

| ID | services | proves |
|---|---|---|
| `LC-LIVE-01` | pages | Every public route (`/`, every visible game from the catalogue incl. `/coming-soon`, `/privacy`, `/terms`, `/profile`, `/admin`) answers 200 `text/html` with the server-rendered app shell (a `<title>`, the `/_next/static/` scripts, no `__next_error__` page); `/lc-check-no-such-page` answers 404 with the shell. Hidden game slugs (404) are UI check's `G-PERM-` rows. |
| `LC-LIVE-02` | auth, signup, profile, friends, leaderboard | `GET <api>/health/` answers 200 `{"ok": true}`; its time is a metric (no budget: serverless cold starts). |
| `LC-LIVE-03` | game-data | Each visible game's data source (its `fetchData` in `GameUtils.tsx`) loads with its shape and a non-empty pool: a `POOL_GAMES` pool from the manifest-v3 data host (manifest entry, rows file or first chunk, lookups, encoded keys resolve); any other pool from the site's bundled `/data/manifest.json` + `/data/<key>.json` (row count = manifest count); a question game from the data host's question index + one question file, else the questions store; Wordle's read-only `GET /trivia/wordle/daily-status/` (`locked` boolean, `next_reset_at` date; the daily-play POST is local only). An unknown `fetchData` kind fails until the check learns it. Each per-game violation carries the note `service games.<id>`: blocking `games.<id>` per failing game (instead of all of `game-data`) is Task 6's mapping. |
| `LC-LIVE-04` | leaderboard | `GET <api>/get-users/` (guest) is consistent: `top_100_users` ≤ 100 rows of `{ id, username, points ≥ 0 }`, each player once (ranks are positions, so unique and ascending), points non-increasing as the rank grows, `number_users` ≥ the rows shown, `user_rank` null for a guest. |
| `LC-LIVE-05` | auth | Google sign-in is configured: `https://accounts.google.com/gsi/client` loads (200 JavaScript), the client id in the source ships in the landing page's JS, and Google's OAuth endpoint accepts it for the site origin (redirects to sign-in, not `/signin/oauth/error`). The full OAuth round trip stays a manual owner check. |
| `LC-LIVE-06` | relay | The relay (`VITE_SOCKET_URL`) answers a socket.io handshake: `GET /socket.io/?EIO=4&transport=polling` → 200 with an Engine.IO open packet (`sid`, `pingInterval`). No socket is opened beyond that one polling GET. |
| `LC-LIVE-07` | pages | Every public route's TTFB (time to the response headers from the checker, best of two, after one warm-up) is ≤ 800 ms. Enforced on the live site; a metric per route. |

## Pages (LC-PAGES-)

| ID | services | proves |
|---|---|---|
| `LC-PAGES-01` | pages | On the checkout (prod build, local stack), every public route of `LC-LIVE-01` loads in Chromium with HTTP 200 (the unknown route 404), the app shell renders and React hydrates (event props on an interactive element within 10 s); the 404 page's "Back to games" button navigates to `/` (a click works). TTFB per route is a metric only: local load budgets are UI check's (`G-PERF-01`, spec §5). |

## Selftest (LC-ST-)

| ID | services | proves |
|---|---|---|
| `LC-ST-GUARD` | - | The live guard as Logic Check uses it: a page audit in env live (`lc.page`) aborts a POST to a remote origin and records `live-write`; the node `api` guard refuses a POST before it leaves and records `live-write`; GETs pass and are counted; `lc.done()` fails; the attachment has `checker` shape and `liveRequests`. |
| `LC-ST-BLOCKED` | - | `--skip-blocked` mapping (`check-core/lib/blocked.mjs`) with a fake channel: a blocked service maps to every check tagged with it in both catalogues (families in `*` form, a `games.<id>` block narrowed to that game), the grep-invert matches exactly those titles, `recordDeferrals` calls `defer()` once per check. |
| `LC-ST-TRIAGE` | - | `lib/live-triage.mjs` turns each failing LC-LIVE result into a schema-valid logic finding (owner `ci`, acceptance `{ lc }`, `where.env: ["live"]`), skips passing ones, stamps validation only for findings whose `lc` checks failed in the run, and decides the consecutive-failure state (first failure: Slack only; second: cards). |
