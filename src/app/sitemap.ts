import type { MetadataRoute } from "next";
import { visibleGames } from "../utils/GameUtils";
import { SITE_URL } from "../configurations/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const games = visibleGames
    .filter((g) => g.id !== "coming-soon")
    .map((g) => ({ url: `${SITE_URL}${g.urlPath}`, changeFrequency: "weekly" as const, priority: 0.8 }));
  return [{ url: `${SITE_URL}/`, changeFrequency: "weekly", priority: 1 }, ...games];
}
