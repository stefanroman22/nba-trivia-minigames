// Account-ban plumbing (AUTH: 403 `account_banned`). The backend answers a banned account with
// 403 `{ code: "account_banned", error, public_id, strikes, reason, banned_at }` on every
// authenticated endpoint, login, Google login and token refresh. Every caller that can see that
// body reports it here; the one handler (registered by app/providers.tsx) clears the session and
// puts the slice into its `banned` state, which BanNotice renders.
//
// Deliberately imports nothing from Api.tsx or the store, so Api.tsx can import it without a cycle.

export const BAN_CODE = "account_banned";

export type BanInfo = {
  code: typeof BAN_CODE;
  error: string;
  public_id: string;
  strikes: number;
  reason: string;
  banned_at: string | null;
};

/** True when `body` is the backend's ban payload. Only `code` is load-bearing; the other
 *  fields are normalised by `toBanInfo` so a partial body still reaches the screen. */
export function isBanPayload(body: unknown): body is BanInfo {
  return typeof body === "object" && body !== null && (body as { code?: unknown }).code === BAN_CODE;
}

function toBanInfo(body: BanInfo): BanInfo {
  return {
    code: BAN_CODE,
    error: typeof body.error === "string" ? body.error : "This account has been banned.",
    public_id: typeof body.public_id === "string" ? body.public_id : "",
    strikes: typeof body.strikes === "number" ? body.strikes : 0,
    reason: typeof body.reason === "string" ? body.reason : "",
    banned_at: typeof body.banned_at === "string" ? body.banned_at : null,
  };
}

/** Reads a ban payload off a 403 JSON response without consuming the caller's body. */
export async function banFromResponse(res: Response): Promise<BanInfo | null> {
  if (res.status !== 403) return null;
  if (!res.headers.get("content-type")?.includes("application/json")) return null;
  const body: unknown = await res.clone().json().catch(() => null);
  return isBanPayload(body) ? toBanInfo(body) : null;
}

type BanHandler = (info: BanInfo) => void;
let banHandler: BanHandler | null = null;

/** Registers the app-wide handler (app/providers.tsx). Returns an unregister function. */
export function setBanHandler(fn: BanHandler): () => void {
  banHandler = fn;
  return () => {
    if (banHandler === fn) banHandler = null;
  };
}

/** Hands a ban to the app. Safe to call before the handler mounts (it is then a no-op: the
 *  next authenticated request reports it again). */
export function reportBan(info: BanInfo): void {
  banHandler?.(toBanInfo(info));
}
