// Answer reviews for the two server-authoritative turn games, built from the relay's final turn
// state. One source for both callers (MULTIPLAYER_CONSTRAINTS MP-16): the renderer, which hands the
// review back with its end call, and the multiplayer store, which builds it from the final state it
// already holds when the relay's matchResult lands before that (delayed) end call could fire.
import type { AnswerReview } from "../types/review";
import type { PlayerInfo } from "../types/types";
import type { TttTurnState } from "../Game Renderers/TicTacToe";
import type { ImposterState } from "../Game Renderers/ImposterGame";

export interface ReviewSeat {
  uid: string;
  name: string;
  photo?: string | null;
  isSelf: boolean;
}

/** Tic-Tac-Toe: the final duel board, your cells marked. `qid` is the dealt grid's, when known. */
export function tttReview(s: TttTurnState, selfUid: string, qid?: string): AnswerReview {
  return {
    game: "tictactoe",
    qid,
    rows: s.criteria.rows,
    cols: s.criteria.cols,
    cells: s.board.map((c) => ({ name: c?.playerName ?? null, mine: c?.ownerUid === selfUid })),
    result: s.draw ? "draw" : s.winnerUid === selfUid ? "win" : "loss",
  };
}

/** Imposter: the reveal (mystery player, imposter, steal guess), scores best first, every clue. */
export function imposterReview(s: ImposterState, seatOf: (uid: string) => ReviewSeat): AnswerReview {
  return {
    game: "imposter",
    mystery: s.mysteryPlayer?.full_name ?? "—",
    imposterName: seatOf(s.imposterUid ?? "").name,
    imposterGuess: s.imposterGuess,
    guessCorrect: s.guessCorrect,
    seats: (s.order.length ? s.order : Object.keys(s.scores))
      .map((uid) => ({
        ...seatOf(uid),
        isImposter: uid === s.imposterUid,
        score: s.scores[uid] ?? 0,
        clues: s.clues.filter((c) => c.uid === uid).map((c) => c.text),
      }))
      .sort((a, b) => b.score - a.score),
  };
}

/** The store's fallback: a finished turn game's review from its final state, or null. */
export function turnReview(
  gameId: string | undefined,
  state: unknown,
  self: { uid: string; name: string; photo?: string | null },
  opponents: PlayerInfo[],
): AnswerReview | null {
  if (!state) return null;
  if (gameId === "tictactoe") {
    const s = state as TttTurnState;
    return s.board && (s.winnerUid || s.draw) ? tttReview(s, self.uid) : null;
  }
  if (gameId === "imposter") {
    const s = state as ImposterState;
    if (s.phase !== "reveal" || s.awaitingGuess) return null;
    const seatOf = (uid: string): ReviewSeat => {
      if (uid === self.uid) return { uid, name: self.name, photo: self.photo, isSelf: true };
      const o = opponents.find((p) => (p.id || p.username) === uid);
      return { uid, name: o?.username || "Player", photo: o?.profile_photo, isSelf: false };
    };
    return imposterReview(s, seatOf);
  }
  return null;
}
