// Fixture catalogue for check:seo: the shape of src/utils/GameUtils.tsx, trimmed.
interface Game {
  id: string;
  name: string;
  description: string;
  seoDescription?: string;
  urlPath: string;
  hidden?: boolean;
  [key: string]: unknown;
}

const bg = { src: "/bg.png" };

export const games: Game[] = [
  {
    id: "series-winner",
    name: "Guess the Series Winner",
    description: "Pick the winner between two teams from a real NBA playoff series.",
    seoDescription: "Guess the winner of real NBA playoff series. Two teams from a historic matchup, five rounds, 20 points per correct call.",
    rules: [
      { n: "1", t: "Two teams from a real playoff series are shown each round." },
      { n: "2", t: "Tap the team you think won that series." },
    ],
    instruction: `
      <div class="space-y-2">
        <p>Travel back in time. seoDescription: "not a field", urlPath: "/not_a_field"</p>
        <p class="text-xs italic mt-2">Press 'Play' to begin the challenge!</p>
      </div>
    `,
    backgroundImage: `url('${bg.src}')`,
    urlPath: "/series-winner",
    fetchData: () => Promise.resolve({ id: "x", hidden: true }),
  },
  {
    id: "name-logo",
    name: "Name the NBA Club",
    description: "Only real fans name every logo.",
    // Escaped quotes count as one character each.
    seoDescription: "Name the NBA club behind each team logo.",
    backgroundImage: `url('${bg.src}')`,
    urlPath: "/name-logo",
  },
  {
    id: "heatmap",
    name: "The Heatmap",
    description: "Hidden games are not checked: no seoDescription, and this urlPath would fail.",
    urlPath: "/Heat_Map",
    hidden: true,
  },
  {
    id: "coming-soon",
    name: "Coming Soon",
    description: "A new game is currently in development.",
    urlPath: "/coming-soon",
  },
];

/** `games` minus anything flagged `hidden`. */
export const visibleGames: Game[] = games.filter((g) => !g.hidden);

export const backgroundUrl = (css: string) => css.replace(/^url\(['"]?/, "").replace(/['"]?\)$/, "");
