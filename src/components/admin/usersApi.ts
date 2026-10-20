/**
 * Types + fetchers for the admin Users tab. Mirrors backend/users/admin_users_api.py; the friend
 * request goes through the ordinary friends endpoints (the admin is a player there too).
 */
import { apiFetch } from "../../utils/Api";
import { BACKEND_URL } from "../../configurations/backend";

export type UsersPeriod = "7d" | "30d" | "90d" | "12m" | "all";

export type UsersBucket = {
  start: string;
  label: string;
  signups: number;
  active_players: number;
  seconds: number;
  games: number;
  online_games: number;
};

export type UsersOverview = {
  range: { period: UsersPeriod; from: string; to: string; granularity: string };
  users: { total: number; new: number; banned: number; admins: number; google: number };
  active: { today: number; week: number; month: number; period: number };
  time: {
    period_seconds: number;
    all_time_seconds: number;
    per_active_player: number;
    per_active_day: number;
    tracked_since: string | null;
  };
  games: {
    total: number;
    signed_in: number;
    guests: number;
    online: number;
    by_mode: Record<string, number>;
    players: number;
    online_players: number;
    game_ms: number;
  };
  series: { granularity: string; buckets: UsersBucket[] };
  ranks: { rank: string; count: number }[];
  countries: { country: string; players: number; seconds: number }[];
  by_game: { game: string; plays: number; players: number; online: number; ms: number }[];
  top_time: { public_id: string; username: string; seconds: number }[];
};

export type UserRow = {
  public_id: string;
  username: string;
  email: string;
  rank: string;
  points: number;
  photo_version: number;
  date_joined: string;
  last_seen: string | null;
  country: string;
  games: number;
  online_games: number;
  game_ms: number;
  app_seconds: number;
  seconds_30d: number;
  active_days: number;
  is_admin: boolean;
  banned: boolean;
  google: boolean;
};

export type UsersPage = { total: number; offset: number; rows: UserRow[] };

export type UsersQuery = { q: string; filter: string; rank: string; country: string; sort: string };

export const EMPTY_QUERY: UsersQuery = { q: "", filter: "all", rank: "", country: "", sort: "newest" };

export type UserAccount = {
  public_id: string;
  username: string;
  email: string;
  rank: string;
  points: number;
  photo_version: number;
  date_joined: string;
  last_login: string | null;
  google: boolean;
  has_password: boolean;
  is_admin: boolean;
  is_active: boolean;
  banned_at: string | null;
  ban_reason: string;
  strike_count: number;
  active_days: number;
  streak_days: number;
  streak_best: number;
  streak_freezes: number;
  founding_member: boolean;
  terms_version: string;
  terms_accepted_at: string | null;
};

export type Relationship = {
  status: "self" | "friend" | "pending_outgoing" | "pending_incoming" | "blocked" | "none";
  request_id: number | null;
};

export type UserDetail = {
  account: UserAccount;
  relationship: Relationship;
  usage: {
    total_seconds: number;
    seconds_today: number;
    seconds_7d: number;
    seconds_30d: number;
    days_active: number;
    per_active_day: number;
    first_seen_day: string | null;
    last_seen: string | null;
    country: string;
    countries: { country: string; days: number; seconds: number }[];
    daily: { day: string; label: string; seconds: number }[];
  };
  games: {
    total: number;
    online: number;
    by_mode: Record<string, number>;
    game_ms: number;
    points_awarded: number;
    first_at: string | null;
    last_at: string | null;
    by_game: { game: string; plays: number; online: number; best: number; avg: number; ms: number; last: string | null }[];
    recent: { game: string; mode: string; score: number; awarded: number; ms: number; at: string }[];
  };
  social: { friends: number; requests_in: number; requests_out: number; blocking: number; blocked_by: number };
  feedback: number;
  question_reports: number;
  moderation: { kind: string; tier: string; reason: string; at: string }[];
};

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.detail || fallback);
  return data as T;
}

export async function fetchOverview(period: UsersPeriod, signal?: AbortSignal) {
  const res = await apiFetch(`${BACKEND_URL}/admin/users/overview/?period=${period}`, signal ? { signal } : {});
  return readJson<UsersOverview>(res, "Could not load the overview");
}

export async function fetchUsers(query: UsersQuery, offset: number, limit: number, signal?: AbortSignal) {
  const p = new URLSearchParams({ offset: String(offset), limit: String(limit), sort: query.sort, filter: query.filter });
  if (query.q.trim()) p.set("q", query.q.trim());
  if (query.rank) p.set("rank", query.rank);
  if (query.country) p.set("country", query.country);
  const res = await apiFetch(`${BACKEND_URL}/admin/users/?${p}`, signal ? { signal } : {});
  return readJson<UsersPage>(res, "Could not load players");
}

export async function fetchUserDetail(publicId: string) {
  const res = await apiFetch(`${BACKEND_URL}/admin/users/${encodeURIComponent(publicId)}/`);
  return readJson<UserDetail>(res, "Could not load this player");
}

export async function setBanned(publicId: string, banned: boolean) {
  const res = await apiFetch(`${BACKEND_URL}/admin/users/${encodeURIComponent(publicId)}/ban/`, {
    method: "POST",
    body: JSON.stringify({ action: banned ? "ban" : "unban" }),
  });
  return (await readJson<{ account: UserAccount }>(res, "Could not update the ban")).account;
}

/** From the admin's own account, exactly as the friends screen would. */
export async function sendFriendRequest(publicId: string) {
  const res = await apiFetch(`${BACKEND_URL}/send-friend-request/`, {
    method: "POST",
    body: JSON.stringify({ public_id: publicId }),
  });
  return (await readJson<{ status: "sent" | "accepted" }>(res, "Could not send the request")).status;
}

export async function cancelFriendRequest(requestId: number) {
  const res = await apiFetch(`${BACKEND_URL}/cancel-friend-request/`, {
    method: "POST",
    body: JSON.stringify({ request_id: requestId }),
  });
  await readJson(res, "Could not cancel the request");
}

export async function acceptFriendRequest(requestId: number) {
  const res = await apiFetch(`${BACKEND_URL}/accept-friend-request/`, {
    method: "POST",
    body: JSON.stringify({ request_id: requestId }),
  });
  await readJson(res, "Could not accept the request");
}

/* ---------------- formatting shared by the tab and its charts ---------------- */
export function fmtDuration(seconds: number): string {
  if (!seconds) return "0m";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 100) return `${h.toLocaleString()}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m`;
  return `${seconds}s`;
}

const regionNames = typeof Intl !== "undefined" && "DisplayNames" in Intl
  ? new Intl.DisplayNames(["en"], { type: "region" })
  : null;

export function countryName(code: string): string {
  if (!code) return "Unknown";
  try {
    return regionNames?.of(code) ?? code;
  } catch {
    return code;
  }
}
