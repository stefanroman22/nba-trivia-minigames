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
| starting-five | `starting-five` (one game per play) | scoreboard: both team names + final score (+ date) | the lineup player of the first empty card's position family (G / F / C) | a player from another game's lineup, in nobody's normalised lineup, never repeated |
| fan-favorites | `fan-favorites` | the prompt (`.gf-title`) + slot count | the first unrevealed answer's canonical text (an alias if another answer claims it under `answerMatch.ts`) | an answer or alias of another survey that `matchAnswer` finds on no slot of this board, never repeated |
| career-path | question payload `{ game: 'career-path', qid, player }` (`capQuestions`: questions store in dev, v3 host in prod) | newest captured payload whose stint count and face-up cards (team + years) equal the rail | `player.full_name` | a name from the captured autocomplete list (`capNames`) matching neither the name nor an alias |
| who-are-ya | question payload `{ game: 'who-are-ya', … }` | the headshot URL's person id (newest payload when the photo is missing) | the mystery's full name, only when the game's own name lookup (rebuilt from the captured list, first claim wins) resolves it to the mystery | a listed player whose name resolves to himself, not to the mystery, never repeated (a repeat or an unlisted name costs nothing in the game) |

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
| starting-five | 5 right (100 with the bonus) | 3 misses → lineup revealed | 2 misses, then 5 right | no clock | no give-up | not daily |
| fan-favorites | whole board (300) | 3 misses → board revealed, 0 | 2 misses, then the whole board | no clock | no give-up | not daily |
| career-path | right first guess (cards × 100) | a miss per card → 0 | 1 miss, then right (never the last guess) | no clock | no give-up | not daily |
| who-are-ya | right first guess (240) | 8 misses → 0 | 2 misses, then right (180) | no clock | no give-up | not daily |

`partial` for games without lives is "a mix of right and wrong" (right on even turns); with lives or limited guesses it
spends all but one on misses (`lives - 1`, or the adapter's `partialMisses`), then answers right (finish with one to
spare): Starting Five / Fan Favorites 2 misses, Who Are Ya 2 (8 guesses, the brief's "all but one" would be 7 misses,
which only slows the test), Career Path 1 (its guess count is the stint count; the adapter answers right instead of
missing the last guess, so a one-stint player still wins).

## Post-game flow

`perfect` / `partial`: end screen Play again → a fresh round 1 (`replay`) → the shell's Close game cross-fades to
idle (`no-transition` if no part-way opacity frame). `wrong`: the end screen's own Close game → idle. So both end
buttons are exercised on every core viewport. Non-core viewports (`perfect`, layout-only) skip the post-game flow and
the log-session assertion.

## Throttle budget (per full run, `--vp all`)

| endpoint | limit | used |
|---|---|---|
| `POST /trivia/log-session/` (`score-submit`) | 60/h per account | 8 adapted games finish: 8 games x 3 scenarios x 3 core vps (72) + 8 `perfect` x 4 other vps (32) = **104** in the 4-worker pass, + GM-LATENCY-01's 4 finished games (Series Winner, Who Would Win, Career Path, Who Are Ya) x 3 core vps (**12**, single-worker pass, always `testuser3`). 116 per run in all. GM-SHELL-01 finishes no game. `freshAccount` scenarios count against their own new account. |
| `POST /trivia/log-guesses/` (`guess-log`) | 120/h per account (guests per IP) | Who Would Win votes: 10 (`perfect`) + 5 (`partial`) per core vp, 10 per other vp, 2 per core vp in GM-LATENCY-01 (the rest of that game is skips): 91. |

**Account rotation (Task 6).** One account per worker could not carry 104 + 12 games: 4 workers x 60 = 240/h in theory, but
the dynamic split is uneven and Tasks 7/8 add more games. In the games suite the `session` fixture
(`lib/fixtures.mjs` `rotatedIndex`) takes the account of `parallelIndex + 4 * (stableHash(titlePath) % 4)`: 16 accounts,
`testuser3`, `testuser3w1` .. `testuser3w15` (`isTestUsername` accepts `w1`-`w99`, `mintTokens` creates them on demand, the
stack teardown sweep already restores every `testuser3` family name). The hash is FNV-1a of the test's title path, so a
test always lands in the same class (the same title at every viewport), whatever worker runs it. `@perf` tests keep
`testuser3`; the account suite and every other suite are unchanged (`rotatedIndex` returns `parallelIndex` unless the
suite is `games`).

Worst case per account: an account's games are the tests of one hash class that ran on one worker, so the bound is the
largest class. Counted from the log-session rows of the final prod run (run `20261013-1119`, 106 sessions in 54 min):
class 0 (`testuser3`, `w1`..`w3`) 11, class 1 (`w4`..`w7`) 28, class 2 (`w8`..`w11`) 36, class 3 (`w12`..`w15`) 28 (+6 Fan
Favorites games that errored before finishing in that run, class unknown). Even if one worker ran a whole class:
36 + 6 = **42 <= 60** (the largest observed single account: `testuser3w8`, 12). `testuser3` additionally takes the @perf
pass: 12 games + its class-0 share <= 11 + 6 = 29 < 60. Margin check when adding games (Tasks 7/8): each new game adds
3 x 3 + 4 = 13 finished games spread over four classes (about 3 per class); even all 13 in the largest class would give
42 + 13 = 55 < 60, so three more games fit; re-count with `GameSession` (`finished_at`, `user__username__startswith='testuser3'`) if it gets close.

Evidence for "every log-session 2xx": the final run has no `points-not-logged` finding and no `429` anywhere in the digest or
the runner log (`grep -c 429`: 0).

Counters live in Django's LocMem cache: a second full run on the same kept stack within the hour can still reach a limit
on an account the first run used heavily (the assertion then shows `HTTP 429 ... (score-submit throttle)`). `node
scripts/ui-check/run.mjs --stop` resets them. The log-session assertion stays on in every core scenario.

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

## Autocomplete games with lives / limited guesses (Task 6)

Adapters `starting-five`, `fan-favorites`, `career-path`, `who-are-ya` (answer sources, coverage: tables above).
Contract and driver additions (all optional; the Task 5 adapters are unaffected):

- `partialMisses`: how many misses `partial` spends before answering right [`lives - 1`]. `planFor` uses it.
- `latencyPlan(turn) -> right?`: GM-LATENCY-01's answer plan [right, wrong, right]. Career Path and Who Are Ya end on
  their first right answer, so they play miss first (Career Path: miss, right; Who Are Ya: miss, miss, right) and are
  played to the end like Who Would Win.
- Answer result `correct` (the adapter overrode the plan: Career Path never spends its last guess in `partial`) and
  `points` (the `+N` of this turn's `Correct!` popup: Career Path `(cards - misses) x 100`, Who Are Ya
  `240 - 30 x misses`).
- `feedback.copy: 'wrong'`: check the copy and colour of misses only (Fan Favorites: its hit popup `+N fans said it!` is the
  documented 6.0 deviation, constraints doc).
- `endGeometry` / `shellIsOver` / the ResizeObserver `ending()` also accept `.scorepanel-actions` alone: Career Path ends
  with the result line in the status row and Play again / Close game in the action slot (no `.scorepanel`).
- The `replay` round-label check runs only when the label contains an `n/m` counter (these games say `FILL THE LINEUP`,
  `NAME THE TOP ANSWERS`, ... no round number).
- `games/helpers.mjs`: `normAnswer` (answerMatch.ts), `capQuestions(ctx, game)`, `capNames(ctx)`; `typeAndConfirm` takes
  `{ input, confirm }` (Starting Five types into the card's own input; Who Are Ya's button reads `Guess`, its aria-label
  is `Confirm guess`, hence the `confirmGuess` locator).

Per game:

- **Starting Five**: the key is `found|hearts` and goes `null` once 5 are found or hearts hit 0, so `nextTurn` waits for the
  end sequence instead of returning a half-ended turn. The miss that spends the last heart shows NO popup (Rule 6.3), so
  that turn returns `feedback: false`. Final score `right x 10 (+50 when 5)`. End reveal: all five cards named (the real
  lineup), `is-correct` = right answers, `is-revealed` = the rest.
- **Fan Favorites**: prod loads only one chunk of the pool (often just this survey), so wrong guesses cannot come from other
  surveys alone: candidates are other surveys, the `all-players` list, then a fixed list of famous names; each is checked
  against this board with the game's own `matchAnswer` before use (the check is the guarantee). The third miss still
  shows `Not on the board` (allowed: ordinary wrong copy). Score `300` on a clear, else `round(300 x found / total)`.
- **Career Path**: the question comes from the questions store (dev) / data host (prod); several can be captured, so the
  payload is chosen by the rail (stint count + team + years of every face-up card), newest first. Each miss flips a card;
  after a loss the name is behind `See the answer` (the end check clicks it and asserts the name is visible).
- **Who Are Ya**: the typed name must resolve through the game's own lookup (first claim wins over canonical names and
  aliases); an unlisted name or a repeat costs nothing, so the adapter only guesses names that resolve to themselves.
  The mystery is found by the headshot URL's person id. Wrong copy `Not <name>.` names the guessed player, which is the
  `truth` the driver matches.

### REAL findings (checks stay strict; each has a shot in the run's `shots/`)

1. **Who Are Ya's feedback feed grows the stage** (Rule 6.2): every guess adds a row of chips and the stage grows by 80-130 px
   (`stage-resized`, e.g. 351->475 px on turn 1 at phone-390), plus the reveal card at the end; the row appears in one frame
   (`snap`, height 321->445 px) and lands in one long frame in prod (`loaf` 105-110 ms in GM-LATENCY-01 on all three core
   vps). The feed is mounted only when it has rows (a code comment says why) and has no reserved or scrolling area. Fix
   direction: reserve the feed's height (8 rows) or give it an internal scroller.
2. **Starting Five** (a) when the lineup completes, the stage grows ~79 px in one frame as the EndSequence mounts
   (`snap` on all 7 vps in `perfect`/`partial`; the loss path is hidden by the card-flip animations); (b) on phones a
   found card swaps its input + Confirm for the one-line name and the stage shrinks ~16 px (`stage-resized` -15.8 px on
   turn 2 at phone-360/390/414, shot `resized-turn2.jpg`).
3. **Fan Favorites** at phone-360: a long answer wraps when its slot is revealed and the stage grows 10 px
   (`stage-resized` +10.2 px on turn 14); data-dependent like the Series Winner finding.
4. Series Winner (Task 5) shows again at phone-360/390/414 (card height 18.8 px, depends on the sampled series).

### False positives and flakes met

- `no guaranteed-wrong answer available` (Fan Favorites, prod): adapter bug, fixed (candidate list above).
- GM-LATENCY-01 phone-390 once timed out in the `session` fixture ("Test timeout of 60000ms exceeded while setting up
  session", mint of `testuser3` under load); the re-run was clean. Not reproduced.
- Dev mode: Career Path / Who Are Ya show `not-hydrated` once per worker (cold dev server), same as Task 5.
