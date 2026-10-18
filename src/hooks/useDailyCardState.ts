import { useEffect, useState } from "react";
import {
  DAILY_COPY, DAILY_LOCK_GAMES, fetchDailyStatus, isDailyLockGame, type DailyLockGame, type DailyStatus,
} from "../utils/wordleDaily";
import { dailyCountdownText } from "../utils/dailyCountdown";

export interface DailyCardState {
  locked: boolean;
  label: string | null;
}

const UNLOCKED: DailyCardState = { locked: false, label: null };

/** Home-card state for the daily games (Wordle, Contexto): whether today's play
 *  is used up and the "Next Wordle in 5h 12m" label, per game. Client-only — the
 *  first render (and the server render) is always unlocked with no label, i.e.
 *  "Play now"; a failed status call stays there too. `card(id)` is unlocked for
 *  every game without a daily lock. */
export function useDailyCardState(): { card: (id: string) => DailyCardState; anyLocked: boolean } {
  const [statuses, setStatuses] = useState<Partial<Record<DailyLockGame, DailyStatus | null>>>({});
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    Promise.all(DAILY_LOCK_GAMES.map((g) => fetchDailyStatus(g).then((s) => [g, s] as const))).then((pairs) => {
      if (!alive) return;
      setNow(Date.now());
      setStatuses(Object.fromEntries(pairs));
    });
    return () => {
      alive = false;
    };
  }, []);

  const states = Object.fromEntries(
    DAILY_LOCK_GAMES.map((g) => {
      const s = statuses[g];
      const label = s?.locked ? dailyCountdownText(DAILY_COPY[g].short, s.nextResetAt, now) : null;
      return [g, { locked: label !== null, label }];
    })
  ) as Record<DailyLockGame, DailyCardState>;
  const anyLocked = DAILY_LOCK_GAMES.some((g) => states[g].locked);

  // Tick once a minute while a countdown is showing; once it reaches zero the
  // label turns null, `locked` drops and the interval is cleared.
  useEffect(() => {
    if (!anyLocked) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [anyLocked]);

  return { card: (id: string) => (isDailyLockGame(id) ? states[id] : UNLOCKED), anyLocked };
}
