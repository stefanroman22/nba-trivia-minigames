/** The brand, everywhere: titles, Open Graph, JSON-LD, manifest, llms.txt, navbar and footer. */
export const SITE_NAME = "Swish Quest";
/** Home page title and the default title of any page without its own. */
export const SITE_TITLE = "Swish Quest: Free NBA Trivia Games";
/** Short line shown under the wordmark. */
export const SITE_TAGLINE = "NBA TRIVIA GAMES";
export const SITE_DESCRIPTION =
  "Free NBA trivia games in your browser: NBA Wordle, Career Path, Who Are Ya?, Tic-Tac-Toe and more. Play solo, score points and climb the leaderboard.";

/** The one public address. Hard-coded on purpose: VERCEL_PROJECT_PRODUCTION_URL changes if a shorter
 *  domain is ever attached, and preview/alias hosts must still canonicalise here. NEXT_PUBLIC_SITE_URL
 *  can override it for local QA only. No trailing slash. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://swishquest.com").replace(/\/+$/, "");
export const SITE_HOST = new URL(SITE_URL).host;

/** Google Search Console HTML-tag verification for the old https://nba-minigames.vercel.app/ property
 *  (needed for the Change of Address tool). Public by design; keep it while that property exists. */
export const GOOGLE_SITE_VERIFICATION = "Go6H589V1n8cNpZFONJqd3O6XsICBjZ7KiHI3GacoEE";

/** Stable JSON-LD node ids, so pages can reference the organisation instead of repeating it. */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;
/** Square PNG logo (>= 112 px, crawlable) for Organization.logo; generated into public/. */
export const LOGO_URL = `${SITE_URL}/logo-512.png`;
