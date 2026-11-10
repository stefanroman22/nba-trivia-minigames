import { useEffect, useState } from "react";
import type { NamesEntry } from "../types/types";
import { loadNames, namesNow } from "../utils/questions";

/** The shared player name list (autocomplete + name->id). null while loading, [] on failure.
 *  Starts from the list this tab already holds (Play preloads it), so a game has it on its first render. */
export function useNames(): NamesEntry[] | null {
  const [names, setNames] = useState<NamesEntry[] | null>(() => namesNow());
  useEffect(() => {
    const held = namesNow();
    if (held) { setNames(held); return; } // a no-op when the first render already had it
    let cancelled = false;
    loadNames().then((n) => { if (!cancelled) setNames(n); }).catch(() => { if (!cancelled) setNames([]); });
    return () => { cancelled = true; };
  }, []);
  return names;
}
