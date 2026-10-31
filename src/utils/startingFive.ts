// Starting Five's slot decisions (src/Game Renderers/StartingFive.tsx), pure so scripts/test-answer-accept.mjs
// can test them: which card each starter fills at the reveal, and where a typed name goes.
import type { StartingFivePlayer } from "../types/types";
import { nameKey, sameName } from "./answerMatch";

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

/** Does a typed name name this starter? */
export type StarterMatch = (typed: string, starterName: string) => boolean;

/**
 * The typed-name test for a lineup. With the shared names lookup (buildNameLookup), a guess names a starter when
 * its players (resolveIds: an exact name or alias wins outright, so "Gary Payton" is never Gary Payton II)
 * include the starter's own, so aliases count ("Penny Hardaway", "Ron Artest", "Shaq"). A starter's ids are
 * resolved once, keeping only the players whose full name is his when the name is also someone's alias.
 * sameName is the fallback while the names load or for a starter the list lacks; `knownKeys` (nameKeys of every
 * player name) lets it forgive a suffix only when the typed name is not another real player.
 */
export function starterMatcher(
  knownKeys?: ReadonlySet<string> | null,
  lookup?: { resolveIds: (name: string) => number[]; nameOf: (id: number) => string | null } | null,
): StarterMatch {
  const idsOf = new Map<string, number[]>();
  const starterIds = (name: string): number[] => {
    let ids = idsOf.get(name);
    if (!ids) {
      const all = lookup ? lookup.resolveIds(name) : [];
      const own = all.filter((id) => nameKey(lookup?.nameOf(id) ?? "") === nameKey(name));
      ids = own.length ? own : all;
      idsOf.set(name, ids);
    }
    return ids;
  };
  return (typed, starterName) => {
    if (lookup) {
      const ids = starterIds(starterName);
      if (ids.length && lookup.resolveIds(typed).some((id) => ids.includes(id))) return true;
    }
    return sameName(typed, starterName, knownKeys);
  };
}

/**
 * Where a name typed on card `posKey` goes, or null when it names no starter still to find. A starter of the
 * card's own position family fills that card (as before); any other unfound starter is still right and fills
 * his own card at the reveal (lineupSlots), so the board shows what the reveal would. `matches` is the lineup's
 * starterMatcher (default: sameName on the same key only).
 */
export function placeGuess(
  starting5: StartingFivePlayer[],
  posKey: string,
  typed: string,
  found: Record<string, string>,
  matches: StarterMatch = (t, s) => sameName(t, s),
): { slot: string; name: string } | null {
  const foundNames = Object.values(found);
  const named = starting5.filter((p) => !foundNames.includes(p.name) && matches(typed, p.name));
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
