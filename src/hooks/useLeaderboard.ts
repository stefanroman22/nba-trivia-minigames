import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";
import { FALLBACK_LEADERS, FALLBACK_SELF, type LeaderRow, type SelfRow } from "../constants/leaderboard";

interface LeaderboardData {
  loading: boolean;
  /** True when showing dummy data because the backend was empty/unreachable. */
  isFallback: boolean;
  leaders: LeaderRow[];
  self: SelfRow;
  refresh: () => void;
}

/**
 * Loads the leaderboard from /get-users/, falling back to the design's dummy
 * players whenever the backend is unreachable or returns nothing. The signed-in
 * player's row uses live data; a signed-out visitor sees the illustrative self row.
 */
export function useLeaderboard(): LeaderboardData {
  const { user } = useSelector((state: RootState) => state.user);
  const [loading, setLoading] = useState(true);
  const [isFallback, setIsFallback] = useState(false);
  const [leaders, setLeaders] = useState<LeaderRow[]>(FALLBACK_LEADERS);
  const [self, setSelf] = useState<SelfRow>(FALLBACK_SELF);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiFetch(`${BACKEND_URL}/get-users/`);
      const data = await response.json();
      const live = Array.isArray(data?.top_100_users) ? data.top_100_users : [];

      if (data?.error || live.length === 0) {
        setLeaders(FALLBACK_LEADERS);
        setIsFallback(true);
      } else {
        setLeaders(
          live.map((u: { username: string; points: number }, i: number) => ({
            rank: i + 1,
            name: u.username,
            points: u.points,
          }))
        );
        setIsFallback(false);
      }

      if (user) {
        setSelf({
          rank: typeof data?.user_rank === "number" ? data.user_rank : Number(user.rank) || FALLBACK_SELF.rank,
          name: user.username,
          points: user.points,
          total: typeof data?.number_users === "number" ? data.number_users : FALLBACK_SELF.total,
        });
      } else {
        setSelf(FALLBACK_SELF);
      }
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
      setLeaders(FALLBACK_LEADERS);
      setIsFallback(true);
      setSelf(
        user
          ? { rank: Number(user.rank) || FALLBACK_SELF.rank, name: user.username, points: user.points, total: FALLBACK_SELF.total }
          : FALLBACK_SELF
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  return { loading, isFallback, leaders, self, refresh: load };
}
