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

/** The live server verdict on a name: "checking" while the debounced check for this exact value is
 *  pending, then "ok" or "bad" (with the server's generic message). */
export type NameVerdict = { status: "checking" | "ok" | "bad"; error: string | null };

/**
 * Debounced live check for a username field. Returns null when the check is off (`enabled` false, or
 * the name fails the format rule, which the checklist shows on its own); otherwise the verdict for
 * the current value, "checking" until its answer arrives. An answer for an earlier value is never
 * applied, and a network/throttle failure reads as "ok" (the server judges again on submit).
 */
export function useNameVerdict(name: string, enabled = true): NameVerdict | null {
  const [answer, setAnswer] = useState<{ name: string; ok: boolean; error: string | null } | null>(null);
  const active = enabled && USERNAME_FORMAT.test(name);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const result = await checkName(name);
      if (!cancelled) setAnswer({ name, ok: result.ok, error: result.ok ? null : result.error ?? FALLBACK_ERROR });
    }, NAME_CHECK_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [name, active]);

  if (!active) return null;
  if (!answer || answer.name !== name) return { status: "checking", error: null };
  return { status: answer.ok ? "ok" : "bad", error: answer.error };
}

/** The slot animation shared by the checklists under the password and username fields (and the
 *  name and photo-age notes): only its height and opacity animate, so the fields below glide
 *  instead of jumping. Use with initial="hidden" animate="visible" exit="hidden". */
export const nameNoteSlot: Variants = {
  hidden: { height: 0, opacity: 0, transition: { duration: durations.fast, ease: easing.in } },
  visible: { height: "auto", opacity: 1, transition: { duration: durations.base, ease: easing.out } },
};
