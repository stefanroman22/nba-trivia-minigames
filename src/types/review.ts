// Answer review: the read-only snapshot a renderer hands back with its final score
// (`onGameEnd(score, { review })`). Online it is kept per round in the multiplayer store and
// shown by the "See answers" modal once the player has finished (MULTIPLAYER_CONSTRAINTS MP-16);
// single-player keeps it for "Report a problem" (src/utils/reviewRounds.ts). Plain data only: names, labels, ids and flags, never functions.
import type { Criterion, PlayerTeamStint } from "./types";

/** Who Are Ya chip (mirrors the renderer's ChipVal). */
export interface ReviewChip { text: string; state: "hit" | "close" | "miss" | "na"; arrow?: "up" | "down" }

export interface WayaReviewRow {
  key: string;
  name: string;
  correct: boolean;
  conf: ReviewChip; div: ReviewChip; team: ReviewChip;
  pos: ReviewChip; age: ReviewChip; jersey: ReviewChip; draft: ReviewChip;
}

export type AnswerReview =
  | {
      game: "series-winner";
      rounds: {
        matchId: string;
        label: string;
        teams: { name: string; logo: string; wins: number }[];
        winner: string;
        pick: string | null;
      }[];
    }
  | { game: "name-logo"; rounds: { team: string; teamId: number; pick: string | null; correct: boolean }[] }
  | { game: "guess-mvps"; rounds: { season: string; award?: string; mvp: string; pick: string | null; correct: boolean }[] }
  | {
      game: "starting-five";
      matchup: { gameId: string; teamA: string; teamB: string; logoA: string; logoB: string; winner: string; score: string; date: string };
      slots: { key: string; label: string; name: string | null; found: boolean }[];
    }
  | { game: "wordle"; solution: string; guesses: string[]; won: boolean }
  | { game: "fan-favorites"; qid: string; prompt: string; asked: string; answers: { answer: string; count: number; hit: boolean }[] }
  | {
      game: "heatmap";
      rows: { id: number; label: string; type: Criterion["type"]; claimedBy: string | null; example: string | null }[][];
    }
  | { game: "connections"; groups: { label: string; difficulty: number; members: string[]; solved: boolean }[] }
  | {
      game: "career-path";
      player: { person_id: number; full_name: string };
      teams: PlayerTeamStint[];
      draft: string;
      guesses: string[];
      won: boolean;
    }
  | { game: "nba-grid"; rows: string[]; cols: string[]; cells: { pick: string | null; examples: string[] }[] }
  | { game: "who-are-ya"; mystery: { person_id: number; full_name: string; sub: string }; rows: WayaReviewRow[]; won: boolean }
  | {
      game: "tictactoe";
      /** The dealt grid's qid: set in single player; absent in online matches (the relay sends no qid). */
      qid?: string;
      rows: Criterion[];
      cols: Criterion[];
      cells: { name: string | null; mine: boolean }[];
      result: "win" | "loss" | "draw";
    }
  | { game: "who-would-win"; rounds: { qid: string; a: string; b: string; pick: "a" | "b" | null }[] }
  | { game: "bingo"; cells: { label: string; claimedBy: string | null; example: string | null }[] }
  | {
      game: "contexto";
      secret: { person_id: number; full_name: string };
      rows: { pid: number; name: string; rank: number }[];
      poolSize: number;
      won: boolean;
    }
  | {
      game: "pack-five";
      turns: { stat: string; card: { name: string; value: string }; next: { name: string; value: string }; hit: boolean }[];
    }
  | {
      game: "superdraft";
      objective: string;
      aggLabel: string;
      aggregate: string;
      percentile: number;
      slots: {
        label: string;
        sub: string;
        kind: string;
        pick: { person_id: number; name: string; metric: string } | null;
        best: { person_id: number; name: string; metric: string } | null;
      }[];
    }
  | {
      game: "imposter";
      mystery: string;
      imposterName: string;
      imposterGuess: string | null;
      guessCorrect: boolean | null;
      seats: { uid: string; name: string; photo?: string | null; isSelf: boolean; isImposter: boolean; score: number; clues: string[] }[];
    };

export type AnswerReviewGame = AnswerReview["game"];
