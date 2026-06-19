export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;

// Backend origin without the trailing "/api" — used for non-/api routes
// like /trivia/*. Falls back to local dev if the env var is missing.
export const BACKEND_ORIGIN = (BACKEND_URL || "http://localhost:8000/api").replace(/\/api\/?$/, "");
