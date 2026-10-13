# UI check catalogue

Every check has one ID and lives in exactly one suite. This file lists all of them and says which suite
owns what. The spec is `docs/superpowers/specs/2026-10-11-ui-check-design.md`.

## How IDs work

- A test title starts with its ID in brackets, then a description: `[G-HOME] home page layout`.
  The `audit` fixture reads the ID from the title. It names the evidence folder
  (`<uicHome>/runs/<run>/shots/<ID>/`) and groups the digest by it.
- `<uicHome>` is where everything is written (`lib/home.mjs`): `UI_CHECK_HOME` if set; on Windows with the repo under OneDrive `%LOCALAPPDATA%
ba-ui-check`; else `<repo>/.ui-check`. `node scripts/ui-check/run.mjs --where` prints it and the latest run directory.
- A test title may carry the tag `@perf` after its ID (`[G-PERF-01] @perf ...`). `run.mjs` runs `@perf` tests in a second, single-worker invocation so timing is not distorted by parallel browsers.
- Prefixes: `G-` guest, `AC-` account, `GM-` games, `MP-` multiplayer, `ST-` selftest, `ACCEPT` acceptance.
- Each ID appears once across all specs and is listed below. A generated family (one test per game ×
  scenario, say) is listed as a pattern such as `GM-<game>-<scenario>`.
- Detector rule IDs (spec §6) are not check IDs. Any check can report them: `overflow-x`, `offscreen`,
  `clipped`, `occluded`, `tap-target`, `snap`, `cls`, `loaf`, `slow-action`, `console`, `slow-api`,
  `a11y`, `perf`, plus check-specific rules.
- `tap-target` is WCAG 2.5.8: a target under 24×24 CSS px fails unless it is a link inside running
  text, or spaced so that a 24px circle centred on it meets no other target (nor an undersized
  target's own circle). Stacked list links, like the footer, are judged by the spacing rule.
- Soft rules are recorded as warnings and never fail a test: `tap-target-touch` (under 44×44 on a
  touch viewport). They are listed in the digest under `## Warnings`.

- `audit.timing(label, action, done, budget)` is measured in node, from before `action` to after `done`.
  It includes the CDP round trips of every Playwright call inside, so it reads a little higher than
  in-page time. Set budgets with that in mind.

## Ownership matrix

Personas log in with tokens minted straight into the local sqlite DB (`lib/mint_tokens.py`), a fresh
pair per test. Each mint adds one `OutstandingToken` row to `backend/db.sqlite3`; that is harmless
(local only, expires with the 90-day refresh lifetime). Each parallel worker has its own solo account,
because two sockets of one user displace each other in the relay and Django throttles per account.

| suite | prefix | persona | viewports | owns |
|---|---|---|---|---|
| guest | `G-` | guest (logged out) | all 7 | Public layout of `/`, `/privacy`, `/terms`, `/coming-soon`, the 404 page, the guest views of `/profile` and `/admin`, and the **idle** screen of every visible game. Nav, drawer, footer, rail and chip links. Scrolling, and scroll-lock released after a modal closes. Public modals (login opens, feedback, leaderboard, instructions, multiplayer info): one backdrop, Escape closes, focus returns, z-index scale. Route transitions, segmented-tab thumbs, load CLS/LCP/TTFB, interaction latency, axe a11y, tap targets. Permissions: `/admin` shows "Admins only" with no admin data, `/api/admin/*` returns 401/403, no Admin nav link, hidden game slugs return 404, guests see "Log in to play online" and open no socket. |
| account | `AC-` | solo (per-worker accounts: `testuser3` on worker 0, `testuser3w<n>` on worker n) + throwaway | all 7 for layout; core only for flows that hit throttled endpoints (sign-up, UI log-in) | Sign-up form (live password rules, username check, consent required, duplicate errors, closing animation on success). Log in by email and by username, wrong-password error, session survives reload, expired access token refreshes silently, log out reverts the UI. Google button: renders, sized, click opens the popup or GIS frame, in-app-browser warning (the full OAuth round trip stays a manual owner check). Profile: change username (valid / invalid / too long / taken), copy player ID, photo upload with the age prompt, remove photo, export data, delete account (throwaway). Logged-in surfaces: profile card, friends panel tabs, friend request round trip with testuser2 (driven through the API), leaderboard friends tab, points panel. Permissions: `/admin` as non-admin, `/api/admin/*` 403. Play Online opens searching and Cancel works (the match belongs to multiplayer). Blocking: buttons disable with feedback while submitting, double submit is impossible, no action waits more than 400 ms on an animation. |
| games | `GM-` | solo (the games suite rotates each test over 4 accounts per worker, `testuser3` / `testuser3w<n>`, to stay under the 60/h score-submit throttle; the `@perf` pass stays on `testuser3`) | all scenarios on core; `perfect` as layout-only on the other 4 | Per visible game, the scenarios from its adapter: `perfect`, `wrong`, `partial`, `timeout`, `giveup`, `daily-lock`. Shell contract (Rule 4.2 distances), stage never resizes during feedback (6.2), lives running out never announced (6.3), the game ends in place with the answer visible and the score above the buttons (7.0/7.3), feedback copy (6.0), points logged for the solo user, Play again and Close game, motion and latency while answering. |
| multiplayer | `MP-` | pair (`testuser1` host + `testuser2` joiner) | pairs A `desktop-1366`+`phone-390`, B `phone-360`+`desktop-1920`, C `tablet-768`+`tablet-1280`, D `phone-414`+`phone-390` | 1v1 matchmaking (search, cancel, match found, intro). Friend rooms (generate code, copy, wrong-code error, join, player stepper, expand / collapse, game picker, ready, start, leave, close room). Results (win / lose / draw headline, standings, answer review modal). Rematch (propose, accept, decline, cancel), change-game proposal, stop match, opponent leaves → "Match ended", reload mid-match → resume. Both players' screens are asserted and shot. Every online-capable visible game is played through one full match on pair A. One worker. |
| selftest | `ST-` | none (file:// fixtures) | `phone-360` | Proves every detector fires on a bad page and stays quiet on good ones, and checks the digest builder. Needs no app server. |
| accept | `ACCEPT` | per assertion | per assertion | Acceptance assertions from findings, run by `verify.mjs`. |

## Guest (G-)

Logged out, all 7 viewports. Specs are in `specs/guest/`, locators in `pagemap/guest.json`, helpers in
`lib/guest.mjs`, the game list in `lib/games-catalog.mjs` (parsed from `src/utils/GameUtils.tsx`).
Hard failures also include the check-specific rules named below. Learnings: `notes/guest.md`.

| ID | proves |
|---|---|
| `G-LAYOUT-01` | `/`, `/privacy`, `/terms`, `/coming-soon`, `/profile`, `/admin`, the 404 page and the idle screen of each of the 11 playable games pass the layout scan (overflow-x, offscreen, clipped, occluded, tap-target); `.app-shell` and `main.page` exist on real pages (`shell-missing`); one idle shot per route. |
| `G-LAYOUT-02` | `/`, `/privacy` and a game scroll to the bottom with the footer fully visible (`footer-reach`), the sticky nav stays at top 0 on every step (`sticky-nav`), the page never scrolls sideways and nothing sticks out sideways. |
| `G-NAV-01` | Desktop: Games scrolls to the grid, Leaderboard / Feedback / Log in open their modals, Games from a game page routes home to the grid, the brand goes home, no Admin link. At 900px and below: the drawer closes with an animation (a part-way frame), Escape closes it and returns focus to the hamburger, every drawer item works and closes it, drawer Games from a game page routes home. |
| `G-NAV-02` | Footer: one Games link per playable game with the right href (and it opens), Terms and Privacy open their pages, Contact is a `mailto:` link. |
| `G-NAV-03` | Game page rail (above 820px) or chips (820px and below) list every visible game in catalogue order, "coming-soon" is disabled, each item switches to its game with the page fade (dips below 0.9, returns to 1, one dip only), the active item follows. |
| `G-NAV-04` | Landing grid: one card per visible game; the search narrows the grid within 400ms and clearing restores it within 1s; a no-match query shows the empty line; each playable card links to and opens its game; "coming-soon" is disabled. |
| `G-MODAL-01` | Login, feedback, leaderboard, instructions and multiplayer-info modals, each closed once with Escape and once with the X: exactly one `.modal-backdrop` holding exactly one `.modal-panel`; animated entrance and exit (at least one part-way opacity frame, so an instant mount or unmount fails); focus moves in on open and back to the trigger on close; `body` scroll is locked while open and released after; z-index fab 35 / nav 40 / modal 60 / drawer 70; the open modal passes the layout scan. |
| `G-MOTION-01` | `@perf`. Hard load of a game has no entrance animation; card, brand and hero-CTA navigations fade the template wrapper out and back in to 1 with one dip (UI-14), with no snap, CLS or long frame while it runs. |
| `G-MOTION-02` | `@perf`. The login modal's Log in / Sign up tabs: exactly one `.seg-thumb`, it slides (at least one frame between the start and end positions), the panel and form show no snap. The leaderboard's Global/Friends tab motion needs a signed-in user and is owned by the account suite (AC-SURF-01). |
| `G-MOTION-03` | With reduced motion: `.hero-grain` has `animation-name: none`, the hero button does not move on hover, no hydration warning on `/` or a game. |
| `G-PERF-01` | `@perf`. Cold load (first load in a fresh context) of `/` and a game: TTFB, FCP, LCP, CLS and long frames recorded; prod budgets (TTFB 800ms, LCP 2500ms, CLS 0.1) apply to the cold value; a warm reload is recorded as a metric only. Click-to-content latency for card -> game, rail/chip -> game and brand -> home is at most 1000ms in prod. No `slow-api` allowance: a slow `/api/get-users/` fails this check. |
| `G-PERM-01` | `/admin` for a guest shows "Admins only" and "Back to the games", no admin tabs or tables, no Admin nav or drawer link, makes no `/api/admin/` call; every `/api/admin/*` endpoint answers 401 or 403 with no token and with a bogus token (`admin-api-open`). |
| `G-PERM-02` | Each hidden game slug and `/definitely-not-a-route` answer HTTP 404 with the 404 page (`hidden-route`); no hidden game appears in the landing grid, rail, chips or footer (`hidden-listed`). |
| `G-PERM-03` | `/profile` for a guest shows "Log in to see and manage your profile." and no account controls; online-capable game pages show "Log in to play online" and neither Play 1v1 nor Play with a friend; no websocket or `socket.io` request is made (`guest-socket`). |
| `G-A11Y-01` | axe (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA): no serious or critical issues on `/`, `/privacy`, a game idle screen and the open login modal. |

## Account (AC-)

Solo persona (per-worker `testuser3` / `testuser3w<n>`, a minted session per test) plus throwaway users
`uic<run digits><n>`. Specs: `specs/account/{auth,google,profile,surfaces,permissions,blocking}.spec.mjs`,
locators `pagemap/account.json` (+ `guest.json` for the modal shell, `common.json` for nav and drawer), helpers
`lib/account.mjs`. Learnings, throttle budget and exemptions: `notes/account.md`.

`@perf` checks (they sample frames: long-frame and CLS noise from parallel browsers would otherwise show up as findings) run in the serial single-worker pass, like the guest motion checks.

Throttled endpoints (sign-up 10/h, log-in 30/h per IP; export, delete and set-age 10/h per account) are hit only on
the core viewports (`phone-390`, `tablet-768`, `desktop-1366`); layout-only variants run on all 7. Every
throwaway is deleted by the end of the run (Delete-account UI in AC-PROFILE-03, the API in a `finally` otherwise);
the solo account's username, photo and friendship with `testuser2` are restored in a `finally` (each step independent, with a freshly minted token, status checked: a failed restore is a `cleanup` violation). The `stack-teardown` project also runs a sweep (`mint_tokens.py` op `sweep`, local sqlite and ui-check names only) that deletes leaked `uic<digits>` users, clears testuser3-family <-> testuser2 friendships/requests/blocks and restores testuser3-family usernames and photos, so it runs even after a worker crash.
Names may repeat in this app (the player ID tells them apart), so there is no "username taken" error: sign-up and
profile checks assert that an existing name such as `testuser2` passes every rule instead.

| ID | proves |
|---|---|
| `AC-SIGNUP-01` | `@perf`, all 7 vps, logged out. The Log in / Sign up tabs slide (one thumb, a frame between start and end x) and the modal panel never snaps (`audit.motion`). Username rules open on the first character, update within 150 ms, the server verdict turns the third rule into its message in place (reserved name `admin`), and `testuser2` passes (no "taken"). Password rules (length, not only numbers, not like the username) flip within 150 ms of the value changing. The eye button shows and hides the password. With the consent box unticked the submit sends no `POST /api/signup/` and shows the consent message inline; ticking it clears the message. Layout scan of the modal in each state. |
| `AC-SIGNUP-02` | `@perf`, core vps. A duplicate email shows the server error inline on the email field without the modal snapping. A real sign-up of `uic<run><n>` shows "Welcome", closes the modal with an animated exit, shows the avatar chip (`aria-label` `<name> #<id>`), and the click-to-avatar time is at most 1500 ms (measured in the page). The session survives a reload. The throwaway is deleted through the API afterwards. |
| `AC-LOGIN-01` | `@perf`, core vps. A wrong password shows the error inline without a snap and leaves the form usable. Log in by username (click-to-avatar at most 1500 ms), the session survives a reload, log out through the profile menu (tablet, desktop) or the drawer (phones) clears both tokens and reverts the nav to guest; a fresh context logs in by email. |
| `AC-LOGIN-02` | `@perf`, all 7 vps. With an expired (well-formed JWT, `exp` in the past) and then a garbage access token plus a valid refresh token, a reload stays signed in as the same user, the refresh answers 200 and rotates both tokens, and the nav shows no signed-out state for more than 300 ms (sampled on every frame from the first paint: `logged-out-flash`). The same reload with a valid token is recorded as a baseline metric. |
| `AC-GOOGLE-01` | All 7 vps. "Continue with Google" is visible, enabled, at least 40 px tall and inside the modal panel without overflow. On the Sign up tab without the tick it opens nothing and shows the consent message. On the Log in tab a click opens the Google window (`context.waitForEvent('page')`, closed at once) or a Google iframe; closing it leaves the form usable. With an Instagram user agent it opens nothing and shows the in-app-browser warning. **Manual owner check:** the full OAuth round trip (Google consent screen, code exchange, new-account name pane, the 428 consent hand-off) is not automated. |
| `AC-PROFILE-01` | `@perf`, all 7 vps. `/profile` passes the layout scan. Invalid characters flag the rule inline and Save raises the "Invalid Username" alert; the input stops at 20 characters; the reserved name `admin` turns the third rule into the server message; `testuser2` passes every rule (no "taken"); a valid rename updates the page title, the nav chip, the server (`/me/`) and the landing card, with no snap. The username is restored. |
| `AC-PROFILE-02` | `@perf`, all 7 vps. Copy player ID swaps "Copy" to "Copied!" and back without a snap. An account of unknown age that picks a photo gets the age prompt (birth month and year, an adult year); after it the avatar and the nav chip show the photo ("Shown to other players"); Remove puts back the default avatar ("No photo"). The 428 from the first upload is the designed hand-off and is allowed. The photo is removed afterwards. |
| `AC-PROFILE-03` | Core vps, throwaway user made like a sign-up (minted). Export downloads `swish-quest-my-data.json` holding this account. Delete account: the button stays disabled until the word is exactly `DELETE`; a wrong password shows the server error inline without a snap and keeps the account; the right password logs out, shows the guest profile prompt and the account can no longer log in. The password field may stay empty by design (Google-only accounts have none), so the button is not gated on it. |
| `AC-SURF-01` | `@perf`, all 7 vps. Signed-in landing: profile card (name, points, rank, Profile settings, copy ID icon swaps and back), the "Your points" hero stat, the Profile and Friends tabs (thumb slides, card height glides, no snap), the four friends sub-tabs (Friends, Requests, Find, Blocked), and the leaderboard Global and Friends tabs (thumb slides, panel height glides, heading swaps, no snap); layout scan of each state. Owns the leaderboard scope tab motion that the guest suite cannot see. |
| `AC-SURF-02` | Core vps. The solo account finds `testuser2` by player ID in Find and sends a request from the UI ("Request sent"); `testuser2` (minted token) accepts through `POST /api/accept-friend-request/`; after a fresh load the solo Friends list shows `testuser2`. The friendship and any request are removed through the API before and after, and the cleanup is verified. |
| `AC-PERM-01` | All 7 vps. `/admin` for the solo (non-admin) account shows "Admins only" and "Back to the games", no admin tabs or tables, no Admin link in the nav or drawer, makes no `/api/admin/` call; every `/api/admin/*` endpoint answers 403 with the solo token. |
| `AC-ONLINE-01` | `@perf`, all 7 vps (a different online game per viewport, so parallel workers never match each other). Play 1v1 shows "Finding an opponent" with a Cancel button and the side button turns into Cancel; Cancel (from the stage and from the side button) returns to the idle game card, the searching screen fades out (a part-way frame) and nothing snaps. The match itself belongs to the multiplayer suite. |
| `AC-BLOCK-01` | `@perf`. Each submit has its answer held back 1.5 s: the (still mounted) button is disabled or shows its busy label within 100 ms of the click and two more clicks send no second request. Username Save and friend Add on all vps; photo age Continue and delete account (wrong password, nothing deleted) on core vps with a throwaway user (the per-account limit); log in (wrong password) on core vps; sign up (duplicate email, nothing created) on `phone-390` only, to stay under the sign-up throttle. |
| `AC-BLOCK-02` | `@perf`, all 7 vps, logged out. "No action waits more than 400 ms on an animation": from the click until the next control is interactable (enabled, visible, `elementFromPoint` hits it): Log in -> Sign up (Email field), Sign up -> Log in (Email or username field), the modal X (the nav brand behind the backdrop). `slow-action` above 400 ms. |
| `AC-BLOCK-03` | `@perf`, core vps. After a successful log in, from the moment the "Welcome back" message shows (the server has answered) until the nav avatar is pressable. The success pane holds 600-800 ms by design (a tap skips it after 300 ms), so this check is expected to fail until that hold is shortened. |

## Games (GM-)

Solo persona (`testuser3` / `testuser3w<n>`: the worker's account rotated by a hash of the test's title path, `lib/fixtures.mjs` `rotatedIndex`; `@perf` tests stay on `testuser3`; a minted session per test) except GM-SHELL-01 (guest).
Specs: `specs/games/{scenarios,shell,latency}.spec.mjs`; driver `lib/game-driver.mjs`; adapters `games/<id>.mjs`
(contract in `games/index.mjs`, shared helpers in `games/helpers.mjs`); locators `pagemap/games.json`; the shell
measurement shared with `scripts/ui-audit.mjs` is `scripts/lib/game-shell.mjs`. Learnings, answer sources, throttle
budget and exemptions: `notes/games.md`. The games specs run with the browser's own user agent minus "Headless"
(cdn.nba.com refuses the headless one, see notes).

Game-specific rules recorded as violations: `stage-resized` (6.2), `loss-announced` (6.3), `feedback-copy` /
`feedback-color` / `feedback-missing` (6.0, 6.1), `not-in-place` (7.3), `score-not-above` / `end-score` /
`end-buttons` (7.0, final score), `answer-hidden` (in-place reveal), `points-not-logged`, `replay`,
`no-transition`, `never-ended`, `daily-lock`, `no-truth` (the adapter cannot tell a right answer), `shell-contract` / `no-playing` (GM-SHELL-01).

| ID | proves |
|---|---|
| `GM-<game>-<scenario>` | One test per visible game with an adapter × scenario (`perfect`, `wrong`, `partial`, `timeout`, `giveup`, `daily-lock`). A scenario the adapter cannot drive is skipped with the adapter's reason (coverage gap). Core viewports run every scenario; the other four run `perfect` only, layout-only (no Play again / Close game, no log-session assertion). Open the game (idle shot), Play, then answer turn by turn (≤ 60) inside `audit.motion` (watch `.stage-shell`, `.playing-wrap`; snap and CLS enforced, long frames recorded as a note here and enforced in GM-LATENCY-<game>): each answer gets feedback (6.1), correct copy is exactly `Correct! +N` in `var(--good)` (N from the adapter's per-turn `points` where it varies: Career Path, Who Are Ya; Fan Favorites' documented `+N fans said it!` is exempt, its misses are still checked), wrong copy names the right answer in `var(--bad)` and is never a bare "Wrong" (6.0), no loss announcement (6.3). At the end: the game is over, in place unless allowlisted in `scripts/game-result-allowlist.json` (7.3), the score line sits above Play again / Close game (7.0), the final score equals right answers × points (or the adapter's own expectation, e.g. Who Would Win's crowd points from the captured tallies), no loss announcement in the end state (6.3), the adapter's end reveal is visible (an in-place game whose adapter has no `endReveal` fails `answer-hidden`), the end screen shows Play again and Close game (Close game alone only for an adapter declaring `playAgain: false`), the stage height never changed while playing (6.2, `stage-resized` with delta and turn), exactly one `POST /trivia/log-session/` answered 2xx with the game, mode `single`, the score and the same `awarded`; layout scan of the stage column while playing and at the end; then Play again (it must be on the end screen: `replay` otherwise) starts a fresh round 1 and the shell's Close game cross-fades back to idle (scenario `wrong`: the end screen's own Close game instead). An adapter's `freshAccount` scenarios run as a brand-new throwaway `uic<digits>` account, deleted afterwards (and by the teardown sweep). Shots: idle, playing, feedback, end, replay, closed. |
| `GM-<game>-adapter` | A visible game with no adapter yet: one skipped test, reason "no adapter yet" (coverage gap until Tasks 6/7 add it). |
| `GM-SHELL-01` | All 7 vps, logged out. Every visible game, while playing, keeps the GAME_DESIGN_CONSTRAINTS shell contract measured exactly like `scripts/ui-audit.mjs` (`measureInPage` + `shellFailures`): `<GameFrame>` root with a 20px gap (Rule 0), top offset and Close game → bottom equal the stage padding and Game → Close game is 28px (content) / 12px (fill) (4.1, 4.2), a lone status slot is centred / flush right (4.2a), the game stays inside the shell border (1.2). Replaces ui-audit's hand-kept game list with the live catalogue. |
| `GM-LATENCY-<game>` | `@perf`, core vps; one test per game with an adapter (`[GM-LATENCY-<game>]`, so a finding in one game does not hide the others). Three answers (right, wrong, right): the answer (click / Enter) to its feedback on screen is at most 150 ms, measured in the page, and no long animation frame (> 100 ms) while answering. Series Winner (full-screen GameResult), Who Would Win, Career Path and Who Are Ya (in place) are played to the end (the rest as misses / skips; Career Path and Who Are Ya use the adapter's `latencyPlan`, a miss first, so the wrong answer is timed too) with the end transition inside the window, so long frames while ending are enforced too: 4 finished games per core viewport. |

## Selftest

Fixtures are in `fixtures/detectors/` and the spec is `specs/selftest/detectors.spec.mjs`.
Run it with `npm run ui:selftest`.

| ID | proves |
|---|---|
| `ST-OVERFLOW` | `overflow-x` fires on a 600px box in a 360px viewport and names the box. It stays quiet on `overflow-good.html` (box capped at 100%, wide track inside its own scroller) and on `good.html`, where all layout rules stay quiet. |
| `ST-OFFSCREEN` | `offscreen` fires on a control past the right edge. A control inside a horizontal scroller (carousel) and a closed, hidden drawer stay quiet. |
| `ST-SNAP` | `snap` fires on a panel that jumps 100→300px in one frame, with explicit and `auto` watch. It stays quiet for the same toggle animated with a CSS transition (including the box pushed down below it) and for a framer-motion-style rAF animation that writes inline styles. |
| `ST-CLS` | `cls` fires when a block is inserted above the content 300ms later with no input, and stays quiet on `good.html`. |
| `ST-OCCLUDED` | `occluded` fires on a button under a fixed layer in mid-screen. It stays quiet for a button scrolled under the sticky top nav. |
| `ST-TAP` | `tap-target` fires on a 16px button 2px from another target and on two touching 16px buttons. It stays quiet on 16px buttons 40px apart, on links inside a sentence (even two touching one-letter links), on a stacked footer-style list of 17px links, and on 48px buttons. On touch, the targets under 44px get a `tap-target-touch` warning instead (none for inline links, none on desktop), and `done()` still passes. |
| `ST-CLIPPED` | `clipped` fires on nowrap text inside a 40px `overflow:hidden` box. It stays quiet on sr-only text and on an ellipsis label that fits. |
| `ST-PROBES` | `console` reports console errors and uncaught errors, and `allow` patterns silence them. `timing` records a metric every time and adds `slow-action` only when over budget. `perf` records fcp. `a11y` is clean on `good.html` and reports serious axe violations. |
| `ST-EVIDENCE` | `shot` writes JPEGs under `<runDir>/shots/<ID>/<project>[-<label or vp>]-<name>.jpg` (full viewport and locator crop). A second audit at another viewport in the same test gets its own files, and a duplicate shot path throws. Layout violations get an automatic crop. `done()` fails with a compact message. |
| `ST-DIGEST` | `buildDigest` collapses one violation seen on 7 viewports into one line, keeps a different violation separate, lists coverage gaps and metric tables, and caps the digest at 400 lines with `+N more (see results.json)`. With two audits in one test (a multiplayer pair), each violation and metric keeps its own vp and label: a shared violation lists both players, a one-sided one lists only that player. A collapsed row lists every distinct expected value with its viewports and takes its shot from the member that has its own crop. Warnings collapse to one line per rule, selector and route, capped at 60 lines. `mergeRun` merges appended invocations, and the header spans the first start to the last end. |
| `ST-GAMES` | The games driver's unexercised paths on `fixtures/detectors/game-clock.html` (the shell's class names, a 30 s countdown, Give up, an in-place end) with a fake adapter: the `timeout` scenario through the real `runScenario` (driver installs `page.clock`, the adapter ends the countdown with one `clock.runFor`: still running before, over after) and the `giveup` scenario (one wrong answer whose "It was B" copy and colour pass, then Give up) both end with no violation, including Play again → Close game cross-fade; with `page.clock` installed (a 60 s jump moves `performance.now` 60 s) the feedback recorder still records text and latency and the snap sampler still catches a 100 px jump. |
