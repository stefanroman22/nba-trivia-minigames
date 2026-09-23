import { BACKEND_URL } from "../configurations/backend";
import type { User } from "../store/userSlice";
import { isSessionUser } from "./session";

// Token-refresh queue: many requests can 401 at once, but only one refresh should
// run. The rest wait here and are settled with the outcome.
//
// Each waiter keeps BOTH resolve and reject. An earlier version kept only resolve
// and threw from inside the notify loop on failure — which stranded every queued
// promise unsettled (their `await` never returned, so those requests hung forever)
// and skipped the remaining subscribers. Rejecting is what lets a failed refresh
// surface as "session expired" instead of a spinner that never stops.

/** What token/refresh/ hands back: the new access token plus, when the backend includes it
 *  (users.tokens.SessionRefreshSerializer), the signed-in user's /me/ payload — so a return
 *  visit can resume the session in one round trip (app/providers.tsx). */
export type RefreshResult = { access: string; user?: User };

/** Thrown by refreshSession when the request never reached the server — offline, DNS,
 *  timeout, wake-from-sleep. Distinguishes "couldn't ask" from "asked and was told no": a
 *  caller sees this and leaves tokens/cache alone instead of treating it as a dead session. */
export class SessionNetworkError extends Error {
  constructor(message = "Network error while refreshing session") {
    super(message);
    this.name = "SessionNetworkError";
  }
}

let isRefreshing = false;
type RefreshWaiter = { resolve: (result: RefreshResult) => void; reject: (err: Error) => void };
let refreshSubscribers: RefreshWaiter[] = [];

function subscribeTokenRefresh(waiter: RefreshWaiter) {
  refreshSubscribers.push(waiter);
}

function onRefreshed(result: RefreshResult | null, error?: Error) {
  // Take the list first: settling a waiter can synchronously queue more work, and
  // no waiter may be notified twice.
  const waiters = refreshSubscribers;
  refreshSubscribers = [];
  for (const waiter of waiters) {
    // One waiter's exception must not strand the others.
    try {
      if (result) waiter.resolve(result);
      else waiter.reject(error ?? new Error("Session expired. Please log in again."));
    } catch (err) {
      console.error("Token refresh subscriber failed:", err);
    }
  }
}

export function getAccessToken() {
  return localStorage.getItem("accessToken");
}

export function getRefreshToken() {
  return localStorage.getItem("refreshToken");
}

export function setTokens(access: string, refresh: string) {
  localStorage.setItem("accessToken", access);
  localStorage.setItem("refreshToken", refresh);
}

export function clearTokens() {
  localStorage.removeItem("accessToken");
  localStorage.removeItem("refreshToken");
}

/** Rotate the refresh token. One refresh runs at a time — concurrent callers share its
 *  outcome. Resolves with the new access token (+ the user when the backend sends it).
 *  A server-rejected refresh clears the tokens and rejects every waiter; a network
 *  failure (SessionNetworkError) or a malformed response rejects every waiter too, but
 *  leaves the tokens in place (AUTH-11). */
export async function refreshSession(): Promise<RefreshResult> {
  // A refresh is already in flight — wait for its outcome rather than starting a
  // second one. Whether tokens survive depends on how it settles (see above).
  if (isRefreshing) {
    return new Promise<RefreshResult>((resolve, reject) => {
      subscribeTokenRefresh({ resolve, reject });
    });
  }

  isRefreshing = true;
  const refresh = getRefreshToken();

  if (!refresh) {
    isRefreshing = false;
    const err = new Error("No refresh token available");
    onRefreshed(null, err);
    throw err;
  }

  let res: Response;
  try {
    res = await fetch(`${BACKEND_URL}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });
  } catch {
    // The request itself never reached the server. This says nothing about whether
    // the refresh token is still good, so it — and the cached user — stay put; only
    // a server answer (ok or not) may clear them.
    isRefreshing = false;
    const networkError = new SessionNetworkError();
    onRefreshed(null, networkError);
    throw networkError;
  }

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    console.error("Refresh failed:", errorData);

    // The server answered and said no: the refresh token is genuinely dead.
    clearTokens();
    isRefreshing = false;
    const authError = new Error("Refresh token expired or invalid");
    onRefreshed(null, authError);
    throw authError;
  }

  try {
    const data = await res.json();
    setTokens(data.access, data.refresh);
    const result: RefreshResult = isSessionUser(data.user)
      ? { access: data.access, user: data.user }
      : { access: data.access };
    isRefreshing = false;
    onRefreshed(result);
    return result;
  } catch (err) {
    // A malformed 200 body, or setTokens throwing (storage quota / private mode), is
    // not a session verdict — the server said yes, so the tokens are left as they are.
    isRefreshing = false;
    const error = err instanceof Error ? err : new Error(String(err));
    onRefreshed(null, error);
    throw error;
  }
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const usedToken = getAccessToken();

  // Detect if body is FormData
  const isFormData = options.body instanceof FormData;

  const makeRequest = async (token?: string | null) => {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    // Only set Content-Type for JSON, not FormData
    if (!isFormData && !headers["Content-Type"]) {
      headers["Content-Type"] = "application/json";
    }

    return await fetch(url, {
      ...options,
      headers,
    });
  };

  // --- 1. Try with the current access token ---
  let response = await makeRequest(usedToken);

  // --- 2. If unauthorized, attempt to refresh token ---
  if (response.status === 401 && getRefreshToken()) {
    try {
      // Is this 401 about the token, or a genuine permission failure?
      //
      // simplejwt answers this precisely: it sets code "token_not_valid" on the
      // body. Prefer that over scanning the text for words like "invalid", which
      // both false-positives on unrelated 401s and misses differently-worded
      // token errors. A body we can't read is treated as a token error so the
      // refresh path still runs behind a bare 401.
      const contentType = response.headers.get("content-type");
      let isTokenError = true;

      if (contentType?.includes("application/json")) {
        const errorData = await response.clone().json().catch(() => null);
        if (errorData) {
          isTokenError =
            errorData.code === "token_not_valid" ||
            (Array.isArray(errorData.messages) &&
              errorData.messages.some(
                (msg: { message?: string }) => msg?.message?.toLowerCase().includes("token")
              ));
        }
      }

      if (isTokenError) {
        // A concurrent request may have already rotated the token while this one sat
        // on its own 401 (two mounts each firing a request that expires moments
        // apart, one settling the single-flight refresh before the other's 401
        // lands). Retry once with whatever token is current now instead of
        // starting/joining a second, redundant refresh; only fall through to a real
        // refresh if that retry also 401s.
        const current = getAccessToken();
        if (current && current !== usedToken) {
          response = await makeRequest(current);
        }
        if (!current || current === usedToken || response.status === 401) {
          // --- 3. Refresh the access token ---
          const { access: newAccessToken } = await refreshSession();

          // --- 4. Retry the original request with the new token ---
          response = await makeRequest(newAccessToken);
        }
      } else {
        // Not a token issue, just return the original 401
        return response;
      }
    } catch (err) {
      if (err instanceof SessionNetworkError) {
        // Couldn't reach the server to refresh — not a verdict on the session.
        // Leave the tokens as they are and let the caller see the real error.
        console.error("Session check failed (network):", err);
        throw err;
      }
      // --- 5. The server rejected the refresh: clear everything and force logout ---
      clearTokens();
      console.error("Session expired:", err);
      throw new Error("Session expired. Please log in again.");
    }
  }

  return response;
}