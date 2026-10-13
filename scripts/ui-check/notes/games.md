# Games suite notes (for adapter authors and the judge agents)

Specs: `specs/games/scenarios.spec.mjs` (`GM-<game>-<scenario>`, `GM-<game>-adapter`), `specs/games/shell.spec.mjs`
(`GM-SHELL-01`), `specs/games/latency.spec.mjs` (`GM-LATENCY-01`, `@perf`). Driver: `lib/game-driver.mjs`. Adapters:
`games/<id>.mjs`, registered in `games/index.mjs` (the contract is written out at the top of that file). Shared
adapter helpers: `games/helpers.mjs`. Locators: `pagemap/games.json`. Shell measurement shared with
`scripts/ui-audit.mjs`: `scripts/lib/game-shell.mjs`.

## Writing an adapter (Tasks 6, 7)

1. `games/<id>.mjs` default-exports the contract object; add it to `ADAPTERS` in `games/index.mjs`. The scenarios
   spec picks it up for every viewport; `GM-<id>-adapter` disappears by itself.
2. `answer(page, ctx, { correct })` plays exactly ONE turn and returns only when the next turn is ready or the game
   is over: use `nextTurn(page, readKey, prevKey, isOver)` with a key that changes once per turn and is never read
   half-swapped (SwapText keeps the old text until its exit ends: key on one value, or validate the key against the
   pool like `series-winner.mjs`). Keep the previous key in `ctx.state`.
   Read question rows ONLY through `ctx.pool(key)` (single player: captured HTTP JSON; the multiplayer suite swaps in
   a socket-frame source via `newCtx(fx, scenario, { online: true, pool })`). When the round cannot be answered from
   the pool or fiber, call `noTruth(ctx, what)` (via `answerFrom`): it records `no-truth` and throws. Never accept a
   round you cannot validate (series-winner fails on an empty pool instead of taking any key).
3. Return `{ over, truth }`: `truth` is the right answer as the player should see it; the driver checks that every
   wrong-answer feedback names it (Rule 6.0). Return `feedback: false` for a turn that shows nothing by design.
4. Every `waitFor`/`isEditable`/`getAttribute` inside a polling loop needs a short `timeout`: Playwright's default
   action timeout here is unlimited, and an element that vanished when the game ended hangs the test until its
   240 s timeout (that is how the first name-logo version failed).
5. A scenario you cannot drive is a reason string, never `true` with a no-op.
6. Optional fields: `pointsPerCorrect` (copy and expected score), `feedback: { selector, copy }`, `endsInPlace`,
   `playAgain: false` (the end screen legitimately has only Close game — Wordle; otherwise both buttons are required,
   `end-buttons` / `replay`), `freshAccount` (`true` or a list of scenarios run as a brand-new throwaway account),
   `labels` (test-title wording per scenario), `expectedScore(turns, ctx)`, `endReveal(page, ctx, turns)`, `giveUp`,
   `timeout`.
7. **A game that ends in place must have `endReveal`** (Rule 7.3): without it every finished scenario records
   `answer-hidden` "adapter has no endReveal".
8. `timeout` runs after `page.clock.install()` (the driver installs it before the first load, in that scenario only).
   The fake clock keeps flowing at real speed, so the game and every rAF sampler run normally; end the clock with
   `page.clock.runFor(timerMs + 1000)`. Proven by `[ST-GAMES]` (selftest, `fixtures/detectors/game-clock.html`), which
   also runs `giveup` through the real driver.
9. `daily-lock`: the driver finishes a play with wrong answers, closes from the end screen, reloads and expects
   (`toBeVisible`) `.idle .idle-room-note` and no Play button. Wordle's scenarios must use `freshAccount` (each one
   gets its own `uic<digits>` account, so one scenario's daily play never locks another's). The account is minted by
   `lib/mint_tokens.py`, seeded over the persona's session on the first load, deleted through the API after the
   scenario, and swept by the stack teardown if a worker dies (the sweep already deletes every `uic<digits>` user).

## Answer source per game

The pools are sampled client-side with `Math.random` (`utils/pool.ts sampleN`, `utils/gameData.ts fetchGameRows`),
so the captured network data holds the whole pool, not the five rounds. Each adapter reads what the round shows
(season, team names, logo file) and looks it up in the pool captured by `ctx.cap` (`capPool(ctx, key)`): the bundled
`/data/<key>.json` in dev (`VITE_DATA_BASE` unset), the manifest-v3 host in prod (`.env.production`
`VITE_DATA_BASE`: schema-3 `manifest.json`, chunk/single files, lookups expanded like `gameData.ts expand()`).
`ctx.fiber` (`fiberRound(ctx, prop)`: the renderer's own props + hook 0) is the fallback, accepted only when the fiber row
is the one on screen (name-logo checks the logo, guess-mvps the season, series-winner the team pair); neither → a
`no-truth` violation and a failed test (never a guess). Adapters reach the pool through `ctx.pool(key)` only. No `Math.random` seeding is used. Each test records the
`answer source` note metric (`{"cap":5,"fiber":0}` in every run so far).

| game | pool key | round identity (DOM) | answer field | wrong answer |
|---|---|---|---|---|
| series-winner | `playoff` (v3: chunks + `teams` lookup) | eyebrow `<round> · <season>` + both team names (sides swap per round: unordered pair) | `winner` | the other team |
| name-logo | `name-logo` | puzzle `img` src `/logos/scrambled/<team_id>.webp` (else the row's `logo`) | `full_name` | another franchise from the pool |
| guess-mvps | `mvps` | eyebrow (season; one row per season) | `mvp` | another season's MVP |
| who-would-win | (none; tallies from `/trivia/who-would-win/tally/`) | `MATCHUP n/10` + card labels | no right answer | — (Skip) |

Who Would Win has no right answer: `correct: true` = vote (sides alternate), `false` = Skip. So `perfect` = vote on all
10 (titled "vote on every matchup"), `wrong` = skip all, `partial` = alternate. Expected score: each vote's captured
tally response (counted after the player's own vote) scored with `utils/whoWouldWinPoints.ts pointsFor` (20 with or
tied with the crowd, 5 against, 20 when the tally failed, 0 for a skip); the driver asserts the sum on the
ScorePanel, in the log-session body and as `awarded`. Its feedback is the picked card
(`.www-card.is-mine`): accepted deviation 6.1 (no popup), so no Rule 6.0 copy check for it. Its end is in place: the
summary list must hold one visible row per matchup with the skipped ones marked (`endReveal`).

Series Winner, Name the NBA Club and Guess the MVP are allowlisted for the full-screen `GameResult`
(`scripts/game-result-allowlist.json`: every round already reveals its answer), so "answer visible at the end" is
checked per round through the feedback copy; the driver flags `not-in-place` only for non-allowlisted games.

## Scenario coverage (Task 5)

| game | perfect | wrong | partial | timeout | giveup | daily-lock |
|---|---|---|---|---|---|---|
| series-winner | driven | driven | driven (alternate) | no clock | no give-up control | not daily |
| name-logo | driven | driven | driven (alternate) | no clock | no give-up control | not daily |
| guess-mvps | driven | driven | driven (alternate) | no clock | no give-up control | not daily |
| who-would-win | vote all | skip all | vote / skip | no clock | no give-up control | not daily |

`partial` for games without lives is "a mix of right and wrong" (right on even turns); with lives it is one miss,
then right answers (finish with lives to spare).

## Post-game flow

`perfect` / `partial`: end screen Play again → a fresh round 1 (`replay`) → the shell's Close game cross-fades to
idle (`no-transition` if no part-way opacity frame). `wrong`: the end screen's own Close game → idle. So both end
buttons are exercised on every core viewport. Non-core viewports (`perfect`, layout-only) skip the post-game flow and
the log-session assertion.

## Throttle budget (per full run, `--vp all`)

| endpoint | limit | used |
|---|---|---|
| `POST /trivia/log-session/` (`score-submit`) | 60/h per account | 58 finished games: 4 games × 3 scenarios × 3 core vps (36) + 4 `perfect` × 4 other vps (16) + GM-LATENCY-01's 2 finished games (Series Winner, Who Would Win) × 3 core vps (6, all on worker 0's account in the serial pass). Spread over the per-worker accounts; worst case all on one account: 58 < 60. GM-SHELL-01 finishes no game. `freshAccount` scenarios count against their own new account. |
| `POST /trivia/log-guesses/` (`guess-log`) | 120/h per account (guests per IP) | Who Would Win votes: 10 (`perfect`) + 5 (`partial`) per core vp, 10 per other vp, 2 per core vp in GM-LATENCY-01 (the rest of that game is skips): 91 |

Counters live in Django's LocMem cache: a second full run on the same kept stack within the hour can reach the
score-submit limit (the assertion then shows `HTTP 429 … (score-submit throttle)`). `node scripts/ui-check/run.mjs
--stop` resets them. The log-session assertion stays on in every core scenario.

## Intentional exemptions

- **User agent.** The games specs run with the browser's own UA minus "Headless" (`realUserAgent`). cdn.nba.com, which
  the app hotlinks for crests and logos, resets HTTP/2 streams for `HeadlessChrome` (`net::ERR_HTTP2_PROTOCOL_ERROR`;
  the same URL answers 200 with the normal UA, verified with raw Playwright). Without it every shot shows placeholder
  crests and every game logs console errors that no visitor would see.
- **`loaf` in the scenario pass** is moved to a note metric (`longest frame while playing (parallel pass)`): 4
  browsers on one machine make 110-520 ms frames at random. GM-LATENCY-01 (`@perf`, one worker) owns long frames while
  answering and while two games end (GameResult and EndSequence transitions) and fails on them.
- **`slow GET /api/me/` and `/api/get-users/`** (`GAMES_LOCAL_LOAD`) are allowed in the scenario and shell tests only
  (4 workers on one local runserver push the session restore past 1 s; idle it answers in ~0.2 s). GM-LATENCY-01
  allows nothing.
- **Feedback latency** in the scenario pass is a note metric (`<game> <scenario> feedback max`); GM-LATENCY-01 asserts
  the 150 ms budget.
- **GM-SHELL-01 runs logged out**: a guest's daily Wordle play is keyed by a fresh device id per context, so it never
  locks the solo accounts' daily word (Task 7's `daily-lock` needs that).
- **`previous feedback still visible after 3 s`** is a note metric (the turn number), not a failure: the next turn's
  latency may then be read off the old element; look at it when a latency number looks wrong.
- **Stage resize at the end**: `stage-resized` ignores a height change while the end phase is mounting (no
  `.playing-wrap`, or EndSequence spinner / ScorePanel / ended exit link present). A resize during the last answer's
  feedback, before the end phase starts, is still caught.

## Measurement notes

- Feedback latency = last capture-phase click / Enter before the feedback element is present with height in an
  animation frame. In-page, so no CDP round trips. Prod, single worker (GM-LATENCY-01): 6-17 ms; the 4-worker
  scenario pass reads 6-291 ms (load), which is why it is only a note there.
- Feedback copy is read from the first frame the element shows; its colour is compared with `var(--good)` /
  `var(--bad)` resolved in the page.
- Before arming each turn the driver waits (≤ 3 s) until the previous turn's feedback has left, so an exiting popup is
  never timed as the next turn's feedback.
- The negative control (an adapter wrapper with wrong points, `endsInPlace: true` and a 40 px padding injected on
  turn 3) produced `feedback-copy`, `end-score`, `not-in-place`, `points-not-logged`, `stage-resized` (Δ40 on turn 3)
  and `snap` on all three core viewports — the rules fire. It was a temporary spec, not committed.

## Flaky spots

- **Data-dependent, not timing**: `stage-resized` on Series Winner fires on narrow phones (phone-360, phone-414) only
  when the five sampled series include a long team name: "Golden State Warriors" wraps to three lines in its pick
  card and the card (and the stage) grows ~18.8 px for that round, then shrinks back (Rule 6.2 / 4.4: team names do
  not reserve their maximum line count). Real; it shows up in some runs and not others because the rounds are random.
  Evidence shots `resized-turn<n>.jpg` show the board right after the resizing round.
- The first test of each worker on a cold prod server can record the soft warning `not-hydrated` (phone-360 in the
  final run); the test still passed.

- Dev mode: `ui-audit.mjs` (and `startGame` without hydration wait) clicks Play before React hydrates on a loaded
  dev server; the games specs use `audit.goto`, which waits for hydration.
- GuessMvps has no guard against a second submit in one round (NameLogo has `advanceTimer`): a double Enter would
  advance twice. Adapters submit once; noted as a possible app bug, not asserted.
