# Who Would Win: fix the overlap, add Skip, crowd-based points, end in place

Task: `who-would-win-fix-the-overlap` (Notion `3ee2cfb1-c595-8169-8b8e-feaa8c157be3`, frontend + backend, P0).
Classify: `hard`, areas `frontend`/`backend`/`games`/`ui`, risk `low`, provisional engine `opus`, plan `fable`.
Base: `dev` 87b81b0. Design round run by the planner-architect on 2026-10-04 (one pass).

Sources read: the brief, the attachment screenshot, `src/Game Renderers/WhoWouldWin.tsx`,
`src/styles/WhoWouldWin.css`, `src/styles/ui.css` (`.gf-*`, `.endseq`, `.scorepanel`, `.btn-*`),
`src/components/EndSequence.tsx`, `src/components/ScorePanel.tsx`, `src/components/ui/Button.tsx`,
`src/Game Renderers/WhoAreYa.tsx` (the in-place exemplar), `src/views/Trivia/MiniGame.tsx`
(`onGameEnd`/`awardPoints`/idle chips), `src/components/MultiPlayer/{OnlineMatch,FriendPlay}.tsx`,
`backend/trivia/views.py` (`log_session`), `backend/trivia/tests/test_score_award.py`,
`scripts/game-result-allowlist.json`, `docs/GAME_DESIGN_CONSTRAINTS.md` §7b / Rules 7.0-7.3 / Accepted
deviations.

## Decision summary

**Engine: mixed** — `[opus]` on the renderer's state/flow rewrite (points + end sequence), `[sonnet]`
on CSS, the action row, the points module + its unit test, the backend cap + test, catalog copy,
multiplayer gating and docs.

1. **Overlap**: the cards stop being a fixed-`min-height` flex child that cannot shrink. `.www-card`
   becomes `flex: 1 0 auto; min-height: 0` (grows into spare space, never shrinks below its content)
   and `.www-arena` gets `overflow-y: auto` — it is the fill scroller Rule 4.1 says a `GameFrame fill`
   game must have (today it has none). The `.www-note` row in the Action slot is **deleted**; its three
   states move: "Counting votes…" spinner and the error line render inside the picked card's reserved
   `.www-split` area (zero extra height, Rule 6.2); the "Tap a side" hint is dropped (the prompt title
   already says it); the screen-reader live text stays as a visually-hidden `aria-live` span inside the
   board.
2. **Action row**: one `.www-actions` flex row, always mounted, `[Skip]` (`Button variant="secondary"`,
   fixed width) left and `[Next matchup | See results]` (`primary`, `flex: 1`) right, both `size="md"`
   (46px). States only toggle `disabled`; the row is 46px in every state. Skip before a vote advances
   with a `choice: null` record; after a vote Skip is disabled and Next enabled (Next is enabled as soon
   as the pick lands, not when the tally lands — unchanged from today).
3. **Points**: pure `pointsFor(choice, tally)` in a new dependency-free module
   `src/utils/whoWouldWinPoints.ts` that exports `WWW_POINTS_MAJORITY = 20`, `WWW_POINTS_MINORITY = 5`,
   `WWW_MATCHUPS = 10`, `WWW_MAX_POINTS = 200`. The renderer imports the constants at its top (the
   spec's "top of the renderer" is honoured by the import line + a comment; the module exists so the
   spec's unit test can run under `node --experimental-strip-types` without JSX/framer). Rule: `null`
   choice → 0; tally missing or `"error"` → majority (the player voted; a network fault never costs
   points, and the backend cap bounds abuse); else `mine >= other` → majority, otherwise minority. The
   running total shows in `GameFrame.Status` `right={<GameFrame.Score value={score} />}` — the first
   time this game has a right slot, which is what makes the points visible during play.
4. **End in place**: the summary screen, "Finish" and the second `GameResult` go. After the last
   matchup "See results" keeps the same `GameFrame fill`; the Board swaps the arena for the
   per-matchup list (the "final board" Rule 7.3 talks about), the Action slot is `EndSequence`
   `input → loader (1.5s, waits for the last tally) → score`, and `onGameEnd(score, { inPlace: true })`
   fires once when the loader ends. The score slot is `<ScorePanel score outOf={200} onPlayAgain
   onClose />` with **no label** (Rule 7.1 — the list already shows per-matchup outcomes; no "sided with
   the crowd N/M"). The shell is a fixed-height fill box, so swapping board content costs zero pixels
   (Rule 6.2); `.endseq` min-height 46px equals the action row, so the bottom swap costs zero too.
5. **Backend**: `PER_GAME_MAX_POINTS = {"who-would-win": 200}` next to `MAX_SESSION_POINTS`;
   `log_session` clamps `score` to `min(score, PER_GAME_MAX_POINTS.get(game, MAX_SESSION_POINTS))`.
   Clamp, not 4xx: it is the same semantic as the global cap (the GameSession row still records the
   attempt, no `data.error` alert for a real player) and nothing above 200 is ever awarded — see
   DECISIONS.
6. **Multiplayer**: both pickers list `visibleGames` minus `coming-soon`; Who Would Win is **not** gated
   today. Add `g.id !== "who-would-win"` to both filters with a one-line comment (no turn/score logic in
   the renderer; a room would score 0-0). `gameEndpoints.js` keeps its entry (harmless, read-only data).

## Interfaces

```ts
// src/utils/whoWouldWinPoints.ts  (new, no imports)
export const WWW_POINTS_MAJORITY = 20;   // your side has >= the other side's votes (majority, tie, first voter)
export const WWW_POINTS_MINORITY = 5;    // your side has fewer votes
export const WWW_MATCHUPS = 10;
export const WWW_MAX_POINTS = WWW_MATCHUPS * WWW_POINTS_MAJORITY; // 200
export type WwwSide = "a" | "b";
export interface WwwTally { a: number; b: number }
/** Points for one matchup from the tally AFTER the player's vote is counted. */
export function pointsFor(choice: WwwSide | null, tally: WwwTally | "error" | undefined): number;
```

```ts
// src/Game Renderers/WhoWouldWin.tsx
interface WhoWouldWinProps { gameInfo: WwwMatchup[]; onGameEnd: OnGameEnd; onPlayAgain?: () => void; onClose?: () => void }
interface PickRecord { qid: string; choice: Side | null }        // null = skipped
type Phase = EndSequencePhase;                                     // "input" | "loader" | "score"
// derived: score = picks.reduce((s, p) => s + pointsFor(p.choice, tallies[p.qid]), 0)
// end: onGameEnd?.(finalScore, { inPlace: true })  — exactly once, from the loader timer
```

```tsx
// RenderGame.tsx case "who-would-win"
<WhoWouldWin gameInfo={…} onGameEnd={onGameEnd} onPlayAgain={onPlayAgain} onClose={onClose} />
```

```python
# backend/trivia/views.py
PER_GAME_MAX_POINTS = {"who-would-win": 200}   # highest honest score: 10 matchups x 20
# in log_session, replacing the single clamp line:
score = min(score, PER_GAME_MAX_POINTS.get(game, MAX_SESSION_POINTS))
```

```ts
// src/utils/GameUtils.tsx — who-would-win entry
pointsPerCorrect: 20, maxPoints: 200, roundsLabel: "10 matchups"   // rules[2] + instruction "Reward" copy describe the crowd points
```

Markup the QA selectors rely on: `.www-actions` (row), `.www-skip` (Skip button class), `.www-next`
(Next/See results), `.www-arena`, `.www-card`, `.www-split`, `.www-summary-list`, `.www-summary-row`,
`.www-summary-pts` (per-row `+20`/`+5`/`0` in `.tnum`), `.scorepanel`.

## File plan

| File | Change |
|---|---|
| `src/utils/whoWouldWinPoints.ts` | new: constants + `pointsFor` |
| `scripts/test-www-points.mjs` | new: node test (majority, tie, first voter, minority, skip, error/pending) |
| `package.json` | add `"test:www-points": "node --experimental-strip-types scripts/test-www-points.mjs"` |
| `src/styles/WhoWouldWin.css` | arena scroller, content-sized cards, delete `.www-note*`, add `.www-actions`/`.www-skip`/`.www-next`, split-area loading/error text, `.www-summary-pts`; drop `.www-agree` |
| `src/Game Renderers/WhoWouldWin.tsx` | Skip, points, Score slot, EndSequence/ScorePanel end-in-place, summary list in the board, delete summary screen/Finish |
| `src/Game Renderers/RenderGame.tsx` | pass `onPlayAgain`/`onClose` to WhoWouldWin |
| `src/utils/GameUtils.tsx` | `pointsPerCorrect: 20`, `maxPoints: 200`, rules/instruction copy |
| `scripts/game-result-allowlist.json` | remove the `who-would-win` entry (stale-entry check) |
| `src/components/MultiPlayer/OnlineMatch.tsx` | exclude `who-would-win` from the switch picker + comment |
| `src/components/MultiPlayer/FriendPlay.tsx` | exclude `who-would-win` from the room picker + comment |
| `backend/trivia/views.py` | `PER_GAME_MAX_POINTS`, per-game clamp in `log_session` |
| `backend/trivia/tests/test_score_award.py` | per-game cap tests |
| `docs/GAME_DESIGN_CONSTRAINTS.md` | Accepted deviations rows for Who Would Win |

## Risks

- **Overlap persists on 320x568** — the arena now scrolls (`overflow-y: auto`) and cards never shrink
  below content (`flex-shrink: 0`), so text can only scroll, never overlap. Done-check measures
  `card.bottom <= arena.bottom` and `arena.scrollHeight` vs `clientHeight`.
- **`onGameEnd` fires twice / with a stale tally** — single `endedRef` guard; the loader waits for the
  in-flight `castVote` promise (`pendingVoteRef`) with a 1.5s floor; the tally timeout (8s) already
  bounds the wait; `sessionRef` invalidates in-flight work on play-again/unmount as today.
- **Score shown during play drifts from the final score** — both derive from the same
  `pointsFor` over `picks` + `tallies`, no separate accumulator.
- **`npm run check:games` fails** — the allowlist entry is removed in the same change and the call
  site literally contains `{ inPlace: true }`.
- **Backend clamp changes other games** — `.get(game, MAX_SESSION_POINTS)` leaves every other game on
  the global cap; the existing `test_inflated_score_is_clamped` (wordle) proves it.
- **Multiplayer regression** — change is two filter predicates; `gameEndpoints.js` untouched.
- **Button focus** — the chosen card is disabled after a pick, which drops focus; keep the existing
  `nextRef.focus()` effect pointing at the Next button.

## Test plan

Gate 1 (verify script): `npm run lint` (includes `check:games`), `npx next typegen && npx tsc --noEmit`,
`npm run build`, `cd backend && DATABASE_URL="" python manage.py test`.
Engine runs before reporting: `npm run test:www-points`, `python manage.py test trivia.tests.test_score_award`.

New tests the engine must add:
- `scripts/test-www-points.mjs`: `pointsFor("a", {a:5,b:3}) === 20` (majority), `("a",{a:4,b:4}) === 20`
  (tie), `("a",{a:1,b:0}) === 20` (first voter), `("b",{a:6,b:2}) === 5` (minority),
  `(null, {a:9,b:1}) === 0` (skip), `("a","error") === 20` and `("a", undefined) === 20`
  (error/pending), `WWW_MAX_POINTS === 200`.
- `test_score_award.py`: `test_who_would_win_is_capped_at_its_own_ceiling` (score 999 → awarded 200),
  `test_who_would_win_honest_max_is_awarded_in_full` (200 → 200), existing wordle clamp test stays
  (global cap unchanged).

Gate 2 QA assertions (`.team/run/<slug>/brief.md`):
```json
[
  { "route": "/who-would-win", "selector": ".idle-chips", "expect": "text:up to 200 pts" },
  { "route": "/who-would-win", "selector": ".idle-chips", "expect": "text:10 matchups" },
  { "flow": "At 360x640 and 390x844: open /who-would-win, press Play. Before voting: .www-actions holds .www-skip (secondary, enabled) left and .www-next (primary, disabled, text 'Next matchup') right; no 'Early votes' or 'Tap a side' text anywhere; every .www-card bottom <= .www-arena bottom; no text node overlaps another (compare bounding boxes of .www-card-label, .www-card-sub, .www-split, .www-actions). Screenshot." },
  { "flow": "Tap the first card. .www-split of the tapped card shows a spinner then 'N% · N vote(s)'; .www-skip becomes disabled, .www-next enabled; .www-actions height and top are identical before and after the vote (within 1px); the status row right slot shows a score of 20 or 5. Screenshot with the split visible." },
  { "flow": "Press Skip on the next matchup: the matchup index advances, the score does not change, no vote request (POST /trivia/log-guesses/) is sent for it." },
  { "flow": "Vote or skip through to matchup 10/10; the button reads 'See results'. Press it: the same frame stays (no screen change, .stage-inner height unchanged within 1px), a spinner shows for ~1.5s, then .www-summary-list shows 10 .www-summary-row rows (skipped rows read 'skipped', others 'with the crowd' or 'crowd took …' with +20/+5) and .scorepanel shows '<score>/200 pts' above Play again + Close game; the text 'sided with the crowd' does not appear; .exit-link is hidden. Screenshot at 360x640 and 390x844." },
  { "flow": "Multiplayer: open the Play Online switch-game picker and the friend-room game picker; 'Who Would Win?' is listed in neither." }
]
```

## Implementation plan

Frontend (steps 1-7) and backend (step 8) touch disjoint files and can run in parallel; step 9 (docs)
and step 10 (report) last.

1. `[sonnet]` **Points module + unit test.** Create `src/utils/whoWouldWinPoints.ts` with the four
   constants, the `WwwSide`/`WwwTally` types and `pointsFor` exactly as in Interfaces (`null` → 0;
   `undefined`/`"error"` → `WWW_POINTS_MAJORITY`; `mine >= other` → majority else minority). Create
   `scripts/test-www-points.mjs` (same `node --experimental-strip-types` style as
   `scripts/test-game-data.mjs`, plain `assert`) covering majority, tie, first voter, minority, skip,
   error, pending and `WWW_MAX_POINTS === 200`; add `"test:www-points"` to `package.json` scripts.
   Done: `npm run test:www-points` exits 0.
2. `[sonnet]` **CSS: arena, cards, action row, summary.** In `src/styles/WhoWouldWin.css`:
   `.www-arena` add `overflow-y: auto` (keep `flex: 1 1 0; min-height: 0`); `.www-card` → `flex: 1 0 auto;
   min-height: 0` (remove the `96px` floor); delete `.www-note`, `.www-note-row`, `.www-agree` (keep
   `.www-sr`); add `.www-split-state` (12px muted, inline-flex, gap 6px, for the spinner/error line
   inside `.www-split`); add `.www-actions { display:flex; gap:10px; width:100%; max-width:420px }`,
   `.www-skip { flex: 0 0 auto; min-width: 96px }`, `.www-next { flex: 1 1 auto; min-width: 0 }`; add
   `.www-summary-pts { flex:none; width: 34px; text-align:right; font-size:12px; font-weight:700;
   color: var(--brand) }` and `.www-summary-row.is-skipped .www-summary-pts { color: var(--muted) }`.
   Remove `.www-btn`. Done: file has no `min-height: 96px`, no `.www-note`, and `.www-arena` has
   `overflow-y: auto`.
3. `[opus]` **Renderer: Skip + points + score slot.** In `src/Game Renderers/WhoWouldWin.tsx`: import
   the constants and `pointsFor` from `../utils/whoWouldWinPoints` at the top (comment: "scoring
   constants live in whoWouldWinPoints.ts so the node test can import them"); `PickRecord.choice`
   becomes `Side | null`; add `handleSkip` (guard `picked || phase !== "input"`; push `{qid, choice: null}`,
   advance like `handleNext` without a vote; on the last matchup it triggers the end flow of step 4);
   derive `score` from `picks` + `tallies` via `pointsFor`; render `GameFrame.Status` with
   `left={MATCHUP i/N}` and `right={<GameFrame.Score value={score} />}`; delete `EARLY_VOTES`, `note`
   and the whole `.www-note` block; move the loading spinner (`<Spinner size={14} /> Counting votes…`)
   and the error text ("No split yet") into the picked card's `.www-split` as `.www-split-state`
   (unpicked cards keep the empty reserved area); keep `srNote` as the `.www-sr` live region, now a
   child of `GameFrame.Board`. Replace the single `Button` with
   `<div className="www-actions"><Button variant="secondary" size="md" className="www-skip" disabled={!!picked} onClick={handleSkip}>Skip</Button><Button ref={nextRef} size="md" className="www-next" disabled={!picked} onClick={handleNext}>{last ? "See results" : "Next matchup"}</Button></div>`.
   Done: at 390x844 Skip advances without a POST and the score stays; a vote shows 20 or 5 in the
   status right slot; the `.www-actions` rect is identical before/after the vote.
4. `[opus]` **Renderer: end in place.** Same file: delete `showSummary`, the summary `return` block and
   `handleFinish`; add `phase: EndSequencePhase` state (reset to `"input"` on `gameInfo` change) and
   `pendingVoteRef` (the promise returned by `castVote`, cleared when it settles); `handleNext`/`handleSkip`
   on the last matchup set `phase = "loader"` and `later(...)` after
   `Promise.race([pendingVoteRef.current, delay(TALLY_TIMEOUT_MS)])` with a 1500ms floor: compute
   `finalScore` with `pointsFor` from the current `tallies`, guard with `endedRef`, call
   `onGameEnd?.(finalScore, { inPlace: true })`, set `phase = "score"`. Timers go through a
   `timersRef` cleared on `gameInfo` change and unmount (WhoAreYa pattern). When `phase !== "input"`,
   the Board renders the `.www-summary-list` (existing rows; crowd text: `"skipped"` for `choice ===
   null` with class `is-skipped`, else `"with the crowd"` / `` `crowd took ${theirs.label}` `` /
   `"split unknown"`; append `<span className="www-summary-pts tnum">+20|+5|0</span>`) instead of the
   arena; Status left reads `MATCHUPS COMPLETE`, Prompt title `How you voted` (no count), ProgressBar
   full. The Action slot is `<EndSequence phase={phase} input={actionsRow} score={<ScorePanel score={finalScore} outOf={WWW_MAX_POINTS} onPlayAgain={onPlayAgain} onClose={onClose} />} />`.
   Add `onPlayAgain`/`onClose` to the props. Done: `grep -c "inPlace: true" WhoWouldWin.tsx` = 1;
   `grep -c "GameResult\|handleFinish\|showSummary\|sided with" WhoWouldWin.tsx` = 0; in the browser the
   end shows the list + `N/200 pts` above the two buttons with no frame height change.
5. `[sonnet]` **Wiring + allowlist.** `src/Game Renderers/RenderGame.tsx` case `"who-would-win"`: pass
   `onPlayAgain={onPlayAgain} onClose={onClose}` (as the `"who-are-ya"` case does). Remove the
   `"who-would-win"` key from `scripts/game-result-allowlist.json`. Done: `npm run check:games` exits 0.
6. `[sonnet]` **Catalog entry.** `src/utils/GameUtils.tsx` who-would-win: `pointsPerCorrect: 20`,
   `maxPoints: 200`, keep `roundsLabel: "10 matchups"`; rules[2] → "Side with the crowd for 20 points, go
   against it for 5. Skip a matchup for 0."; instruction `Reward` → "20 points when your side has at
   least as many votes as the other, 5 when it has fewer. Skips earn nothing. Up to 200." Done: the idle
   screen shows the `up to 200 pts` chip (gate 2 assertion).
7. `[sonnet]` **Multiplayer gating.** `src/components/MultiPlayer/OnlineMatch.tsx` (`others` filter,
   ~:383) and `src/components/MultiPlayer/FriendPlay.tsx` (room picker filter, ~:191): add
   `&& g.id !== "who-would-win"` with the comment `// who-would-win has no turn/score logic for rooms
   (both players would score 0)`. Done: `grep -n 'who-would-win' OnlineMatch.tsx FriendPlay.tsx` shows
   one hit each; neither picker lists it in the browser.
8. `[sonnet]` **Backend per-game cap + tests.** `backend/trivia/views.py`: add `PER_GAME_MAX_POINTS =
   {"who-would-win": 200}` directly under `MAX_SESSION_POINTS` with a two-line comment (highest honest
   score; other games stay on the global cap), and change the clamp in `log_session` to
   `score = min(score, PER_GAME_MAX_POINTS.get(game, MAX_SESSION_POINTS))`. In
   `backend/trivia/tests/test_score_award.py` add `test_who_would_win_is_capped_at_its_own_ceiling`
   (`_finish(game="who-would-win", score=999)` → `awarded == 200`, `points() == 200`) and
   `test_who_would_win_honest_max_is_awarded_in_full` (`score=200` → 200). Done:
   `cd backend && DATABASE_URL="" python manage.py test trivia.tests.test_score_award` passes, then the
   full `python manage.py test`.
9. `[sonnet]` **Docs.** `docs/GAME_DESIGN_CONSTRAINTS.md` Accepted deviations (~:874-893), after
   `git fetch origin dev && git merge origin/dev` of this file only if it conflicts: change the
   "Fan Favorites, SuperDraft, Contexto, Who Would Win | correct-feedback copy" row to drop Who Would
   Win and add a row `| Who Would Win | no per-matchup feedback popup; points show in the status Score
   slot and the split bar | there is no right answer to flash — the crowd split is the feedback |`;
   keep the `color: #fff` and `stays a fill game` rows; add `| Who Would Win | ends in place with the
   per-matchup list as the final board, no "sided with the crowd N/M" count | Rule 7.1 — the rows carry
   the outcome |`. Done: `grep -c "Who Would Win" docs/GAME_DESIGN_CONSTRAINTS.md` ≥ 4 and no row still
   says the game has no points.
10. `[sonnet]` **Build report.** Run `npm run test:www-points` and the backend suite once more, then
    write `.team/run/who-would-win-fix-the-overlap/build-report.json` with `did`, `assumed` (the
    error/pending → majority rule, the clamp-not-reject reading, the points module location) and
    `touched` listing every file in the File plan. Done: file exists and parses.
