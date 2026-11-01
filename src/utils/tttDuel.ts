// The Tic-Tac-Toe duel rules, pure (node-testable: scripts/test-ttt-duel.mjs). Local multiplayer plays by them in the
// browser; the online duel's relay mirrors them in multiplayer_server/src/turnGames.js (tttWinLine / tttJudge), and the
// test checks the two agree. One answer per turn: a known player who does not fit passes the turn; a name the game does
// not know, or a player already on the board, costs nothing.
import { durations } from "../motion/tokens";

/** The eight winning lines of a 3x3 board, cells numbered row by row (0-8). */
export const TTT_LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** A seat in a local match: 0 = Player 1 (X), 1 = Player 2 (O). */
export type Seat = 0 | 1;

/** The owner of a completed line and that line's three cells, or null. Owners are any value (seats, uids). */
export function winningLine<T>(owners: readonly (T | null | undefined)[]): { winner: T; line: number[] } | null {
  for (const [a, b, c] of TTT_LINES) {
    const o = owners[a];
    if (o != null && owners[b] === o && owners[c] === o) return { winner: o, line: [a, b, c] };
  }
  return null;
}

/** All nine cells taken (with no line, that is a draw). */
export function isFull(owners: readonly unknown[]): boolean {
  return owners.length === 9 && owners.every((o) => o != null);
}

/** Whose turn follows `seat`. */
export const nextPlayer = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** Who starts board number `index` (0-based) of a local session: Player 1, then Player 2, then Player 1, ... */
export const starterFor = (index: number): Seat => (index % 2 === 0 ? 0 : 1);

/** The win line's draw (TttWinLine, `durations.slow`), then the decided board and its banner held for a read. */
export const TTT_END_HOLD_MS = durations.slow * 1000 + 1500;
/** Reduced motion: nothing draws, so the board is held just long enough to read who won. */
export const TTT_END_HOLD_REDUCED_MS = 1000;

/**
 * How long a decided online duel keeps its final board on screen before the results replace it (the relay settles
 * the match in the same tick as the deciding move). 0 for a board that is not decided (or no board at all).
 */
export function endHoldMs(state: { winnerUid?: string | null; draw?: boolean } | null | undefined, reduced: boolean): number {
  if (!state || !(state.winnerUid || state.draw)) return 0;
  return reduced ? TTT_END_HOLD_REDUCED_MS : TTT_END_HOLD_MS;
}

export type Judgement =
  | { kind: "unknown" }
  | { kind: "used"; id: number }
  | { kind: "wrong"; id: number }
  | { kind: "right"; id: number };

/**
 * One typed answer for a square, judged the way solo judges it (TicTacToe.tsx handleSoloSubmit): the typed name's
 * players (`resolveIds`: an exact name or alias wins outright, so "Gary Payton" is never Gary Payton II); of those, the
 * first who fits the square and is not on the board yet, else the first one. Unknown name → `unknown`; that player
 * already on the board → `used`; he does not fit → `wrong`; otherwise `right`.
 */
export function judgeAnswer(
  raw: string,
  cell: number,
  valid: readonly (readonly number[])[],
  used: ReadonlySet<number>,
  lookup: { resolveIds: (guess: string) => number[] },
): Judgement {
  const fits = valid[cell] ?? [];
  const ids = lookup.resolveIds(raw);
  const id = ids.find((x) => fits.includes(x) && !used.has(x)) ?? ids[0];
  if (id === undefined) return { kind: "unknown" };
  if (used.has(id)) return { kind: "used", id };
  return fits.includes(id) ? { kind: "right", id } : { kind: "wrong", id };
}
