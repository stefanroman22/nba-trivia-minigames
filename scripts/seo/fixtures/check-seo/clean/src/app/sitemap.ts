import type { MetadataRoute } from "next";
import { visibleGames } from "../utils/GameUtils";

const SITE_URL = "https://example.com";

/** Absolute URLs only; games come from the visible catalogue. */
export default function sitemap(): MetadataRoute.Sitemap {
  const games = visibleGames
    .filter((g) => g.id !== "coming-soon")
    .map((g) => ({ url: `${SITE_URL}${g.urlPath}` }));
  const legal = ["/privacy"].map((path) => ({ url: `${SITE_URL}${path}` }));
  return [{ url: `${SITE_URL}/` }, ...games, ...legal];
}
