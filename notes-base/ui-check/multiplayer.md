# Multiplayer suite notes (for spec authors and the judge agents)

Specs: `specs/multiplayer/{matchmaking,rooms,results,proposals,resilience,timeouts,games}.spec.mjs` (catalogue in
`CHECKS.md`, "Multiplayer (MP-)"). Helpers: `lib/mp.mjs` (pair lifecycle, room / match steps, screen state, results
reader, frame recorders), `lib/mp-play.mjs` (an online round with the single-player game adapters), `lib/mp-pool.mjs`
(round data from socket frames). Locators: `pagemap/multiplayer.json` (+ `guest.json` for the modal shell, `games.json`
for the adapters' own keys). App side: `src/context/MultiplayerContext.tsx` (phases), `src/components/MultiPlayer/*`,
`src/components/modals/{GamePickerModal,AnswerReviewModal}.tsx`; relay `multiplayer_server/src/index.js` + `turnGames.js`.

## How judges use this file

The `ui-check-multiplayer` judge reads "False positives met and how they were handled", "Flaky spots" and "Waits
and timings that matter" before judging (what they describe is not a finding), and "Screen state" when it maps a
digest line to a phase. The rest is for spec authors; the judge opens it only when a digest line needs it. After
judging it appends what a later run can reuse (a false positive and why, a flaky spot, a timing) as one bullet
`- (<runId>) …` under the matching heading; it never edits or deletes existing lines.

## Running

- `node scripts/ui-check/run.mjs --suite multiplayer --mode prod` runs all four pairs with ONE worker (run.mjs). The mp
  projects also have `fullyParallel: false`, so a file's tests run in file order in that worker. Serial mode
  (`test.describe.configure({ mode: 'serial' })`) is deliberately NOT used: it skips every later test of the file after
  one failure, and a real finding (a strict violation) in one check would hide the rest.
- `games.spec.mjs` (MP-GAME-<game>) and `timeouts.spec.mjs` (MP-TIMEOUT-01) load on `mp@pairA` only (playwright config
  `testIgnore` on the other pairs): one full match per online game, and the real-time waits, once per run.
- Iterate with `--only MP-ROOM-01 --vp pairA --mode prod --keep-stack` (prod is faster to iterate than dev here: no
  compile on first visit of each game page; the build is reused while `src/` is unchanged). Add `--skip-slow` to leave
  out `@slow` tests (MP-TIMEOUT-01: three real 30 s waits) in verify loops; full runs keep them.

## Stack additions (lib/stack.mjs, Task 8)

- The relay ui-check starts gets the data hosts production gives it (`DATA_PUBLIC_BASE` = the build's `VITE_DATA_BASE`,
  `QUESTIONS_PUBLIC_BASE` = `VITE_QUESTIONS_BASE`, env files in Next's order, `relayDataEnv()`). Without them the relay
  cannot deal Career Path, Who Are Ya, Contexto or Tic-Tac-Toe (`roundDataError` "Couldn't load the game."); pool games
  fall back to the Django endpoints either way.
- Relay and Django share a `MULTIPLAYER_SHARED_SECRET` (`relayKeyFor` in lib/stack.mjs: random per stack, `randomBytes`,
  kept in `<uicHome>/stack.json` while either process lives, never logged), so a finished 1v1 match is credited like in
  production (`/trivia/multiplayer-result/` → `pointsAwarded` → "+N pts added to your profile"). Local only. A relay or
  Django not started by ui-check lacks the key: nothing is credited, and `creditsEnabled()` turns the MP-RESULT-01
  points assertion into a note.
- Dev mode: ui-check starts its own relay on :4000 before `npm run dev` (scripts/dev.mjs reuses a socket already
  listening), so the dev relay gets the same env.

## Pair lifecycle (the guarantees)

- `openPair(mp, path)`: throws when Playwright runs more than one worker (the two accounts are shared); `mp.pair()` (testuser1 host, testuser2 joiner, fresh minted tokens, own contexts, real UA), both
  `audit.goto(path)`, wait for each page's socket `identify` frame, then until neither page has received a socket frame
  for 800 ms (at most 8 s: a `resumeMatch` / `roomLeft` for a seat the relay still holds arrives right after identify),
  then `ensureIdle` on both twice: whatever screen a player is on
  (searching, intro, playing, waiting, results, ended, lobby, friend menu) is left through the app's own controls
  (Cancel, Exit game, Stop match → Close room, Leave room, Back). Both must end on the idle card or the test fails at
  setup. Then `cap.clear()` on both, so frame assertions see only this test.
- `afterEach` → `releasePair()`: the same UI-only leave loop for both (3 rounds, never throws), then it verifies both
  ended idle (or on the friend menu); otherwise a `cleanup` annotation on the test and a console warning. Then the fixture closes
  both contexts (sockets disconnect while idle: the relay deletes the player). Anything still held (a crash mid-step)
  is resumed and left by the next test's `openPair`; at worst the relay's own grace (30 s match, 10 s lobby) or lobby
  TTL (15 min) frees it.
- `both(pair, fn)` runs host then joiner and throws once with both errors; `finishBoth` runs `console()` + `done()` on
  both audits (each attaches even when the other fails) and fails once with both messages.

## Screen state (DOM only)

`mpState(page)`: the last `.stage-inner .om-stage` decides (`--compact` searching, `--play` playing, `--results`
results, `.om-ended-title` ended, `.om-yourscore` waiting, `.om-eyebrow` intro); without one, the Multiplayer card
(`.fp-code-row` / `.fp-mini` lobby, `.mp-friend` friend menu, `.mp-choice` + `.stage-col .idle` idle). The
MultiplayerContext phase is not reachable from outside. `startStateLog` records the trail per frame (MP-MATCH-01).

## Event sequences seen (socket.io frames, `cap.frames(name, { dir })`)

- Identify: out `identify {token}` on every connect and before each gated action (the client re-identifies itself).
- 1v1: out `findMatch {game}` → first player in `searching {inQueue, position}` → second player's `findMatch` → both
  in `matchFound {code, role, roomType:'match', roomSize:2, you, opponent, opponents, game}` → in `roundData {gameData,
  game}` (dealt during the 2.6 s VS intro) → out `submitScore {code, score, elapsedMs}` → the first finisher in
  `waitingForOpponent`, the other in `opponentFinished {id, username}` → both in `matchResult {yourScore, opponentScore,
  outcome, standings}` → the scorer in `pointsAwarded {awarded, points, rank, rank_up, progress, streak, ...} (the whole receipt row)` (1v1 only, score > 0).
- Friend room: out `createFriendRoom {game, size}` → in `friendRoomCreated` (lobby snapshot: code, game, capacity,
  min, max, hostUid, members[{id, username, isHost, online}]) → joiner out `joinFriendRoom {code}` → joiner in
  `friendRoomJoined`, host in `friendLobbyUpdate`; `setRoomSize` / `changeFriendGame` → `friendLobbyUpdate` to both;
  out `startRoomNow` → both `matchFound {roomType:'friend'}` → `roundData`. Wrong code → `friendJoinError {message:
  "No room found for that code."}`. Host `stopMatch` → `matchStopped {message}` (not to the host) + `friendLobbyUpdate`.
  Host `leaveMatch` in the lobby → others `friendRoomCancelled {message: "The host closed the room."}`. A guest leaving a
  2-player match → host `matchStopped "<name> left, so the match ended."` + lobby.
- Proposals (1v1 only): out `proposeAgain {code}` / `proposeSwitch {code, game}` → proposer `proposalPending`, other
  `proposalReceived {type, gameId, gameName, fromName}`; `respondProposal {accept:true}` → both `matchRestart {game}` +
  `roundData`; `{accept:false}` → `proposalDeclined` to the PROPOSER ONLY (see findings); `cancelProposal` →
  `proposalCancelled` to the other; 30 s → `proposalTimeout` to both.
- Reload / drop: the remaining player gets `opponentDisconnected {graceMs: 30000}`; the reloaded page identifies →
  `resumeMatch` (snapshot: phase, gameData, opponents, standings, proposal) and the other `opponentReconnected`; no
  return within the grace → `opponentLeft "Your opponent left the match."`.
- Tic-Tac-Toe: `turnState {code, game, state: {board[9], criteria{rows, cols}, turnUid, deadlineTs, stealsLeft, winnerUid,
  draw}}` after every change; a refused move → `turnReject {message}` (warn notice); out `turnAction {code, action:
  {type:'claim'|'steal', cell, playerName}}`.

## Matchmaking is deterministic here

The relay pairs a new searcher at once with a waiting player of the same game, nearest rank first, else any waiting
player (`pickOpponent`: rank only ORDERS candidates, it never keeps a player waiting). The local relay has no other
players and the suite has one worker, so "host searches first, joiner presses Play 1v1 on the same game" always pairs
testuser1 with testuser2, whatever their ranks (they drift as points accumulate, see below). The second player is paired
on arrival, usually before its searching screen or the button's "Cancel" label paint: MP-MATCH-01 records that as a note
(`second player saw the searching state`), it does not require it.

## Playing online with the game adapters (lib/mp-play.mjs, lib/mp-pool.mjs)

- Online, OnlineMatch renders the same renderer (`renderGame(..., multiplayer: true)`) inside `.stage-inner
  .om-stage--play` (no MiniGame `.playing-wrap`) and without the shell's feedback slot: `SubmitGuessPopup` falls back to
  its inline overlay (0-height relative div → absolute row with `pointer-events: none` → the popup span). The adapters
  are written against the solo shell, so `onlinePage(page)` (a Proxy) maps `.playing-wrap` → `.stage-inner
  .om-stage--play` and `.feedback-slot > *` → the inline popup span in every selector, in-page function source
  (re-evaluated from its rewritten source; in-page functions can close over nothing anyway) and string argument passed
  through `locator / evaluate / waitForFunction / waitForSelector / $eval / $$eval`. It also exposes `uicOnline: true`.
- Adapter changes (additive, single player unchanged): `helpers.shellIsOver` — online, the game is over once the
  playing screen gave way to waiting / results (the renderer hands its score to the match); `helpers.payloads(ctx,
  game)` + `capQuestions` — online, the question payload is the round the relay dealt (`ctx.pool(game)`); Contexto reads
  its question through `payloads`; Wordle's word online is `ctx.pool('wordle')[0]` (no daily-play call online);
  Tic-Tac-Toe has an `online` section (below).
- `framePool(cap)` → `ctx.pool(key)`: a round game's pool key → the newest `roundData.gameData` (THIS round's rows,
  expanded by the relay: 5 rows for series-winner / name-logo / guess-mvps, 1 for starting-five / fan-favorites, `[question]`
  for career-path / who-are-ya / contexto, `[WORD]` for wordle); `'tictactoe'` → the published question whose criteria
  labels equal the newest `turnState.criteria` (the relay keeps `valid[cell]` server-side, so the 120 question files of
  the same public data host the relay deals from are fetched once per worker and matched by labels); anything else
  (fan-favorites' `all-players`) → the page's own HTTP capture (`capPool`). Every answer in the runs so far came from
  this source (`answer source {"cap":N,"fiber":0}`).
- `playOnline(p, adapter, scenario)`: layout of the playing screen + shot, the adapter's turns inside `audit.motion`
  (watch `.stage-shell` only, `STAGE_BOX`: the inner `.om` changes height invisibly between phases; snap / CLS enforced, loaf a note), feedback presence per turn (Rule 6.1;
  copy / colour / 6.2 resize rules stay with the games suite), `never-ended`. `playBoth`: the host plays the whole round
  first (`perfect`), the waiting screen is checked, then the joiner (`wrong`, or `giveup` for Contexto, whose only loss
  path is Give up). Sequential on purpose: deterministic, and it exercises waiting / "Finished" chips.
- Tic-Tac-Toe online is the relay's duel, not the solo board: `adapter.online.move(page, ctx, {correct})` claims the
  next top-row cell with a valid unused player (host) or a listed player who does not fit a free cell (joiner: refused
  with "<name> doesn't fit that square.", the turn stays). `playDuel` waits for whoever shows YOUR TURN; each joiner
  turn passes to the host only when its 25 s clock runs out (waited for real twice per run, pair A only: `turn-pass`).
  Host three in a row → banners "You win!" / "Opponent wins" (held 1.8 s, read inside the motion window) → results
  300 / 45 (a draw 180) (no play times in a duel: `times: false`). `move(page, ctx, { correct, cell })` claims a given cell with its
  player from a one-player-per-cell matching of the whole board (`assign`, the same on both pages), so the two players
  never name the same person. `playDuel(pair, adapter, { script })` plays `DUEL_SCRIPTS.win` (MP-GAME-tictactoe) or
  `DUEL_SCRIPTS.draw` (MP-RESULT-02: both claim, `X O X / X O O / O X X`, no line → 180 / 180; the duel submits no play
  times, so the relay's rankRoom calls it a tie: the only deterministic way to the draw headline, no clock waited out).
- The decided duel board: the relay settles a duel in the same tick as its last move and MultiplayerContext switches to
  the results at once, so TicTacToe.tsx's 1.8 s "hold the banner" never happens: the mover sees no banner at all, the
  other player ~0.4 s (dev). `watchBanner` records the banner per frame on both pages; `duel-banner` (< 1 s or never) is
  a REAL finding, not a timing flake. A claim after which the results are already up counts as landed.
- MP-MATCH-01's intro is asserted from a snapshot the in-page state log takes on the first complete intro frame
  (`readIntro`): the 2.6 s intro is often over before the test can look at it (pair A matched in 3.8 s once).

## Waits and timings that matter

- VS intro 2.6 s (`INTRO_ELAPSED`), then playing once the round is in. `startRoom` / `startMatch` wait intro|playing
  (20 s) then playing (30 s).
- The relay refuses a restart / start within 3 s of the previous deal (`RESTART_MIN_MS`): never Start right after Stop.
- Notices: info / warn auto-clear after 3.2 s, "+N pts" after 1.5 s, errors stay. `waitNotice` polls 100 ms; the copy
  hint "Copied." / "Code copied" lasts 1.8 s. `recordTexts` (rAF, per selector, nests) is how short-lived labels are
  caught: Creating…, Joining…, Cancel, Code copied, the +N pts toast, Reconnecting.
- innerText applies CSS `text-transform` (the intro eyebrow reads MATCH FOUND): compare with `textContent` there. A
  SwapText with `reserveWidth` keeps its other labels hidden in the DOM: read `innerText` (skips `visibility: hidden`),
  never `:has-text()` (the 1v1 button "has" Play 1v1, Cancel and In a match at once).
- Real-time limits (relay process, cannot be fast-forwarded from the browser): matchmaking queue 30 s, proposal 30 s,
  reconnect grace 30 s (MP-TIMEOUT-01, pair A, ~2 min), Tic-Tac-Toe turn 25 s (MP-GAME-tictactoe, ~50 s). Lobby grace
  10 s and lobby TTL 15 min are not waited out (no check is about them).
- A closed tab is noticed at once (socket close); a frozen one only after `pingInterval + pingTimeout` (20 s).

## Accounts, names and what accumulates per run

- testuser1 / testuser2 never gave an age, so they count as teens (`users/consent.py is_teen`); since 2026-10-19 that no
  longer matters on the relay: every room type, a RANDOM 1v1 included, shows the real name and photo (`publicUser`; the
  teen masking was removed). `shownName(p, type)` gives the expected name; results / waiting / prompts / notices use it.
- Per full run (4 pairs + pair-A-only files), credited by the relay to the local sqlite only (1v1 matches; friend rooms
  never credit, checked in every MP-GAME test): testuser1 +400 per pair (Series Winner, 100 per credited round: MP-RESULT-01, MP-PROP-01 + rematch,
  MP-PROP-02) = 1600, + 100 in MP-TIMEOUT-01 = **+1700 points**; testuser2 +100 per pair (the all-right rematch in
  MP-PROP-01) = **+400 points**. Each account's first scoring game of a Paris day adds +100, so the exact totals vary by up to 100 per account per run. Each credited match also writes one `GameSession(mode='match')` row per player (a 0
  score too, awarded 0). Matches left mid-game (MP-MATCH-01, MP-RES-01, MP-TIMEOUT-01's grace match) credit nothing. Ranks
  rise with the points; that only reorders matchmaking candidates (see above). No per-account throttle is hit (the
  relay's credit call is server to server, unthrottled; MP submits no `log-session`). Each test mints 2 token pairs
  (2 `OutstandingToken` rows).

## False positives met and how they were handled

- `loaf` is a note only while BOTH pages render the same event (`motionBoth`, `playOnline`, `playDuel` → `demoteMpLoaf`,
  label `longest frame (two browsers at once, not enforced)` with the step): two browsers render at once on one machine,
  so a frame's length is not attributable to the page. A one-sided `motion()` (Copy code, collapse / expand, Enter code,
  the picker, a lone search) keeps `loaf` strict; long frames are owned by the single-browser @perf passes (guest, account, GM-LATENCY).
  Values seen: 110-140 ms on lobby / room steps, 250-710 ms on a game page's first mount after a route change or start
  (the same mounts the guest suite reports in its @perf pass).
- `slow GET /api/me/` (`MP_LOCAL_LOAD`): both sessions restore at once on one runserver, and the first test of a run also
  boots the token minter; 2.3-3.1 s then, ~0.2 s otherwise.
- "lobby game name swap": after a game pick both pages change route, so the lobby re-mounts (not a SwapText in place);
  recorded as a note, the route change is asserted.
- `snap` on OnlineMatch's inner `.om` between phases (results → intro −203 px on a phone): the old screen has faded to
  opacity 0 when it is removed, so nothing visible jumps. Only `.stage-shell` (the visible box) is watched (`STAGE_BOX`).
- After the host closes a room, a player who had opened "Play with a friend" on that page stays on the friend menu
  (phase idle, local card state): accepted as "out of the room" (`idle` or `friend-menu`).

## Flaky spots

- The second player's searching state (paired on arrival) and "Creating…" (relay answers within a frame) may not paint:
  notes, not assertions.
- A notice auto-clears after 3.2 s: assert it with `waitNotice` / `recordTexts` right after the action, not later.
- The "+N pts" toast lasts 1.5 s: recorded from before the round ends (`recordTexts` around the joiner's play).
- (20261014-1153) MP-GAME-wordle timed out (420 s, shot stays on the lobby): not judged, no repro; check whether the wordle online start stalls before filing.
- (20261014-1153) The tictactoe duel-banner hold (1800 ms in TicTacToe.tsx) is cut short by the context's MATCH_RESULT, which fires the moment the relay settles the board; draws on pairB-D show 0 ms.
