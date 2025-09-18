// Add a simple token refresh queue to prevent multiple simultaneous refreshes
let isRefreshing = false;
let refreshSubscribers: Array<(token: string | null) => void> = [];

function subscribeTokenRefresh(callback: (token: string | null) => void) {
  refreshSubscribers.push(callback);
}

function onRefreshed(token: string | null) {
  refreshSubscribers.forEach(callback => callback(token));
  refreshSubscribers = [];
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
  // Prevent multiple simultaneous refresh attempts
  if (isRefreshing) {
    return new Promise<string>((resolve) => {
      subscribeTokenRefresh((token) => {
        if (token) resolve(token);
        else {
          // Refresh failed
          clearTokens();
          throw new Error("Session expired. Please log in again.");
        }
      });
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
    const res = await fetch("http://localhost:8000/api/token/refresh/", {
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

  const makeRequest = async (token?: string) => {
    const headers: Record<string, string> = {
      ...(options.headers || {}),
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
      // Check if this is a token-related error (not another authentication issue)
      const contentType = response.headers.get("content-type");
      let isTokenError = true;
      
      if (contentType?.includes("application/json")) {
        const errorData = await response.clone().json().catch(() => ({}));
        
        // Check for common token error indicators
        const errorText = JSON.stringify(errorData).toLowerCase();
        isTokenError = 
          errorText.includes("token") || 
          errorText.includes("expired") || 
          errorText.includes("invalid") ||
          errorData.code === "token_not_valid" ||
          (errorData.messages && 
           errorData.messages.some((msg: any) => 
             msg.message?.toLowerCase().includes("expired")
           ));
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