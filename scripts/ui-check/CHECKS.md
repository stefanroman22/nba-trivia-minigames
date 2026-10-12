# UI check catalogue

Every check has one ID and lives in exactly one suite. This file lists all of them and says which suite
owns what. The spec is `docs/superpowers/specs/2026-10-11-ui-check-design.md`.

## How IDs work

- A test title starts with its ID in brackets, then a description: `[G-HOME] home page layout`.
  The `audit` fixture reads the ID from the title. It names the evidence folder
  (`.ui-check/runs/<run>/shots/<ID>/`) and groups the digest by it.
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
| games | `GM-` | solo (per-worker accounts: `testuser3`, `testuser3w<n>`) | all scenarios on core; `perfect` as layout-only on the other 4 | Per visible game, the scenarios from its adapter: `perfect`, `wrong`, `partial`, `timeout`, `giveup`, `daily-lock`. Shell contract (Rule 4.2 distances), stage never resizes during feedback (6.2), lives running out never announced (6.3), the game ends in place with the answer visible and the score above the buttons (7.0/7.3), feedback copy (6.0), points logged for the solo user, Play again and Close game, motion and latency while answering. |
| multiplayer | `MP-` | pair (`testuser1` host + `testuser2` joiner) | pairs A `desktop-1366`+`phone-390`, B `phone-360`+`desktop-1920`, C `tablet-768`+`tablet-1280`, D `phone-414`+`phone-390` | 1v1 matchmaking (search, cancel, match found, intro). Friend rooms (generate code, copy, wrong-code error, join, player stepper, expand / collapse, game picker, ready, start, leave, close room). Results (win / lose / draw headline, standings, answer review modal). Rematch (propose, accept, decline, cancel), change-game proposal, stop match, opponent leaves → "Match ended", reload mid-match → resume. Both players' screens are asserted and shot. Every online-capable visible game is played through one full match on pair A. One worker. |
| selftest | `ST-` | none (file:// fixtures) | `phone-360` | Proves every detector fires on a bad page and stays quiet on good ones, and checks the digest builder. Needs no app server. |
| accept | `ACCEPT` | per assertion | per assertion | Acceptance assertions from findings, run by `verify.mjs`. |

## Smoke (temporary)

Persona smoke check from Task 2. Task 4 replaces it with the real account suite.
`node scripts/ui-check/catalog.mjs` checks that every ID in the specs is listed in this file once.

| ID | proves |
|---|---|
| `AC-SMOKE` | The solo persona's minted session is restored on load. The nav shows that user's avatar chip and no Log in button, and the restore call (`/api/me/` or `token/refresh/`) answered 200. |

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
| `G-MOTION-01` | Hard load of a game has no entrance animation; card, brand and hero-CTA navigations fade the template wrapper out and back in to 1 with one dip (UI-14), with no snap, CLS or long frame while it runs. |
| `G-MOTION-02` | The login modal's Log in / Sign up tabs: exactly one `.seg-thumb`, it slides (at least one frame between the start and end positions), the panel and form show no snap. (Leaderboard Global/Friends tabs need a signed-in user and belong to the account suite.) |
| `G-MOTION-03` | With reduced motion: `.hero-grain` has `animation-name: none`, the hero button does not move on hover, no hydration warning on `/` or a game. |
| `G-PERF-01` | TTFB, FCP, LCP, CLS and long frames recorded for `/` and a game (budgets enforced in prod: TTFB 800ms, LCP 2500ms, CLS 0.1); click-to-content latency for card -> game, rail/chip -> game and brand -> home is at most 1000ms in prod. |
| `G-PERM-01` | `/admin` for a guest shows "Admins only" and "Back to the games", no admin tabs or tables, no Admin nav or drawer link, makes no `/api/admin/` call; every `/api/admin/*` endpoint answers 401 or 403 with no token and with a bogus token (`admin-api-open`). |
| `G-PERM-02` | Each hidden game slug and `/definitely-not-a-route` answer HTTP 404 with the 404 page (`hidden-route`); no hidden game appears in the landing grid, rail, chips or footer (`hidden-listed`). |
| `G-PERM-03` | `/profile` for a guest shows "Log in to see and manage your profile." and no account controls; online-capable game pages show "Log in to play online" and neither Play 1v1 nor Play with a friend; no websocket or `socket.io` request is made (`guest-socket`). |
| `G-A11Y-01` | axe (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA): no serious or critical issues on `/`, `/privacy`, a game idle screen and the open login modal. |

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
