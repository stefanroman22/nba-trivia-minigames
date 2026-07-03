// Maps an NBA team's name (current, relocated, or renamed) to the team id of the
// franchise it belongs to today, so we can resolve a *current* logo for it. The
// NBA CDN only hosts logos for the 30 active franchises (ids 1610612737–66);
// defunct early-BAA teams (Chicago Stags, Anderson Packers, …) aren't here, so
// they resolve to null and callers fall back to a generated crest.
//
// Generated from the shipped game data — keep in sync if franchises move/rename.
const TEAM_NAME_TO_ID: Record<string, number> = {
  "Atlanta Hawks": 1610612737,
  "Baltimore Bullets": 1610612764,
  "Boston Celtics": 1610612738,
  "Brooklyn Nets": 1610612751,
  "Buffalo Braves": 1610612746,
  "Capital Bullets": 1610612764,
  "Charlotte Bobcats": 1610612766,
  "Charlotte Hornets": 1610612766,
  "Chicago Bulls": 1610612741,
  "Cincinnati Royals": 1610612758,
  "Cleveland Cavaliers": 1610612739,
  "Dallas Mavericks": 1610612742,
  "Denver Nuggets": 1610612743,
  "Detroit Pistons": 1610612765,
  "Ft. Wayne Zollner Pistons": 1610612765,
  "Golden State Warriors": 1610612744,
  "Houston Rockets": 1610612745,
  "Indiana Pacers": 1610612754,
  "Kansas City Kings": 1610612758,
  "Kansas City-Omaha Kings": 1610612758,
  "LA Clippers": 1610612746,
  "Los Angeles Clippers": 1610612746,
  "Los Angeles Lakers": 1610612747,
  "Memphis Grizzlies": 1610612763,
  "Miami Heat": 1610612748,
  "Milwaukee Bucks": 1610612749,
  "Minneapolis Lakers": 1610612747,
  "Minnesota Timberwolves": 1610612750,
  "New Jersey Nets": 1610612751,
  "New Orleans Hornets": 1610612740,
  "New Orleans Pelicans": 1610612740,
  "New York Knicks": 1610612752,
  "Oklahoma City Thunder": 1610612760,
  "Orlando Magic": 1610612753,
  "Philadelphia 76ers": 1610612755,
  "Philadelphia Warriors": 1610612744,
  "Phoenix Suns": 1610612756,
  "Portland Trail Blazers": 1610612757,
  "Rochester Royals": 1610612758,
  "Sacramento Kings": 1610612758,
  "San Antonio Spurs": 1610612759,
  "San Diego Rockets": 1610612745,
  "San Francisco Warriors": 1610612744,
  "Seattle SuperSonics": 1610612760,
  "St. Louis Hawks": 1610612737,
  "Syracuse Nationals": 1610612755,
  "Toronto Raptors": 1610612761,
  "Tri-Cities Blackhawks": 1610612737,
  "Utah Jazz": 1610612762,
  "Washington Bullets": 1610612764,
  "Washington Wizards": 1610612764,
};

// Case-insensitive lookup so minor casing differences in the data still resolve.
const NORMALIZED: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_NAME_TO_ID).map(([name, id]) => [name.toLowerCase(), id]),
);

/** Logo URL for a team id (one of the 30 current franchises). */
export function logoForId(teamId: number): string {
  return `https://cdn.nba.com/logos/nba/${teamId}/primary/L/logo.svg`;
}

/**
 * Resolve the *current* NBA CDN logo for a team by name, following relocations
 * and renames (e.g. "Seattle SuperSonics" → Thunder logo). Returns null for
 * defunct franchises that have no current logo, so callers can fall back.
 */
export function currentLogoUrl(name?: string | null): string | null {
  if (!name) return null;
  const id = NORMALIZED[name.trim().toLowerCase()];
  return id ? logoForId(id) : null;
}
