# Guest suite notes (for the judge agents)

Specs: `specs/guest/{layout,navigation,modals,motion,perf,permissions,a11y}.spec.mjs`. Locators:
`pagemap/guest.json` (+ `pagemap/common.json` for nav and drawer). Helpers: `lib/guest.mjs`. Game list:
`lib/games-catalog.mjs` (`visibleGames()`, `hiddenGames()`, parsed from `src/utils/GameUtils.tsx` and
`NOT_ONLINE` in `src/utils/roomSizes.ts`).

## How judges use this file

The `ui-check-guest` judge reads "Intentional exemptions", "Measurement notes" and "Flaky spots" before judging
(what they describe is not a finding) and "Selector tips" when it writes acceptance assertions. After judging it
appends what a later run can reuse (a false positive and why, a selector that works, a flaky spot) as one bullet
`- (<runId>) …` under the matching heading; it never edits or deletes existing lines.

## Selector tips

- The app has no `data-testid`. Stable hooks: `.nav3`, `.nav3-links`, `#nav-drawer` / `.drawer-panel`,
  `.modal-backdrop` > `.modal-panel` (role=dialog, aria-label = title), `.modal-title`, `.modal-close`,
  `.feedback-fab`, `aside.rail .rail-item` (desktop), `.rail-strip .rail-chip` (mobile), `section.stage-col h1`
  (game title), `.stage-col .idle` (idle screen), `#games-grid .gtile` (landing cards, `<a href>` unless disabled),
  `footer.site-footer`, `.auth-tabs` / `.seg-thumb` (segmented tabs).
- Breakpoints: nav desktop links vs hamburger at 900px (so phone-* and tablet-768 get the drawer, tablet-1280 and
  desktop get links); rail vs chips at 820px (tablet-768 gets chips).
- The template wrapper is `#root > div` (framer `motion.div.w-full.h-full` from `src/app/template.tsx`).
- A modal opened from the mobile drawer has no surviving trigger (the drawer unmounts), so focus-return is tested
  with triggers that stay mounted: nav Log in (desktop) or the guest panel CTA (<=900px), `.feedback-fab`,
  `.lb-viewall`, the game page `(i)` buttons. The `/` page is the only one with the guest panel.
- `/coming-soon` renders the 404 view (`NoPageFound`) with HTTP 200; `/definitely-not-a-route` and hidden slugs
  return a real 404. Legal pages (`/privacy`, `/terms`) use a plain `<main>` (no `.page`), so `audit.goto` waits on
  `main article h1` for them.
- `/admin` for a guest: `.admin-placeholder` ("Admins only"); `Checking access...` shows first.
- Leaderboard Global/Friends tabs exist only when signed in. The guest equivalent of "segmented tabs" is the login
  modal's Log in / Sign up (`.auth-tabs`). Global/Friends belongs to the account suite.

## Intentional exemptions

- `slow GET /api/get-users/` (`LOCAL_LOAD` in `lib/guest.mjs`) is allowed in the parallel-pass guest `audit.console()` calls: it
  answers 161 bytes in ~0.25s idle, but four browsers on one local `runserver` push it past 1s. The `@perf` tests run
  alone (one worker) and do NOT allow it.
- The 404 routes' document response and Chrome's "Failed to load resource ... 404" console line are allowed, and only
  in the loop that visits 404 routes (per route in G-LAYOUT-01, once after the loop in G-PERM-02).
- Dev-server HMR websockets (`/_next/hmr`) are not counted as a guest socket in G-PERM-03.
- `tap-target-touch` warnings (44px on touch) are soft by design. The footer, rail chips (40px high), the
  hamburger (38px), `(i)` buttons (30px) and the nav brand all warn on touch viewports. The digest shows at most
  20 warning lines per suite, then a `(suite guest)` trailer pointing at results.json.

## Measurement notes

- `recordFrames(page, selector, fn, {tail})` samples a selector on every animation frame from before `fn` until
  `tail` ms after it. A fixed-length window is wrong: a slow click falls outside it. Use it for fades, slides and
  modal entrance/exit. Entrance/exit "animated" means at least one part-way frame (0.03 < opacity < 0.97); counting distinct steps broke on a busy machine that drops frames.
- Route-change latency is measured inside the page (`routeLatency`): capture-phase click to a predicate on a
  frame. Node-side `audit.timing` with `expect(...).toHaveText` adds CDP round trips and up to 250-500ms of
  polling lag, which put 300ms-class noise on a 1000ms budget. Same for the search filter (`searchLatency`).
- `valleys(opacities)` is a zigzag with a 0.4 minimum swing. Clean route change = 1 valley (out once, in once).
- The prod template fade ends with a one-frame opacity flash (see report): WAAPI finishes at 0 (or 1) and the
  inline style catches up one frame later. The check reports it as `double-transition` (3 dips).
- Perf budgets (TTFB 800, LCP 2500, CLS 0.1) apply in prod only. Home is loaded twice and the second load is
  measured. Even so, a TTFB or LCP spike can still come from load (4 workers, one Django): re-run that viewport
  alone (`--only G-PERF-01 --vp <id>`) before calling it real. CLS on phones is real (legal notice).
- `--live` runs (`guest-live@<vp>`, digest `· env live`): any non-GET/HEAD request or websocket to a remote origin is
  aborted and fails the test as `live-write`. A `live-write` is never a site bug to file: it is the guard doing its job.
  Known cause: Google Identity Services (`accounts.google.com/gsi/...`) may POST when the login modal mounts the Google
  button; that conservative failure is correct (the check must not send it). Report it to the owner instead of filing a
  finding, and leave the check untagged rather than loosening the guard. Live perf numbers include real network latency.

## Flaky spots

- Stack start: `run.mjs` starting Django itself hung twice in this session (log showed nothing after the header, port
  never opened); starting `manage.py runserver` by hand with the same env worked immediately. See the report.
- Dev mode (`--mode dev`) is for fix loops only: first compile of each route takes 5-20s, the HMR socket and React 19
  `element.ref` dev warnings add console noise. Judge on prod.
- `loaf` (long animation frame) findings depend on CPU. They repeat at 140-250ms on the same transitions at every
  viewport, so they are treated as real, but compare against a single-worker run before filing.
- G-MODAL-01 saw one `net::ERR_CONNECTION_REFUSED` console error on `/` (prod, run 20261012-1350, right after Django
  was started by hand). It never repeated in 3 later full runs.
- (20261014-1153) Probes took 60-100s each with the full stack under load; `axe: ["color-contrast"]` with the guest-panel login modal open reproduces the white-on-#ff6a1a failures; `style` with `main article p a[href^='mailto:'] >> nth=0` works on /privacy.
