# NBA Tic-Tac-Toe: local multiplayer + standard online rules

Date: 2026-11-01 · Owner: Stefan · Status: approved in chat 2026-11-01

## Why

Stefan wants two people on one device to play NBA Tic-Tac-Toe against each other, no account needed, and
online Tic-Tac-Toe to follow the same, standard rules: a turn is one answer, three in a row wins.

## Decisions (owner, 2026-11-01)

- One answer per turn. Right → the player's mark goes in the cell. A valid NBA player who does not fit the
  square, or the 30-second time-out → the turn passes. Same in local and online.
- No steals (online loses its 3 steals and the Steal button).
- Online 1v1 points unchanged: win 300, draw 180, loss 45 (`turnGames.js` TTT_WIN/DRAW/LOSS_SCORE).
- Local mode: no login, no points, nothing stored, frontend only.
- Solo "Play" stays exactly as today (cells show the answer's name, no X/O, 3-minute clock).

## Calls made for the owner (stated in chat, not objected to)

- Player 1 is always X, Player 2 always O; Play again alternates who STARTS (game 1 Player 1, game 2
  Player 2, ...). A mark never changes owner.
- A name the game does not know ("Not in our player index") or a player already on the board costs nothing:
  a notice, the turn and the clock continue. Only a known player who does not fit passes the turn.
- Players are shown as a circle with the name's first letter + their mark; no images.
- Empty name fields default to "Player 1" / "Player 2".
- A full board with no line is a draw.

## Entry point

- `MultiplayerPanel` (idle aside; right column ≥1200px, stacked under the stage below that) gets a
  **Local multiplayer** button, shown only for games that support local play (Tic-Tac-Toe now; a
  `Game.localMultiplayer` flag in `src/utils/GameUtils.tsx`). Visible logged in AND logged out.
- Sub-text under the "Multiplayer" heading: **"Play online or on this device with a friend."** (logged-in
  view gets the sub-text too; the logged-out one replaces its current sentence).
- Pressing it opens the local mode in the stage (it is not an online match: `MpState.phase` stays idle,
  MP-5). Opening it while an online search/room is active is not possible (button disabled then).

## Local mode (in the stage, GameFrame root, Rule 0)

1. **Setup**: two `Field`s "Player 1 · X" and "Player 2 · O" (max 16 chars, trimmed), the board difficulty is
   the idle switch's current pick, **Start** (`Button`), and the shell's single "Close game" (4.6).
2. **Match** (same `TttBoard`, 3×3, content game 4.1):
   - Status row (the only left/right element, 4.7): Player X chip left, Player O chip right — initial circle
     (`Avatar` initials), name, mark; the active player's chip is lit (brand), the other muted; the 30-second
     countdown sits in the status row's centre / label (`tnum`, low state ≤5 s), via `SwapText` (UI-21).
   - Prompt: "<Name>'s turn" + "Pick a square"; after a square is picked: "<row label> × <col label>" and the
     `GameFrame.InputRow` with the shared autocomplete (same name list as solo) and Confirm.
   - Judging = solo's: `lookup.resolveIds(raw)` → the first id in `valid[cell]` not yet used on the board.
     Unknown name / already used → notice, nothing else changes. Doesn't fit → "Doesn't fit", turn passes.
     Right → the cell gets the mark (a stroke-drawn X or O, the answer's name small under it), turn passes.
   - Time-out → "Time's up", turn passes. Feedback via `SubmitGuessPopup` (6.0/6.1).
3. **End**: three in a row → the **win line** draws across the three cells (SVG stroke, pathLength 0→1,
   shared motion tokens, reduced motion = shown at once), then "<Name> wins!" with **Play again** and **Close
   game**; full board → "Draw!". Play again deals a new board (same difficulty) and the other player starts.
   No `onGameEnd` score submission and no guess log (nothing stored).

## Online changes (relay `multiplayer_server/src/turnGames.js` + `src/Game Renderers/TicTacToe.tsx` duel)

- `TTT_TURN_MS` 25000 → 30000.
- Wrong answer (a known player not in `valid[cell]`) → the turn passes to the opponent (as a timeout does),
  with a `turnReject`-style notice for the mover; unknown name / already used → reject, turn kept.
- Steals removed: `steal` actions are rejected; `TTT_STEALS` and the steal counter/toggle go; the
  `TttTurnState` contract (#6) keeps its shape where possible (document any field change, update
  `tttReview` / `BoardReviews` if the shape changes, MP-16).
- Win line: the same component draws over the board when the relay reports a winning line (the relay
  already knows `TTT_LINES`; send the winning line indices in the final state if not already there), before
  the existing "You win!/Opponent wins/Draw!" banner and result screen.
- Rules copy in the game entry (`GameUtils.tsx`, "25 seconds per turn; 3 steals…") updated.
- `sim_turngames.js` updated for the new rules (wrong answer passes, no steals, 30 s).
- **Deploy**: the relay is a manual deploy; the frontend and the relay ship in the same window (relay right
  after the frontend), or online Tic-Tac-Toe runs old rules against the new client.

## Shared pieces

- `src/utils/tttDuel.ts` (pure, node-testable): `TTT_LINES`, `winningLine(marks)`, `isFull`, `nextPlayer`,
  `judgeAnswer(raw, cell, valid, used, lookup)` → `unknown | used | wrong | right(id)`.
- `src/components/motion/TttWinLine.tsx` (or inside TicTacToe): the stroke line over a 3×3 board given the
  line's cell indices.
- Marks: X and O drawn as SVG strokes in the cell (X brand orange, O the neutral text colour: one accent,
  Rule 0.1).

## Constraints to respect

GAME_DESIGN 0, 0.1, 1.1 (fits 390×844 with Exit visible), 4.1, 4.6, 4.7, 4.8, 6.0-6.4, 7.x where
applicable (local end is in place, no score submission), 8.1; MULTIPLAYER MP-2 (relay owns online turn
state), MP-3, MP-5 (no parallel match flag), MP-12/13, MP-16; UI_SHELL UI-10, UI-13, UI-20..23.

## Verification

Node tests for `tttDuel` (lines, winner, full board, judging), the relay sim, lint, `tsc --noEmit`, `next
build`, a real 390×844 local playthrough (setup → turns → win line → Play again starts Player 2 → draw), the
game's ui-checks on all 7 viewports, an independent review.
