// Answer logging (the data flywheel, contract #7) for renderers that log through a shared helper:
// collect entries while the game runs, then one fire-and-forget POST to /trivia/log-guesses/ on game
// end and on unmount. Guests are allowed (apiFetch adds the JWT only when one exists).
import { BACKEND_ORIGIN } from "../configurations/backend";
import { apiFetch } from "./Api";

export interface GuessEntry {
  question_id: string;
  answer: string;
  correct: boolean;
  elapsed_ms: number;
}

export interface GuessLogger {
  add: (entry: GuessEntry) => void;
  /** Sends what has been collected (no-op when empty) and starts over. */
  flush: () => void;
}

/** The endpoint takes at most this many entries per request. */
const MAX_ENTRIES = 100;

export function createGuessLogger(game: string): GuessLogger {
  let entries: GuessEntry[] = [];

  const flush = () => {
    const batch = entries;
    entries = [];
    if (!batch.length) return;
    // keepalive lets the request outlive the page when the flush runs on unmount/navigation.
    apiFetch(`${BACKEND_ORIGIN}/trivia/log-guesses/`, {
      method: "POST",
      body: JSON.stringify({ game, entries: batch }),
      keepalive: true,
    }).catch(() => {
      /* analytics only */
    });
  };

  const add = (entry: GuessEntry) => {
    entries.push(entry);
    if (entries.length >= MAX_ENTRIES) flush();
  };

  return { add, flush };
}
