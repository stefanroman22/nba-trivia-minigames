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
| auth | `LC-AUTH-` | `api`, `pages` | local stack (API; one browser case) | login by username / email / Name#ID, `/me/`, refresh rotation + blacklist, logout, the auth throttles' configuration, Google login's bad input, a deleted account's tokens, the Google button |
| signup | `LC-SIGNUP-` | `api`, `pages` | local stack (API; one browser case) | the sign-up validation matrix (`lib/matrix.mjs`), frontend/backend rule agreement, the happy path and the throwaway's lifecycle, the form showing the backend's error |
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

## Auth (LC-AUTH-)

Reads as `logic.actor` (testuser4, minted tokens); the destructive case uses its own `lgc<digits>` throwaway. Every
request goes out as its own simulated client (`lib/auth.mjs` `clientIp` → `X-Forwarded-For`, which DRF's throttles key
on while `NUM_PROXIES` is unset), so the machine's 30/h login and 60/h refresh buckets are untouched; no check hunts a 429.

| ID | services | proves |
|---|---|---|
| `LC-AUTH-01` | auth | `POST /api/login/` by username: empty id + password and empty password → 400 "Email/username and password are required."; wrong password and unknown name → 401 with the same "Incorrect email, username or password." (no enumeration); correct (also in other case) → 200 `{ access, refresh, user }` of testuser4; `Name#ID` → 200, `Name#wrong` → 401. |
| `LC-AUTH-02` | auth | The same by email: empty password 400, wrong / unknown 401 with the same message, correct and upper-case email → 200 with the user. |
| `LC-AUTH-03` | auth | `GET /api/me/` with a minted token returns that user (`id, username, email, points, rank, is_admin, is_teen` equal to the mint's payload); no token and a tampered signature → 401. |
| `LC-AUTH-04` | auth | `POST /api/token/refresh/` rotates: 200 with a new access and a new refresh token (+ the user); the old refresh token again → 401 (blacklisted); the rotated one → 200 and the new access token works on `/me/`; garbage → 401. |
| `LC-AUTH-05` | auth | `POST /api/logout/` with the refresh token → 200 `success`; that token then cannot refresh (401) or log out again (400 "Invalid or expired refresh token"); no token → 400 "Refresh token required". |
| `LC-AUTH-06` | auth, signup | AUTH-9 by configuration (DRF sends no rate headers below the limit, Retry-After only with a 429): `login_view` and `google_login` carry `LoginRateThrottle` (`auth-login` 30/hour), `signup_view` `SignupRateThrottle` (`auth-signup` 10/hour), `SessionRefreshView` `RefreshRateThrottle` (`auth-refresh` 60/hour), each a `UserRateThrottle`; a correct login answers 200 without Retry-After. |
| `LC-AUTH-07` | auth | `POST /api/login/google/` with a bad code (with and without the consent tick), no code, a non-string code, a forged consent token (with and without consent) → 400 with an `error` the form can show ("Missing code", "Your sign-in took too long…", code `consent_required`), never 5xx. |
| `LC-AUTH-08` | auth | A fresh `lgc` throwaway deletes itself (`POST /api/account/delete/` password + `DELETE` → 200); afterwards its access token on `/me/` → 401, its refresh token → 401 and its login → 401 (never 5xx). |
| `LC-AUTH-GOOGLE-01` | auth | Browser: opening the login modal loads `accounts.google.com/gsi/client` (200) and initialises GIS; "Continue with Google" is present and enabled; a click opens Google's window (closed at once) or its iframe. No OAuth round trip (manual owner check). |

## Signup (LC-SIGNUP-)

The matrix is data in `lib/matrix.mjs` (provenance in its header): every row changes ONE field of an otherwise valid
sign-up, so a row the backend accepts is a `validation-gap` violation (the account it created is deleted at once), never
an expected pass. Budget: all signup POSTs are simulated clients (no real 10/h bucket spent); accounts actually created per
run are 2 (`LC-SIGNUP-05`) + at most 2 by validation gaps (then the remaining cases are not sent: `signup-budget`) → ≤ 4.
Moderated words are mild/reserved only: a severe name at sign-up strikes the caller's IP.

| ID | services | proves |
|---|---|---|
| `LC-SIGNUP-00` | signup | The frontend's stated rules and the backend agree: password min length (`passwordRules.ts` vs `MinimumLengthValidator`), every frontend rule has a configured `AUTH_PASSWORD_VALIDATORS` validator and every validator is a frontend rule or declared server-only ("Too common"), the form's username `pattern` equals `USERNAME_RE`, `CONSENT_NEEDED` equals `CONSENT_REQUIRED_MESSAGE`; every literal message of the matrix still exists in the backend source (`matrix-stale`). A mismatch is a FAIL finding. |
| `LC-SIGNUP-01` | signup | Username rows → 400: empty ("All fields are required."), too short, too long, bad characters (space/!, hyphen, accent) (`USERNAME_RULES`), mild word "Dick" ("That name isn't allowed…"), reserved "admin1" ("That name is reserved…"). |
| `LC-SIGNUP-02` | signup | Email rows: missing → 400 required; no `@` / no top-level domain → 400 "That email address doesn't look valid."; testuser4's email, also upper-case → 409 "Email already in use!…". |
| `LC-SIGNUP-03` | signup | Password rows → 400 with Django's validator message: empty (required), too short (7), common "password123", numeric only, similar to the username (`UserAttributeSimilarityValidator`). |
| `LC-SIGNUP-04` | signup | Consent rows → 400 code `consent_required` (message = `CONSENT_REQUIRED_MESSAGE`): `accepted_terms` missing / false / the string "true", `age_confirmed` missing / false; a birth date under 13 → 400 code `age_requirement`. |
| `LC-SIGNUP-05` | signup, auth | Happy path: a new `lgc<digits>` sign-up → 201 `{ access, refresh, user }`; login by email → 200 same user; `/me/` with the signup token matches; the same display name with another email → 201 (names are not unique), a bare-name login is then 401 "Several players use that name…" (AUTH-2), and that account is deleted; delete with password + `DELETE` → 200; login afterwards → 401. Everything created is removed in `finally` (the lgc sweep as the last resort). |
| `LC-SIGNUP-UI-01` | signup | Browser, one case per category that passes the form's own checks: mild word "Dick", testuser4's email, "password123" → the form shows the backend's exact message (found by its text in the modal); consent unticked → the form shows `CONSENT_REQUIRED_MESSAGE`'s text and sends nothing. No layout, motion or live-rule assertions (UI check's AC-SIGNUP rows). |

## Selftest (LC-ST-)

| ID | services | proves |
|---|---|---|
| `LC-ST-GUARD` | - | The live guard as Logic Check uses it: a page audit in env live (`lc.page`) aborts a POST to a remote origin and records `live-write`; the node `api` guard refuses a POST before it leaves and records `live-write`; GETs pass and are counted; `lc.done()` fails; the attachment has `checker` shape and `liveRequests`. |
| `LC-ST-BLOCKED` | - | `--skip-blocked` mapping (`check-core/lib/blocked.mjs`) with a fake channel: a blocked service maps to every check tagged with it in both catalogues (families in `*` form, a `games.<id>` block narrowed to that game), the grep-invert matches exactly those titles, `recordDeferrals` calls `defer()` once per check. |
| `LC-ST-TRIAGE` | - | `lib/live-triage.mjs` turns each failing LC-LIVE result into a schema-valid logic finding (owner `ci`, acceptance `{ lc }`, `where.env: ["live"]`), skips passing ones, stamps validation only for findings whose `lc` checks failed in the run, and decides the consecutive-failure state (first failure: Slack only; second: cards). |
