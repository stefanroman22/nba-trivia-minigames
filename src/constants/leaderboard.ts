// Leaderboard dummy data + helpers, ported from the MBA Trivium design comp.
// Used as a fallback whenever the backend /get-users/ endpoint can't be reached
// or returns no players, so the board always looks populated like the design.

export interface LeaderRow {
  rank: number;
  name: string;
  /** Permanent public player id (#K7F3QD); null on illustrative fallback rows. */
  id: string | null;
  points: number;
}

export interface SelfRow {
  rank: number;
  name: string;
  id: string | null;
  points: number;
  total: number;
}

export const FALLBACK_LEADERS: LeaderRow[] = [
  { rank: 1, name: "CourtVision23", id: null, points: 4820 },
  { rank: 2, name: "SwishKing", id: null, points: 4510 },
  { rank: 3, name: "DowntownDee", id: null, points: 4180 },
  { rank: 4, name: "GlassCleaner", id: null, points: 3990 },
  { rank: 5, name: "PickAndRoll", id: null, points: 3720 },
  { rank: 6, name: "HoopHarriet", id: null, points: 3540 },
  { rank: 7, name: "AnkleBreaker", id: null, points: 3310 },
  { rank: 8, name: "TriumphTom", id: null, points: 3120 },
  { rank: 9, name: "FastBreakFi", id: null, points: 2980 },
  { rank: 10, name: "ClutchCarl", id: null, points: 2810 },
  { rank: 11, name: "NetRipper", id: null, points: 2640 },
  { rank: 12, name: "BankShotBex", id: null, points: 2470 },
  { rank: 13, name: "AlleyOopAl", id: null, points: 2390 },
  { rank: 14, name: "SplashSam", id: null, points: 2255 },
  { rank: 15, name: "PaintPatrol", id: null, points: 2140 },
  { rank: 16, name: "TripleDoubleT", id: null, points: 2030 },
  { rank: 17, name: "CrossoverCo", id: null, points: 1920 },
  { rank: 18, name: "BoxOutBen", id: null, points: 1845 },
  { rank: 19, name: "RimRunRia", id: null, points: 1760 },
  { rank: 20, name: "DeepRangeDan", id: null, points: 1690 },
  { rank: 21, name: "HeatCheckHal", id: null, points: 1605 },
  { rank: 22, name: "PostUpPia", id: null, points: 1540 },
];

// The signed-out visitor's illustrative standing (outside the top 100, so the
// board pins a "your rank" bar — matches the design comp).
export const FALLBACK_SELF: SelfRow = { rank: 248, name: "You", id: null, points: 1180, total: 14802 };

// Solid avatar colors keyed by rank (design comp palette).
export const AVATAR_COLORS = [
  "#ff6a1a", "#1D428A", "#007A33", "#860038", "#552583", "#0077C0",
  "#98002E", "#C8102E", "#FEC524", "#00788C", "#1D1160", "#CE1141",
];

export const initials = (name: string): string => {
  if (name === "You") return "YS";
  const letters = (name || "?").replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return letters || "?";
};

export const avatarBg = (rank: number): string =>
  AVATAR_COLORS[(Math.max(1, rank) - 1) % AVATAR_COLORS.length];

// The self bar uses a brand gradient like the design.
export const SELF_AVATAR_BG = "linear-gradient(140deg, var(--brand), var(--brand-deep))";
