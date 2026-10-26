import type { MetadataRoute } from "next";
import { games as catalogue } from "../utils/GameUtils";

const SITE_URL = "https://example.com";

/** Builds the game URLs from the whole catalogue, hidden games included. */
export default function sitemap(): MetadataRoute.Sitemap {
  const games = catalogue
    .filter((g) => g.id !== "coming-soon")
    .map((g) => ({ url: `${SITE_URL}${g.urlPath}` }));
  const legal = ["/privacy"].map((path) => ({ url: `${SITE_URL}${path}` }));
  return [{ url: `${SITE_URL}/` }, ...games, ...legal];
}
