// One entry per game card.
//   id         game id from src/utils/GameUtils.tsx
//   assetFile  the file GameUtils imports; `apply` overwrites it, so no code changes are needed
//   concept    what the AI stage renders (subject only; style comes from style.mjs)
//   keywords   Pexels search for a real source photo (fetch-sources.mjs)
//   existing   "valid" = the current asset is a real picture worth translating,
//              "generic" = flat gradient + icon placeholder, "replace" = real picture but not ours
//              to keep (copyrighted photo / third-party logos) - translate for a preview only.
export const manifest = [
  {
    id: "series-winner",
    assetFile: "playoff_series.jpg",
    existing: "replace",
    concept:
      "Two symmetrical tournament bracket boards made of bevelled dark panels flanking a tall golden championship trophy on a black marble pedestal; the bracket slots are empty glowing panels, orange rim light along every edge.",
    keywords: "basketball trophy arena dark",
  },
  {
    id: "name-logo",
    assetFile: "guess_the_logo.jpg",
    existing: "replace",
    concept:
      "A wall of blank glossy shield-shaped badges on dark panels, six badges in two rows, one badge lit from inside in orange, the rest dim charcoal; a spotlight from above. The badges are empty shapes, no emblems.",
    keywords: "basketball court floor dark",
  },
  {
    id: "guess-mvps",
    assetFile: "mvp.jpg",
    existing: "replace",
    concept:
      "A single gleaming abstract MVP trophy (a basketball on a tall column) on a podium, confetti frozen mid-air lit orange, arena lights as soft bokeh in the dark background.",
    keywords: "basketball confetti celebration arena",
  },
  {
    id: "starting-five",
    assetFile: "starting_five.jpg",
    existing: "replace",
    concept:
      "Five dark faceless player silhouettes standing in a row on a court baseline, the centre one outlined in glowing orange, jerseys blank, hardwood floor reflecting the light.",
    keywords: "basketball team silhouette lineup",
  },
  {
    id: "wordle",
    assetFile: "wordle.jpg",
    existing: "replace",
    concept:
      "A floating 5 by 6 grid of bevelled dark tiles above a court floor, a handful of tiles glowing orange, others dim charcoal, seen slightly from below; the tiles are blank.",
    keywords: "basketball hoop net close up dark",
  },
  {
    id: "fan-favorites",
    assetFile: "thumb_fan_favorites.jpg",
    existing: "generic",
    concept:
      "A three-step podium made of dark bevelled blocks with the top step lit orange, a crowd of raised-hand silhouettes behind it in fog.",
    keywords: "basketball crowd cheering arena",
  },
  {
    id: "heatmap",
    assetFile: "thumb_heatmap.jpg",
    existing: "generic",
    concept:
      "A floor of hexagonal tiles viewed at a low angle, a cluster of hexes glowing orange fading to charcoal at the edges, thin orange seams between tiles.",
    keywords: "hexagon pattern dark",
  },
  {
    id: "connections",
    assetFile: "thumb_connections.jpg",
    existing: "generic",
    concept:
      "A 4 by 4 grid of dark bevelled tiles, four of them lifted and linked by glowing orange lines into one group, the rest dim.",
    keywords: "basketball court lines overhead",
  },
  {
    id: "career-path",
    assetFile: "thumb_career_path.jpg",
    existing: "generic",
    concept:
      "A winding path of glowing orange nodes connected by thin light lines across a dark court floor, like a 3D route map, the last node brightest.",
    keywords: "basketball court dark aerial",
  },
  {
    id: "nba-grid",
    assetFile: "thumb_nba_grid.jpg",
    existing: "generic",
    concept:
      "A 3 by 3 grid of bevelled dark cells with a glowing orange frame and row and column headers as blank panels, one centre cell lit orange.",
    keywords: "grid dark metal",
  },
  {
    id: "who-are-ya",
    assetFile: "thumb_who_are_ya.jpg",
    existing: "generic",
    concept:
      "A faceless player silhouette seen through frosted glass, blurred and pixelated, a thin orange rim light tracing the outline, mystery mood.",
    keywords: "basketball player silhouette dark",
  },
  {
    id: "tictactoe",
    assetFile: "thumb_tictactoe.jpg",
    existing: "generic",
    concept:
      "A 3 by 3 board on dark marble with glowing orange X and O shapes made of neon light tubes, one winning diagonal brighter.",
    keywords: "neon lines dark",
  },
  {
    id: "bingo",
    assetFile: "thumb_bingo.jpg",
    existing: "generic",
    concept:
      "A 5 by 5 card of bevelled dark tiles standing on a pedestal, a diagonal of tiles stamped with glowing orange discs.",
    keywords: "basketball dark pattern",
  },
  {
    id: "contexto",
    assetFile: "thumb_contexto.jpg",
    existing: "generic",
    concept:
      "Concentric target rings etched into a dark floor, the centre glowing orange, a small orange dot sliding inward along the rings.",
    keywords: "target rings dark",
  },
  {
    id: "pack-five",
    assetFile: "thumb_pack_five.jpg",
    existing: "generic",
    concept:
      "Five dark trading cards fanned out on marble, one card glowing orange with blank stat bars, orange rim light on the edges.",
    keywords: "cards fanned dark",
  },
  {
    id: "superdraft",
    assetFile: "thumb_superdraft.jpg",
    existing: "generic",
    concept:
      "A draft board with five empty orange-lit slots in a row and a basketball on a pedestal in front, podium lighting.",
    keywords: "basketball on pedestal dark",
  },
  {
    id: "imposter",
    assetFile: "thumb_imposter.jpg",
    existing: "generic",
    concept:
      "Four dark faceless figures around a round table under one spotlight, one figure outlined in glowing orange, heavy shadows.",
    keywords: "silhouettes table spotlight dark",
  },
  {
    id: "who-would-win",
    assetFile: "thumb_who_would_win.jpg",
    existing: "generic",
    concept:
      "Two dark pedestals facing each other with a jagged glowing orange split line between them, each pedestal lit by its own spotlight, nothing on them.",
    keywords: "versus spotlight dark stage",
  },
  {
    id: "coming-soon",
    assetFile: "coming_soon.jpg",
    existing: "generic",
    concept:
      "An empty court in fog under a single orange light, a covered pedestal in the centre, everything else dark.",
    keywords: "empty basketball court dark fog",
  },
];

export const byId = Object.fromEntries(manifest.map((g) => [g.id, g]));

export function pick(ids) {
  if (!ids) return manifest;
  const want = String(ids).split(",").map((s) => s.trim()).filter(Boolean);
  const missing = want.filter((id) => !byId[id]);
  if (missing.length) throw new Error(`Unknown game id(s): ${missing.join(", ")}`);
  return want.map((id) => byId[id]);
}
