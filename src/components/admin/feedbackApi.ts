/**
 * Types + fetchers for the admin Feedback tab.
 * Mirrors backend/trivia/feedback_api.py — one filter object drives both calls,
 * which is what keeps the charts and the table showing the same set of rows.
 */
import { apiFetch } from "../../utils/Api";
import { BACKEND_URL } from "../../configurations/backend";

/** Filter value meaning "sent from a non-game screen" — see NO_GAME in feedback_api.py.
 *  Feedback rows store game="" for these, and an empty string cannot be sent as a
 *  filter value because it is indistinguishable from "no filter at all". */
export const NO_GAME = "__none__";

export type Granularity = "day" | "week" | "month" | "year";
export type FeedbackStatus = "new" | "read" | "resolved";

export type FeedbackFilters = {
  period: string; // "all" | "7d" | "30d" | "90d" | "12m" | "24m" | "custom"
  from?: string;
  to?: string;
  granularity?: Granularity;
  ratings: number[];
  hasMessage: "" | "true" | "false";
  audience: "all" | "registered" | "guest";
  minSessions: string;
  maxSessions: string;
  minPoints: string;
  game: string;
  statuses: FeedbackStatus[];
  q: string;
  sort: string;
};

export const EMPTY_FILTERS: FeedbackFilters = {
  period: "all",
  ratings: [],
  hasMessage: "",
  audience: "all",
  minSessions: "",
  maxSessions: "",
  minPoints: "",
  game: "",
  statuses: [],
  q: "",
  sort: "newest",
};

export type Bucket = {
  start: string;
  end: string;
  label: string;
  count: number;
  avg_rating: number | null;
  promoters: number;
  detractors: number;
};

export type FeedbackStats = {
  totals: {
    count: number;
    avg_rating: number | null;
    with_message: number;
    registered: number;
    guests: number;
    promoters: number;
    passives: number;
    detractors: number;
    unresolved: number;
  };
  previous: { count: number; avg_rating: number | null };
  distribution: { rating: number; count: number }[];
  series: { granularity: Granularity; drill_into: Granularity; buckets: Bucket[] };
  by_game: { game: string; label: string; count: number; avg_rating: number | null }[];
  range: { from: string; to: string; period: string; granularity: Granularity };
  all_time: { count: number; new: number; first_at: string | null };
};

export type FeedbackAccount = {
  id: number;
  public_id: string;
  username: string;
  email: string;
  points: number;
  rank: string;
};

export type FeedbackRow = {
  id: number;
  rating: number;
  message: string;
  created_at: string;
  status: FeedbackStatus;
  admin_note: string;
  page: string;
  game: string;
  sessions: number;
  account: FeedbackAccount | null;
  snapshot: { email: string; display_name: string; public_id: string };
  account_deleted: boolean;
  is_guest: boolean;
};

export type FeedbackPage = { total: number; offset: number; limit: number; rows: FeedbackRow[] };

/** Turn the filter object into the query string both endpoints understand. */
export function toParams(f: FeedbackFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.period === "custom") {
    if (f.from) p.set("from", f.from);
    if (f.to) p.set("to", f.to);
  } else {
    p.set("period", f.period);
  }
  if (f.granularity) p.set("granularity", f.granularity);
  if (f.ratings.length) p.set("rating", [...f.ratings].sort().join(","));
  if (f.hasMessage) p.set("has_message", f.hasMessage);
  if (f.audience !== "all") p.set("audience", f.audience);
  if (f.minSessions) p.set("min_sessions", f.minSessions);
  if (f.maxSessions) p.set("max_sessions", f.maxSessions);
  if (f.minPoints) p.set("min_points", f.minPoints);
  if (f.game) p.set("game", f.game);
  if (f.statuses.length) p.set("status", f.statuses.join(","));
  if (f.q.trim()) p.set("q", f.q.trim());
  if (f.sort) p.set("sort", f.sort);
  return p;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await apiFetch(url, signal ? { signal } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || "Request failed");
  return data as T;
}

export function fetchStats(f: FeedbackFilters, signal?: AbortSignal) {
  return getJson<FeedbackStats>(`${BACKEND_URL}/admin/feedback/stats/?${toParams(f)}`, signal);
}

export function fetchPage(f: FeedbackFilters, offset: number, limit: number, signal?: AbortSignal) {
  const p = toParams(f);
  p.set("offset", String(offset));
  p.set("limit", String(limit));
  return getJson<FeedbackPage>(`${BACKEND_URL}/admin/feedback/?${p}`, signal);
}

export async function updateFeedback(
  id: number,
  patch: { status?: FeedbackStatus; admin_note?: string },
): Promise<FeedbackRow> {
  const res = await apiFetch(`${BACKEND_URL}/admin/feedback/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Could not update this feedback");
  return data.row as FeedbackRow;
}
