# Motion audit — every text and screen change smooth (design round, 2026-10-07)

Card `3ee2cfb1-c595-81cf-9c32-d83792fef482` · P2 · hard · areas frontend/ui/games · risk low.
Branch `team/motion-audit-every-text-and` at origin/dev `5065a76`. This document is the card's
deliverable #1 (the card named it `docs/team/designs/2026-10-03-motion-audit.md`; the pipeline's
design-round naming wins, there is one audit doc, this one).

## Decision summary
Engine: **mixed** (`[opus]` for motion, `[sonnet]` for the rule and doc edits).

1. The four prerequisite motion cards are on `dev` (Friends SwapText `8833a7d`, Career Path result
   `e5c6d3f`, Feedback confirmation `75df3d2`, Auth modal `5065a76`). Every "already-known candidate"
   in the card is verified fixed by them except none — see rows 4, 26, 31, 33, 38. Nothing is rebuilt.
2. The audit was run with the motion-reviewer's checklist (A: existing motion; B: missing motion) over
   the six areas. The `Agent` tool is not available in this planner session, so the planner ran the
   six area reviews itself from the same `.claude/agents/motion-reviewer.md` checklist; the
   orchestrator's final motion-reviewer pass at the review gate is the independent check.
3. Result: 0 blocker, 0 major, 16 minor, 16 missing. The app's shells (Stage, ModalHost/Modal,
   EndSequence, GameResult, OnlineMatch phases) already animate; what is left is conditional blocks
   and labels that bypass them. The fixes are small wrappers using only `SwapText`, `AnimatedNumber`,
   `AnimatePresence` + the shared `swap`/`fadeIn`/`popIn` variants.
4. Highest-impact single fix: `GameFrame.Score` renders a raw number — every live score change in
   every game snaps. One `AnimatedNumber` call (short duration) fixes all 18 renderers at once.
5. 13 findings are fixed in this card (12 missing + 1 minor one-liner); 4 missing findings are
   deferred with written reasons (three inline error lines, grouped into one follow-up so they get
   one consistent `errorIn` treatment; one hard-mode photo toggle at the tail of the impact order).
   All 15 remaining minors are literal-duration/easing tokens or rare paths — deferred, listed.
6. Rule: UI-21 covers text only. The card's requested rule also covers screens and conditional
   blocks, so it is added as **UI-22** (new number; UI-20/UI-21 untouched).
7. Card exemptions honoured: nothing is added to typing feedback, per-keystroke search/validation
   (CodeInput tiles, the switch-game search list), timers (SessionTimer, the Wordle countdown tick)
   or guess confirmation. Admin (area 6) is report-only.

## Audit table (deliverable #1)
Severity per `.claude/agents/motion-reviewer.md`: `blocker` (movement without reduced-motion branch),
`major` (clashing feel / abrupt screen), `minor` (literal tokens, rare paths), `missing` (no motion
where one is expected). "Fixed" rows name the plan step; the `[sonnet]` doc step updates this column
after the build if the engine's outcome differs.

| # | Area | file:line | Severity | What changes | Shared piece to use | Fixed / deferred and why |
|---|---|---|---|---|---|---|
| 1 | 1 home | `src/views/Landpage.tsx:132-135` | missing | `filtered.length === 0 ? <games-empty> : <games-grid3>` snaps when the search crosses zero results | `AnimatePresence mode="wait"` + `swap` variant, keyed `"empty"` / `"grid"` | **fixed** — step 3 |
| 2 | 1 home | `src/components/ui/GameTile.tsx:59` | minor | literal `duration: 0.38`, cubic literal (= `easing.out`) | `easing.out` | deferred — identical curve, no visible change; belongs to a token sweep |
| 3 | 1 home | `src/components/Leaderboard.tsx:106-120` | minor | `.lb-self` row mounts without a fade inside the measured block | `fadeIn` | deferred — the height tween already animates the change; appears once per load |
| 4 | 1 home | `src/components/Leaderboard.tsx:132-134` ("Refreshed x ago", card's `:104`) | verified fixed | `SwapText` keyed per minute string | — | already fixed by `8833a7d` |
| 5 | 1 home | `src/components/modals/LeaderboardModal.tsx:24-74` (incl. `:38-42` "No players yet.") | missing | `loading ? <CourtLoader/> : <list>` snaps; a scope switch (global ↔ friends) snaps twice; the empty line pops | `AnimatePresence mode="wait"` + `swap`, keyed `loading ? "loading" : scope` around the body | **fixed** — step 3 |
| 6 | 1 home | `src/components/Navigation.tsx:133-137` | minor | logout swaps `UserChip` → "Log in" instantly (login side already uses `reveal`) | `fadeIn` | deferred — logout is rare; the auth card chose login-side reveal only |
| 7 | 2 shell | `src/components/ui/GameFrame.tsx:63` (`Score`) | missing | `{value}` is a raw number: every live score change in all 18 renderers snaps | `AnimatedNumber value={value} duration={durations.slow}` | **fixed** — step 2 (highest impact) |
| 8 | 2 shell | `src/views/Trivia/MiniGame.tsx:242-255` | missing | idle: Play button ↔ "You're in a private room." ↔ Wordle countdown ternary snaps (Stage key stays `idle`) | `AnimatePresence mode="wait"` + `swap`, keyed `"lobby"` / `"locked"` / `"play"`; the countdown tick itself stays exempt (timer) | **fixed** — step 2 |
| 9 | 2 shell | `src/components/ui/Stage.tsx:17-22` | minor | literal `0.25` + cubic | `durations`/`easing.out` | deferred — token sweep |
| 10 | 2 shell | `src/components/EndSequence.tsx:30,42,53` | minor | literal `0.16` / `"easeInOut"` | `durations.fast`/`easing` | deferred — shipped feel across 7 games; a retune is an owner call |
| 11 | 2 shell | `src/components/ui/Modal.tsx:41,66` | minor | literal `0.2` / `0.28` + cubic | tokens | deferred — just tuned by `5065a76` |
| 12 | 2 shell | `src/views/Trivia/MiniGame.tsx:284` + `src/styles/MiniGame.css:204` | minor | `.exit-link.is-ended { visibility:hidden }` snaps when an in-place game ends | CSS `opacity` transition on `durations.base` (visibility delayed) | **fixed** — step 2 (one CSS rule) |
| 13 | 3 games | `src/Game Renderers/TicTacToe.tsx:398-408` | missing | multiplayer terminal banner (`Draw!` / `You win!`) pops in | `AnimatePresence` + `popIn` (keep `role="status"`) | **fixed** — step 4 |
| 14 | 3 games | `src/Game Renderers/TicTacToe.tsx:448` (+ `:440` `x{myStealsLeft}`) | missing | confirm label "Claim" ↔ "Steal" snaps; steals-left counter snaps | `SwapText reserveWidth={["Claim","Steal"]}`; `SwapText swapKey={myStealsLeft}` on the count | **fixed** — step 4 |
| 15 | 3 games | `src/Game Renderers/WhoWouldWin.tsx:225` | missing | "Next matchup" → "See results" snaps on the last matchup | `SwapText reserveWidth={["Next matchup","See results"]}` | **fixed** — step 4 |
| 16 | 3 games | `src/Game Renderers/WhoWouldWin.tsx:242-300` | minor | summary frame replaces the play frame: the board has an entrance (`:254-256`, literal 0.25) but Status/Prompt reflow instantly; two return trees | one `GameFrame` with a keyed Board | deferred — RULE 0 forbids a motion wrapper around `GameFrame`; unifying the two trees is a refactor beyond this card; the board entrance already exists |
| 17 | 3 games | `src/Game Renderers/FanFavorites.tsx:265-275` | minor | answer text appears inside the scale pulse | — | deferred — the pulse is the reveal; a fade would double-animate the same event |
| 18 | 3 games | `src/Game Renderers/StartingFive.tsx:73` | minor | image-failure fallback swaps instantly | — | deferred — error fallback inside the card flip |
| 19 | 3 games | `src/Game Renderers/GuessMvps.tsx:135-139` | missing | "Couldn't load player suggestions." pops in and grows `GameFrame.Action` | `AnimatePresence` + `errorIn` | deferred — inline-error group (rows 19, 20, 24, 29): one follow-up, one treatment; error path, not the main flow |
| 20 | 3 games | `src/Game Renderers/Contexto.tsx:236-238` | minor | load-failure note under the spinner pops | `errorIn` | deferred — inline-error group |
| 21 | 3 games | `src/Game Renderers/Contexto.tsx:286-292` | missing | "Name any player to begin." vanishes instantly on the first guess while the row animates in | move the empty block inside the existing `AnimatePresence` as a keyed `motion.div` with `fadeIn` | **fixed** — step 4 |
| 22 | 3 games | `src/Game Renderers/WhoAreYa.tsx:345-356` | missing | Hide/Show photo toggles placeholder ↔ `<img>` instantly (the label already uses `SwapText`) | `AnimatePresence mode="wait"` + `fadeIn`, keyed | deferred — hard-mode toggle, tail of the impact order under the 15-minute build budget; follow-up |
| 23 | 3 games | `src/Game Renderers/PlayOffSeries.tsx:138-139` | missing | "N wins" appears instantly in its reserved line | `SwapText swapKey={showWinner ? "wins" : "blank"}` (keeps the nbsp reservation) | **fixed** — step 4 |
| 24 | 4 modals | `src/components/FriendsPanel.tsx:99` | missing | `actionError` line pops | `errorIn` | deferred — inline-error group |
| 25 | 4 modals | `src/components/FriendsPanel.tsx:101-176` | missing | four tab bodies mount/unmount with no presence: the `SegmentedTabs` thumb slides but the content snaps | `AnimatePresence mode="wait"` + `swap`, one `motion.div key={tab}` | **fixed** — step 5 (no height animation: Modal.tsx height+layout jitter rule) |
| 26 | 4 modals | `src/components/FriendsPanel.tsx:288-296` (card's `:289`) | verified fixed | `EmptyLine` keyed `loading`/`no-match`/`empty` | — | already fixed by `8833a7d` |
| 27 | 4 modals | `src/components/UserProfile.tsx:184,213` | minor | literal `0.5` / `0.4` + cubic | tokens | deferred — token sweep |
| 28 | 4 modals | `Modal.tsx`, `ModalHost.tsx`, `InstructionsModal.tsx`, `MultiplayerInfoModal.tsx`, `GuestPanel.tsx`, `FeedbackModal.tsx`, `LogInSignUp.tsx` | pass | enter + exit present, title via `SwapText`, takeover path reduce-aware; feedback/auth shipped by `75df3d2`/`5065a76` | — | n/a |
| 29 | 5 multiplayer | `src/components/MultiPlayer/FriendPlay.tsx:231` | missing | join error line pops | `errorIn` | deferred — inline-error group |
| 30 | 5 multiplayer | `src/components/MultiPlayer/FriendPlay.tsx:251-254` | missing | "Finish your current game first." / "Cancel matchmaking…" helper appears and disappears, shifting the row | always-rendered `fp-sub` with `SwapText swapKey` + `reserveWidth` (same pattern as the "Copied." line at `:144`) | **fixed** — step 5 |
| 31 | 5 multiplayer | `src/components/MultiPlayer/FriendPlay.tsx:133-146` (card's `:137-141`) | verified fixed | icon + hint both `SwapText`, hint reserves width | — | already fixed by `8833a7d` |
| 32 | 5 multiplayer | `src/components/MultiPlayer/FriendPlay.tsx:213` | minor | "Cancel room" ↔ "Leave room" on host handover | `SwapText` | deferred — rare |
| 33 | 5 multiplayer | `src/components/MultiPlayer/OnlineMatch.tsx:96-99` (card's `:96`) | verified fixed | "Get ready..." / "Loading the game..." / error via keyed `SwapText` | — | already fixed by `8833a7d` |
| 34 | 5 multiplayer | `OnlineMatch.tsx:22-27`, `FriendPlay.tsx:21`, `MultiplayerPanel.tsx:17` | minor | three local `swap` objects (0.34 / 0.24, `EASE` literal) duplicate `variants.swap` | `variants.swap` | deferred — moving to 0.2/0.14 changes the shipped multiplayer feel; variant consolidation follow-up |
| 35 | 5 multiplayer | `src/components/MultiPlayer/OnlineMatch.tsx:411` | minor | switch-game search empty ↔ list per keystroke | — | deferred — per-keystroke (card exemption) |
| 36 | 5 multiplayer | `src/components/MultiPlayer/MultiplayerPanel.tsx:69-75` | missing | the "Play 1v1" button is replaced by a different "Cancel" button instantly on press | one `<Button>` whose label is `SwapText reserveWidth={["Play 1v1","Cancel","In a match"]}`, variant toggled | **fixed** — step 5 |
| 37 | 5 multiplayer | `src/components/MultiPlayer/PlayerCard.tsx:58` | minor | state chip mounts on reconnect | `fadeIn` | deferred — rare |
| 38 | 6 admin | `src/views/Admin.tsx` (34 conditional blocks, 0 `AnimatePresence`), `src/components/admin/FeedbackTab.tsx` (39, 0; `:677` Load more already `SwapText` via `8833a7d`), `FeedbackCharts.tsx` (11, 0) | report only | admin screens swap tabs, loaders and rows without presence | `swap`, `SwapText` | deferred — admin, card says do not fix |

Totals: blocker 0 · major 0 · minor 16 · missing 16 · verified already fixed 5 · pass/report 2.
Fixed in this card: 13 (rows 1, 5, 7, 8, 12, 13, 14, 15, 21, 23, 25, 30, 36). Deferred missing: 4
(rows 19, 22, 24, 29).

## Interfaces
No new components, props or endpoints. Existing pieces only:
- `src/components/motion/SwapText.tsx` — `SwapText({ children, swapKey?, reserveWidth?, className? })`.
- `src/components/motion/AnimatedNumber.tsx` — `AnimatedNumber({ value: number; duration?: number })`;
  `GameFrame.Score` passes `duration={durations.slow}` (0.3 s) so a live score never lags a player action
  (the default 0.9 s is the end-of-game reveal).
- `src/motion/variants.ts` — `swap`, `fadeIn`, `popIn`; `src/motion/tokens.ts` — `durations`, `easing`.
- `framer-motion` `AnimatePresence mode="wait" initial={false}` for every new swap (no entrance on first paint).
- New rule id: `UI-22` in `docs/constraints/UI_SHELL_CONSTRAINTS.md` (text below, step 1).

## File plan
- `docs/constraints/UI_SHELL_CONSTRAINTS.md` — add `## Rule UI-22` after UI-21 and its id in the index; UI-20/21 unchanged.
- `src/components/ui/GameFrame.tsx` — `Score` uses `AnimatedNumber`.
- `src/views/Trivia/MiniGame.tsx` — idle ternary → keyed `AnimatePresence` swap.
- `src/styles/MiniGame.css` — `.exit-link` opacity transition.
- `src/views/Landpage.tsx` — grid ↔ empty swap.
- `src/components/modals/LeaderboardModal.tsx` — loader ↔ list swap keyed by scope.
- `src/Game Renderers/TicTacToe.tsx` — banner presence, Claim/Steal + count `SwapText`.
- `src/Game Renderers/WhoWouldWin.tsx` — Next/See results `SwapText`.
- `src/Game Renderers/Contexto.tsx` — empty block inside the list presence.
- `src/Game Renderers/PlayOffSeries.tsx` — "N wins" `SwapText`.
- `src/components/FriendsPanel.tsx` — tab bodies in one keyed swap.
- `src/components/MultiPlayer/FriendPlay.tsx` — helper line reserved + `SwapText`.
- `src/components/MultiPlayer/MultiplayerPanel.tsx` — single button with `SwapText` label.
- `docs/team/designs/2026-10-07-motion-audit-every-text-and.md` — fixed/deferred column updated after the build.
- `.team/run/motion-audit-every-text-and/build-report.json` — written by the engine.

## Risks
- **A live score that lags play** (row 7): `AnimatedNumber` default is 0.9 s. Prevented: pass
  `durations.slow`; reduced motion sets the value instantly (already in the component).
- **Layout jump during `mode="wait"` swaps** (rows 1, 5, 8, 25): the outgoing pane unmounts before the
  incoming mounts, so the container can collapse for one leg. Prevented: keep the swap inside the
  element that already owns the height (`.idle` column, `.modal-body`, the leaderboard card's measured
  block) and never add `animate={{ height }}` next to `layout` (Modal.tsx jitter rule). For row 8 give
  the swapped slot `min-height` equal to the Play button's height so Play ↔ note never moves the chips.
- **Exit animations that never run** because the parent unmounts first (rows 13, 21): the new
  `AnimatePresence` sits inside the renderer, which stays mounted while the game is on screen.
- **Reduced motion**: every piece used already branches (`SwapText`, `AnimatedNumber`, variants under
  `MotionConfig reducedMotion="user"`); no new `useReducedMotion` call is needed. A hand-rolled
  `animate={{ y }}` outside a shared variant is a review-reject.
- **Card exemptions**: nothing added to the Wordle countdown tick, `SessionTimer`, `CodeInput`, the
  switch-game search list, or any guess submit path. `GameFrame.Score` animates the *result* of a guess.
- **Rule numbering**: UI-22 is appended; the UI-20/UI-21 ids and their index lines are not edited.

## Test plan
Gate 1 (verify): `npm run lint`, `npx next typegen && npx tsc --noEmit`, `npm run build`.
No new unit tests (presentation-only diff; the project has no renderer test harness).

Gate 2 (QA, headless, 390x844 and 1280x800, plus a `prefers-reduced-motion: reduce` run):
```json
[
  { "route": "/", "selector": ".games-grid3 .gtile", "expect": "count>=5" },
  { "route": "/", "selector": ".games-search input", "expect": "visible" },
  { "route": "/series-winner", "selector": ".idle .btn", "expect": "visible" },
  { "flow": "Text swap: on / type 'zzzz' into .games-search input; .games-empty appears through an opacity transition (computed opacity strictly between 0 and 1 on at least one frame) and .games-grid3 is gone afterwards; clear the input and .games-grid3 returns the same way. Under reduced motion the swap completes within one frame. Capture 390x844 and 1280x800." },
  { "flow": "Result/score: open /series-winner, press Play, answer one round. .gf-score-value contains a motion span whose text reaches the new score within 400 ms of the click (poll every 50 ms), and the SubmitGuessPopup still appears in .feedback-slot. Under reduced motion the new score is present on the next frame. Capture both viewports." },
  { "flow": "Modal: on / click the leaderboard 'View all' link. The modal body shows CourtLoader then .lbf-list; the list enters through an opacity transition (opacity strictly between 0 and 1 on at least one frame) and the panel's height never animates (no height change between consecutive frames once the list is visible). Close with Escape: the backdrop fades out. Capture both viewports." },
  { "flow": "Idle swap: open /series-winner signed out; the .idle block shows one Play button and the chips row's top offset is identical before and after the Play button appears (no vertical jump; compare getBoundingClientRect().top of .idle-chips across frames)." },
  { "flow": "Reduced motion: with prefers-reduced-motion: reduce, visit / and /series-winner, open the leaderboard modal; no element inside .modal-panel or .idle reports a non-identity transform mid-transition (sample three frames after each change)." }
]
```
Friends-tab and multiplayer swaps (rows 25, 30, 36) need a signed-in session and the socket server;
the browser-qa agent verifies them by reading the diff (one keyed `motion.div` per swap, variants
from `src/motion/variants.ts`, no literal durations) and skips the live check with a note if no
test account is available.

## Implementation plan
Grouped by area so engines own disjoint files. Budget for steps 2–5 together: ~15 minutes on opus.
If the clock runs out inside step 4 or 5, stop at a file boundary and move the untouched rows to
"deferred (build budget)" in step 6; never leave a half-wrapped `AnimatePresence`.

1. **[sonnet] Rule UI-22.** `docs/constraints/UI_SHELL_CONSTRAINTS.md`: add the id line
   `- RULE UI-22 — Every visible screen or conditional-block change enters and exits through the shared motion system; instant feedback is exempt` to the rule index next to UI-21, and a
   `## Rule UI-22: …` section right after UI-21 (before `## Acceptance checks`) stating: mutually
   exclusive screens/panes use `AnimatePresence mode="wait"` + the `swap` variant keyed per state;
   blocks that appear/disappear (`{cond && <X/>}`) sit in an `AnimatePresence` with `fadeIn`/`popIn`;
   text uses `SwapText` (UI-21); counters use `AnimatedNumber`; exempt: typing feedback, per-keystroke
   validation/search lists, timers, the click itself (animate the result). Include one ❌/✅ pair
   from this card (LeaderboardModal before/after). Done: `grep -c "Rule UI-2[012]"` = 3 section
   headers, UI-20 and UI-21 text byte-identical to `origin/dev`.
2. **[opus] Area 2 game shell** — `src/components/ui/GameFrame.tsx`, `src/views/Trivia/MiniGame.tsx`,
   `src/styles/MiniGame.css`. (a) `Score`: render `<AnimatedNumber value={value} duration={durations.slow} />`
   inside `.gf-score-value` (import from `../motion/AnimatedNumber` and `../../motion/tokens`).
   (b) MiniGame idle: wrap the `inLobby / wordleLocked / Play` ternary in
   `<AnimatePresence mode="wait" initial={false}>` with one `motion.div` child, `variants={swap}`,
   `initial="hidden" animate="visible" exit="exit"`, `key` = `"lobby" | "locked" | "play"`; the slot
   gets `min-height` of the Play button (`.idle-action` or inline style) so `.idle-chips` never moves;
   the countdown text inside the `"locked"` state is untouched. (c) CSS: `.exit-link { transition: opacity .2s ease }`
   and `.exit-link.is-ended { opacity: 0; visibility: hidden; transition: opacity .2s ease, visibility 0s .2s }`.
   Done: `npx tsc --noEmit` clean; a score change in any game counts up in ≤0.3 s; Play ↔ room note
   cross-fades with no chip movement.
3. **[opus] Area 1 home** — `src/views/Landpage.tsx`, `src/components/modals/LeaderboardModal.tsx`.
   (a) Landpage: wrap the `filtered.length === 0` ternary in `AnimatePresence mode="wait" initial={false}`,
   one `motion.div variants={swap}` keyed `"empty"` / `"grid"` (the `games-grid3` div itself becomes the
   motion element so tile keys stay `game.id`). (b) LeaderboardModal: wrap everything below the
   `SegmentedTabs` row in `AnimatePresence mode="wait" initial={false}` with `motion.div variants={swap}`
   keyed `loading ? "loading" : scope`; keep `CourtLoader` and the list as the two states; do not
   animate height. Done: typing a no-match query fades the grid out and the empty line in; opening the
   leaderboard modal and toggling Global ↔ Friends fades loader → list each time; no literal durations.
4. **[opus] Area 3 renderers** — `src/Game Renderers/TicTacToe.tsx`, `WhoWouldWin.tsx`, `Contexto.tsx`,
   `PlayOffSeries.tsx`. TicTacToe: `{terminal && <div className="ttt-banner">}` → `<AnimatePresence>` +
   `motion.div variants={popIn}` (keep `role="status"` and classes); confirm label →
   `<SwapText reserveWidth={["Claim","Steal"]}>{stealMode ? "Steal" : "Claim"}</SwapText>`; the
   `x{myStealsLeft}` span → `<SwapText swapKey={myStealsLeft}>`. WhoWouldWin `:225` →
   `<SwapText reserveWidth={["Next matchup","See results"]}>`. Contexto `:286-292`: move the
   `.cx-empty` block inside the existing `<AnimatePresence initial={false}>` as a
   `motion.div key="empty" variants={fadeIn}` so it exits as the first row enters. PlayOffSeries `:139`:
   `<SwapText swapKey={showWinner ? "wins" : "blank"}>{showWinner ? \`${t.wins} wins\` : " "}</SwapText>`
   keeping the outer reserved span. Done: `npx tsc --noEmit` clean; no new literal `duration:`; the
   feedback popup, timers and input rows of these games are byte-identical.
5. **[opus] Areas 4+5 panels and multiplayer** — `src/components/FriendsPanel.tsx`,
   `src/components/MultiPlayer/FriendPlay.tsx`, `src/components/MultiPlayer/MultiplayerPanel.tsx`.
   FriendsPanel: replace the four `{tab === … && …}` blocks with one
   `<AnimatePresence mode="wait" initial={false}><motion.div key={tab} variants={swap} …>{body}</motion.div></AnimatePresence>`
   where `body` is the existing per-tab JSX (no height animation). FriendPlay `:251-254`: always render
   the `<p className="fp-sub">` with `<SwapText swapKey={searching ? "searching" : blocked ? "blocked" : "none"} reserveWidth={[…both messages]}>`
   and `" "` for the `none` state, mirroring `:144`. MultiplayerPanel `:69-75`: one `<Button>` with
   `variant={mp.phase === "searching" ? "ghost" : undefined}`, `onClick` switching between `leaveMatch`
   and `findMatch`, `disabled={online && mp.phase !== "searching"}`, label
   `<SwapText reserveWidth={["Play 1v1","Cancel","In a match"]} swapKey={…}>`. Done: `npx tsc --noEmit`
   clean; tab switch cross-fades; the Play 1v1 row never changes width; "Play with a friend" is untouched.
6. **[sonnet] Audit table + report.** Update the "Fixed / deferred and why" column of this document to
   the actual build outcome (any row the engine could not finish → "deferred (build budget)" with the
   file:line), and make sure every player-facing row (areas 1–5) reads either **fixed** or a written
   reason. Write `.team/run/motion-audit-every-text-and/build-report.json` `assumed` noting: the card's
   `2026-10-03-motion-audit.md` filename is this file; the `Agent` tool was unavailable to the planner so
   the six area reviews were run from the motion-reviewer checklist by the planner, and the review-gate
   motion-reviewer pass is the independent check. Done: every row in the table has a non-empty last
   column; `grep -c "\*\*fixed\*\*"` equals the number of rows the build touched.

The final motion-reviewer run over the whole diff (`verdict: pass`) is the orchestrator's review gate,
not a plan step.
