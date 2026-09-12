import { useEffect, useState } from "react";
import type { NamesEntry } from "../types/types";
import { loadNames } from "../utils/questions";

/** The shared player name list (autocomplete + name->id). null while loading, [] on failure. */
export function useNames(): NamesEntry[] | null {
  const [names, setNames] = useState<NamesEntry[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadNames().then((n) => { if (!cancelled) setNames(n); }).catch(() => { if (!cancelled) setNames([]); });
    return () => { cancelled = true; };
  }, []);
  return names;
}
