// Resolves a team's CURRENT logo from its name, used as a fallback when the
// period-accurate logo in the game data is missing or fails to load. Logos come
// from the official NBA CDN keyed by stable franchise ids, so the URL never goes
// stale. Historical / relocated names are aliased to their present-day franchise
// so e.g. "Minneapolis Lakers" still resolves to the Lakers crest.

const cdn = (id: string) => `https://cdn.nba.com/logos/nba/${id}/global/L/logo.svg`;

// Current franchise full name -> NBA franchise id.
const TEAM_ID: Record<string, string> = {
  "Atlanta Hawks": "1610612737",
  "Boston Celtics": "1610612738",
  "Brooklyn Nets": "1610612751",
  "Charlotte Hornets": "1610612766",
  "Chicago Bulls": "1610612741",
  "Cleveland Cavaliers": "1610612739",
  "Dallas Mavericks": "1610612742",
  "Denver Nuggets": "1610612743",
  "Detroit Pistons": "1610612765",
  "Golden State Warriors": "1610612744",
  "Houston Rockets": "1610612745",
  "Indiana Pacers": "1610612754",
  "Los Angeles Clippers": "1610612746",
  "Los Angeles Lakers": "1610612747",
  "Memphis Grizzlies": "1610612763",
  "Miami Heat": "1610612748",
  "Milwaukee Bucks": "1610612749",
  "Minnesota Timberwolves": "1610612750",
  "New Orleans Pelicans": "1610612740",
  "New York Knicks": "1610612752",
  "Oklahoma City Thunder": "1610612760",
  "Orlando Magic": "1610612753",
  "Philadelphia 76ers": "1610612755",
  "Phoenix Suns": "1610612756",
  "Portland Trail Blazers": "1610612757",
  "Sacramento Kings": "1610612758",
  "San Antonio Spurs": "1610612759",
  "Toronto Raptors": "1610612761",
  "Utah Jazz": "1610612762",
  "Washington Wizards": "1610612764",
};

// Historical / relocated / renamed franchises -> current franchise name.
const ALIAS: Record<string, string> = {
  "Minneapolis Lakers": "Los Angeles Lakers",
  "St. Louis Hawks": "Atlanta Hawks",
  "Milwaukee Hawks": "Atlanta Hawks",
  "Tri-Cities Blackhawks": "Atlanta Hawks",
  "Philadelphia Warriors": "Golden State Warriors",
  "San Francisco Warriors": "Golden State Warriors",
  "Syracuse Nationals": "Philadelphia 76ers",
  "Rochester Royals": "Sacramento Kings",
  "Cincinnati Royals": "Sacramento Kings",
  "Kansas City Kings": "Sacramento Kings",
  "Kansas City-Omaha Kings": "Sacramento Kings",
  "Fort Wayne Pistons": "Detroit Pistons",
  "New Jersey Nets": "Brooklyn Nets",
  "Seattle SuperSonics": "Oklahoma City Thunder",
  "Vancouver Grizzlies": "Memphis Grizzlies",
  "Washington Bullets": "Washington Wizards",
  "Capital Bullets": "Washington Wizards",
  "Baltimore Bullets": "Washington Wizards",
  "Chicago Packers": "Washington Wizards",
  "Chicago Zephyrs": "Washington Wizards",
  "San Diego Clippers": "Los Angeles Clippers",
  "Buffalo Braves": "Los Angeles Clippers",
  "San Diego Rockets": "Houston Rockets",
  "New Orleans Jazz": "Utah Jazz",
  "New Orleans Hornets": "New Orleans Pelicans",
  "New Orleans/Oklahoma City Hornets": "New Orleans Pelicans",
  "Charlotte Bobcats": "Charlotte Hornets",
  "New Jersey Americans": "Brooklyn Nets",
};

/** The team's current logo URL, or null for a defunct franchise with no successor. */
export function currentLogoUrl(name?: string | null): string | null {
  if (!name) return null;
  const direct = TEAM_ID[name];
  if (direct) return cdn(direct);
  const alias = ALIAS[name];
  if (alias && TEAM_ID[alias]) return cdn(TEAM_ID[alias]);
  return null;
}
