// Starting Five's slot decisions (src/Game Renderers/StartingFive.tsx), pure so scripts/test-answer-accept.mjs
// can test them: which card each starter fills at the reveal, and where a typed name goes.
import type { StartingFivePlayer } from "../types/types";
import { sameName } from "./answerMatch";

// Which cards each position family may fill, in reveal order. The board only
// renders a 2-guard/2-forward/1-center lineup, which is why the pool is
// filtered to that shape (backend/trivia/data_pipeline/starting_five.py).
export const SLOTS_BY_POSITION: Record<string, string[]> = {
  G: ["PG", "SG"],
  F: ["PF", "SF"],
  C: ["C"],
};

export const normalizePosition = (pos: string) => {
  if (pos === "PF" || pos === "SF" || pos === "F") return "F";
  if (pos === "PG" || pos === "SG" || pos === "G") return "G";
  return pos; // "C"
};

/**
 * Each card's player at the reveal: the found ones stay on the card they were found on, every other starter
 * takes the first free card of his position family (box-score start slot), in lineup order. A starter with no
 * free card (a lineup that is not 2-2-1, filtered out of the pool) is left out and handed to `onNoSlot`.
 */
export function lineupSlots(
  starting5: StartingFivePlayer[],
  found: Record<string, string> = {},
  onNoSlot?: (p: StartingFivePlayer) => void,
): Record<string, string> {
  const slots: Record<string, string> = { ...found };
  const foundNames = Object.values(found);
  for (const p of starting5) {
    if (foundNames.includes(p.name)) continue;
    const slot = (SLOTS_BY_POSITION[normalizePosition(p.position)] ?? []).find((k) => !slots[k]);
    if (slot) slots[slot] = p.name;
    else onNoSlot?.(p);
  }
  return slots;
}

/**
 * Where a name typed on card `posKey` goes, or null when it names no starter still to find. A starter of the
 * card's own position family fills that card (as before); any other unfound starter is still right and fills
 * his own card at the reveal (lineupSlots), so the board shows what the reveal would. `knownKeys` (nameKeys of
 * every player name) lets sameName forgive a suffix only when the typed name is not another real player.
 */
export function placeGuess(
  starting5: StartingFivePlayer[],
  posKey: string,
  typed: string,
  found: Record<string, string>,
  knownKeys?: ReadonlySet<string> | null,
): { slot: string; name: string } | null {
  const foundNames = Object.values(found);
  const named = starting5.filter((p) => !foundNames.includes(p.name) && sameName(typed, p.name, knownKeys));
  if (!named.length) return null;
  const family = normalizePosition(posKey);
  const own = named.find((p) => normalizePosition(p.position) === family);
  if (own) return { slot: posKey, name: own.name };
  const reveal = lineupSlots(starting5, found);
  for (const p of named) {
    const slot = Object.keys(reveal).find((k) => !found[k] && reveal[k] === p.name);
    if (slot) return { slot, name: p.name };
  }
  return null;
}
