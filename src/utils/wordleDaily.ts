import type { FetchResult } from "../types/types";
import { apiFetch } from "./Api";
import { BACKEND_ORIGIN } from "../configurations/backend";
import { fetchQuestion } from "./questions";

/** The solo games played once per Europe/Paris day, gated server-side (backend/trivia/wordle_daily.py).
 *  Online rounds of these games have no lock. */
export const DAILY_LOCK_GAMES = ["wordle", "contexto"] as const;
export type DailyLockGame = (typeof DAILY_LOCK_GAMES)[number];
export const isDailyLockGame = (id: string | undefined): id is DailyLockGame =>
  (DAILY_LOCK_GAMES as readonly string[]).includes(id ?? "");

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
}

export async function fetchDailyStatus(game: DailyLockGame): Promise<DailyStatus | null> {
  try {
    const deviceId = getDailyDeviceId();
    const res = await apiFetch(
      `${BACKEND_ORIGIN}/trivia/${game}/daily-status/?device_id=${encodeURIComponent(deviceId)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { locked: !!data.locked, nextResetAt: data.next_reset_at };
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

/** Claims today's play of `game` (the server records it): its JSON on success, else the error to show. */
async function startDailyPlay(game: DailyLockGame): Promise<{ data: Record<string, unknown> } | { failed: FetchResult }> {
  try {
    const deviceId = getDailyDeviceId();
    const res = await apiFetch(`${BACKEND_ORIGIN}/trivia/${game}/daily-play/`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 423 || data.locked) {
      const copy = DAILY_COPY[game];
      return {
        failed: {
          success: false,
          error: {
            title: "Already played today",
            message: `Come back after today's ${copy.puzzle} resets for another round of ${copy.full}.`,
          },
        },
      };
    }
    if (!res.ok) {
      return { failed: { success: false, error: { title: `Unable to start ${DAILY_COPY[game].short}`, message: "Please try again later." } } };
    }
    return { data };
  } catch {
    return { failed: CONNECTION_ERROR };
  }
}

export async function playWordleDaily(): Promise<FetchResult> {
  const play = await startDailyPlay("wordle");
  if ("failed" in play) return play.failed;
  if (!Array.isArray(play.data.series)) {
    return { success: false, error: { title: "Unable to start Wordle", message: "Please try again later." } };
  }
  return { success: true, data: play.data.series };
}

/** Today's LeContexto: the server records the play and names the Paris day; the question is the one
 *  the published index schedules for that day (not the browser's own date), so it flips with the lock. */
export async function playContextoDaily(): Promise<FetchResult> {
  const play = await startDailyPlay("contexto");
  if ("failed" in play) return play.failed;
  const day = play.data.day;
  if (typeof day !== "string") {
    return { success: false, error: { title: "Unable to start Contexto", message: "Please try again later." } };
  }
  return fetchQuestion("contexto", day);
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
