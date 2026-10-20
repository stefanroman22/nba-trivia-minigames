"use client";
import { useEffect } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "../store";
import { apiFetch, getAccessToken } from "../utils/Api";
import { BACKEND_URL } from "../configurations/backend";

/** How often the clock checks whether the player is still here. */
const TICK_MS = 15_000;
/** No pointer, key, touch or scroll for this long = away, even with the tab open. */
const IDLE_MS = 3 * 60_000;
/** Batched: one report every 5 minutes of use, plus one whenever the tab is hidden or closed. */
const FLUSH_MS = 5 * 60_000;
/** Matches users.activity.MAX_REPORT_SECONDS: anything above is clamped server-side anyway. */
const MAX_REPORT_S = 15 * 60;
/** Hiding the tab reports only once this much is owed, so tab-hopping stays under the server's rate limit. */
const MIN_HIDE_REPORT_MS = 30_000;

const INTERACTIONS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Time on the site for signed-in players (the admin Users tab; users.activity on the backend).
 *
 * Counts only while the tab is visible AND the player interacted in the last IDLE_MS, so a tab
 * left open overnight counts nothing. Guests are never tracked: nothing runs without a session,
 * and a report is only sent while an access token exists. The country comes from the host's
 * geo header server-side; nothing about location is read here.
 */
export function useActivityTracker() {
  // Keyed by account, not just "signed in": switching accounts must not credit A's time to B.
  const accountId = useSelector((s: RootState) => s.user.user?.id ?? null);

  useEffect(() => {
    if (!accountId) return;

    let pendingMs = 0;
    let lastTick = Date.now();
    let lastInteraction = Date.now();
    let lastFlush = Date.now();

    const visible = () => document.visibilityState === "visible";

    // Credit the time since the previous tick, if the player was here for it. `wasVisible`: the tab
    // has just been hidden, so the stretch up to now was still on screen.
    const accrue = (wasVisible = visible()) => {
      const now = Date.now();
      const elapsed = Math.min(now - lastTick, TICK_MS * 2);
      lastTick = now;
      if (wasVisible && now - lastInteraction < IDLE_MS) pendingMs += elapsed;
    };

    const flush = (closing = false) => {
      const seconds = Math.min(Math.floor(pendingMs / 1000), MAX_REPORT_S);
      lastFlush = Date.now();
      if (seconds <= 0 || !getAccessToken()) return;
      pendingMs -= seconds * 1000;
      // Seconds go back on the pile if the report doesn't land (offline, throttled), so the next one carries them.
      const restore = () => {
        pendingMs += seconds * 1000;
      };
      // keepalive lets the last report outlive a closing tab (sendBeacon can't carry the JWT).
      apiFetch(`${BACKEND_URL}/activity/`, {
        method: "POST",
        body: JSON.stringify({ seconds }),
        keepalive: closing,
      })
        .then((res) => {
          if (!res.ok) restore();
        })
        .catch(restore);
    };

    const onInteraction = () => {
      // Coming back after being idle starts a fresh stretch rather than crediting the gap.
      if (Date.now() - lastInteraction >= IDLE_MS) lastTick = Date.now();
      lastInteraction = Date.now();
    };

    const onVisibility = () => {
      if (visible()) {
        lastTick = Date.now();
        lastInteraction = Date.now();
      } else {
        accrue(true);
        // A quick look at another tab isn't worth a request; small amounts wait for the next report
        // (or pagehide, if the tab is closed while hidden).
        if (pendingMs >= MIN_HIDE_REPORT_MS) flush(true);
      }
    };

    const onPageHide = () => {
      accrue();
      flush(true);
    };

    const timer = window.setInterval(() => {
      accrue();
      if (Date.now() - lastFlush >= FLUSH_MS) flush();
    }, TICK_MS);

    for (const e of INTERACTIONS) window.addEventListener(e, onInteraction, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.clearInterval(timer);
      for (const e of INTERACTIONS) window.removeEventListener(e, onInteraction, { capture: true });
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      // Unmount or sign-out: send what is still owed if the session's token is still there.
      accrue();
      flush(true);
    };
  }, [accountId]);
}
