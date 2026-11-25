import type { Metadata } from "next";
import CustomGame from "../../../views/CustomGame";

// A published AI-built community game, reached only by its link: never indexed, never in the sitemap, and not linked
// from anywhere on the site. Slugs exist only in the database, so there is no generateStaticParams: the page is
// rendered per request and the view asks the backend whether the game is published (a 404 shows "not available").
export const metadata: Metadata = {
  title: "Community game",
  robots: { index: false, follow: false },
};

export default async function CustomGamePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CustomGame slug={slug} />;
}
