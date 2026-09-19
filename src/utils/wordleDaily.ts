import type { FetchResult } from "../types/types";
import { apiFetch } from "./Api";
import { BACKEND_ORIGIN } from "../configurations/backend";

// A stable per-browser id, independent of the login token: it lives under its
// own localStorage key so logging out (which only clears the auth tokens)
// never resets it — that's what stops "log out, replay from the same
// browser" from bypassing the once-per-day limit.
const DEVICE_ID_KEY = "nba-mg:wordle-device-id";

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // Fallback for non-secure contexts / older browsers without crypto.randomUUID.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getWordleDeviceId(): string {
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

export interface WordleDailyStatus {
  locked: boolean;
  nextResetAt: string;
}

export async function fetchWordleDailyStatus(): Promise<WordleDailyStatus | null> {
  try {
    const deviceId = getWordleDeviceId();
    const res = await apiFetch(
      `${BACKEND_ORIGIN}/trivia/wordle/daily-status/?device_id=${encodeURIComponent(deviceId)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return { locked: !!data.locked, nextResetAt: data.next_reset_at };
  } catch {
    return null;
  }
}

export async function playWordleDaily(): Promise<FetchResult> {
  try {
    const deviceId = getWordleDeviceId();
    const res = await apiFetch(`${BACKEND_ORIGIN}/trivia/wordle/daily-play/`, {
      method: "POST",
      body: JSON.stringify({ device_id: deviceId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 423 || data.locked) {
      return {
        success: false,
        error: {
          title: "Already played today",
          message: "Come back after today's word resets for another round of NBA Wordle.",
        },
      };
    }
    if (!res.ok || !Array.isArray(data.series)) {
      return {
        success: false,
        error: { title: "Unable to start Wordle", message: "Please try again later." },
      };
    }
    return { success: true, data: data.series };
  } catch {
    return {
      success: false,
      error: {
        title: "Unable to connect to the server",
        message: "Please check your internet connection or try again later.",
      },
    };
  }
}

/** "3 hours" / "45 minutes" until `nextResetAt` — a plain duration, so it's the
 * same figure for every viewer regardless of their own timezone. */
export function formatWordleCountdown(nextResetAt: string): string {
  const ms = new Date(nextResetAt).getTime() - Date.now();
  if (ms <= 0) return "any moment now";
  const totalMinutes = Math.ceil(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
  const hours = Math.ceil(totalMinutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
