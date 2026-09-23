// Session bootstrap helpers for app/providers.tsx: the cached /me/ payload that lets a
// return visit render as signed-in before the network answers, and the access-token
// expiry check that skips the dead /me/ -> 401 hop once it has expired.
//
// Security: the cache is display-only. It holds exactly what /me/ returns (id, username,
// email, rank, points, photo data URL, is_admin hint) and lives next to the refresh token
// that already grants everything about the account, so it adds no capability. It never
// holds a token. It is cleared on logout, on any failed session check and on a corrupt
// read; everything sensitive re-checks the server (admin endpoints re-check is_staff).
import type { User } from "../store/userSlice";

const SESSION_USER_KEY = "nba3via-session-user";

/** Treat a token as expired this long before `exp`, so one that dies in flight doesn't cost a 401. */
const ACCESS_EXPIRY_SKEW_MS = 30_000;

export function isSessionUser(value: unknown): value is User {
  if (!value || typeof value !== "object") return false;
  const u = value as Record<string, unknown>;
  return typeof u.id === "string" && typeof u.username === "string" && typeof u.points === "number";
}

export function readCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (isSessionUser(parsed)) return parsed;
  } catch {
    /* unavailable or corrupt — drop it below */
  }
  clearCachedUser();
  return null;
}

export function writeCachedUser(user: User): void {
  try {
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(user));
  } catch {
    /* quota exceeded / private mode — the next visit just takes the network path */
  }
}

export function clearCachedUser(): void {
  try {
    localStorage.removeItem(SESSION_USER_KEY);
  } catch {
    /* ignore */
  }
}

/** True when the JWT's `exp` is past (or within the skew). An unreadable token counts as not
 *  expired: the request goes out as before and apiFetch's 401 path still covers it. */
export function isAccessTokenExpired(token: string): boolean {
  try {
    const payload = token.split(".")[1] ?? "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const exp: unknown = JSON.parse(atob(padded)).exp;
    return typeof exp === "number" && exp * 1000 <= Date.now() + ACCESS_EXPIRY_SKEW_MS;
  } catch {
    return false;
  }
}
