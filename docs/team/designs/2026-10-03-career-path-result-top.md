# Career Path: result at the top, see full career or the answer, drop the stops count

Task: `career-path-result-top` (Notion `3ee2cfb1-c595-8112-ae33-f2f4990ea8d7`, frontend, P0).
Classify: `hard`, areas `frontend`/`ui`/`games`, risk `low`, provisional engine `opus`, plan `fable`.
Base: `origin/dev` 8eee5ed. Design round run by the planner-architect on 2026-10-03.

How this round was run: the cloud planner has no agent-spawning tool in this session
(`ListAgents` shows only the planner), so the two layout proposals below were written by the
planner from `.claude/agents/frontend-engine.md`, the constraint docs and a full read of
`src/Game Renderers/CareerPath.tsx`, `src/styles/CareerPath.css`, `EndSequence.tsx`,
`ScorePanel.tsx`, `GameResult.tsx`, `GameFrame.tsx`, `ui.css`, `src/motion/*` and the two
attachment screenshots. The sign-off pass is the planner's own objection check against the same
sources. The `impeccable:impeccable` skill is not installed in this environment; the frontend
guidance applied is `docs/GAME_DESIGN_CONSTRAINTS.md` (which, per `frontend-engine.md`, outranks
any generic design skill for `Game Renderers/*` anyway).

## Decision summary

**Engine: mixed** — `[opus]` on the renderer, motion and shared-component steps, `[sonnet]` on the
CSS-only, docs and cleanup steps (per-step tags in `## Implementation plan`).

Chosen layout: **Proposal A — "same five slots, the content swaps".** Every `GameFrame` slot stays
mounted from first guess to Play again, and each slot's content has the same box height in play
and at the end, so the frame never changes height — not when the result appears, not when the
answer is revealed, not when the career is shown (Rule 6.2 and card requirement 5 hold by
construction, no layout animation needed).

```
PLAY                                          END (win)                    END (loss)
TRACE THE CAREER        5 guesses left        That's him!  500/600 pts     Out of guesses  0/600 pts   <- Status (22px; end = lone-left, centred, springs in)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━        ━━━━━━━━━━━━━━━━━━━━━━━━     ━━━━━━━━━━━━━━━━━━━━━━━━    <- ProgressBar (unchanged)
      One career, card by card                    ( SEE FULL CAREER )          ( SEE THE ANSWER )      <- Prompt (22px; end = chip toggle, SwapText label)
┌──────────────────────────────┐              ┌──────────────────────┐     ┌──────────────────────┐
│ [card][card][card]... (rail) │              │     [headshot]       │     │ [card][card][card]   │   <- Board: .cp-stage grid, rail + answer pane
│                              │              │ The journey belonged │     │  all face-up (rail)  │      share one cell; the inactive pane is
└──────────────────────────────┘              │   to  Eric Montross  │     └──────────────────────┘      faded out + visibility:hidden
                                              └──────────────────────┘
[ Who is it?…        ][Confirm]                 [Play again][Close game]      [Play again][Close game]  <- Action: EndSequence input -> score (46px both)
```

- Header: `"{n} guesses left"` only (`"1 guess left"` singular), wrapped in `SwapText` so the number
  change slides. No "stops" text anywhere.
- The result is the shared score line (`ScoreLine`, extracted from `ScorePanel`, points via
  `AnimatedNumber`) placed in the Status slot's left position (lone-left centres it, Rule 4.2a),
  entering with GameResult's spring, now a token (`springs.result`) and a shared variant
  (`resultIn`) that `GameResult` itself consumes.
- One toggle, a 22px chip button in the Prompt slot (the eyebrow's row), label swapped with
  `SwapText`: it reads **"See full career"** while the answer pane is showing and **"See the
  answer"** while the rail is showing. Win: answer pane by default. Loss: rail by default (every
  card is already face-up on a loss — the last miss cannot flip anything).
- "See full career" on a win swaps to the rail and runs the existing 260 ms flip cascade over the
  still-face-down cards only (Rule 7.2); the existing `scrollIntoView` effect pans the rail to each
  newly flipped stop ("scrolled to show every stop"). On a loss there is nothing to flip; the swap
  alone brings the rail back.
- Play again + Close game are `ScoreActions` (the second half of `ScorePanel`) in the EndSequence
  score slot: btn-sm 38px inside the 46px `.endseq` minimum, same height as the md input row.
- No loader beat: Career Path goes `input -> score` directly. The reveal is player-driven, so there
  is nothing to calculate behind a spinner, and the owner's ">400 ms before a button is pressable"
  rule cannot be met with the §7b 1.5 s loader. Recorded as an accepted deviation (docs step).
- `EndSequence` is untouched. `ScorePanel` is split into `ScoreLine` + `ScoreActions` with the
  default export composing both, so Who Are Ya, Starting Five, Fan Favorites and Heatmap keep their
  markup; their score number now counts up through `AnimatedNumber` (the one shared behaviour change,
  deliberate — see Decisions).
- Rule 6.3 fix folded in because the handler is being rewritten: the losing guess flashes the
  ordinary `"Not him."` instead of `"Out of guesses"` (the result line says it 100 ms later).

### Proposal A — "same five slots, the content swaps" (frontend engine, chosen)

Interface: no new GameFrame slots. Status left = result line at end; Status right = counter
during play, omitted at end; Prompt eyebrow = `SwapText` between the eyebrow text and the toggle
chip; Board = `.cp-stage` grid with two always-mounted panes (`.cp-rail`, `.cp-answer`) in the same
cell; Action = `EndSequence` with `ScoreActions` as the score content. Data shapes: one new
renderer state `view: "career" | "answer"`. Files: `CareerPath.tsx`, `CareerPath.css`,
`ScorePanel.tsx` (+ `ui.css` one rule), `tokens.ts`, `variants.ts`, `GameResult.tsx` (3 lines).
Risks: `visibility` via framer `transitionEnd` on an `initial={false}` mount (mitigated by a CSS
fallback on `.cp-pane:not(.is-active)`); the 22px status row is a per-game content height that must
be equal in both phases (set explicitly in CSS, asserted in QA).

### Proposal B — "result panel replaces the header" (rejected)

At the end, Status + ProgressBar + Prompt are replaced by one bordered result card (headline, big
points, the toggle, Play again/Close), the rail stays below it and the answer slides in under the
rail. Rejected: three GameFrame children become one, so the root's 20px gaps and the slot heights
change at the phase switch — the frame height jumps unless the three slots are wrapped in a
per-game `.cp-head` (forbidden by Rule 0 / `CareerPath.css` header comment) or animated with a
`layout` prop on the shared `GameFrame` div (shared file, and the motion reviewer's check 4 warns
against height animation on a container whose children also animate). The answer under the rail
also needs a reserved ~70px band that sits empty on a loss until pressed, or a conditional mount
(both ❌ under Rule 6.2). It also puts Play again above the cards, which reads as an action before
the evidence. A third variant (answer in a reserved band inside the result with a silhouette
placeholder, two separate buttons) was considered and dropped for the same reserved-band reason
and because the card asks for one toggle whose label swaps.

### Why A wins
Zero container resize in every transition with no measurement and no layout animation; every
slot keeps GameFrame's rhythm; every moving part is a shared piece (`SwapText`, `AnimatedNumber`,
`swap`-derived pane variant, `popIn`, `fadeInUp`, `resultIn`/`springs.result`); the other four
in-place games are untouched in markup; and the toggle sits directly above the thing it switches.

## Interfaces (exact names and types)

`src/motion/tokens.ts` — add to `springs`:
```ts
// GameResult's score-reveal entrance (scale .9 / y 10 -> settled); every result line that
// springs in at the end of a game uses it.
result: { type: "spring", stiffness: 240, damping: 22 },
```

`src/motion/variants.ts` — add:
```ts
// End-of-game result entrance (GameResult's spring): the score springs in from slightly below
// and slightly smaller. In-place games use it on their result line too.
export const resultIn: Variants = {
  hidden: { opacity: 0, scale: 0.9, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: springs.result },
};

// Two always-mounted panes sharing one grid cell: a view toggle that must not change the
// container's height (GAME_DESIGN_CONSTRAINTS Rule 6.2). The leaving pane fades/slides out on
// swap's exit timing and ends visibility:hidden; the arriving pane waits that long, enters on
// swap's entrance, and releases its own variant children (popIn / fadeInUp) at the same moment.
export const stackPane: Variants = {
  hidden: {
    opacity: 0, y: 14, scale: 0.985,
    transition: { duration: durations.fast, ease: easing.in },
    transitionEnd: { visibility: "hidden" },
  },
  visible: {
    opacity: 1, y: 0, scale: 1, visibility: "visible",
    transition: { duration: durations.base, ease: easing.out, delay: durations.fast, delayChildren: durations.fast },
  },
};
```

`src/components/ScorePanel.tsx` — three exports, same file, same CSS classes:
```ts
export interface ScoreLineProps { score: number; label?: string; outOf?: number; won?: boolean }
/** The score line alone: <div class="scorepanel-line"> label? + <span class="scorepanel-pts tnum"><AnimatedNumber value={score}/>{outOf != null ? `/${outOf}` : ""} pts</span> */
export function ScoreLine(props: ScoreLineProps): JSX.Element

export interface ScoreActionsProps { onPlayAgain?: () => void; onClose?: () => void }
/** Play again + Close game in <div class="scorepanel-actions">; returns null when neither handler is given. */
export function ScoreActions(props: ScoreActionsProps): JSX.Element | null

/** Unchanged contract for existing callers: <div class="scorepanel"><ScoreLine/><ScoreActions/></div> */
export default function ScorePanel(props: ScoreLineProps & ScoreActionsProps): JSX.Element
```
`src/styles/ui.css` — add after `.scorepanel-pts`: `.scorepanel-actions { display: flex; gap: 10px; }`
(replaces the inline `style={{ display: "flex", gap: 10 }}`).

`src/components/GameResult.tsx` — the result `motion.div` uses `variants={resultIn}
initial="hidden" animate="visible"` instead of its literal `initial`/`transition` (same values, now
tokens). No other change.

`src/Game Renderers/CareerPath.tsx` — state and handlers:
```ts
type View = "career" | "answer";
const [view, setView] = useState<View>("career");                 // new
// bottomPhase keeps its EndSequencePhase type; Career Path uses only "input" and "score".

/** Flip every still-face-down card with the existing 260 ms cascade (Rule 7.2: only the unearned ones). */
const revealRest = () => {
  const remaining = stints - flipped;
  for (let i = 0; i < remaining; i++) later(() => setFlipped((f) => Math.min(f + 1, stints)), 260 + i * 260);
};
/** The end, synchronous (no `later`): result line, default pane, buttons — all in one render. */
const finish = (score: number, won: boolean) => {
  onGameEnd?.(score, { inPlace: true });
  setEndState({ score, won });
  setView(won ? "answer" : "career");
  setBottomPhase("score");
};
const toggleView = () => {
  if (view === "answer") { setView("career"); revealRest(); } else { setView("answer"); }
};
```
Removed from the renderer: the `"stops"` text, the loss-only `.cp-reveal` block after
`EndSequence`, the `bottomPhase = "loader"` calls, the win-time cascade and the `700 ms` /
`1500 ms` end delays. `RevealHeadshot` keeps its signature and class names.

CSS contract (`src/styles/CareerPath.css`), heights that make the frame static:

| Slot | Play content | End content | Box |
|---|---|---|---|
| Status left | `GameFrame.Label` (11px) | `.cp-result` (lone, centred) | `.cp-result { height: 22px }` |
| Status right | `.cp-counter` | omitted (`undefined`) | `.cp-counter { height: 22px }` |
| Prompt eyebrow | `.cp-eyebrow` text | `.cp-toggle` chip | both `height: 22px; display: inline-flex; align-items: center` |
| Board | `.cp-stage` > `.cp-rail.cp-pane` + `.cp-answer.cp-pane` | same nodes, `is-active` moves | `grid-area: 1 / 1` on both panes |
| Action | `GameFrame.InputRow` (46px, `btn-md`) | `ScoreActions` (38px) in `.endseq` (min 46px) | unchanged |

## File plan

| File | Change |
|---|---|
| `src/motion/tokens.ts` | `springs.result` |
| `src/motion/variants.ts` | `resultIn`, `stackPane` |
| `src/components/GameResult.tsx` | consume `resultIn` (3 lines) |
| `src/components/ScorePanel.tsx` | split into `ScoreLine` + `ScoreActions` + default `ScorePanel`; `AnimatedNumber` on the score |
| `src/styles/ui.css` | `.scorepanel-actions` |
| `src/Game Renderers/CareerPath.tsx` | header, result line, toggle, stage panes, end flow, 6.3 copy |
| `src/styles/CareerPath.css` | status/prompt 22px boxes, `.cp-stage`/`.cp-pane`/`.cp-answer`/`.cp-toggle`, answer sizing; drop `.cp-reveal` box rules |
| `docs/GAME_DESIGN_CONSTRAINTS.md` | §7b: `ScorePanel` = `ScoreLine` + `ScoreActions`; Accepted deviations row for Career Path |
| `docs/team/CODE_MAP.md` | `ScorePanel`, `tokens`, `variants` descriptions |
| `docs/games/MASTER_PLAN.md` | W1-4 rule line: result at the top, answer behind the toggle |

Not touched: `EndSequence.tsx`, `GameFrame.tsx`, `MiniGame.tsx`, `WhoAreYa.tsx`,
`StartingFive.tsx`, `FanFavorites.tsx`, `HeatmapGame.tsx`, `SwapText.tsx`, `AnimatedNumber.tsx`,
anything under `backend/` or `multiplayer_server/`.

## Risks

1. **`visibility` on an `initial={false}` mount.** If framer does not apply `transitionEnd` values
   when resolving the initial style, the hidden answer pane would be at opacity 0 but technically
   visible. Mitigation: `.cp-pane:not(.is-active) { visibility: hidden; pointer-events: none; }`
   — inline `visibility: visible` (set by the `visible` variant) beats the class during an exit
   fade, and the class covers the first mount. Both are in step 6.
2. **Status row height drift.** The score line's 1.15rem type could make the row 23-24px without
   the explicit 22px boxes. Step 7 sets them; the QA script asserts `.gf` height is identical
   before the end, after the end and after each toggle (Rule 6.2 test).
3. **Shared behaviour change.** `ScoreLine` counts the score up (0.9 s `AnimatedNumber`) for all
   five in-place games. Visible but harmless; Who Are Ya and Starting Five screenshots are in the
   Done-when. If the owner dislikes the count-up on the other games, `ScoreLine` gets an
   `animate?: boolean` prop later — not planned now.
4. **Lone-left centring during the switch.** The play label and counter vanish instantly when the
   result mounts (no exit animation) so the label never slides to centre while fading. The motion
   reviewer may list this as `missing` (minor) — accepted, reason recorded in Decisions.
5. **Mobile width.** The result line ("Out of guesses 0/600 pts") is centred alone on its row, and
   the toggle is alone on its row, so nothing competes for the ~322px row at 390px.
6. **Reduced motion.** `MotionConfig reducedMotion="user"` (UI-20) already neutralises transforms;
   the result line additionally starts at `"visible"` when `useReducedMotion()` is true, and the
   CSS flip transition is already off under `prefers-reduced-motion`.

## Test plan

Unattended (verify stage): `npm run lint`, `npm run build`
(`npx next typegen && npx tsc --noEmit` equivalent). `grep -n "stops" "src/Game Renderers/CareerPath.tsx"`
must return only the `aria-label="Career stops"` line (not user-visible text) — or nothing if the
engine renames it; either passes.

Browser QA (qa-protocol, Playwright, ports 5273/8100): `node scripts/ui-audit.mjs --only career-path`
plus a script that, at **390x844** and **1280x800**:
1. Starts Career Path, screenshots `mid-play header` and asserts `.cp-counter` text matches
   `/^\d+ guess(es)? left$/` and the status row contains no "stops".
2. Reads the mystery player's name from the question payload: listen on `page.on("response")` for a
   JSON body with `game === "career-path"` and `player.full_name` (the data-host question file that
   `fetchQuestion` loads). Records `h0 = .gf` height.
3. **Win:** type `full_name` into the input, press Confirm. Within 400 ms assert the `Play again`
   button exists and is enabled; assert `.cp-result` text contains `That's him!` and `/\d+\/\d+ pts/`;
   assert `.cp-answer.is-active` and `.cp-toggle` text `See full career`; `.gf` height equals `h0`
   (±0.5). Screenshot `win`.
4. Click the toggle: assert `.cp-rail.is-active`, toggle text `See the answer`; wait
   `260 * stints + 300` ms; assert every `.cp-flip` has `is-flipped`; `.gf` height equals `h0`.
   Screenshot `see-full-career`. Click again: `.cp-answer.is-active`; screenshot `see-the-answer`.
5. **Loss:** Play again, then submit `stints` wrong names (take them from the autocomplete
   suggestions, skipping `full_name`). Assert `.cp-result` contains `Out of guesses` and `0/`;
   `.cp-rail.is-active`; toggle text `See the answer`; `.gf` height equals `h0`; screenshot `loss`.
   Click the toggle: `.cp-answer.is-active`, headshot or `.cp-reveal-fallback` present, name text
   equals `full_name`; screenshot `see-the-answer-loss`.
6. Rule 6.3: the losing guess's `.feedback-slot` text is `Not him.`, never `Out of guesses`.
7. Who Are Ya and Starting Five: play to the end (any outcome), assert `.scorepanel-line` and
   `.scorepanel-actions` render with `Play again` + `Close game`, screenshot each.
8. `.exit-link.is-ended` present at every end state (one leave control, unchanged behaviour).

## Implementation plan

Order matters: steps 1-4 are the shared pieces the renderer imports; 5-7 are the renderer; 8-10
docs. The engine implements this plan; it does not re-derive one.

### Step 1 `[sonnet]` — motion tokens and variants
Files: `src/motion/tokens.ts`, `src/motion/variants.ts`.
- In `tokens.ts` add `result: { type: "spring", stiffness: 240, damping: 22 }` to `springs`, after
  `gentle`, with the comment from Interfaces.
- In `variants.ts` append `resultIn` and `stackPane` exactly as written in Interfaces (keep the
  comments; `visibility` and `transitionEnd` are valid `TargetAndTransition` members).
Done: `npx tsc --noEmit -p tsconfig.json` has no error in either file (run only this check; the two
files have no runtime behaviour to verify by hand).

### Step 2 `[sonnet]` — GameResult consumes the shared entrance
File: `src/components/GameResult.tsx`.
- Import `{ resultIn }` from `'../motion/variants'`.
- On the result `motion.div` (currently `initial={{ opacity: 0, scale: 0.9, y: 10 }}`,
  `animate={{ opacity: 1, scale: 1, y: 0 }}`, `transition={{ type: "spring", stiffness: 240, damping: 22 }}`)
  replace those three props with `variants={resultIn} initial="hidden" animate="visible"`. Keep
  the `style` prop and everything else.
Done: the file contains no `stiffness: 240` literal; `grep -n "resultIn" src/components/GameResult.tsx`
shows the import and the prop.

### Step 3 `[opus]` — split ScorePanel into ScoreLine + ScoreActions
Files: `src/components/ScorePanel.tsx`, `src/styles/ui.css`.
- Add `import AnimatedNumber from "./motion/AnimatedNumber";`.
- Export `ScoreLine` (`ScoreLineProps`): returns the existing `.scorepanel-line` div verbatim, except
  the points span becomes `<span className="scorepanel-pts tnum"><AnimatedNumber value={score} />{outOf != null ? `/${outOf}` : ""} pts</span>`.
  The `won` colouring of the label stays an inline style as today.
- Export `ScoreActions` (`ScoreActionsProps`): returns `null` when `!onPlayAgain && !onClose`, else
  `<div className="scorepanel-actions">` with the same two `Button size="sm"` elements as today
  (`Play again` primary, `Close game` `variant="secondary"`).
- Default export `ScorePanel` keeps its props (now `ScoreLineProps & ScoreActionsProps`) and
  renders `<div className="scorepanel"><ScoreLine …/><ScoreActions …/></div>`. Update the JSDoc:
  "`ScoreLine` + `ScoreActions`; a game that puts its result at the top of the frame renders the
  two halves in different slots (Career Path)."
- `ui.css`: add `.scorepanel-actions { display: flex; gap: 10px; }` directly after `.scorepanel-pts`.
Done: `WhoAreYa.tsx`, `StartingFive.tsx`, `FanFavorites.tsx`, `HeatmapGame.tsx` compile unchanged
(`npx tsc --noEmit`); `grep -rn "display: \"flex\", gap: 10" src/components/ScorePanel.tsx` is empty.

### Step 4 `[opus]` — CareerPath header: guesses only, SwapText, no stops
File: `src/Game Renderers/CareerPath.tsx`.
- Imports: add `SwapText from "../components/motion/SwapText"`, `{ ScoreLine, ScoreActions } from "../components/ScorePanel"`
  (drop the default `ScorePanel` import), `{ resultIn, stackPane, popIn, fadeInUp } from "../motion/variants"`.
- Status right during play:
  `<span className="cp-counter tnum" aria-live="polite"><SwapText>{`${guessesLeft} ${guessesLeft === 1 ? "guess" : "guesses"} left`}</SwapText></span>`
  (SwapText keys on the string, so each change slides). Remove `· {stints} stops` and the
  "stop count" comment.
- Prompt: `eyebrow={<SwapText swapKey={ended ? "toggle" : "eyebrow"}>{ended ? <toggle from step 5> : <span className="cp-eyebrow">One career, card by card</span>}</SwapText>}`.
Done: `grep -n "stops" "src/Game Renderers/CareerPath.tsx"` shows only `aria-label="Career stops"`;
the counter renders `5 guesses left` / `1 guess left`.

### Step 5 `[opus]` — CareerPath end flow: result line at the top, toggle, actions
File: `src/Game Renderers/CareerPath.tsx`.
- Add `type View = "career" | "answer"` and `const [view, setView] = useState<View>("career")`;
  reset it to `"career"` in the `[gameInfo]` effect next to `setBottomPhase("input")`.
- Add `revealRest`, `finish`, `toggleView` exactly as in Interfaces, placed directly after
  `handleGuessSubmit` (before the early returns, like every other handler). `revealRest` and
  `toggleView` need the stint count, which is only derived after the early returns today, so each
  starts with `if (!player) return; const stints = player.teams.length;` (the same two lines
  `handleGuessSubmit` already uses). `finish` takes `score`/`won` and needs no player. `later` and
  `clearTimers` are unchanged.
- `handleGuessSubmit`, correct branch: `setPhase("won"); sendGuessLog(); flashPopup(`Correct! +${finalScore}`, "var(--good)"); finish(finalScore, true); return;`
  — no `setBottomPhase("loader")`, no cascade, no `later`.
- Losing branch (`newWrong >= stints`): `setPhase("lost"); sendGuessLog(); flashPopup("Not him.", "var(--bad)"); finish(0, false);`
  (Rule 6.3: the popup never announces the loss; the result line does). The ordinary miss branch is
  unchanged (`setFlipped(1 + newWrong)`, `flashPopup("Not him.", …)`).
- Status left: `ended ? <motion.div className="cp-result" variants={resultIn} initial={reduce ? "visible" : "hidden"} animate="visible"><ScoreLine score={endState?.score ?? 0} outOf={stints * POINTS_PER_CARD} label={endState?.won ? "That's him!" : "Out of guesses"} won={endState?.won} /></motion.div> : <GameFrame.Label>TRACE THE CAREER</GameFrame.Label>`.
  Status right: `ended ? undefined : <counter from step 4>` — `undefined`, never an empty element
  (Rule 4.2a; the lone left slot centres itself).
- The toggle (rendered in the Prompt slot via step 4):
  `<button type="button" className="chip cp-toggle" onClick={toggleView}><SwapText>{view === "answer" ? "See full career" : "See the answer"}</SwapText></button>`.
- `EndSequence`: `phase={bottomPhase}`, `input` unchanged, `score={<ScoreActions onPlayAgain={onPlayAgain} onClose={onClose} />}`.
- Delete the `<AnimatePresence>{phase === "lost" && <motion.div className="cp-reveal">…}</AnimatePresence>`
  block after `EndSequence` (its content moves into the answer pane in step 6). Drop the now-unused
  `AnimatePresence` import if nothing else uses it.
Done: a win shows `That's him!` + points centred in the status row and Play again/Close game in the
action row within one render (no timers); a loss shows `Out of guesses 0/N pts`; the `Confirm`
button stays disabled after the end (`ended` guard unchanged).

### Step 6 `[opus]` — the stage: rail pane + answer pane in one grid cell
File: `src/Game Renderers/CareerPath.tsx`.
- Wrap the Board content: `<div className="cp-stage">` containing
  1. the rail, now `<motion.div className={`cp-rail cp-pane${view === "career" ? " is-active" : ""}`} ref={railRef} role="list" aria-label="Career stops" aria-hidden={view !== "career"} variants={stackPane} initial={false} animate={view === "career" ? "visible" : "hidden"}>` with the card map unchanged inside (the cards stay direct children, so the `scrollIntoView` effect and `rail.children` indexing still hold);
  2. the answer pane `<motion.div className={`cp-answer cp-pane${view === "answer" ? " is-active" : ""}`} aria-hidden={view !== "answer"} variants={stackPane} initial={false} animate={view === "answer" ? "visible" : "hidden"}>` containing
     `<motion.div className="cp-answer-photo" variants={popIn}><RevealHeadshot personId={player.person_id} name={player.full_name} /></motion.div>` and
     `<motion.div className="cp-answer-text" variants={fadeInUp}><span className="cp-reveal-label">The journey belonged to</span><span className="cp-reveal-name font-display">{player.full_name}</span></motion.div>`.
     The children carry only `variants` (no `initial`/`animate`): they inherit the pane's labels, so
     `stackPane.visible`'s `delayChildren` releases the pop and the fade together once the other pane
     has left.
     (Fix cycle 1) The two children render only when `ended`, so the name and headshot request
     don't exist during play, and the answer pane's `initial` is `{ended ? "hidden" : false}` so
     children mounting at the end start hidden and still take the orchestrated pop/fade.
- `railRef` stays `useRef<HTMLDivElement>(null)`; `motion.div` forwards it.
Done: toggling flips `is-active` between the two panes; the answer pane is not focusable or
hit-testable while inactive; `.gf` height is identical in play, at the end and after each toggle.

### Step 7 `[opus]` — CareerPath.css: static heights, panes, chip, answer sizing
File: `src/styles/CareerPath.css`.
- `.cp-counter`: add `height: 22px; display: inline-flex; align-items: center;` (keep font rules).
- Add `.cp-result { height: 22px; display: inline-flex; align-items: center; }`.
- Add `.cp-eyebrow { height: 22px; display: inline-flex; align-items: center; }` and
  `.cp-toggle { height: 22px; padding: 0 12px; position: relative; font-family: inherit; color: var(--text); background: var(--surface2); border-color: var(--line2); cursor: pointer; }`
  `.cp-toggle:hover { border-color: var(--brand); color: var(--brand); }`
  `.cp-toggle::after { content: ""; position: absolute; inset: -11px -6px; }` (44px touch target, no layout cost).
  (`.chip` from `ui.css` supplies the pill, 11px/700/.5px letter-spacing, 1px border.)
- Add `.cp-stage { display: grid; width: 100%; }`, `.cp-pane { grid-area: 1 / 1; min-width: 0; }`,
  `.cp-pane:not(.is-active) { visibility: hidden; pointer-events: none; }` (fallback for the first
  mount; the variant's inline `visibility` wins during fades).
- Add `.cp-answer { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: clamp(6px, 1.2dvh, 10px); }`
  and `.cp-answer-text { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }`.
- Replace the `.cp-reveal` block (`.cp-reveal`, `.cp-reveal-text`): delete those two rules; keep
  `.cp-reveal-label` (change `font-size` to `11px`) and `.cp-reveal-name` (`font-size: clamp(18px, 2.6dvh, 24px)`);
  change `.cp-reveal-photo, .cp-reveal-fallback` to `flex: none; width: clamp(96px, 24vw, 128px); aspect-ratio: 1040 / 760; height: auto; object-fit: cover; border-radius: 12px; background: var(--surface3); border: 1px solid var(--line2);`.
- Update the file header comment: the stage holds two panes; the answer replaces the bottom reveal.
- Keep the `@media (max-width: 480px)` block as is.
Done: `grep -n "cp-reveal {\|cp-reveal-text" src/styles/CareerPath.css` is empty; the status row,
prompt row and board measure the same height before and after the end at 390 and 1280 wide (QA
asserts it).

### Step 8 `[sonnet]` — GAME_DESIGN_CONSTRAINTS.md
File: `docs/GAME_DESIGN_CONSTRAINTS.md`.
- §7b, after "Use `<ScorePanel>`:" paragraph's CSS block: add one sentence — "`ScorePanel` is
  `ScoreLine` (the line, score via `AnimatedNumber`) + `ScoreActions` (Play again / Close game),
  both exported from the same file; a game that puts its result at the top of the frame renders
  `ScoreLine` in the Status slot and `ScoreActions` in the score slot (Career Path)."
- Accepted deviations table, add a row:
  `| Career Path | no `loader` beat (`input -> score`); result line in the Status slot, the career/answer toggle in the Prompt slot, actions alone in the Action slot | the reveal is player-driven ("See full career" / "See the answer"), so nothing is calculated behind a spinner, and the owner's rule is that no button waits more than 400 ms; every slot keeps its play-time height so the frame never resizes (Rule 6.2) |`
- §8 list: add `ScoreLine`, `ScoreActions` after `ScorePanel`.
Done: the three edits are present; no other line changed.

### Step 9 `[sonnet]` — CODE_MAP.md and MASTER_PLAN.md
Files: `docs/team/CODE_MAP.md`, `docs/games/MASTER_PLAN.md`.
- CODE_MAP lines for `src/components/ScorePanel.tsx` (both occurrences): "Standard score line
  (`ScoreLine`, count-up) + Play again/Close (`ScoreActions`); default `ScorePanel` composes both."
  `src/motion/tokens.ts`: add `result` to the springs list. `src/motion/variants.ts`: add
  `resultIn`/`stackPane` to the list.
- MASTER_PLAN W1-4 rules bullet "Run out of guesses ⇒ 0 points and the player's name + headshot
  shown in a reveal container at the bottom." → "Run out of guesses ⇒ 0 points. The result line
  sits at the top of the frame; the name + headshot are the answer pane (shown by default on a
  win, behind "See the answer" on a loss) and "See full career" flips the remaining cards."
Done: `grep -n "reveal container at the bottom" docs/games/MASTER_PLAN.md` is empty.

### Step 10 `[sonnet]` — commit body notes for reviewers
No file. In the build report / commit body state: (a) `ScoreLine` counts up in all five in-place
games (shared change, deliberate); (b) the play label and counter vanish without an exit when the
result mounts (Risk 4); (c) Rule 6.3 copy fix on the losing guess; (d) `stackPane` is built from
`swap`'s values plus `visibility` because `AnimatePresence mode="wait"` cannot keep both panes
mounted and the zone must stay rail-tall.

## Self-review (5b)

- **Coverage.** Req 1 (header, SwapText) → step 4. Req 2 (result at the top, headline + points as
  one small component, cards below) → steps 3, 5 (`ScoreLine` in the Status slot). Req 3 (two
  options, cascade reuse, `RevealHeadshot`, win default answer, loss on request, SwapText label) →
  steps 5, 6. Req 4 (buttons together under the result, score above buttons) → step 5
  (`ScoreActions` in the Action slot; the score line is in the Status slot above it). Req 5 (no
  resize) → steps 6, 7 and the QA assertion. Req 6 (spring, variants, AnimatedNumber, tokens only,
  reduced motion, ≤400 ms) → steps 1, 2, 3, 5, 6. Req 7 (no fork, other games intact) → step 3.
  Done-when: grep (step 4), screenshots (Test plan), other games (step 3 + Test plan 7),
  motion-reviewer (shared pieces throughout), lint/build (verify stage). Docs → 8, 9.
- **No placeholders.** Every step names its file, the exact JSX/CSS, and a check.
- **Consistency.** `view`/`View`, `.cp-stage`/`.cp-pane`/`.is-active`/`.cp-answer`/`.cp-toggle`/
  `.cp-result`/`.cp-eyebrow`, `ScoreLine`/`ScoreActions`, `resultIn`/`stackPane`/`springs.result`
  are spelled identically in Interfaces, steps and the test plan.
- **Scope.** The GameResult edit is the dedupe the "tokens only" requirement forces; the Rule 6.3
  copy change is one string inside a branch the plan rewrites; nothing else outside the card.
- **Ambiguity resolved.** "Rail expanded or scrolled" → scrolled (expanding to a wrapping grid would
  need ~650px at 390 wide and squash or multiply the cards, Rule 4.3). "Two clear options" → one
  toggle whose label is the other view, as the card's own SwapText sentence implies. "Under the
  result block" for the buttons → the Action slot, which is below the Status slot where the result
  lives; the cards sit between because the frame's slot order is fixed (Rule 0). "Loader shown for
  1.5 s" (§7b) vs "≤400 ms" (card) → the card wins, recorded as an accepted deviation.
