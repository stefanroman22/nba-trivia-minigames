// Maps an NBA team's name (current, relocated, or renamed) to the team id of the
// franchise it belongs to today. Used for the team's colours (teamColorsFor in
// utils/teamNameGradient.ts, following relocations: "Seattle SuperSonics" -> the
// Thunder's) and for Name the NBA Club's scrambled puzzle image. No team logo is
// loaded anywhere: teams show as TeamBadge / TeamNameGradient. Defunct early-BAA
// teams (Chicago Stags, Anderson Packers, ...) aren't here and resolve to null.
//
// Generated from the shipped game data — keep in sync if franchises move/rename.
export const TEAM_NAME_TO_ID: Record<string, number> = {
  "Atlanta Hawks": 1610612737,
  "Baltimore Bullets": 1610612764,
  "Boston Celtics": 1610612738,
  "Brooklyn Nets": 1610612751,
  "Buffalo Braves": 1610612746,
  "Capital Bullets": 1610612764,
  "Charlotte Bobcats": 1610612766,
  "Charlotte Hornets": 1610612766,
  "Chicago Bulls": 1610612741,
  "Chicago Packers": 1610612764,
  "Chicago Zephyrs": 1610612764,
  "Cincinnati Royals": 1610612758,
  "Cleveland Cavaliers": 1610612739,
  "Dallas Mavericks": 1610612742,
  "Denver Nuggets": 1610612743,
  "Detroit Pistons": 1610612765,
  "Fort Wayne Pistons": 1610612765,
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
  "Milwaukee Hawks": 1610612737,
  "Minneapolis Lakers": 1610612747,
  "Minnesota Timberwolves": 1610612750,
  "New Jersey Americans": 1610612751,
  "New Jersey Nets": 1610612751,
  "New Orleans Hornets": 1610612740,
  "New Orleans Jazz": 1610612762,
  "New Orleans Pelicans": 1610612740,
  "New Orleans/Oklahoma City Hornets": 1610612740,
  "New York Knicks": 1610612752,
  "New York Nets": 1610612751,
  "Oklahoma City Thunder": 1610612760,
  "Orlando Magic": 1610612753,
  "Philadelphia 76ers": 1610612755,
  "Philadelphia Warriors": 1610612744,
  "Phoenix Suns": 1610612756,
  "Portland Trail Blazers": 1610612757,
  "Rochester Royals": 1610612758,
  "Sacramento Kings": 1610612758,
  "San Antonio Spurs": 1610612759,
  "San Diego Clippers": 1610612746,
  "San Diego Rockets": 1610612745,
  "San Francisco Warriors": 1610612744,
  "Seattle SuperSonics": 1610612760,
  "St. Louis Hawks": 1610612737,
  "Syracuse Nationals": 1610612755,
  "Toronto Raptors": 1610612761,
  "Tri-Cities Blackhawks": 1610612737,
  "Utah Jazz": 1610612762,
  "Vancouver Grizzlies": 1610612763,
  "Washington Bullets": 1610612764,
  "Washington Wizards": 1610612764,
};

// Case-insensitive lookup so minor casing differences in the data still resolve.
const NORMALIZED: Record<string, number> = Object.fromEntries(
  Object.entries(TEAM_NAME_TO_ID).map(([name, id]) => [name.toLowerCase(), id]),
);

/** The current franchise's team id for a team name (current, relocated or renamed), or null. */
export function franchiseIdForName(name?: string | null): number | null {
  return (name && NORMALIZED[name.trim().toLowerCase()]) || null;
}

/**
 * The scrambled (text removed, recoloured, mirrored, rotated) logo Name the Logo shows before the
 * guess, served from public/logos/scrambled/<team id>.webp. Built by scripts/scramble-logos for the
 * 30 current franchises; returns null for anything else so callers can fall back.
 */
export function scrambledLogoUrl(teamId?: number | null, name?: string | null): string | null {
  const id = teamId ?? (name ? NORMALIZED[name.trim().toLowerCase()] : undefined);
  return id && id >= 1610612737 && id <= 1610612766 ? `/logos/scrambled/${id}.webp` : null;
}
