import { games, visibleGames } from "../../utils/GameUtils";
import { renderShareCard, shareCardContentType, shareCardSize } from "../../utils/shareCard";
import { SITE_NAME } from "../../configurations/site";

export const alt = `An NBA trivia game on ${SITE_NAME}`;
export const size = shareCardSize;
export const contentType = shareCardContentType;

// Prebuilt for every game page (like the page itself), so no function runs per share.
export function generateStaticParams() {
  return visibleGames.filter((g) => g.id !== "coming-soon").map((g) => ({ game: g.urlPath.replace(/^\//, "") }));
}

export default async function Image({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const entry = games.find((g) => g.urlPath === `/${game}`);
  return renderShareCard(entry?.name ?? SITE_NAME, entry?.description ?? "Free NBA trivia games");
}
