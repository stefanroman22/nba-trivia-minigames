// NBA season strings in "YYYY-YY" form, newest first. Suggestion source for
// season-category Fan Favorites questions (matches the season format stored on
// PlayoffSeries / Mvp / StartingFiveGame). Bump LATEST_START when a new season
// tips off.
const LATEST_START = 2025; // 2025-26 season
const FIRST_START = 1946; // inaugural BAA/NBA season 1946-47

function buildSeasons(): string[] {
  const out: string[] = [];
  for (let y = LATEST_START; y >= FIRST_START; y--) {
    out.push(`${y}-${String(y + 1).slice(2)}`);
  }
  return out;
}

export const nbaSeasons = buildSeasons();
