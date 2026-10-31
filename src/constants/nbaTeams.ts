import { TEAM_ABBR } from "./teamAbbr";

export const nbaTeams = [
  "Atlanta Hawks",
  "Boston Celtics",
  "Brooklyn Nets",
  "Charlotte Hornets",
  "Chicago Bulls",
  "Cleveland Cavaliers",
  "Dallas Mavericks",
  "Denver Nuggets",
  "Detroit Pistons",
  "Golden State Warriors",
  "Houston Rockets",
  "Indiana Pacers",
  "Los Angeles Clippers",
  "Los Angeles Lakers",
  "Memphis Grizzlies",
  "Miami Heat",
  "Milwaukee Bucks",
  "Minnesota Timberwolves",
  "New Orleans Pelicans",
  "New York Knicks",
  "Oklahoma City Thunder",
  "Orlando Magic",
  "Philadelphia 76ers",
  "Phoenix Suns",
  "Portland Trail Blazers",
  "Sacramento Kings",
  "San Antonio Spurs",
  "Toronto Raptors",
  "Utah Jazz",
  "Washington Wizards",
];

// Short forms fans type for a current franchise, by nickname (unique among the 30 current teams). Never a
// former name ("SuperSonics", "Bobcats", "New Jersey Nets"): Name the Logo shows the current logo.
const TEAM_SHORT_FORMS: Record<string, string[]> = {
  "76ers": ["Sixers", "Philly"],
  Cavaliers: ["Cavs"],
  Mavericks: ["Mavs"],
  Timberwolves: ["Wolves", "T-Wolves", "T Wolves"],
  "Trail Blazers": ["Blazers", "Trailblazers"],
  Lakers: ["LA Lakers", "Los Angeles Lakers"],
  Clippers: ["LA Clippers", "Los Angeles Clippers", "Clips"],
  Warriors: ["Dubs", "GSW"],
  Thunder: ["OKC"],
  Pelicans: ["Pels", "Nola"],
  Knicks: ["NY Knicks"],
};

/** "Portland Trail Blazers" -> { city: "Portland", nickname: "Trail Blazers" }; "LA" counts as "Los Angeles". */
function splitTeamName(fullName: string): { city: string; nickname: string } {
  const name = fullName.trim();
  const nickname = /\sTrail Blazers$/i.test(name) ? "Trail Blazers" : name.slice(name.lastIndexOf(" ") + 1);
  const city = name.slice(0, name.length - nickname.length).trim();
  return { city: city === "LA" ? "Los Angeles" : city, nickname };
}

/** Cities two current franchises share ("Los Angeles"): too vague to name one team. */
const SHARED_CITIES = new Set(
  nbaTeams.map((t) => splitTeamName(t).city).filter((c, i, all) => all.indexOf(c) !== i),
);

/**
 * Every spelling accepted for a current franchise, from its full name: the full name, the nickname, the city
 * unless two current franchises share it, the abbreviation (TEAM_ABBR) and the common short forms above.
 */
export function teamAnswerAliases(fullName: string): string[] {
  const { city, nickname } = splitTeamName(fullName);
  const out = [fullName.trim(), nickname, ...(TEAM_SHORT_FORMS[nickname] ?? [])];
  if (city && !SHARED_CITIES.has(city)) out.push(city);
  const abbr = TEAM_ABBR[fullName.trim()];
  if (abbr) out.push(abbr);
  return [...new Set(out)];
}
