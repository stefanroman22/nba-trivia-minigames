// Live username check against POST /api/check-name/ (throttled, never strikes, never logs). The
// word lists stay on the server: this only learns "ok" or a generic message. The server is still
// the judge on submit, so every failure here (network, throttle, bad body) reads as "ok" and the
// form shows nothing.
import { useEffect, useState } from "react";
import type { Variants } from "framer-motion";
import { BACKEND_URL } from "../configurations/backend";
import { durations, easing } from "../motion/tokens";

export type NameCheckResult = { ok: boolean; error?: string };

/** The same format rule the forms and the backend apply; the server check runs only past it. */
export const USERNAME_FORMAT = /^[A-Za-z0-9_]{3,20}$/;
export const NAME_CHECK_DEBOUNCE_MS = 500;
const FALLBACK_ERROR = "That name isn't allowed. Please choose another.";

/** Never throws: anything but a clear `{ ok: false }` answer is `{ ok: true }`. */
export async function checkName(username: string): Promise<NameCheckResult> {
  try {
    const res = await fetch(`${BACKEND_URL}/check-name/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    if (!res.ok) return { ok: true };
    const data: unknown = await res.json().catch(() => null);
    if (typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === false) {
      const error = (data as { error?: unknown }).error;
      return { ok: false, error: typeof error === "string" && error ? error : FALLBACK_ERROR };
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

/**
 * Debounced live check for a username field: returns the server's message once it has answered
 * "not allowed", else null. Runs only when `enabled` and the name passes the format rule. The
 * last message stays up while the check for a newer value is pending (so the note does not
 * blink on every keystroke); it clears when an answer comes back "ok", the name fails the format,
 * or the check is disabled. An answer for an earlier value is never applied.
 */
export function useNameCheck(name: string, enabled = true): string | null {
  const [error, setError] = useState<string | null>(null);
  const active = enabled && USERNAME_FORMAT.test(name);

  // Adjusted during render, not in an effect: an inactive field shows nothing, so the kept
  // message is dropped and cannot flash back when the field becomes active again.
  if (!active && error !== null) setError(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await checkName(name);
      if (!cancelled) setError(result.ok ? null : result.error ?? FALLBACK_ERROR);
    }, NAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [name, active]);

  return active ? error : null;
}

/** The note's slot under a username field (sign-up form, profile editor): only its height and
 *  opacity animate, so the fields below glide instead of jumping. The text inside swaps with
 *  SwapText. Use with initial="hidden" animate="visible" exit="hidden". */
export const nameNoteSlot: Variants = {
  hidden: { height: 0, opacity: 0, transition: { duration: durations.fast, ease: easing.in } },
  visible: { height: "auto", opacity: 1, transition: { duration: durations.base, ease: easing.out } },
};
