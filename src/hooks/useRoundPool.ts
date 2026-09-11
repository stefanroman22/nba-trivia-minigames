import { useEffect, useState } from "react";
import { fetchWholePool } from "../utils/pool";
import type { PlayerIndexEntry } from "../types/types";

/**
 * The shared player pool a round is played against.
 *
 * Single-player is handed the whole pool as its round data, so it passes it in
 * and nothing is fetched. A multiplayer round carries only config (a secret, a
 * set of slot constraints), so `local` is null and the pool is loaded from the
 * SAME CDN cache single-player uses (utils/pool.ts) — the dataset is never
 * broadcast through the socket server.
 *
 * Returns null while loading and [] when the pool can't be loaded, which is
 * what the renderers' loading / empty states already key off.
 */
export function useRoundPool(
  local: PlayerIndexEntry[] | null,
  poolKey = "players-index",
): PlayerIndexEntry[] | null {
  const [pool, setPool] = useState<PlayerIndexEntry[] | null>(local);

  useEffect(() => {
    if (local) {
      setPool(local);
      return;
    }
    let cancelled = false;
    setPool(null);
    fetchWholePool(poolKey).then((res) => {
      if (cancelled) return;
      setPool(res.success ? ((res.data ?? []) as PlayerIndexEntry[]) : []);
    });
    return () => {
      cancelled = true;
    };
  }, [local, poolKey]);

  return pool;
}
