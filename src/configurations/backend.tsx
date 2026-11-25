export const BACKEND_URL = process.env.VITE_BACKEND_URL ?? "";

// The photo-check (moderation) service's public health GET. Pinged when the file picker opens so its
// cold start overlaps with choosing a file; unset = no ping.
export const PHOTO_CHECK_URL = process.env.VITE_PHOTO_CHECK_URL ?? "";

// Backend origin without the trailing "/api" — used for non-/api routes
// like /trivia/*. Falls back to local dev if the env var is missing.
export const BACKEND_ORIGIN = (BACKEND_URL || "http://localhost:8000/api").replace(/\/api\/?$/, "");

// "Why?" on a missed answer (utils/explain.ts, components/review/ExplainWhy.tsx) and the single-player "See why"
// action. A build-time flag, unset everywhere by default: anything but "1" renders nothing new and makes no request.
export const EXPLANATIONS_ENABLED = process.env.VITE_EXPLANATIONS === "1";
