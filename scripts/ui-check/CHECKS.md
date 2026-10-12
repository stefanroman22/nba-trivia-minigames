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

- `audit.timing(label, action, done, budget)` is measured in node, from before `action` to after `done`.
  It includes the CDP round trips of every Playwright call inside, so it reads a little higher than
  in-page time. Set budgets with that in mind.

## Ownership matrix

| suite | prefix | persona | viewports | owns |
|---|---|---|---|---|
| guest | `G-` | guest (logged out) | all 7 | Public layout of `/`, `/privacy`, `/terms`, `/coming-soon`, the 404 page, the guest views of `/profile` and `/admin`, and the **idle** screen of every visible game. Nav, drawer, footer, rail and chip links. Scrolling, and scroll-lock released after a modal closes. Public modals (login opens, feedback, leaderboard, instructions, multiplayer info): one backdrop, Escape closes, focus returns, z-index scale. Route transitions, segmented-tab thumbs, load CLS/LCP/TTFB, interaction latency, axe a11y, tap targets. Permissions: `/admin` shows "Admins only" with no admin data, `/api/admin/*` returns 401/403, no Admin nav link, hidden game slugs return 404, guests see "Log in to play online" and open no socket. |
| account | `AC-` | solo (`testuser3`) + throwaway | all 7 for layout; core only for flows that hit throttled endpoints (sign-up, UI log-in) | Sign-up form (live password rules, username check, consent required, duplicate errors, closing animation on success). Log in by email and by username, wrong-password error, session survives reload, expired access token refreshes silently, log out reverts the UI. Google button: renders, sized, click opens the popup or GIS frame, in-app-browser warning (the full OAuth round trip stays a manual owner check). Profile: change username (valid / invalid / too long / taken), copy player ID, photo upload with the age prompt, remove photo, export data, delete account (throwaway). Logged-in surfaces: profile card, friends panel tabs, friend request round trip with testuser2 (driven through the API), leaderboard friends tab, points panel. Permissions: `/admin` as non-admin, `/api/admin/*` 403. Play Online opens searching and Cancel works (the match belongs to multiplayer). Blocking: buttons disable with feedback while submitting, double submit is impossible, no action waits more than 400 ms on an animation. |
| games | `GM-` | solo (`testuser3`) | all scenarios on core; `perfect` as layout-only on the other 4 | Per visible game, the scenarios from its adapter: `perfect`, `wrong`, `partial`, `timeout`, `giveup`, `daily-lock`. Shell contract (Rule 4.2 distances), stage never resizes during feedback (6.2), lives running out never announced (6.3), the game ends in place with the answer visible and the score above the buttons (7.0/7.3), feedback copy (6.0), points logged for the solo user, Play again and Close game, motion and latency while answering. |
| multiplayer | `MP-` | pair (`testuser1` host + `testuser2` joiner) | pairs A `desktop-1366`+`phone-390`, B `phone-360`+`desktop-1920`, C `tablet-768`+`tablet-1280`, D `phone-414`+`phone-390` | 1v1 matchmaking (search, cancel, match found, intro). Friend rooms (generate code, copy, wrong-code error, join, player stepper, expand / collapse, game picker, ready, start, leave, close room). Results (win / lose / draw headline, standings, answer review modal). Rematch (propose, accept, decline, cancel), change-game proposal, stop match, opponent leaves → "Match ended", reload mid-match → resume. Both players' screens are asserted and shot. Every online-capable visible game is played through one full match on pair A. One worker. |
| selftest | `ST-` | none (file:// fixtures) | `phone-360` | Proves every detector fires on a bad page and stays quiet on good ones, and checks the digest builder. Needs no app server. |
| accept | `ACCEPT` | per assertion | per assertion | Acceptance assertions from findings, run by `verify.mjs`. |

## Smoke (temporary)

Stack and persona smoke checks from Task 2. Tasks 3 and 4 replace them with the real suites.
`node scripts/ui-check/catalog.mjs` checks that every ID in the specs is listed in this file once.

| ID | proves |
|---|---|
| `G-SMOKE` | The home page loads for a guest on the local stack, with a clean layout scan and no console errors. |
| `AC-SMOKE` | The solo persona's minted session is restored on load. The nav shows that user's avatar chip and no Log in button, and the restore call (`/api/me/` or `token/refresh/`) answered 200. |

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
| `ST-TAP` | `tap-target` fires on a 16×16 button (44px minimum on touch, 24px otherwise). It stays quiet on 48px buttons and on an inline link in running text. |
| `ST-CLIPPED` | `clipped` fires on nowrap text inside a 40px `overflow:hidden` box. It stays quiet on sr-only text and on an ellipsis label that fits. |
| `ST-PROBES` | `console` reports console errors and uncaught errors, and `allow` patterns silence them. `timing` records a metric every time and adds `slow-action` only when over budget. `perf` records fcp. `a11y` is clean on `good.html` and reports serious axe violations. |
| `ST-EVIDENCE` | `shot` writes JPEGs under `<runDir>/shots/<ID>/<project>[-<label or vp>]-<name>.jpg` (full viewport and locator crop). A second audit at another viewport in the same test gets its own files, and a duplicate shot path throws. Layout violations get an automatic crop. `done()` fails with a compact message. |
| `ST-DIGEST` | `buildDigest` collapses one violation seen on 7 viewports into one line, keeps a different violation separate, lists coverage gaps and metric tables, and caps the digest at 400 lines with `+N more (see results.json)`. With two audits in one test (a multiplayer pair), each violation and metric keeps its own vp and label: a shared violation lists both players, a one-sided one lists only that player. |
