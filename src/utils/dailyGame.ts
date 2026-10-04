// "Play today's game": one deterministic pick per Europe/Paris day, the same for every player.
// Pure (no runtime imports) so it can be unit-tested with plain Node: scripts/test-daily-game.mjs.

/** Games that never count as "today's game": the placeholder, and Wordle (it has its own daily lock). */
export const DAILY_EXCLUDED_IDS = ["coming-soon", "wordle"];

let parisFormatter: Intl.DateTimeFormat | null = null;

/** `YYYY-MM-DD` of `now` in Europe/Paris, independent of the visitor's time zone (follows DST). */
export const parisDateKey = (now: Date): string => {
  parisFormatter ??= new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return parisFormatter.format(now);
};

// FNV-1a 32-bit.
const fnv1a = (text: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
};

const DAY_MS = 86_400_000;

// Seeded Fisher-Yates shuffle of the eligible list for one epoch (a run of n consecutive days).
const epochOrder = (eligible: { id: string }[], epoch: number): string[] => {
  const order = eligible.map((g) => g.id);
  for (let i = order.length - 1; i > 0; i--) {
    const j = fnv1a(`${epoch}:${i}`) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
};

/**
 * Id of today's game (Paris date of `now`); never the same as yesterday's. "" if no game is eligible.
 * Each epoch of n days plays every eligible game once in a seeded order, so repeats are impossible by
 * construction; at an epoch boundary the first two are swapped if the new epoch would open with the
 * previous epoch's last game.
 */
export const dailyGameId = (games: { id: string }[], now: Date): string => {
  const eligible = games.filter((g) => !DAILY_EXCLUDED_IDS.includes(g.id));
  const n = eligible.length;
  if (n === 0) return "";
  if (n === 1) return eligible[0].id;
  const [y, m, d] = parisDateKey(now).split("-").map(Number);
  const dayIndex = Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
  if (n === 2) return eligible[dayIndex % 2].id;
  const epoch = Math.floor(dayIndex / n);
  const order = epochOrder(eligible, epoch);
  if (order[0] === epochOrder(eligible, epoch - 1)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[dayIndex - epoch * n];
};
