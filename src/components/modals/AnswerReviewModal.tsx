// "See answers" (ModalKind "answerReview"): the latest round's answers, after you finished it.
// Loaded lazily by ModalHost: it pulls in every game's review pieces, which only game pages need.
import type { ReactNode } from "react";
import { useMultiplayer } from "../../context/MultiplayerContext";
import {
  BingoReview, CareerPathReview, ConnectionsReview, ContextoReview, FanFavoritesReview, HeatmapReview,
  ImposterReview, NbaGridReview, StartingFiveReview, TicTacToeReview, WhoAreYaReview, WordleReview,
} from "../review/BoardReviews";
import { LogoReview, MvpReview, PackFiveReview, SeriesReview, SuperDraftReview } from "../review/RoundReviews";
import type { AnswerReviewPayload } from "../../context/ModalContext";
import type { AnswerReview } from "../../types/review";
import "../../styles/AnswerReview.css";

function ReviewBody({ review }: { review: AnswerReview }): ReactNode {
  switch (review.game) {
    case "series-winner": return <SeriesReview review={review} />;
    case "name-logo": return <LogoReview review={review} />;
    case "guess-mvps": return <MvpReview review={review} />;
    case "starting-five": return <StartingFiveReview review={review} />;
    case "wordle": return <WordleReview review={review} />;
    case "fan-favorites": return <FanFavoritesReview review={review} />;
    case "heatmap": return <HeatmapReview review={review} />;
    case "connections": return <ConnectionsReview review={review} />;
    case "career-path": return <CareerPathReview review={review} />;
    case "nba-grid": return <NbaGridReview review={review} />;
    case "who-are-ya": return <WhoAreYaReview review={review} />;
    case "tictactoe": return <TicTacToeReview review={review} />;
    case "bingo": return <BingoReview review={review} />;
    case "contexto": return <ContextoReview review={review} />;
    case "pack-five": return <PackFiveReview review={review} />;
    case "superdraft": return <SuperDraftReview review={review} />;
    case "imposter": return <ImposterReview review={review} />;
  }
}

/** Online: reads the round's review straight from the match store, so it can never outlive its round
 *  (ModalHost closes this modal as soon as the store drops it). Single player ("See why") passes its own
 *  review, name and score instead, and the store is not read. */
export default function AnswerReviewModal({ review: own, title, score }: Partial<AnswerReviewPayload>) {
  const { mp } = useMultiplayer();
  const review = own ?? mp.review;
  if (!review) return null;
  const solo = own !== undefined;
  const name = (solo ? title : mp.game?.name) ?? "This round";
  const yourScore = solo ? score : mp.yourScore;
  return (
    <div className="ar">
      <div className="ar-meta">
        <span className="ar-game font-display">{name}</span>
        {yourScore != null && (
          <span className="ar-score tnum"><span>Your score </span>{yourScore.toLocaleString()}</span>
        )}
      </div>
      <ReviewBody review={review} />
    </div>
  );
}
