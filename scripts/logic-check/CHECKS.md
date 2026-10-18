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

## How runs work

- Local suites share ui-check's `stack-setup`. It brings the stack up (or reuses what already listens on the ports),
  mints testuser3 in the app's sqlite (`UI_CHECK_REPO`) and requires the running Django's `/me/` to answer 200 **with
  the same public id**. A Django serving another checkout's sqlite answers 200 for the same pk with another account, so
  setup fails with "stack on <ports> serves a different sqlite than <repo> — stop it or pass --repo of the serving
  checkout". This is a setup guard, not a check row: it has no id, and the run exits 2 (infra).
- `<uicHome>/stack.json` records `repo` and `relayKey` only for a stack whose Django the helper started
  (`check-core/lib/stack.mjs stackMeta`, unit-tested in `check-core/stack.test.mjs`). A reused Django gets
  `repo: null, relayKey: null`, and the rooms suite treats a null key as unkeyed: `LC-ROOMS-08`/`-10` point credit is
  then a warning, not a verdict.

## Suites

| suite | prefix | project | runs against | owns |
|---|---|---|---|---|
| live | `LC-LIVE-` | `live` | the live site, guest, GET/HEAD only, no stack; also every 6 h on GitHub Actions (`.github/workflows/logic-live.yml`) | public routes' status and shell, API health, each visible game's data source, the public leaderboard's consistency, Google sign-in configuration, the relay handshake, TTFB |
| pages | `LC-PAGES-` | `pages` | the local stack (checkout of `--ref`, default main), one Chromium context at desktop-1366 | the same routes on the checkout: status, shell, hydration (a click works) |
| auth | `LC-AUTH-` | `api`, `pages` | local stack (API; one browser case) | login by username / email / Name#ID, `/me/`, refresh rotation + blacklist, logout, the auth throttles' configuration, Google login's bad input, a deleted account's tokens, the Google button |
| signup | `LC-SIGNUP-` | `api`, `pages` | local stack (API; one browser case) | the sign-up validation matrix (`lib/matrix.mjs`), frontend/backend rule agreement, the happy path and the throwaway's lifecycle, the form showing the backend's error |
| profile | `LC-PROFILE-` | `api` | local stack | each profile change persists and is enforced: username change, the photo age gate (428 → age → upload), a teen's upload refused, photo removal, the data export, account deletion's two gates |
| friends | `LC-FRIENDS-` | `api` | local stack, logic.actor ↔ logic.peer | requests arrive on both sides; accept / decline / cancel / remove / block / unblock; the lists are symmetric; search by player id and by name. All via the API (UI check's `AC-SURF-02` only renders states seeded this way) |
| game-data | `LC-GAMEDATA-` | `api` | local stack | each visible game's data sources, `log-session` credit, the logged-in leaderboard rank, the Wordle daily gate |
| rooms | `LC-ROOMS-` | `rooms` | local stack, socket.io clients | the relay's protocol end to end: identify, friend rooms (create, join, size, game, start, scores, leaving), matchmaking, play-again proposals |
| selftest | `LC-ST-` | `selftest` | nothing (no app server) | the harness: live guard, blocked-check mapping, live triage |

The live suite reads the app's facts from its checkout (`lib/app.mjs`): routes and games from `src/utils/GameUtils.tsx`,
origins from `.env.production` (`VITE_BACKEND_URL`, `VITE_SOCKET_URL`, `VITE_DATA_BASE`, `VITE_QUESTIONS_BASE`), the
Google client id from `src/components/LogInSignUp.tsx`. Every request goes through the `api` fixture's guard: a
request other than GET/HEAD to a remote origin is refused before it leaves the machine and is a `live-write`
violation; `run.mjs` prints `live requests: N GET/HEAD · M refused write(s)` and fails on any write. A browser context
opened by a check (`lc.page(page)`) is guarded like `ui-check --live` (non-GET aborted, websockets refused).

Live findings (`.github/workflows/logic-live.yml` → `lib/live-triage.mjs`): a card only for a check that failed in two
consecutive cron runs; acceptance = `{ lc: <id>, projects: ['live'] }` plus a local equivalent where one exists
(`LC-LIVE-01` → `LC-PAGES-01`; `LC-LIVE-04` → `LC-GAMEDATA-03`). A live-only criterion
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
| `LC-AUTH-08` | auth | A fresh `lgc` throwaway deletes itself (`POST /api/account/delete/` username + `delete` → 200); afterwards its access token on `/me/` → 401, its refresh token → 401 and its login → 401 (never 5xx). |
| `LC-AUTH-GOOGLE-01` | auth | Browser: opening the login modal loads `accounts.google.com/gsi/client` (200) and initialises GIS; "Continue with Google" is present and enabled; a click opens Google's window (closed at once) or its iframe. No OAuth round trip (manual owner check). |

## Signup (LC-SIGNUP-)

The matrix is data in `lib/matrix.mjs` (provenance in its header): every row changes ONE field of an otherwise valid
sign-up, so a row the backend accepts is a `validation-gap` violation (the account it created is deleted at once), never
an expected pass. Budget: ≤ 4 accounts created per run; POSTs are unthrottled locally via per-request X-Forwarded-For
(`lib/auth.mjs` `clientIp`). Created accounts are counted in `<runDir>/signup-accounts.json` (shared by the API and
browser cases); at the cap a row is sent with testuser4's taken email, so a gap answers 409 and still fails as
`validation-gap` ("not created: cap"), and a row that could still create one is not sent (`signup-budget`).
Moderated words are mild/reserved only: a severe name at sign-up strikes the caller's IP.

| ID | services | proves |
|---|---|---|
| `LC-SIGNUP-00` | signup | The frontend's stated rules and the backend agree: password min length (`passwordRules.ts` vs `MinimumLengthValidator`), every frontend rule has a configured `AUTH_PASSWORD_VALIDATORS` validator and every validator is a frontend rule or declared server-only ("Too common"), the form's username `pattern` equals `USERNAME_RE`, `CONSENT_NEEDED` equals `CONSENT_REQUIRED_MESSAGE`; every literal message of the matrix still exists in the backend source (`matrix-stale`). A mismatch is a FAIL finding. |
| `LC-SIGNUP-01` | signup | Username rows → 400: empty ("All fields are required."), too short, too long, bad characters (space/!, hyphen, accent) (`USERNAME_RULES`), mild word "Dick" ("That name isn't allowed…"), reserved "admin1" ("That name is reserved…"). |
| `LC-SIGNUP-02` | signup | Email rows: missing → 400 required; no `@` / no top-level domain → 400 "That email address doesn't look valid."; testuser4's email, also upper-case → 409 "Email already in use!…". |
| `LC-SIGNUP-03` | signup | Password rows → 400 with Django's validator message: empty (required), too short (7), common "password123", numeric only, similar to the username (`UserAttributeSimilarityValidator`); a JSON number (12345678) or boolean (`true`) password → 400 (any message), never 5xx. |
| `LC-SIGNUP-04` | signup | Consent rows → 400 code `consent_required` (message = `CONSENT_REQUIRED_MESSAGE`): `accepted_terms` missing / false / the string "true", `age_confirmed` missing / false; a birth date under 13 → 400 code `age_requirement`. |
| `LC-SIGNUP-05` | signup, auth | Happy path: a new `lgc<digits>` sign-up → 201 `{ access, refresh, user }`; login by email → 200 same user; `/me/` with the signup token matches; the same display name with another email → 201 (names are not unique), a bare-name login is then 401 "Several players use that name…" (AUTH-2), and that account is deleted; delete with the username + `delete` → 200; login afterwards → 401. Everything created is removed in `finally` (the lgc sweep as the last resort). |
| `LC-SIGNUP-UI-01` | signup | Browser, one case per category that passes the form's own checks: mild word "Dick", testuser4's email, "password123" → the form's error element (`account.authError`) shows the backend's exact message; consent unticked → the form shows `CONSENT_REQUIRED_MESSAGE`'s text and sends nothing. No layout, motion or live-rule assertions (UI check's AC-SIGNUP rows). |

## Selftest (LC-ST-)

| ID | services | proves |
|---|---|---|
| `LC-ST-GUARD` | - | The live guard as Logic Check uses it: a page audit in env live (`lc.page`) aborts a POST to a remote origin and records `live-write`; the node `api` guard refuses a POST before it leaves and records `live-write`; GETs pass and are counted; `lc.done()` fails; the attachment has `checker` shape and `liveRequests`. |
| `LC-ST-BLOCKED` | - | `--skip-blocked` mapping (`check-core/lib/blocked.mjs`) with a fake channel: a blocked service maps to every check tagged with it in both catalogues (families in `*` form, a `games.<id>` block narrowed to that game), the grep-invert matches exactly those titles, `recordDeferrals` calls `defer()` once per check. |
| `LC-ST-TRIAGE` | - | `lib/live-triage.mjs` turns each failing LC-LIVE result into a schema-valid logic finding (owner `ci`, acceptance `{ lc }`, `where.env: ["live"]`), skips passing ones, stamps validation only for findings whose `lc` checks failed in the run, and decides the consecutive-failure state (first failure: Slack only; second: cards). |

## Game data (LC-GAMEDATA-)

Plays as `logic.actor` (testuser4); Wordle as its own `lgc<digits>` throwaway with a fresh device id. Each data source
comes from the catalogue's `fetchData` (`scripts/ui-check/lib/games-catalog.mjs`), not a list written by hand.
Budgets: `score-submit` 60/h is keyed per account, so `logic.actor` spends 6 `log-session` POSTs per run; `wordle-play`
20/h spends 3 POSTs on the throwaway's account and 1 on a simulated guest (a fresh `X-Forwarded-For`). The checks never
look for a 429. Each per-game violation carries the note `service games.<id>` (as `LC-LIVE-03` does).

| ID | services | proves |
|---|---|---|
| `LC-GAMEDATA-01` | game-data | Each visible game's data sources answer 200 JSON with the expected shape, a non-empty pool and no duplicate ids. The id is the first of `qid, id, person_id, match_id, game_id, team_id, season` that every row carries. Pool games (`fetchGamePool` / `fetchWholePool`) are checked in 3 places. 1) The site's bundled `/data/manifest.json` + `/data/<key>.json`, where the row count must equal the manifest count. 2) Django's `/trivia/manifest/` (the key is listed) and `/trivia/pool/<key>/` (`{ pool, count }`, where count = length = the bundled rows). 3) For `POOL_GAMES`, the v3 data host's manifest entry and its rows file. Question games (`fetchQuestion`) use the data host's question index, or the questions store's if the host does not publish the game: each qid is listed once and has a file, and one question loads with that qid. Wordle: `daily-status` for a new device answers `{ locked: false, next_reset_at: future }`. An unknown `fetchData` kind fails until the check learns it. |
| `LC-GAMEDATA-02` | game-data, leaderboard | `POST /trivia/log-session/` credits exactly what it reports. A single play with score 37 → `awarded` 37, `/me/` points move by exactly `awarded`, the answer's `points` / `rank` match `/me/`, and `rank` is the tier of `users.models update_rank`. The identical POST again: the backend has no per-play key and credits each POST as a new game (`GameSession`). The site's `awardedRef` is what sends it only once, and `score-submit` bounds replays. So the check accepts `awarded` 37 or 0 but requires `/me/` to move by exactly that amount (never a hidden double count). `mode: match` → 0 (AUTH-7: online results are the relay's to credit). Score 0 → 0. Score 1e6 → exactly the cap of the visible game with the smallest one (`views.py PER_GAME_MAX_POINTS`, else `MAX_SESSION_POINTS`). A guest → `{ awarded: 0, points: 0, rank: null }`. No `game` → 400 "game is required". |
| `LC-GAMEDATA-03` | leaderboard | The local equivalent of `LC-LIVE-04` (`lib/live-triage.mjs LOCAL_EQUIVALENT`), checked as `logic.actor` with `GET /api/get-users/`. Points must not increase down the board, and `number_users` must be at least the rows shown. `user_rank` must be (the listed players with more points than `/me/`'s) + 1 (`leaderboard.rank_of`) whenever every player above is on the page, and > 100 otherwise. A teen or age-unknown account is not listed on the public board. An adult one is listed with its `/me/` points and counted. `?scope=friends`: the player is on their own board, `user_rank` is their position, and `number_users` equals the rows. |
| `LC-GAMEDATA-04` | games.wordle, game-data | Wordle's daily gate (`trivia/wordle_daily.py`): status unlocked → the first `POST /trivia/wordle/daily-play/` → 200 `{ series: [a five-letter word], next_reset_at }` → status locked. Then 423 `{ error: "You already played today's word.", locked: true, next_reset_at }` for the same account and device again, for the same account on another device, and for a guest on the same device. A guest on a new device is still unlocked. The local sqlite has no synced `Player` table, so when today has no word and no player can supply one, today's word is stored from the bundled `backend/trivia/data/wordle.json` (sqlite asserted; metric `daily word seeded`). Without this, the first play would 500 for the environment's reason. The throwaway is deleted in `finally`. |

## Rooms (LC-ROOMS-)

These checks cover the relay's socket protocol end to end. They use two `socket.io-client` sockets in node (`lib/socket.mjs`, no browser); playing a room through the UI is UI check's. Each socket identifies as the site does: `identify { token }` with a fresh minted access token. `logic.actor` (testuser4) hosts and `logic.peer` (testuser5) joins. `LC-ROOMS-09` seats `logic.admin` (testuser6) as a third player, because `memberLeft` needs 3 or more. They never use UI check's testuser1/2. Every test ends with `leaveMatch` + `cancelFind` on each socket and then disconnects, in `finally`, so no room or queue outlives it. The minted ids are the relay's ids because `stack-setup` proved the running Django serves the minter's sqlite (see "How runs work"). A socket that dropped by itself is reconnected once in `close()` to leave its seat, rather than letting the relay's 30 s grace carry the room into the next test. Games are derived, not fixed: the first two visible, online games the relay deals as a shared round (`multiplayer_server/src/gameData.js ROUND_GAMES`). A round's rows must have the `ROUND_GAMES` count, carry every key the bundled pool's rows share, and have each id once. Messages are the relay's literals (`multiplayer_server/src/index.js`).

| ID | services | proves |
|---|---|---|
| `LC-ROOMS-01` | relay | With a valid token there is no `identifyError`, and the socket is a player: a `submitScore` for a missing room gets `opponentLeft` "This match is no longer running.", which a stranger never gets. A junk token gets `identifyError { code: "invalid_token" }`, and its `createFriendRoom` gets `friendError` "You need to be signed in to create a room." (no room). No token gets `identifyError invalid_token`. |
| `LC-ROOMS-02` | rooms, relay | `createFriendRoom` → `friendRoomCreated` with a 6-digit integer `code` and `hostUid` = the account's public id (Django's answer, not a client claim). The only member is the host, `isHost` and `online`. `game` is rebuilt with `urlPath` `/<id>`, `capacity` is the size asked for, and `min/max` equal the site's mirror (`src/utils/roomSizes.ts`). A second create gets "You're already in a room." |
| `LC-ROOMS-03` | rooms, relay | `joinFriendRoom` with the code (a string, as typed) → the joiner gets `friendRoomJoined` and the host gets `friendLobbyUpdate`. Both have the same code and `hostUid` and list host then joiner, both online. |
| `LC-ROOMS-04` | rooms, relay | A wrong code and a non-numeric code → `friendJoinError` "No room found for that code.", and nothing is joined. The host joining its own room → "You're already in this room." |
| `LC-ROOMS-05` | rooms, relay | `setRoomSize` by the host → both sockets see the new `capacity`: 3 → 3, 9 → the game's max, 1 → 2 (never below who is seated). A guest's `setRoomSize` changes nothing. |
| `LC-ROOMS-06` | rooms, relay | `changeFriendGame` by the host → both see the new `game`. Switching to tictactoe (2 players max) clamps capacity 3 → 2. A guest's change, and an unknown game id with an off-site `urlPath`, change nothing. |
| `LC-ROOMS-07` | rooms, relay | `startRoomNow` alone → `friendError` "Need at least 2 players to start.". With both seated, both get `matchFound` (`roomType: friend`, roles host/guest, the room's code and game, each other as `opponent`) and the same `roundData` for that game, with the shape described above. |
| `LC-ROOMS-08` | rooms, relay | Host submits 50 → host gets `waitingForOpponent` and the joiner gets `opponentFinished` (host id). Joiner submits 10 → `matchResult` on both: host `{ yourScore 50, opponentScore 10, outcome win }`, joiner `loss`, and `standings` [host 50 win, joiner 10 loss]. Friend rooms never credit (`creditRoom`): no `pointsAwarded`, and `/me/` points are unchanged for both. This is asserted only on a keyed stack; an unkeyed relay credits nothing anyway, so it is a warning there. |
| `LC-ROOMS-09` | rooms, relay | Leaving, each case giving the event the protocol defines. A guest `leaveMatch` in the lobby → host `friendLobbyUpdate` (alone), and the guest can rejoin. A guest leaving mid-round with 2 seated → host `matchStopped` "<guest> left, so the match ended." plus the lobby. A third player leaving a live 3-player round → `memberLeft { id, username, "<name> left the match." }` to the other two, and the round continues (no `matchStopped`). A guest disconnect in the lobby → host sees it `online: false`, then removed after `LOBBY_GRACE_MS`, and on return the guest gets `roomLeft` "You were away too long and left the room.". The host leaving mid-round → guest `opponentLeft` "The host closed the room.", and the code no longer joins. The host leaving the lobby → guest `friendRoomCancelled` "The host closed the room.". |
| `LC-ROOMS-10` | matchmaking, relay | `findMatch` alone → `searching { inQueue 1, position 1 }`. After `cancelFind`, the next searcher is alone in the queue and not paired. `findMatch` ×2 (same game) → `matchFound` on both (`roomType: match`; the player who waited is the room's host) and `roundData` on both. Scores 50/10 → `matchResult` win/loss, and a random match credits each score once: `pointsAwarded.awarded` = the score and `/me/` +score. This needs the relay key the stack shares with Django; without it this is only a warning. `proposeAgain` → `proposalPending` / `proposalReceived { type again, gameId, fromName }`. `fromName` is "Player" for a teen or age-unknown account (strangers are masked). Accept → `matchRestart` + a new `roundData` on both. A second proposal (after `RESTART_MIN_MS`) declined → `proposalDeclined` to the proposer and no restart. Leaving → `opponentLeft` "Your opponent left the match.". |

## Profile (LC-PROFILE-)

`LC-PROFILE-01/02` change logic.actor (testuser4) and put it back in `finally`: the name through the API, the photo
removed, the age back to unknown (mint `forget_age`). The logic sweep restores testuser4/5/6 names, photos and (since
Task 4) ages. `-03..-06` each mint their own `lgc` throwaway (slots 60–63) and delete it. Budget: authenticated
throttles key by account, so testuser4 spends one `account-data` (10/h) per run; the export, the deletes and the teen's
age spend the throwaways' own buckets. The valid rename is cleared by `check-name` first (never a strike).

| ID | services | proves |
|---|---|---|
| `LC-PROFILE-01` | profile | `POST /api/update-profile/` (JSON) username: bad characters ("lc bad!", a hyphen), 21 chars, 2 chars → 400 `USERNAME_RULES` and `/me/` still `testuser4`; a valid `lcProfile<4 digits>` → 200 `success` and `/me/` shows it. |
| `LC-PROFILE-02` | profile | testuser4 with the age unknown: a multipart upload (1x1 PNG) → 428 code `age_required` with the age message, `/me/` photo still null; `POST /api/account/age/` adult → 200, `is_teen` false; upload again → 200 `success`; `/me/` `profile_photo` is a `data:image/jpeg` URL equal to the upload answer's. |
| `LC-PROFILE-03` | profile | Throwaway: `POST /api/account/age/` teen (14) → 200, `is_teen` true; upload → 403 "Profile photos are available from age 16.", `/me/` photo null; an adult year afterwards → 409 "Your age is already confirmed." (the age is set once). |
| `LC-PROFILE-04` | profile | Throwaway made adult with a photo (public `/api/users/<id>/photo/` 200): `POST /api/account/remove-photo/` → 200 `profile_photo` null; `/me/` null; the public photo URL → 404. |
| `LC-PROFILE-05` | profile, friends | Throwaway that sent testuser5 a request: `GET /api/account/export/` → 200 attachment; `account.id/username/email` are the throwaway's; `friend_requests_sent` lists testuser5 as `{ id, username }`; no email but its own anywhere in the export. |
| `LC-PROFILE-06` | profile, auth | Throwaway: delete with a wrong username + `delete` → 400 "Type your username exactly as it appears to confirm."; the right username without `confirm_text` → 400 "Type delete to confirm." (the account is still there); both (the word in any case, no password) → 200 `deleted`; then login → 401 "Incorrect email, username or password." and the access token on `/me/` → 401. |

## Friends (LC-FRIENDS-)

logic.actor (testuser4) ↔ logic.peer (testuser5), minted tokens, every action through the API. Each check first clears
both sides (cancel / decline / unblock / remove, verified by the overview and a `remove-friend` 404) and does it again
in `finally` (`cleanup` violation if anything is left); the logic sweep clears testuser4 ↔ testuser5 rows too. Budget
per run (per account): `friend-action` (send + block, 60/h) testuser4 ≈ 9, testuser5 ≈ 2; `user-search` (120/h) ≤ 8
each; `account-data` testuser5 1 (`-08`).

| ID | services | proves |
|---|---|---|
| `LC-FRIENDS-01` | friends | Send → 201 `sent`; testuser5's `incoming_requests` has testuser4 and testuser4's `outgoing_requests` has testuser5 with the same `request_id`, nothing in the reverse direction, not friends yet; a second send → 409 "Request already sent.". |
| `LC-FRIENDS-02` | friends | The receiver accepts → 200 `accepted`; `search-friends` of each lists the other; no request is left on either side. |
| `LC-FRIENDS-03` | friends | The sender's decline → 404 "Request not found."; the receiver declines → 200 `declined`; no request on either side, not friends. |
| `LC-FRIENDS-04` | friends | The receiver's cancel → 404 "Request not found."; the sender cancels → 200 `cancelled`; gone from both. |
| `LC-FRIENDS-05` | friends | Friends, then remove → 200 `removed`; neither list has the other; removing again (from the other side) → 404 "You're not friends with this player.". |
| `LC-FRIENDS-06` | friends | Friends, then testuser4 blocks → 200 `blocked`: the friendship is gone; testuser4's `blocked_users` lists testuser5, testuser5's lists nobody (one-way); a send from the blocked side and from the blocker → 403 "You can't send a request to this player."; `search-users` by player id hides each from the other (backend: blocked either way is omitted). |
| `LC-FRIENDS-07` | friends | After a block, unblock → 200 `unblocked` and no longer listed; testuser5 sends → 201 and it arrives in testuser4's incoming; unblocking again → 404 "You haven't blocked this player.". |
| `LC-FRIENDS-08` | friends | `search-users` by player id, `#id` and the lower-case id → testuser5 with relationship `none`; by name while testuser5's age is unknown → not listed (unknown-age and teen players are findable by exact id only, `users/friends.py`); after testuser5 gives an adult age → listed by name, relationship `none`; one character → `[]`. The age is forgotten in `finally`. |
