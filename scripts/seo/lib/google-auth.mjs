// Google OAuth for the SEO agent: where the owner's credentials live (env GOOGLE_SEO_CLIENT_ID / _CLIENT_SECRET /
// _REFRESH_TOKEN, else the file scripts/seo/auth.mjs wrote) and a refresh-token → access-token source. No token, client
// secret or response body ever reaches an error message: a failed exchange throws `google auth: <status>`.
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** The local credentials file: %LOCALAPPDATA%\nba-seo\google-oauth.json on Windows, else ~/.config/nba-seo/google-oauth.json. */
export function credentialsPath() {
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'nba-seo', 'google-oauth.json');
  }
  return path.join(os.homedir(), '.config', 'nba-seo', 'google-oauth.json');
}

/**
 * The owner's Google credentials: all three env vars when set, else the credentials file, else null. A file that is
 * not JSON or lacks a field throws (naming the file, never its content).
 *
 * @param {{ env?: Record<string, string|undefined>, file?: string }} [opts] injectable for tests
 * @returns {{ clientId: string, clientSecret: string, refreshToken: string } | null}
 */
export function credentialsFromEnv({ env = process.env, file = credentialsPath() } = {}) {
  const clientId = env.GOOGLE_SEO_CLIENT_ID?.trim();
  const clientSecret = env.GOOGLE_SEO_CLIENT_SECRET?.trim();
  const refreshToken = env.GOOGLE_SEO_REFRESH_TOKEN?.trim();
  if (clientId && clientSecret && refreshToken) return { clientId, clientSecret, refreshToken };
  if (!existsSync(file)) return null;
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch { doc = null; }
  if (!doc || typeof doc !== 'object' || !['clientId', 'clientSecret', 'refreshToken'].every((k) => typeof doc[k] === 'string' && doc[k])) {
    throw new Error(`google auth: ${file} is not { clientId, clientSecret, refreshToken } JSON (rerun node scripts/seo/auth.mjs)`);
  }
  return { clientId: doc.clientId, clientSecret: doc.clientSecret, refreshToken: doc.refreshToken };
}

/**
 * The parsed JSON body of a Google response. A body that is not JSON throws `<what>: response is not JSON` (the
 * SyntaxError would quote the body, which may hold a token or data).
 */
export async function readJson(res, what) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; } catch { throw new Error(`${what}: response is not JSON`); }
}

/**
 * Access tokens from a refresh token: one POST to the token endpoint, the token cached until 60 s before it expires
 * (concurrent callers share the one request; a failure is not cached).
 *
 * @param {{ clientId: string, clientSecret: string, refreshToken: string, fetch?: typeof fetch, now?: () => number }} opts
 * @returns {{ access(): Promise<string> }}
 */
export function tokenSource({ clientId, clientSecret, refreshToken, fetch: fetchImpl = globalThis.fetch, now = Date.now }) {
  let cached = null; // { token, expiresAt }
  let pending = null;

  async function refresh() {
    let res;
    try {
      res = await fetchImpl(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(),
      });
    } catch (e) {
      throw new Error(`google auth: request failed (${e.cause?.code || e.name})`);
    }
    if (!res.ok) throw new Error(`google auth: ${res.status}`);
    const body = await readJson(res, 'google auth');
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error('google auth: no access_token in the response');
    const ttl = Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600;
    cached = { token: body.access_token, expiresAt: now() + ttl * 1000 };
    return cached.token;
  }

  return {
    async access() {
      if (cached && now() < cached.expiresAt - 60_000) return cached.token;
      pending ??= refresh().finally(() => { pending = null; });
      return pending;
    },
  };
}
