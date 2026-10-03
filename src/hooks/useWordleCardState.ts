import { useEffect, useState } from "react";
import { fetchWordleDailyStatus, type WordleDailyStatus } from "../utils/wordleDaily";
import { wordleCountdownText } from "../utils/wordleCountdown";

/** Home-card state for the daily Wordle: whether today's play is used up and
 *  the "Next Wordle in 5h 12m" label. Client-only — the first render (and the
 *  server render) is always `{ locked: false, label: null }`, i.e. "Play now";
 *  a failed status call stays there too. */
export function useWordleCardState(): { locked: boolean; label: string | null } {
  const [status, setStatus] = useState<WordleDailyStatus | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let alive = true;
    fetchWordleDailyStatus().then((s) => {
      if (!alive) return;
      setNow(Date.now());
      setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const label = status?.locked ? wordleCountdownText(status.nextResetAt, now) : null;
  const locked = label !== null;

  // Tick once a minute while the countdown is showing; once it reaches zero
  // `label` turns null, `locked` drops and the interval is cleared.
  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [locked]);

  return { locked, label };
}
