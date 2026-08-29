import { BACKEND_URL } from "../configurations/backend";

// Token-refresh queue: many requests can 401 at once, but only one refresh should
// run. The rest wait here and are settled with the outcome.
//
// Each waiter keeps BOTH resolve and reject. An earlier version kept only resolve
// and threw from inside the notify loop on failure — which stranded every queued
// promise unsettled (their `await` never returned, so those requests hung forever)
// and skipped the remaining subscribers. Rejecting is what lets a failed refresh
// surface as "session expired" instead of a spinner that never stops.
let isRefreshing = false;
type RefreshWaiter = { resolve: (token: string) => void; reject: (err: Error) => void };
let refreshSubscribers: RefreshWaiter[] = [];

function subscribeTokenRefresh(waiter: RefreshWaiter) {
  refreshSubscribers.push(waiter);
}

function onRefreshed(token: string | null) {
  // Take the list first: settling a waiter can synchronously queue more work, and
  // no waiter may be notified twice.
  const waiters = refreshSubscribers;
  refreshSubscribers = [];
  for (const waiter of waiters) {
    // One waiter's exception must not strand the others.
    try {
      if (token) waiter.resolve(token);
      else waiter.reject(new Error("Session expired. Please log in again."));
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

async function refreshAccessToken() {
  // A refresh is already in flight — wait for its outcome rather than starting
  // a second one. Tokens are cleared by the refresher itself on failure.
  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      subscribeTokenRefresh({ resolve, reject });
    });
  }

  isRefreshing = true;
  const refresh = getRefreshToken();
  
  if (!refresh) {
    isRefreshing = false;
    onRefreshed(null);
    throw new Error("No refresh token available");
  }

  try {
    const res = await fetch(`${BACKEND_URL}/token/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      console.error("Refresh failed:", errorData);
      
      // Clear tokens on any refresh failure
      clearTokens();
      isRefreshing = false;
      onRefreshed(null);
      throw new Error("Refresh token expired or invalid");
    }

    const data = await res.json();
    setTokens(data.access, data.refresh);
    isRefreshing = false;
    onRefreshed(data.access);
    return data.access;
  } catch (error) {
    isRefreshing = false;
    onRefreshed(null);
    clearTokens();
    throw error;
  }
}

export async function apiFetch(url: string, options: RequestInit = {}) {
  const accessToken = getAccessToken();

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
  let response = await makeRequest(accessToken);

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
        // --- 3. Refresh the access token ---
        const newAccessToken = await refreshAccessToken();

        // --- 4. Retry the original request with the new token ---
        response = await makeRequest(newAccessToken);
      } else {
        // Not a token issue, just return the original 401
        return response;
      }
    } catch (err) {
      // --- 5. Refresh failed, clear everything and force logout ---
      clearTokens();
      console.error("Session expired:", err);
      throw new Error("Session expired. Please log in again.");
    }
  }

  return response;
}