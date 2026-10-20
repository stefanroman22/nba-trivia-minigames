// Rank display helpers. The ladder's thresholds and day gates live in the backend (users/ranks.py) and
// arrive as `rank_progress` on the user; this file only knows the order, a colour per rank and copy.
export const RANK_ORDER = [
  "Rookie", "Role Player", "Sixth Man", "Starter", "All-Star", "All-NBA", "MVP", "Hall of Famer", "GOAT",
] as const;

export const RANK_COLORS: Record<string, string> = {
  "Rookie": "#8a8f98",
  "Role Player": "#7fb2e5",
  "Sixth Man": "#4f9de0",
  "Starter": "#2fc762",
  "All-Star": "#ff6a1a",
  "All-NBA": "#ff8a3d",
  "MVP": "#ffd166",
  "Hall of Famer": "#c084fc",
  "GOAT": "#f5f3ef",
};

const ROMAN = ["", "I", "II", "III"];

/** "All-Star II" for ranks with divisions, the bare name otherwise. */
export function rankLabel(rank: string, division?: number | null): string {
  return division ? `${rank} ${ROMAN[division] ?? ""}`.trim() : rank;
}

/** The rank-up share line (navigator.share / clipboard). */
export function shareText(rank: string): string {
  return `I just made ${rank} on Swish Quest 🏀 Think you know the NBA better? Play free at swishquest.com`;
}

/** One line per rank for the ladder rows (marketing copy; keep each under 40 characters). */
export const RANK_TAGLINES: Record<string, string> = {
  "Rookie": "Everyone starts here",
  "Role Player": "First points on the board",
  "Sixth Man": "Off the bench, into the rotation",
  "Starter": "You're in the lineup",
  "All-Star": "Top of the regulars",
  "All-NBA": "Elite company",
  "MVP": "Best in the building",
  "Hall of Famer": "Legend status",
  "GOAT": "The greatest of all time",
};

/** The ladder's share line. */
export function percentileShareText(percentile: number, rank: string): string {
  const top = `${Math.min(99.9, Math.max(0.1, percentile)).toFixed(1)}%`;
  return `I'm in the top ${top} of Swish Quest players 🏀 ${rank} and climbing. Think you know the NBA better? Play free at swishquest.com`;
}
