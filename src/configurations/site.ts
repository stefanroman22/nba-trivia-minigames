export const SITE_NAME = "HOOPS24";
export const SITE_DESCRIPTION =
  "Free daily NBA trivia minigames: wordle, grids, guess-the-player and more. Play solo or online, score points and climb the leaderboard.";
const fromEnv =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  "https://nba-minigames.vercel.app";
/** Absolute public origin of the deployed site, no trailing slash — every canonical/OG/JSON-LD/sitemap URL derives from it. */
export const SITE_URL = fromEnv.replace(/\/+$/, "");
