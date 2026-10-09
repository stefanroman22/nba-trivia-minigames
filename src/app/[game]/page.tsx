import type { Metadata } from "next";
import { preload } from "react-dom";
import { games, visibleGames, backgroundUrl } from "../../utils/GameUtils";
import MiniGame from "../../views/Trivia/MiniGame";
import JsonLd from "../../components/JsonLd";
import { ORG_ID, SITE_NAME, SITE_URL } from "../../configurations/site";

/** Every playable, non-hidden game lives at /<slug>; "coming-soon" has its own page.
 *  Hidden games are excluded from generateStaticParams and dynamicParams is false,
 *  so their routes 404 instead of building. */
const gameSlugs = () =>
  visibleGames.filter((g) => g.id !== "coming-soon").map((g) => g.urlPath.replace(/^\//, ""));

// Only the catalogued slugs exist — anything else is a 404, not a runtime lookup.
export const dynamicParams = false;

export function generateStaticParams() {
  return gameSlugs().map((game) => ({ game }));
}

export async function generateMetadata({ params }: { params: Promise<{ game: string }> }): Promise<Metadata> {
  const { game } = await params;
  const entry = games.find((g) => g.urlPath === `/${game}`);
  if (!entry) return {};
  const description = entry.seoDescription ?? entry.description;
  const title = `${entry.name} | ${SITE_NAME}`;
  // Share images come from ./opengraph-image.tsx and ./twitter-image.tsx (generated per game).
  return {
    title: entry.name,
    description,
    alternates: { canonical: entry.urlPath },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: entry.urlPath, title, description },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function GamePage({ params }: { params: Promise<{ game: string }> }) {
  const { game } = await params;
  const entry = games.find((g) => g.urlPath === `/${game}`);
  if (!entry) return <MiniGame />;
  const art = backgroundUrl(entry.backgroundImage);
  // The idle thumbnail is the LCP element; preloading it with high priority lets the browser find it in the HTML.
  preload(art, { as: "image", fetchPriority: "high" });
  // VideoGame must be co-typed with WebApplication (Search Central "software apps"). No ratings: never invented.
  const gameJsonLd = {
    "@context": "https://schema.org",
    "@type": ["VideoGame", "WebApplication"],
    name: entry.name,
    description: entry.seoDescription ?? entry.description,
    url: `${SITE_URL}${entry.urlPath}`,
    image: `${SITE_URL}${art}`,
    genre: "Trivia",
    gamePlatform: "Web browser",
    applicationCategory: "GameApplication",
    operatingSystem: "Any",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    publisher: { "@id": ORG_ID },
  };
  return (
    <>
      <JsonLd data={gameJsonLd} />
      <MiniGame />
    </>
  );
}
