export interface LeaderRow {
  rank: number;
  name: string;
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
