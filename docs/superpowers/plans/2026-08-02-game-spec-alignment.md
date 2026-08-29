# Game Spec Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all 18 games into compliance with `docs/GAME_DESIGN_CONSTRAINTS.md`, fixing every genuine violation while honouring the spec's own carve-outs for games whose shape differs from the 5-round reference.

**Architecture:** Three tiers. Tier A is shared infrastructure + universal violations (applies to every game, no design judgement). Tier B is per-game structural alignment where the game shape genuinely fits the spec. Tier C is explicitly **out of scope** — changes that would require redesigning a game's format.

**Tech Stack:** React 19, TypeScript (strict, `tsc -b` must pass), framer-motion, Vite, plain CSS with design tokens.

## Global Constraints

- **Surgical changes only.** Every changed line must trace to a spec violation listed here. Do not refactor adjacent code, do not restyle things that already comply.
- **TypeScript strict.** `npx tsc -b` must pass. No `any` unless the surrounding code already uses it.
- Feedback colours are **only** `var(--good)`, `var(--bad)`, `var(--muted)`. Never `var(--brand)` for feedback.
- Feedback copy: correct = `Correct! +N`; wrong = a statement of the truth, **never** a bare "Wrong"/"Incorrect".
- `CourtLoader` is **full-stage loading only** (the shell owns it). Inline/among-content loading uses `Spinner`.
- The shell owns the exit control (`.exit-link`), the outer padding (`.stage-inner` clamp), and the loading phase. Games never render their own.
- Only one accent colour exists: `var(--brand)`. Tokens over hex, always.

### Tier C — explicitly OUT OF SCOPE (do not do these)

These would change what a game *is*, not how it complies. Leave them alone and note them:
- Adding `ROUND n/total` to games with no rounds (Connections, Heatmap, Contexto, Wordle, WhoAreYa, CareerPath, TicTacToe, Bingo, SuperDraft, Imposter).
- Adding a `.font-display` 19px question heading to board/puzzle games that have no question.
- Adding keyed `AnimatePresence mode="wait"` round-body transitions to single-board games.
- Converting WhoWouldWin from its fill layout to the content column.
- Moving StartingFive / Wordle into `CONTENT_STAGE_GAMES` (spec §4 warns this unbounds fill areas; both need layout verification first).
- Adding `SessionTimer` to every game (spec §9 says always-visible; no game has it — repo-wide product decision, not a per-game fix).

---

## Task 1: Shared infrastructure — score timing + Close game

**Files:**
- Modify: `src/pages/Trivia/MiniGame.tsx:149`
- Modify: `src/components/ScorePanel.tsx`
- Modify: `src/Game Renderers/RenderGame.tsx`

**Interfaces:**
- Produces: `ScorePanelProps.onClose?: () => void` — renders a `Close game` secondary button beside `Play again`.
- Produces: `RenderGameArgs.onClose?: () => void` — threaded to CareerPath, WhoAreYa, FanFavorites, StartingFive.

- [ ] **Step 1: Fix the calculating-score duration to 1.5s (spec §7a)**

`MiniGame.tsx:149` currently waits 2000ms. Change to:
```tsx
      await new Promise((res) => setTimeout(res, 1500));
```

- [ ] **Step 2: Add `onClose` to ScorePanel (spec §7b "Gap to close")**

In `src/components/ScorePanel.tsx`, add to the props interface:
```tsx
  onPlayAgain?: () => void;
  /** Closes the game and returns to the idle screen (spec §7b). */
  onClose?: () => void;
```
Destructure `onClose` and replace the single-button block with:
```tsx
      {(onPlayAgain || onClose) && (
        <div style={{ display: "flex", gap: 10 }}>
          {onPlayAgain && <Button size="sm" onClick={onPlayAgain}>Play again</Button>}
          {onClose && <Button size="sm" variant="secondary" onClick={onClose}>Close game</Button>}
        </div>
      )}
```

- [ ] **Step 3: Thread `onClose` through RenderGame**

Add `onClose?: () => void;` to `RenderGameArgs` (near `onPlayAgain`, line 48), destructure it, and pass `onClose={onClose}` to the four in-place games: `starting-five`, `fan-favorites`, `career-path`, `who-are-ya`.

- [ ] **Step 4: Wire `onClose` from MiniGame**

In `MiniGame.tsx` `renderGame({...})` (~line 206), add `onClose: handleRestart,` alongside `onPlayAgain: handleStart,`. `handleRestart` already resets to idle.

- [ ] **Step 5: Verify**

Run: `npx tsc -b` — expect no errors.

---

## Task 2: Remove per-game loaders (spec §3/§8)

**Files (all Modify):** `NameLogo.tsx:118`, `HeatmapGame.tsx:189`, `ConnectionsGame.tsx:192`, `CareerPath.tsx:255-258`, `NbaGrid.tsx:263`, `WhoAreYa.tsx:285`, `TicTacToe.tsx:404,288`, `BingoGame.tsx:262`, `Contexto.tsx:322`, `WhoWouldWin.tsx:254`, `PackFive.tsx:248-254`, `SuperDraft.tsx:499-505`, `ImposterGame.tsx:216-219`

Every one of these renders `CourtLoader` *inside the playing phase*, after the shell has already shown "Warming up the court…". Spec §8: `CourtLoader` is full-stage only.

- [ ] **Step 1: Replace each with `Spinner`**

Import `Spinner` from `../components/ui` (it is exported from `src/components/ui/index.ts`). Replace e.g.:
```tsx
// before
<CourtLoader label="Drawing the grid…" />
// after
<Spinner label="Drawing the grid…" />
```
Keep each game's existing label text — it is informative and the spec only constrains the *component*, not the inline label. Remove the now-unused `CourtLoader` import from each file.

**Exception — `NameLogo.tsx:118`:** this is `<CourtLoader label="" scale={0.5} />` used as a tiny image-loading spinner. Replace with `<Spinner size={24} />`.

**Exception — `ImposterGame.tsx:216`:** keep the label "Setting up the room…" but switch to `Spinner`; this covers a real MP state the shell cannot represent.

- [ ] **Step 2: Verify**

Run: `npx tsc -b && npm run lint` — expect clean. Confirm no file still imports `CourtLoader` except `MiniGame.tsx` and `GameResult.tsx`.

---

## Task 3: Remove game-owned exit controls and outer padding (spec §1/§4)

**Files:**
- Modify: `src/Game Renderers/StartingFive.tsx:321`
- Modify: `src/Game Renderers/BingoGame.tsx:254`
- Modify: `src/Game Renderers/NbaGrid.tsx:457` + `src/styles/NbaGrid.css:144-155`
- Modify: `src/styles/ImposterGame.css:14`

- [ ] **Step 1: StartingFive — drop the custom "Exit game" button**

`StartingFive.tsx:321` renders `<Button size="md" variant="secondary">Exit game</Button>` on top of the shell's `.exit-link`. Remove that button (Task 6 replaces this whole block with `ScorePanel`, which supplies Close game).

- [ ] **Step 2: BingoGame — drop the error-state "Exit game" button**

`BingoGame.tsx:254` renders `<Button size="sm" onClick={() => onGameEnd?.(0)}>Exit game</Button>`. Remove it; the shell `.exit-link` is always present.

- [ ] **Step 3: NbaGrid — the "Finish grid →" exit lookalike**

`NbaGrid.css:144-155` styles `.ng-finish` as `12.5px / muted / underline / text-underline-offset:3px` — a visual clone of `.exit-link` sitting directly above the real one. This is a legitimate *game action* (finish early), not an exit, so keep the control but restyle it so it cannot be mistaken for the exit. In `NbaGrid.css`, change `.ng-finish` to use the secondary-button treatment instead of underlined muted text:
```css
.ng-finish {
  align-self: center;
  padding: 6px 14px;
  border: 1px solid var(--line2);
  border-radius: 10px;
  background: transparent;
  color: var(--muted);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.2s ease, border-color 0.2s ease;
}
.ng-finish:hover { color: var(--text); border-color: var(--brand); }
```
Remove any `text-decoration`/`text-underline-offset` declarations from that rule.

- [ ] **Step 4: ImposterGame — remove the root's own outer padding**

`ImposterGame.css:14` has `padding: clamp(8px, 2.4vw, 12px);` on `.imp-wrap`. Spec §1: "Never add your own outer padding". Delete that line.

- [ ] **Step 5: Verify**

Run: `npx tsc -b && npm run lint`.

---

## Task 4: Fix the fill-layout contract (spec §4)

Three games sit outside `CONTENT_STAGE_GAMES` (so the shell gives them the fill `.playing-wrap`) but their roots never set `height:100%`. Their own `margin-top:auto` / `overflow-y:auto` children therefore have no resolved height to work against — a real layout bug, not just a style delta.

**Files:**
- Modify: `src/styles/SuperDraft.css:5-13`
- Modify: `src/styles/ConnectionsGame.css:5-14`
- Modify: `src/styles/CareerPath.css:4-12`

- [ ] **Step 1: SuperDraft — add the fill contract**

`.sd-wrap` has `overflow-y:auto` children (`.sd-slots`, `SuperDraft.css:62`) and `margin-top:auto` children (`.sd-draftbar` :180, `.sd-result` :232) but no height. Add to `.sd-wrap`:
```css
  height: 100%;
  max-height: 100%;
  min-height: 0;
```

- [ ] **Step 2: ConnectionsGame — add the fill contract**

Add the same three declarations to `.cn-wrap` (`ConnectionsGame.css:5-14`).

- [ ] **Step 3: CareerPath — add the fill contract**

Add the same three declarations to `.cp-wrap` (`CareerPath.css:4-12`). This makes `.cp-inputrow { margin-top: auto }` (`CareerPath.css:126`) actually work — it is currently inert.

- [ ] **Step 4: Normalise max-width toward the 560 spec column**

Spec §5 sets `max-width: 560px`. Update these roots which exceed or undershoot it without cause:
- `CareerPath.css:6` `max-width: 620px` → `560px`
- `ConnectionsGame.css` `.cn-wrap` already `560px` — leave.
- `FanFavorites.css:4` `max-width: 620px` → `560px`
- `Contexto.css` `.cx-wrap` `max-width: 620px` → `560px`
- `StartingFive.css:4` `max-width: 720px` → **leave at 720px** and note it: the 5-card lineup row genuinely needs the width; narrowing it would wrap the lineup. Record as an accepted deviation.
- Leave `PackFive` (520), `WhoAreYa` (520), `NbaGrid` (460), `SuperDraft` (480), `Imposter` (430) — these are narrower by design for their board shapes; the spec's 560 is a *max*, not a target.

- [ ] **Step 5: Verify no game overflows**

Run: `npm run build`, then load each of the three changed games at 390×844 and confirm the Exit button is still visible without page scroll.

---

## Task 5: Feedback copy + colour compliance (spec §6)

**Files:** `StartingFive.tsx:187,171`, `BingoGame.tsx:226,217`, `PackFive.tsx:242,230`, `SuperDraft.tsx:467`, `ImposterGame.tsx:270`, `Contexto.tsx:313`, `HeatmapGame.tsx:177`, `ConnectionsGame.tsx:173`, `TicTacToe.tsx:227`, `WhoAreYa.tsx:250`, `CareerPath.tsx:217`

- [ ] **Step 1: Eliminate bare "Wrong"-class messages**

Spec §6: "Never a bare 'Wrong'." Replace:
- `StartingFive.tsx:187` `"Incorrect Answer"` → `` `Not in this lineup` ``
- `StartingFive.tsx:171` `"Game Over"` → `` `Out of lives` ``
- `BingoGame.tsx:226` `"Wrong dab!"` → `` `Doesn't fit that square` ``

- [ ] **Step 2: Fix feedback colours that use `var(--brand)`**

Spec §6 permits only `--good` / `--bad` / `--muted`:
- `PackFive.tsx:242` `"Missed — one life left"` → change colour `var(--brand)` → `var(--bad)`
- `SuperDraft.tsx:467` `"Pools re-rolled"` → `var(--brand)` → `var(--muted)`
- `ImposterGame.tsx:270` `` `Voted ${name}` `` → `var(--brand)` → `var(--muted)`
- `Contexto.tsx:313` `` `It was ${secret.full_name}` `` → `var(--muted)` → `var(--bad)` (it is a truth-reveal)

- [ ] **Step 3: Normalise correct-answer copy to `Correct! +N`**

Spec §6 fixes the correct format. Update the *scored* correct messages:
- `HeatmapGame.tsx:177` `` `Claimed! +${POINTS_PER_HEX}` `` → `` `Correct! +${POINTS_PER_HEX}` ``
- `ConnectionsGame.tsx:173` `` `+50` `` → `` `Correct! +${POINTS_PER_GROUP}` ``
- `TicTacToe.tsx:227` `` `+${CELL_POINTS}` `` → `` `Correct! +${CELL_POINTS}` ``
- `PackFive.tsx:230` `` `Beats it! +${POINTS}` `` → `` `Correct! +${POINTS}` ``
- `WhoAreYa.tsx:250` `` `That's ${name}! +${finalScore}` `` → `` `Correct! +${finalScore}` ``
- `CareerPath.tsx:217` `` `That's him! +${finalScore}` `` → `` `Correct! +${finalScore}` ``
- `BingoGame.tsx:217` `"Dabbed!"` → `` `Correct! +${POINTS_PER_DAB}` `` (use the existing per-dab points constant; if scoring is terminal-only, keep `Dabbed!` and record why)

**Leave alone** (no per-answer points exist, so `+N` would be a lie): FanFavorites' `` `+${hit.count} fans said it!` ``, SuperDraft's `` `${name} drafted` ``, Contexto's `` `#${rank}` ``, WhoWouldWin (no correct answer at all).

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npm run lint`.

---

## Task 6: StartingFive end-path bug + §7b migration

**Files:** `src/Game Renderers/StartingFive.tsx`, `src/styles/StartingFive.css:147-149`

This is the highest-severity finding: **a lost single-player run never calls `onGameEnd` at all** (`StartingFive.tsx:180-185`), so it awards no points and logs no session. It also builds a bespoke end panel with its own exit.

- [ ] **Step 1: Route both outcomes through the in-place path**

StartingFive reveals the full lineup at the end → spec §7b. Import `EndSequence`/`ScorePanel`, add a `bottomPhase` state (`"input" | "loader" | "score"`), and:
- Win (`:152`): `onGameEnd?.(finalScore)` → `onGameEnd?.(finalScore, { inPlace: true })`
- Loss (`:180-185`): call `onGameEnd?.(0, { inPlace: true })` — currently missing entirely.

- [ ] **Step 2: Replace the custom `.s5-gameover` block with ScorePanel**

Remove the hand-rolled block at `StartingFive.tsx:309-325` (copy + `Play again` + `Exit game`) and render `<ScorePanel score={…} outOf={…} won={…} onPlayAgain={onPlayAgain} onClose={onClose} />` inside `EndSequence`'s `score` slot. Set `bottomPhase` to `"loader"` when the reveal starts and `"score"` **1500 ms** later (spec §7b).

- [ ] **Step 3: Accept `onClose`**

Add `onClose?: () => void` to the component props (Task 1 threads it through `RenderGame`).

- [ ] **Step 4: Verify**

Run: `npx tsc -b`. Then play the game to a loss and confirm points are awarded and a session is logged (Network tab: `POST /trivia/log-session/`).

---

## Task 7: Collapse double end screens (spec §7)

Four games render a custom end screen and *then* hand off to the shell's `GameResult` — two sequential end states.

**Files:** `HeatmapGame.tsx:267-281`, `SuperDraft.tsx:626-648`, `WhoWouldWin.tsx:148-195`, `NbaGrid.tsx:389-419`

- [ ] **Step 1: HeatmapGame → §7b in place**

Heatmap reveals the board at the end. Replace the `.hm-endcard` absolute overlay (`HeatmapGame.tsx:267-281`, `HeatmapGame.css:135-155`) with the `EndSequence` + `ScorePanel` pattern, and change `finish()` (`:135-139`) to `onGameEnd(capped, { inPlace: true })`. Delete the `Continue` button — `ScorePanel` supplies Play again + Close game.

- [ ] **Step 2: SuperDraft → keep the custom panel, drop the duplicate**

SuperDraft's `.sd-result` percentile panel is bespoke and worth keeping (it has a share action with no shared equivalent). Change `onGameEnd?.(pct)` (`:406`) to `onGameEnd?.(pct, { inPlace: true })` so the shell does **not** replace it with `GameResult`, and add `<ScorePanel …>`-equivalent Play again + Close game to `.sd-result` by accepting `onPlayAgain`/`onClose` props. Record the deviation: custom panel retained, single end screen achieved.

- [ ] **Step 3: WhoWouldWin → single end screen**

`WhoWouldWin.tsx:140` calls `onGameEnd?.(0)` after its own `.www-summary`, and `maxPoints: 0` makes `GameResult` render a meaningless "0 / 0". Change to `onGameEnd?.(0, { inPlace: true })` and add Play again + Close game to the summary's `Finish` row so the summary *is* the end screen.

- [ ] **Step 4: NbaGrid → single end screen**

`NbaGrid.tsx:177` fires `onGameEnd?.(finalScore)` only when the user presses its custom `See results` button (`:419`), after its own in-place breakdown. Change to `onGameEnd?.(finalScore, { inPlace: true })` fired when the grid finishes, and replace the `See results` button with Play again + Close game so the breakdown is the end screen.

- [ ] **Step 5: Verify**

Run: `npx tsc -b && npm run lint && npm run build`. Play each of the four to completion and confirm exactly one end screen appears and points are awarded.

---

## Task 8: ProgressBar placement and adoption (spec §5)

- [ ] **Step 1: Move nested bars to the root's 2nd child**

- `BingoGame.tsx:277` — `<ProgressBar>` is nested inside `.bng-top > .bng-meter`. Move it to be the direct 2nd child of `.bng-wrap`, full width. Also fix the inverted semantics: `value={dealsLeft}` counts *down*; change to `value={DECK_SIZE - dealsLeft} max={DECK_SIZE}`.
- `NbaGrid.tsx:325` — `<ProgressBar>` is nested inside `.ng-head > .ng-meter-bar`. Move it to be the direct 2nd child of `.ng-wrap`, full width.

- [ ] **Step 2: Add the bar where linear progression genuinely exists**

These have a clear linear axis and no bar, so §5's carve-out does not apply. Add `<ProgressBar>` as the root's 2nd child:
- `PackFive.tsx` — `value={comparisonNo} max={totalComparisons}`
- `SuperDraft.tsx` — `value={filledCount} max={SLOT_COUNT}`
- `WhoWouldWin.tsx` — `value={idx} max={gameInfo.length}`
- `CareerPath.tsx` — `value={stintsRevealed} max={stints}` (use the existing revealed-count state)

- [ ] **Step 3: Replace Imposter's custom bar**

`ImposterGame.css:131-145` hand-rolls a bar with `border-radius:999px`, a flat `var(--brand)` fill, and `transition: width .5s linear`. Spec §5: "never substitute a custom bar". Replace the markup at `ImposterGame.tsx:302-306` with the shared `<ProgressBar>` and delete `.imp-bar`/`.imp-bar-fill` from the CSS. Keep the countdown semantics (`value` = seconds remaining).

- [ ] **Step 4: Leave these bar-less (carve-out justified, record it)**

Heatmap (open board), Contexto (daily, unlimited guesses), TicTacToe (single board), WhoAreYa (single subject), Connections (implicit via solved bars), Wordle (rows are the progress), StartingFive (lives hearts), FanFavorites (board is the progress).

- [ ] **Step 5: Verify**

Run: `npx tsc -b && npm run lint`.

---

## Task 9: Token and type compliance (spec §0)

- [ ] **Step 1: Replace hex values that have exact tokens**

- `ConnectionsGame.tsx:24` `TIER_COLOR`: `"#ff8a3d"` → `"var(--brand2)"`, `"#c2510a"` → `"var(--brand-deep)"`. Leave `"#ffb347"` (no token) and the `TIER_INK` values (no tokens).
- `PackFive.css:127` `rgba(16,16,16,…)` → `rgba(0,0,0,…)` or use `--bg`; `PackFive.css:99` box-shadow → `var(--shadow)`.
- `ImposterGame.css:36` `box-shadow: 0 10px 30px rgba(0,0,0,0.28)` → `var(--shadow)`.
- `Contexto.css:95` `color-mix(in srgb, var(--good) 14%, var(--surface2))` → `var(--good-soft)`.
- **Leave** all `color:#fff` on brand/good fills (Wordle, FanFavorites, TicTacToe, Heatmap, WhoWouldWin) — no white token exists and `ui.css:31` sets the same precedent.

- [ ] **Step 2: Add missing `.tnum`**

`HeatmapGame.tsx:278`, `CareerPath.tsx:305` (draft label), `WhoAreYa.tsx:347-351` (jersey/draft), `SuperDraft.tsx:642` + `:636`, `ImposterGame.tsx:237-238` + `:335`, and the `ROUND n/total` digits in `PlayOffSeries.tsx:94`, `NameLogo.tsx:90`, `GuessMvps.tsx:89`. ConnectionsGame has **no** `.tnum` anywhere — add it to the `+50` feedback string's rendered number if one is shown.

- [ ] **Step 3: Add missing `.font-display` on names/headings**

Spec §0 requires Russo One for every heading, game name, and team name:
- `StartingFive.css:32` `.s5-team-name` — team name, add `.font-display` in the TSX
- `CareerPath.tsx:300` `.cp-card-team` — team name
- `ConnectionsGame` `.cn-solved-label`
- `NbaGrid` — renders **no** `.font-display` node at all; add it to `.ng-detail-head` and the `.ng-score` number
- `PackFive.tsx:322,355`, `SuperDraft.tsx:510`, `ImposterGame.tsx:384,347`, `BingoGame.tsx:317`, `Contexto.tsx:347,363,377`
- Replace raw `font-family:'Russo One'` with the class: `StartingFive.css:115`, `Wordle.css:29`

- [ ] **Step 4: Verify**

Run: `npx tsc -b && npm run lint`. Grep for remaining raw hex: `rg '#[0-9a-fA-F]{6}' src/styles src/Game\ Renderers` and confirm only the accepted `#fff`/no-token cases remain.

---

## Task 10: Content-game root gaps (spec §5)

**Files:** `NameLogo.tsx:86`, `GuessMvps.tsx:85`

Both are content games whose root uses a `clamp()` gap instead of the spec's fixed `20`.

- [ ] **Step 1: NameLogo**

`gap: "clamp(8px, 1.8dvh, 16px)"` → `gap: 20`.

- [ ] **Step 2: GuessMvps**

`gap: "clamp(10px, 2.2dvh, 20px)"` → `gap: 20`. Also fix the header `gap:8` → `gap:6` (`:98`) and the round transition `y:12/-12 @ 0.3` → `y:10/-10 @ 0.25` (`:104-107`).

- [ ] **Step 3: Verify at 390×844**

Run: `npm run build`. These are the two games most likely to overflow on a short screen once the gap is fixed — confirm the Exit button stays visible. If either overflows, revert that game to the clamp and record it as an accepted deviation.

---

## Task 11: Unify the wrong-answer feedback placement (spec §6)

**Files:** `NameLogo.tsx:173-175`, `GuessMvps.tsx:144-146`, `src/components/CorrectAnswer.tsx`

Both games mix the two feedback placements: correct answers use `SubmitGuessPopup` (shell slot) while wrong answers render the `CorrectAnswer` pill in an under-reserved in-flow row (`minHeight:30`/`34` vs a pill with `marginTop:1rem` + padding), which shifts layout on reveal.

- [ ] **Step 1: Route wrong answers through SubmitGuessPopup**

In both games, replace the `CorrectAnswer` row with a `SubmitGuessPopup` call carrying the truth statement:
- NameLogo: `` `It was the ${currentTeam.name}` `` in `var(--bad)`
- GuessMvps: `` `It was ${currentSeason.mvp}` `` in `var(--bad)`

Remove the now-unused `CorrectAnswer` import and the reserved row div from each.

- [ ] **Step 2: Check whether `CorrectAnswer` is still used**

Run: `rg "CorrectAnswer" src/`. If no game imports it, leave the component file in place (pre-existing code — do not delete unless it is now orphaned *by this change alone*, per the surgical-changes rule; note it in the summary either way).

- [ ] **Step 3: Verify**

Run: `npx tsc -b && npm run lint`.

---

## Task 12: Final verification

- [ ] **Step 1: Full static verification**

```bash
npx tsc -b
npm run lint
npm run build
```
All three must pass clean.

- [ ] **Step 2: Runtime smoke test at 390×844**

For each of the 18 games: press Play, confirm (a) one shell loader only, (b) no second end screen, (c) the Exit button is visible without page scroll, (d) feedback appears in one consistent spot.

- [ ] **Step 3: Record accepted deviations**

Update `docs/GAME_DESIGN_CONSTRAINTS.md` to close the three "Gap to close" notes (1500ms, ScorePanel `onClose`, and the PlayOffSeries feedback-placement divergence if Task 11 resolves it), and add a short "Accepted deviations" section listing StartingFive's 720px width and the games legitimately without a progress bar.
