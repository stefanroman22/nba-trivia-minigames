import { visibleGames } from "../../utils/GameUtils";
import { FORMER_NAME, SITE_NAME, SITE_URL } from "../../configurations/site";

// Built from the game catalogue at build time, so it can never list a removed game or miss a new one.
export const dynamic = "force-static";

/** /llms.txt in the llmstxt.org format: H1 name, blockquote summary, context, H2 link lists, "Optional". */
export function GET() {
  const games = visibleGames
    .filter((g) => g.id !== "coming-soon")
    .map((g) => `- [${g.name}](${SITE_URL}${g.urlPath}): ${g.seoDescription ?? g.description}`)
    .join("\n");

  const body = `# ${SITE_NAME}

> ${SITE_NAME} (${SITE_URL.replace(/^https?:\/\//, "")}, formerly ${FORMER_NAME}) is a free, browser-based collection of NBA trivia games: guess players, teams, MVPs, lineups and playoff winners, then climb the leaderboard.

Every game has its own server-rendered page with a "How to play" section. No download or account is needed to play; a free account (13+) keeps points and a place on the leaderboard. English only. Not affiliated with or endorsed by the NBA.

## Games

${games}

## About

- [Home](${SITE_URL}/): all games, today's featured game and the leaderboard

## Optional

- [Privacy Policy](${SITE_URL}/privacy): what is collected and how to export or delete it
- [Terms of Service](${SITE_URL}/terms): rules, moderation and appeals
`;
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
