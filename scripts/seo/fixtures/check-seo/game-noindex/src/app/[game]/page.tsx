import type { Metadata } from "next";
import { games, visibleGames } from "../../utils/GameUtils";

const gameSlugs = () =>
  visibleGames.filter((g) => g.id !== "coming-soon").map((g) => g.urlPath.replace(/^\//, ""));

export const dynamicParams = false;

export function generateStaticParams() {
  return gameSlugs().map((game) => ({ game }));
}

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game } = await params;
  const entry = games.find((g) => g.urlPath === `/${game}`);
  if (!entry) return {};
  const description = entry.seoDescription ?? entry.description;
  const title = `${entry.name} | Fixture Site`;
  return {
    title: entry.name,
    description,
    alternates: { canonical: entry.urlPath },
    robots: { index: false },
    openGraph: { type: "website", url: entry.urlPath, title, description },
  };
}

export default async function GamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  return game;
}
