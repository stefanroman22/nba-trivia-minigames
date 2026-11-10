import { useEffect, useState } from "react";
import {
  DAILY_COPY, DAILY_LOCK_GAMES, fetchDailyStatus, isDailyLockGame, knownDailyStatus, type DailyLockGame, type DailyStatus,
} from "../utils/wordleDaily";
import { dailyCountdownText } from "../utils/dailyCountdown";

export interface DailyCardState {
  locked: boolean;
  label: string | null;
}

const UNLOCKED: DailyCardState = { locked: false, label: null };

/** Home-card state for the daily games (Wordle, Contexto): whether today's play
 *  is used up and the "Next Wordle in 5h 12m" label, per game. Client-only — the
 *  server render (and a page load's first render) is unlocked with no label, i.e.
 *  "Play now"; a failed status call stays there too. A page mounted later in the
 *  same tab (a game switch) starts from the statuses this tab already knows
 *  (knownDailyStatus), so a played game is grey from its first frame, then
 *  re-checks. `card(id)` is unlocked for every game without a daily lock. */
export function useDailyCardState(): { card: (id: string) => DailyCardState; anyLocked: boolean } {
  const [statuses, setStatuses] = useState<Partial<Record<DailyLockGame, DailyStatus | null>>>(() =>
    Object.fromEntries(DAILY_LOCK_GAMES.flatMap((g) => {
      const s = knownDailyStatus(g);
      return s ? [[g, s]] : [];
    }))
  );
  const [now, setNow] = useState(() => (DAILY_LOCK_GAMES.some((g) => knownDailyStatus(g)) ? Date.now() : 0));

  useEffect(() => {
    let alive = true;
    // A failed call keeps what this tab last knew rather than flipping a grey item back to "Play now".
    Promise.all(DAILY_LOCK_GAMES.map((g) => fetchDailyStatus(g).then((s) => [g, s ?? knownDailyStatus(g) ?? null] as const))).then((pairs) => {
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
