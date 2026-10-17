// Copy helpers for the ladder modal (pure, no imports: scripts/test-ladder.mjs loads this under node).
// Numbers come from GET /api/ranks/ladder/ (users/ladder.py); nothing here recomputes ranks or thresholds.

export interface LadderRow { name: string; points: number; days: number; players: number; share_pct: number }
export interface LadderRules {
  first_game_bonus: number; daily_full: number; daily_half: number; daily_tail_rate: number;
  streak_milestones: Record<string, number>; max_freezes: number; guest_carryover_max: number;
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
  return `You're ahead of ${pct0(you.ahead_of_pct)} of players`;
}
export function sameRankCopy(you: LadderYou): string {
  return `${pct0(you.same_rank_pct)} share your rank`;
}
/** `toTop` null = guest (no "for you" part). */
export function toTopCopy(pct: number, threshold: number, toTop: number | null): string {
  const base = `Top ${pct}% · ${n(threshold)} pts`;
  if (toTop === null) return base;
  return toTop > 0 ? `${base} (+${n(toTop)} for you)` : `${base} (you're in)`;
}
export function nextRankCopy(you: LadderYou): string {
  if (!you.next_rank) return "Top of the ladder";
  const days = you.days_to_next > 0 ? `${you.days_to_next} more active ${you.days_to_next === 1 ? "day" : "days"}` : "";
  if (you.points_to_next === 0 && !days) return `You're about to rank up to ${you.next_rank}`;
  if (you.points_to_next === 0) return `${days} to ${you.next_rank}`;
  return `${n(you.points_to_next)} pts to ${you.next_rank}${days ? ` · ${days}` : ""}`;
}
export function gateCopy(row: Pick<LadderRow, "name" | "points" | "days">): string {
  if (row.points === 0) return "Start here";
  return row.days > 0 ? `${n(row.points)} pts · ${row.days} ${row.days === 1 ? "day" : "days"}` : `${n(row.points)} pts`;
}
export function softCapCopy(r: LadderRules): string {
  return `First ${n(r.daily_full)} pts a day count in full, the next ${n(r.daily_half)} at half, the rest at ${Math.round(r.daily_tail_rate * 100)}%`;
}
export function streakCopy(r: LadderRules): string {
  const days = Object.keys(r.streak_milestones).map(Number).sort((a, b) => a - b);
  const bonuses = days.map((d) => `+${n(r.streak_milestones[String(d)])}`).join(" / ");
  return `One game a day keeps your streak · ${r.max_freezes} ${r.max_freezes === 1 ? "freeze" : "freezes"} · ${bonuses} at day ${days.join(" / ")}`;
}
