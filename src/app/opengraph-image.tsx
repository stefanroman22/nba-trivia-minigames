import { renderShareCard, shareCardContentType, shareCardSize } from "../utils/shareCard";
import { SITE_NAME } from "../configurations/site";

export const alt = `${SITE_NAME}: free NBA trivia games`;
export const size = shareCardSize;
export const contentType = shareCardContentType;

export default function Image() {
  return renderShareCard("Free NBA Trivia Games", "NBA Wordle, Career Path, Who Are Ya?, Tic-Tac-Toe and more. Play in your browser.");
}
