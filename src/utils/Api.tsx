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
  const refresh = getRefreshToken();
  if (!refresh) throw new Error("No refresh token available");

  const res = await fetch("http://localhost:8000/api/token/refresh/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh }),
  });

  if (!res.ok) {
    throw new Error("Refresh token expired or invalid");
  }

  const data = await res.json();
  setTokens(data.access, refresh); // keep using same refresh token
  return data.access;
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

    // Only set Content-Type if it's NOT FormData
    if (!isFormData) {
      headers["Content-Type"] = "application/json";
    }

    return await fetch(url, {
      ...options,
      headers,
    });
  };

  // First attempt
  let response = await makeRequest(accessToken ? accessToken : "");

  // If access token expired, try to refresh and retry once
  if (response.status === 401 && getRefreshToken()) {
    try {
      const newAccessToken = await refreshAccessToken();
      response = await makeRequest(newAccessToken);
    } catch (err) {
      clearTokens();
      console.error(err);
      throw new Error("Session expired. Please log in again.");
    }
  }

  return response;
}

