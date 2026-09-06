import type { Metadata } from "next";
import { games } from "../../utils/GameUtils";
import MiniGame from "../../views/Trivia/MiniGame";

/** Every playable game lives at /<slug>; "coming-soon" has its own page. */
const gameSlugs = () =>
  games.filter((g) => g.id !== "coming-soon").map((g) => g.urlPath.replace(/^\//, ""));

// Only the catalogued slugs exist — anything else is a 404, not a runtime lookup.
export const dynamicParams = false;

export function generateStaticParams() {
  return gameSlugs().map((game) => ({ game }));
}

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game } = await params;
  const entry = games.find((g) => g.urlPath === `/${game}`);
  return entry ? { title: entry.name, description: entry.description } : {};
}

export default function GamePage() {
  return <MiniGame />;
}
