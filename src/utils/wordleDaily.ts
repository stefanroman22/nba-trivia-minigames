import type { FetchResult, GameData } from "../types/types";
import { apiFetch } from "./Api";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { fetchQuestion } from "./questions";
import { startDailyQuestion } from "./dailyFlow";

/** The solo games played once per Europe/Paris day, gated server-side (backend/trivia/wordle_daily.py).
 *  Online rounds of these games have no lock. */
export const DAILY_LOCK_GAMES = ["wordle", "contexto"] as const;
export type DailyLockGame = (typeof DAILY_LOCK_GAMES)[number];
export const isDailyLockGame = (id: string | undefined): id is DailyLockGame =>
  (DAILY_LOCK_GAMES as readonly string[]).includes(id ?? "");

/** Local development only (`npm run dev`: NODE_ENV is "development", inlined at build time, so a production
 *  build or Vercel deploy is always false): the once-a-day lock never applies, so the games can be replayed
 *  while their UI is being tested. Nothing is recorded server-side in this mode (no junk play rows in whatever
 *  database the site is pointed at). Wordle deals a random surname (the online-round endpoint), Contexto the
 *  day's puzzle as usual. */
export const DAILY_LOCK_OFF = process.env.NODE_ENV === "development";

/** Per-game copy: the short name on the home-card countdown, and what resets at Paris midnight. */
export const DAILY_COPY: Record<DailyLockGame, { short: string; puzzle: string; full: string }> = {
  wordle: { short: "Wordle", puzzle: "word", full: "NBA Wordle" },
  contexto: { short: "Contexto", puzzle: "secret player", full: "LeContexto" },
};

// A stable per-browser id, independent of the login token: it lives under its
// own localStorage key so logging out (which only clears the auth tokens)
// never resets it — that's what stops "log out, replay from the same
// browser" from bypassing the once-per-day limit. One id for every daily game;
// the key keeps its original Wordle name so existing browsers keep their id.
const DEVICE_ID_KEY = "nba-mg:wordle-device-id";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for non-secure contexts / older browsers without crypto.randomUUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getDailyDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // localStorage unavailable (private mode / quota) — a fresh id every call
    // means no persistent gate for this visitor, which just falls back to
    // "unlimited" for them rather than breaking the game.
    return randomId();
  }
}

export interface DailyStatus {
  locked: boolean;
  nextResetAt: string;
  /** The Paris day ("YYYY-MM-DD") the answer is about. */
  day?: string;
}

// The last status seen per game, for this tab. Every game switch mounts a fresh page, so without it
// a played daily game's rail item / chip rendered "Play now" until the status call came back and then
// turned grey. Pages seed their first render from it and still re-fetch. Written only by the calls
// below, which run in the browser (effects and handlers), so a server render never reads a filled one.
const knownStatus: Partial<Record<DailyLockGame, DailyStatus>> = {};

/** The last daily status this tab saw for `game` (a status call, or today's play just recorded). */
export const knownDailyStatus = (game: DailyLockGame): DailyStatus | undefined => knownStatus[game];

export async function fetchDailyStatus(game: DailyLockGame): Promise<DailyStatus | null> {
  try {
    const deviceId = getDailyDeviceId();
    const res = await apiFetch(
      `${BACKEND_ORIGIN}/trivia/${game}/daily-status/?device_id=${encodeURIComponent(deviceId)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const status = { locked: DAILY_LOCK_OFF ? false : !!data.locked, nextResetAt: data.next_reset_at, day: typeof data.day === "string" ? data.day : undefined };
    knownStatus[game] = status;
    return status;
  } catch {
    return null;
  }
}

const CONNECTION_ERROR: FetchResult = {
  success: false,
  error: {
    title: "Unable to connect to the server",
    message: "Please check your internet connection or try again later.",
  },
};

const lockedError = (game: DailyLockGame): FetchResult => {
  const copy = DAILY_COPY[game];
  return {
    success: false,
    error: {
      title: "Already played today",
      message: `Come back after today's ${copy.puzzle} resets for another round of ${copy.full}.`,
    },
  };
};

const startError = (game: DailyLockGame): FetchResult => ({
  success: false,
  error: { title: `Unable to start ${DAILY_COPY[game].short}`, message: "Please try again later." },
});

/** Claims today's play of `game` (the server records it): its JSON on success, else the error to show. */
async function startDailyPlay(game: DailyLockGame): Promise<{ data: Record<string, unknown> } | { failed: FetchResult; locked?: true }> {
  try {
    const deviceId = getDailyDeviceId();
    const res = await apiFetch(`${BACKEND_ORIGIN}/trivia/${game}/daily-play/`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    // Today's play is used up either way (recorded now, or already): the next page grays it at once.
    if ((res.ok || res.status === 423 || data.locked) && typeof data.next_reset_at === "string") {
      knownStatus[game] = { locked: true, nextResetAt: data.next_reset_at, day: typeof data.day === "string" ? data.day : undefined };
    }
    if (res.status === 423 || data.locked) return { failed: lockedError(game), locked: true };
    if (!res.ok) return { failed: startError(game) };
    return { data };
  } catch {
    return { failed: CONNECTION_ERROR };
  }
}

export async function playWordleDaily(): Promise<FetchResult> {
  if (DAILY_LOCK_OFF) {
    // Dev: a random surname from the online-round endpoint; nothing is claimed or recorded.
    try {
      const res = await apiFetch(`${BACKEND_ORIGIN}/trivia/wordle/`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.series)) return { success: true, data: data.series };
    } catch { /* fall through */ }
    return CONNECTION_ERROR;
  }
  const play = await startDailyPlay("wordle");
  if ("failed" in play) return play.failed;
  if (!Array.isArray(play.data.series)) {
    return { success: false, error: { title: "Unable to start Wordle", message: "Please try again later." } };
  }
  return { success: true, data: play.data.series };
}

/** Today's LeContexto: the gate's status names the Paris day, that day's question is loaded from the
 *  published index (not the browser's own date, so it flips with the lock), and only once it has loaded
 *  is the play recorded — a failed load never uses up the day (utils/dailyFlow.ts). */
export async function playContextoDaily(): Promise<FetchResult> {
  // What to show for an "error" (no status: the server is unreachable; else the record's own failure)
  // and for "unavailable" (the question load's failure; nothing was recorded, so Play can be retried).
  let failure: FetchResult = CONNECTION_ERROR;
  let loadFailure: FetchResult = startError("contexto");
  let statusDay = "";
  const start = await startDailyQuestion<GameData>({
    status: async () => {
      const s = await fetchDailyStatus("contexto");
      statusDay = s?.day ?? "";
      return s && { locked: s.locked, day: s.day };
    },
    load: async (day) => {
      const res = await fetchQuestion("contexto", day);
      if (res.success && res.data?.length) return res.data[0];
      loadFailure = res.success ? startError("contexto") : res;
      return null;
    },
    record: async () => {
      if (DAILY_LOCK_OFF) return { kind: "ok", day: statusDay }; // dev: today's puzzle again, nothing recorded
      const play = await startDailyPlay("contexto");
      if ("failed" in play) {
        failure = play.failed;
        return play.locked ? { kind: "locked" } : { kind: "error" };
      }
      if (typeof play.data.day === "string") return { kind: "ok", day: play.data.day };
      failure = startError("contexto");
      return { kind: "error" };
    },
  });
  switch (start.kind) {
    case "ok": return { success: true, data: [start.question] };
    case "locked": return lockedError("contexto");
    case "unavailable": return loadFailure;
    default: return failure;
  }
}

/** "3 hours" / "45 minutes" until `nextResetAt` — a plain duration, so it's the
 * same figure for every viewer regardless of their own timezone. */
export function formatDailyCountdown(nextResetAt: string): string {
  const ms = new Date(nextResetAt).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(totalMinutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
