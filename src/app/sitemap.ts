import type { MetadataRoute } from "next";
import { visibleGames } from "../utils/GameUtils";
import { SITE_URL } from "../configurations/site";
import { LEGAL } from "../configurations/legal";

/** Absolute URLs only. No changefreq/priority (Google ignores both) and lastModified only where the
 *  date is genuinely known: Google uses lastmod only when it is "consistently and verifiably accurate",
 *  so a build timestamp would teach it to ignore ours. */
export default function sitemap(): MetadataRoute.Sitemap {
  const games = visibleGames
    .filter((g) => g.id !== "coming-soon")
    .map((g) => ({ url: `${SITE_URL}${g.urlPath}` }));
  const legal = ["/privacy", "/terms"].map((path) => ({ url: `${SITE_URL}${path}`, lastModified: LEGAL.updatedIso }));
  return [{ url: `${SITE_URL}/` }, ...games, ...legal];
}
