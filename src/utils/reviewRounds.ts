// "Report a problem": the questions a finished game dealt, read from its AnswerReview.
// `question_id` is the id the game logs and the roll-ups count (GuessLog.question_id); `label` is
// what the player saw. Games whose review carries no question id give [] (nothing to report).
// Type imports only: scripts/check-review-rounds.mjs loads this file on its own.
import type { AnswerReview } from "../types/review";

export interface ReviewRound {
  question_id: string;
  label: string;
}

/** The season part of a series label ("First Round · 1980-81" -> "1980-81"). */
const seasonOf = (label: string) => label.split(" · ").pop() ?? label;

function rounds(review: AnswerReview): ReviewRound[] {
  switch (review.game) {
    case "series-winner":
      return review.rounds.map((r) => ({
        question_id: r.matchId,
        label: `${r.teams[0]?.name ?? ""} vs ${r.teams[1]?.name ?? ""} ${seasonOf(r.label)}`,
      }));
    case "name-logo":
      return review.rounds.map((r) => ({ question_id: String(r.teamId), label: `${r.team} logo` }));
    case "guess-mvps":
      // The id GuessMvps logs (utils/awardSeasons.ts awardQuestionId): season:award, the season on an old row.
      return review.rounds.map((r) => ({
        question_id: r.award ? `${r.season}:${r.award}` : r.season,
        label: `${r.season} ${r.award ?? "MVP"}`,
      }));
    case "starting-five": {
      const m = review.matchup;
      return [{ question_id: m.gameId, label: `${m.teamA} vs ${m.teamB} ${m.date}` }];
    }
    case "wordle": {
      const word = review.solution.toUpperCase();
      return [{ question_id: word, label: word }];
    }
    case "fan-favorites":
      return [{ question_id: review.qid, label: review.prompt }];
    case "career-path":
      return [{ question_id: String(review.player.person_id), label: review.player.full_name }];
    case "who-are-ya":
      return [{ question_id: String(review.mystery.person_id), label: review.mystery.full_name }];
    case "tictactoe":
      return review.qid ? [{ question_id: review.qid, label: `Board ${review.qid}` }] : [];
    case "contexto":
      return [{ question_id: String(review.secret.person_id), label: review.secret.full_name }];
    case "who-would-win":
      return review.rounds.map((r) => ({ question_id: r.qid, label: `${r.a} vs ${r.b}` }));
    case "heatmap":
    case "connections":
    case "nba-grid":
    case "bingo":
    case "pack-five":
    case "superdraft":
    case "imposter":
      return [];
  }
}

/** The reportable questions of a finished game, in the order they were dealt; [] when there are none. */
export function reviewRounds(review: AnswerReview | null | undefined): ReviewRound[] {
  if (!review) return [];
  // A round without a usable id (missing, or longer than the server's 60-character column) can't be reported.
  return rounds(review).filter((r) => r.question_id !== "" && r.question_id !== "undefined" && r.question_id.length <= 60);
}
