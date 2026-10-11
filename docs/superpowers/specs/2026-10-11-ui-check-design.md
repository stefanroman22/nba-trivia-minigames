# UI check system — design

Status: approved by owner standing autonomy grant, 2026-10-11. Implements the owner request:
automatic UI checks with no account, one logged-in account, and two accounts playing online, on
phone/tablet/desktop, covering every visible game and its end cases; findings land in a report
with files, fix instructions and machine-checkable acceptance criteria; the frontend (and backend)
engine can take a finding, fix it, re-check it automatically and loop until it passes.

## 1. Principles (from research, see §9)

1. **Scripts measure, agents judge.** Playwright Test does every click and measurement and writes a
   compact digest. LLM agents never explore the app from scratch; they read the digest, look at a
   few cropped JPEG screenshots, and write findings. This is the QA Wolf pattern (AI writes / judges,
   plain Playwright runs) and keeps a run to tens of thousands of tokens, not millions.
2. **Fixed check catalogue, one owner per check.** Every check has an ID (`G-…`, `AC-…`, `GM-…`,
   `MP-…`) and lives in exactly one suite. `scripts/ui-check/CHECKS.md` is the catalogue and the
   ownership matrix; `catalog.mjs` fails if an ID is duplicated or undocumented.
3. **Ambient detectors everywhere, deduplicated by fingerprint.** Cheap detectors (overflow,
   snapping, layout shift, console errors) run on every page any suite opens. The same defect seen
   by two suites collapses to one finding via `fingerprint = rule|route|selector`.
4. **Every finding is re-checkable.** A finding's acceptance criteria name existing check IDs
   and/or assertions in a small JSON DSL that `verify.mjs` runs. The report step proves each new
   acceptance check FAILS on the current code before the finding is published.
5. **Learn once, reuse.** Locators live in `pagemap/*.json`; per-suite notes (known false
   positives, accepted deviations, selector tips) live in `notes/<suite>.md`; owner-accepted
   findings live in `accepted.json` and are never re-reported.
6. **Local only.** Accounts are created and tokens minted against the local sqlite database. The
   runner refuses to start a suite with a logged-in persona when the API is not on `localhost`.

## 2. Viewports (StatCounter worldwide, Sep 2026, screen → in-browser viewport)

| id | viewport | from screen | class | core |
|---|---|---|---|---|
| phone-360 | 360×720 | 360×800 Android (7.5%) | phone | |
| phone-390 | 390×664 | 390×844 iPhone 12–15 (6.1%) | phone | ✓ |
| phone-414 | 414×715 | 414×896 (13.4%, #1 mobile) | phone | |
| tablet-768 | 768×954 | 768×1024 iPad portrait (8.1%, #1 tablet) | tablet | ✓ |
| tablet-1280 | 1280×720 | 1280×800 tablet landscape / small laptop (7.9%) | tablet | |
| desktop-1366 | 1366×657 | 1366×768 (8.0%) | desktop | ✓ |
| desktop-1920 | 1920×969 | 1920×1080 (28.1%, #1 desktop) | desktop | |

Phone and tablet use `isMobile` (phones only), `hasTouch: true`, `deviceScaleFactor: 2`. Desktop:
`deviceScaleFactor: 1`. Heights subtract real browser chrome (Playwright device descriptors), because
short heights are where fixed bars and game HUDs collide. Expensive matrices (game scenarios) run in
full on the three **core** viewports and as layout-only passes on the other four.

## 3. Personas and accounts

| persona | account | used by |
|---|---|---|
| guest | none | guest suite |
| solo | `testuser3` | account suite, games suite |
| pair | `testuser1` (host) + `testuser2` (joiner) | multiplayer suite |
| throwaway | `uic<run><n>`, created through the real sign-up UI, deleted at the end through the real Delete-account UI | account suite |

Emails `<username>@uicheck.test`. One generated password, stored with the usernames in
`.ui-check/accounts.json` (git-ignored). `lib/mint_tokens.py` runs inside `manage.py shell` against the
local sqlite DB: it creates missing persistent accounts the way sign-up does (consent fields set) and
mints a fresh access/refresh pair per request the same way login does. This sidesteps the per-IP
throttles (signup 10/h, login 30/h) and refresh-token rotation conflicts between parallel contexts.
Each browser context gets its own freshly minted pair injected into `localStorage` before load.

## 4. Stack modes

| mode | Django | socket | frontend | for |
|---|---|---|---|---|
| `prod` (default for audits) | :8200 sqlite (`DATABASE_URL=""`) | :4200 | `next build` + `next start` :5374 | full audits — real speed numbers, no dev overlay |
| `dev` (default for verify) | :8000 | :4000 | `npm run dev` :5173 | fix loops — HMR, no rebuild per attempt |

The stack helper starts only what is not already listening, records what it started in
`.ui-check/stack.json`, and stops only those. Prod mode rebuilds only when the source stamp
(`git rev-parse HEAD` + hash of `git diff HEAD` + build env) changed. Performance budgets are
enforced only in prod mode; in dev mode they are recorded as informational.

## 5. Suites — what each one owns (no overlap)

**Guest (`G-`)** — logged out, all 7 viewports. Public layout of `/`, `/privacy`, `/terms`,
`/coming-soon`, the 404 page, `/profile` and `/admin` guest views, and every visible game's **idle**
screen. Nav, drawer, footer, rail and chip links all work. Scroll works and scroll-lock is released
after modals close. Public modals (login opens, feedback, leaderboard, instructions, multiplayer
info): one backdrop, Escape closes, focus returns, z-index scale. Route transitions, segmented-tab
thumbs, load CLS/LCP/TTFB, interaction latency, axe a11y and tap targets. Permissions: `/admin`
shows "Admins only" with no admin data, `/api/admin/*` returns 401/403, no Admin nav link, hidden
game slugs return 404, guests see "Log in to play online" and open no socket.

**Account (`AC-`)** — `solo` plus a throwaway user, all 7 viewports for layout; flows that submit
to throttled endpoints (sign-up, UI log-in) run on core viewports only. Covers the sign-up form (live
password rules, username check, consent required, duplicate errors, success closing animation), log in
by email and by username, wrong-password error, session survives reload, expired-access-token
silent refresh, log out reverts UI. Google button: renders, sized, click opens the popup or GIS
frame, in-app-browser warning (the full OAuth round-trip is listed as a manual owner check). Profile:
change username (valid / invalid / too long / taken), copy player ID, photo upload with the age
prompt, remove photo, export data, delete account (throwaway). Logged-in surfaces: profile card,
friends panel tabs, friend request round-trip with testuser2 driven by API, leaderboard friends tab,
points panel. Permissions: `/admin` as non-admin, `/api/admin/*` 403. Play Online opens searching
and Cancel works (the match itself is multiplayer's). Blocking: buttons disable with feedback while
submitting, double submit is impossible, no action waits more than 400 ms on an animation.

**Games (`GM-`)** — `solo`, every visible game. Per game, scenarios from its adapter: `perfect`
(everything right), `wrong` (everything wrong / out of lives), `partial` (finish with lives to
spare), `timeout` (a clock runs out, via `page.clock`), `giveup`, `daily-lock` (Wordle after a
finished play). All scenarios on core viewports, `perfect` as layout-only on the other four.
Asserts the GAME_DESIGN_CONSTRAINTS shell contract (Rule 4.2 distances, reused from
`ui-audit.mjs`), stage never resizes during feedback (6.2), lives running out never announced
(6.3), end in place with answer visible and score above the buttons (7.0/7.3), feedback copy (6.0),
points logged for the solo user, Play again and Close game, motion and latency during answers.

**Multiplayer (`MP-`)** — `pair`, four viewport pairs covering all 7 viewports:
A `desktop-1366`+`phone-390`, B `phone-360`+`desktop-1920`, C `tablet-768`+`tablet-1280`,
D `phone-414`+`phone-390`. Room/match flows on all pairs: 1v1 matchmaking (search, cancel, match
found, intro), friend rooms (generate code, copy, wrong code error, join, player stepper, expand /
collapse, game picker, ready, start, leave, close room), results (win / lose / draw headline,
standings, answer review modal), rematch (propose, accept, decline, cancel), change-game proposal,
stop match, opponent leaves → "Match ended", reload mid-match → resume. Both players' screens are
asserted and shot. Every online-capable visible game is played through one full match on pair A.
The suite runs with one worker (the two accounts are shared).

## 6. Runner layout (`scripts/ui-check/`)

- `playwright.config.mjs` — projects `<suite>@<viewport>` (mp: `mp@pairA…D`), `selftest`, `accept`;
  `@playwright/test` pinned to the installed `playwright-core` version.
- `lib/` — `viewports`, `stack`, `accounts` + `mint_tokens.py`, `global-setup`/`-teardown`,
  `fixtures` (`test`, `expect`, `vp`, `persona`, `audit`, `cap`, `mp`), `detect` (in-page detectors),
  `probes` (init script: layout-shift, long-animation-frame, rAF/rect sampler, console/network),
  `evidence` (JPEG crops, contact sheets), `capture` (HTTP JSON + socket.io frames), `fiber`
  (React props/state reader), `pagemap`, `digest-reporter`.
- `specs/{guest,account,games,multiplayer,accept,selftest}/`.
- `games/<id>.mjs` — one adapter per visible game (§7).
- `run.mjs` (suites → playwright invocations → contact sheets → digest), `verify.mjs`, `probe.mjs`,
  `report.mjs`, `catalog.mjs`, `findings.schema.json`, `CHECKS.md`, `accepted.json`, `notes/`.
- Output: `.ui-check/runs/<runId>/` with `results.json`, `digest.md`, `shots/`, `sheets/`,
  `findings/<suite>.json` (judges), `findings.json` + `REPORT.md` (merged). `.ui-check/latest`
  holds the last run id. `.ui-check/` is git-ignored.

### Detectors (rule ids)
`overflow-x` (page scrollWidth > innerWidth, offending elements), `offscreen` (interactive element
outside viewport horizontally), `clipped` (text clipped by overflow hidden/ellipsis), `occluded`
(`elementFromPoint` at an interactive element's centre is not it), `tap-target` (<44×44 on touch,
<24×24 anywhere, WCAG 2.5.8), `snap` (watched element's rect changes >8 px in one frame with no
running animation/transition), `cls` (layout-shift sum without recent input > 0.1, per window),
`loaf` (long animation frames > 100 ms), `slow-action` (action → done over budget), `console`
(console errors, page errors, same-origin 5xx / unexpected 4xx), `slow-api` (API > 1000 ms),
`a11y` (axe serious/critical), plus check-specific rules.

## 7. Game adapters

```js
export default {
  id, path, online, lives, timerMs,
  scenarios: { perfect: true, wrong: true, partial: true|'reason', timeout: ..., giveup: ..., 'daily-lock': ... },
  async answer(page, ctx, { correct }) → { over: boolean },   // one turn
  async isOver(page) → boolean,
  async giveUp?(page, ctx), async timeout?(page, ctx),
}
```
`ctx.cap` exposes captured HTTP JSON and socket.io frames so an adapter knows the right answer
without reading source at run time; `ctx.fiber` reads React props/state as a fallback. A scenario an
adapter cannot drive is a string reason, which the digest lists as a coverage gap, never silently
dropped. Multiplayer reuses the same adapters (round data arrives over the socket).

## 8. Findings, report, verification and the fix loop

Judge agents (`ui-check-guest`, `-account`, `-games`, `-multiplayer`, Sonnet) each read their suite's
digest and crops, run their fixed judgement checklist (things code cannot measure: alignment and
spacing consistency between similar components, hierarchy, copy consistency, missing motion, possible
improvements), confirm suspicions with `probe.mjs` (one assertion, compact answer), map each issue to
source files, and write `findings/<suite>.json` per `findings.schema.json`:

`id, fingerprint, title, severity (blocker|major|minor|polish), category, owner (frontend|backend|ci),
suite, persona, where {route, state, viewports, selector}, current, expected, evidence {checkId, metrics,
shots}, files [{path, line, why}], fix {change[], reuse[], build[], rules[]}, acceptance {checks
[{id, projects}], assertions [DSL], criteria []}, status`.

`report.mjs` merges, dedupes by fingerprint, drops `accepted.json` entries, runs
`verify.mjs --expect-fail` on every new finding (an acceptance check that already passes is rejected
back to the judge as not reproducing), writes `findings.json` and `REPORT.md` (summary by
severity/owner/suite, coverage matrix, then each finding: Current / Expected / Evidence / Files /
How to fix — change, reuse, build / Acceptance criteria with the exact verify command).

`verify.mjs <id…> [--mark]` re-runs a finding's checks and assertions (dev stack by default) and exits
0 only when all pass; `--mark` records `status: fixed`. The `ui-fix` skill routes open findings by owner
(frontend → `frontend-engine`, backend and ci → `backend-engine`), grouped by file cluster; the engine
fixes, runs `verify.mjs`, and loops (max 4 attempts) until it exits 0, then the neighbouring viewports
and the route's suite checks run as a regression gate, `code-reviewer` (+ `motion-reviewer` when motion
code changed) review, and the work ships to `dev` per the project's shipping rules. An engine never
weakens a check, assertion or threshold to make it pass; a check it believes is wrong is reported
back as `check-bug` for the orchestrator to rule on.

## 9. Sources
StatCounter screen-resolution stats (mobile/tablet/desktop, Sep 2026); Playwright docs (auth
storageState, test agents, clock, routeWebSocket, accessibility testing); microsoft/playwright-cli;
Anthropic engineering ("code execution with MCP", "writing tools for agents", vision token cost);
WICG layout-instability; Chrome long-animation-frames; web-vitals attribution; axe-core 4.x WCAG 2.2
`target-size`; QA Wolf / Stagehand caching and self-healing patterns.
