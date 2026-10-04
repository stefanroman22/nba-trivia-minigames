// Who Would Win scoring — no imports, so scripts/test-www-points.mjs can load it under
// `node --experimental-strip-types`. The renderer imports these; change the numbers here.

/** Your side has at least as many votes as the other (majority, tie, or you are the first voter). */
export const WWW_POINTS_MAJORITY = 20;
/** Your side has fewer votes than the other. */
export const WWW_POINTS_MINORITY = 5;
export const WWW_MATCHUPS = 10;
/** Highest honest score; the backend caps who-would-win at the same number. */
export const WWW_MAX_POINTS = WWW_MATCHUPS * WWW_POINTS_MAJORITY; // 200

export type WwwSide = "a" | "b";
export interface WwwTally {
  a: number;
  b: number;
}

/** Points for one matchup from the tally AFTER the player's vote is counted.
 *  `null` choice = skipped (0). A missing or failed tally counts as majority: the player
 *  voted, and a network fault never costs points. */
export function pointsFor(choice: WwwSide | null, tally: WwwTally | "error" | undefined): number {
  if (choice === null) return 0;
  if (!tally || tally === "error") return WWW_POINTS_MAJORITY;
  const mine = choice === "a" ? tally.a : tally.b;
  const other = choice === "a" ? tally.b : tally.a;
  return mine >= other ? WWW_POINTS_MAJORITY : WWW_POINTS_MINORITY;
}
