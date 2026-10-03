// Home-card label for a locked daily Wordle: "Next Wordle in 5h 12m". Kept
// import-free so the node:test script can load it with --experimental-strip-types.

/** "Next Wordle in 5h 12m" / "Next Wordle in 12m" / "Next Wordle in 5h" until
 *  `nextResetAt` (total minutes rounded up), or `null` once the reset has passed
 *  or the date is invalid. */
export function wordleCountdownText(nextResetAt: string, now: number = Date.now()): string | null {
  const ms = new Date(nextResetAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const totalMinutes = Math.ceil(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `Next Wordle in ${minutes}m`;
  if (minutes === 0) return `Next Wordle in ${hours}h`;
  return `Next Wordle in ${hours}h ${minutes}m`;
}
