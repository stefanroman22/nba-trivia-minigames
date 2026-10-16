// How an award receipt lands on the signed-in user. Pure (no React, no Redux Toolkit) so
// scripts/test-award.mjs can load it; userSlice's `applyAward` reducer calls it.
import type { User } from "./userSlice";

/** What the backend sends back for a credited play (backend/trivia/awarding.py `award`) — over HTTP for a
 *  solo game (MiniGame.awardPoints) or through the relay's `pointsAwarded` for an online one. Everything
 *  but `awarded`/`rank` is optional so a relay deployed before this change still applies. */
export interface RankProgress {
  rank: string;
  division: number | null;
  next_rank: string | null;
  next_points: number | null;
  next_days: number | null;
  points_to_next: number;
  days_to_next: number;
  progress_pct: number;
}
export interface AwardReceipt {
  awarded: number;
  points?: number;
  rank: string;
  rank_up?: { from: string; to: string } | null;
  progress?: RankProgress;
  streak?: { days: number; best: number; freezes: number };
  first_game_bonus?: number;
  streak_bonus?: number;
}
export interface PendingRankUp { from: string; to: string; division: number | null }

/** The user after the receipt, and the promotion to show (null when the rank didn't change). The
 *  server's totals win over ours: the award may land after Play again, and a delta would drift. */
export function applyReceipt(user: User, r: AwardReceipt): { user: User; rankUp: PendingRankUp | null } {
  const next: User = { ...user };
  next.points = typeof r.points === "number" ? r.points : user.points + (r.awarded || 0);
  if (r.rank) next.rank = r.rank;
  if (r.progress) next.rank_progress = r.progress;
  if (r.streak) {
    next.streak_days = r.streak.days;
    next.streak_best = r.streak.best;
    next.streak_freezes = r.streak.freezes;
  }
  const rankUp = r.rank_up && r.rank_up.to !== r.rank_up.from
    ? { from: r.rank_up.from, to: r.rank_up.to, division: r.progress?.division ?? null }
    : null;
  return { user: next, rankUp };
}
