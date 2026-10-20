// Home-card label for a locked daily game: "Next Wordle in 5h 12m", "Next Contexto in 5h 12m". Kept
// import-free so the node:test script can load it with --experimental-strip-types.

/** "Next <name> in 5h 12m" / "… in 12m" / "… in 5h" until `nextResetAt` (total minutes rounded
 *  up), or `null` once the reset has passed or the date is invalid. */
export function dailyCountdownText(name: string, nextResetAt: string, now: number = Date.now()): string | null {
  const ms = new Date(nextResetAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Next ${name} in ${minutes}m`;
  if (minutes === 0) return `Next ${name} in ${hours}h`;
  return `Next ${name} in ${hours}h ${minutes}m`;
}
