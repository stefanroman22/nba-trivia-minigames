// "Why?" on a missed answer: the backend's short, AI-written explanation of one question, built from our own data and
// cached server-side (GET /trivia/explain/<game>/?qid=<question id>). Behind EXPLANATIONS_ENABLED (a build-time flag,
// off by default): nothing here runs unless a player opens a "Why?" disclosure, which only renders when the flag is on.
//
// Answers: 200 { text } (shown), 404 (no explanation for this question), 503 (feature off or today's budget used),
// 429 (slow down). Anything but a 200 shows the same quiet "No explanation available" line, so this returns the text
// or null. A 200 and a 404 are remembered for the page's life (reopening a review never refetches); a 429, a 503 or
// a network error are not, so opening it again later tries again.
import { BACKEND_ORIGIN, EXPLANATIONS_ENABLED } from "../configurations/backend";
import type { AnswerReview } from "../types/review";

/** The games the backend can explain. */
export type ExplainGame = "series-winner" | "guess-mvps";

/** The explanation text, or null when there is none to show. */
export type Explanation = { text: string } | null;

const settled = new Map<string, Explanation>();
const inflight = new Map<string, Promise<Explanation>>();

const keyOf = (game: ExplainGame, qid: string) => `${game}:${qid}`;

/** What is already known for a question: the result, or undefined when it was never fetched (or must be retried). */
export function cachedExplanation(game: ExplainGame, qid: string): Explanation | undefined {
  return settled.get(keyOf(game, qid));
}

async function request(game: ExplainGame, qid: string): Promise<{ value: Explanation; keep: boolean }> {
  try {
    const res = await fetch(`${BACKEND_ORIGIN}/trivia/explain/${game}/?qid=${encodeURIComponent(qid)}`);
    if (res.status !== 200) return { value: null, keep: res.status === 404 };
    const data = (await res.json()) as { text?: unknown };
    const text = typeof data.text === "string" ? data.text.trim() : "";
    return text ? { value: { text }, keep: true } : { value: null, keep: false };
  } catch {
    return { value: null, keep: false };
  }
}

/** Fetch (or reuse) the explanation of one question; concurrent callers share one request. Never rejects. */
export function fetchExplanation(game: ExplainGame, qid: string): Promise<Explanation> {
  const key = keyOf(game, qid);
  if (settled.has(key)) return Promise.resolve(settled.get(key) ?? null);
  const pending = inflight.get(key);
  if (pending) return pending;
  const run = request(game, qid).then(({ value, keep }) => {
    inflight.delete(key);
    if (keep) settled.set(key, value);
    return value;
  });
  inflight.set(key, run);
  return run;
}

/** True when a finished single-player game's review has a round "Why?" can explain: the flag is on, the game is one the
 *  backend explains, and the player missed at least one round (a round with no pick counts as a miss). */
export function canExplain(review: AnswerReview | undefined): boolean {
  if (!EXPLANATIONS_ENABLED || !review) return false;
  if (review.game === "series-winner") return review.rounds.some((r) => r.pick !== r.winner);
  if (review.game === "guess-mvps") return review.rounds.some((r) => !r.correct);
  return false;
}
