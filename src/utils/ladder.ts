// Copy helpers for the ladder modal (pure, no imports: scripts/test-ladder.mjs loads this under node).
// Numbers come from GET /api/ranks/ladder/ (users/ladder.py); nothing here recomputes ranks or thresholds.

export interface LadderRow { name: string; points: number; days: number; players: number; share_pct: number }
export interface LadderRules {
  first_game_bonus: number;
  streak_milestones: Record<string, number>; max_freezes: number; freeze_every_days: number; guest_carryover_max: number;
}
export interface LadderYou {
  rank: string; division: number | null; position: number; percentile: number; ahead_of_pct: number;
  same_rank_pct: number; next_rank: string | null; points_to_next: number; days_to_next: number;
  to_top: Record<string, number>;
}
export interface LadderData {
  total_players: number; ladder: LadderRow[]; percentiles: Record<string, number>; rules: LadderRules; you: LadderYou | null;
}

/** Below this many public players a percentile is noise: the headline says "Early adopter" instead. */
export const EARLY_ADOPTER_BELOW = 20;

const n = (v: number) => v.toLocaleString("en-US");
const pct1 = (v: number) => `${Math.min(99.9, Math.max(0.1, v)).toFixed(1)}%`;
const pct0 = (v: number) => `${Math.round(v)}%`;

export function percentileHeadline(you: LadderYou, totalPlayers: number): string {
  return totalPlayers < EARLY_ADOPTER_BELOW ? "Early adopter" : `Top ${pct1(you.percentile)}`;
}
export function aheadCopy(you: LadderYou): string {
  // Never "ahead of 100%": you can't be ahead of yourself.
  return `You're ahead of ${pct0(Math.min(99, Math.round(you.ahead_of_pct)))} of players`;
}
export function sameRankCopy(you: LadderYou): string {
  const v = you.same_rank_pct;
  return `${v > 0 && Math.round(v) === 0 ? "<1%" : pct0(v)} share your rank`;
}

/** The ladder hook's cache decision: fresh only for the same identity (id:points:rank) within its TTL. */
export function ladderCacheFresh(
  entry: { userKey: string | null; fetchedAt: number; error: boolean } | null,
  userKey: string | null, now: number, ttl: number, errorTtl: number,
): boolean {
  if (!entry || entry.userKey !== userKey) return false;
  return now - entry.fetchedAt < (entry.error ? errorTtl : ttl);
}
/** `toTop` null = guest (no "for you" part). */
export function toTopCopy(pct: number, threshold: number, toTop: number | null): string {
  const base = `Top ${pct}% · ${n(threshold)} pts`;
  if (toTop === null) return base;
  return toTop > 0 ? `${base} (+${n(toTop)} for you)` : `${base} (you're in)`;
}
export function nextRankCopy(you: LadderYou): string {
  if (!you.next_rank) return "Top of the ladder";
  if (you.points_to_next === 0) return `You're about to rank up to ${you.next_rank}`;
  return `${n(you.points_to_next)} pts to ${you.next_rank}`;
}
export function gateCopy(row: Pick<LadderRow, "name" | "points">): string {
  if (row.points === 0) return "Start here";
  return `${n(row.points)} pts`;
}
/** The milestones as they are paid: "10 days +500 · 25 days +1,500 · …" (added to your points automatically). */
export function streakBonusCopy(r: LadderRules): string {
  const days = Object.keys(r.streak_milestones).map(Number).sort((a, b) => a - b);
  return days.map((d) => `${n(d)} days +${n(r.streak_milestones[String(d)])}`).join(" · ");
}
export function freezeCopy(r: LadderRules): string {
  const every = r.freeze_every_days;
  return `Missed a day? A freeze saves your streak. You earn one every ${every} days of streak and can hold ${r.max_freezes}`;
}
