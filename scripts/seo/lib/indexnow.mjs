// IndexNow for the SEO agent: the key file check, the batch ping and which URLs to ping. One POST tells Bing, Yandex,
// Naver and Seznam (they share the protocol; Google does not use it) that the URLs changed. The key is public by
// protocol (anyone must be able to fetch <site>/<key>.txt), so it is plain config, never a secret.
// Errors name the endpoint and the cause only, never a response body.

export const INDEXNOW_URL = 'https://api.indexnow.org/indexnow';
export const MAX_URLS = 10_000;
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;

/** What each IndexNow response status means (spec: 200 ok, 202 accepted/key pending, 4xx refusals). */
export const STATUS_TEXT = {
  200: 'ok',
  202: 'accepted (key pending)',
  400: 'invalid request',
  403: 'key invalid',
  422: 'urls not of the host',
  429: 'too many requests',
};

/** The key file's URL: <site>/<key>.txt. */
export const keyFileUrl = (site, key) => `${String(site).replace(/\/+$/, '')}/${key}.txt`;

/**
 * Whether <site>/<key>.txt is live: a GET (through the audit's non-following fetcher) answers 200 and its trimmed
 * body equals the key. A key outside the protocol's 8-128 [A-Za-z0-9-] is never live (no request); a failed request
 * is not live.
 *
 * @param {{ site: string, key: string, fetcher: { get(url: string): Promise<{ status: number, body: string }> } }} opts
 * @returns {Promise<boolean>}
 */
export async function keyFileLive({ site, key, fetcher }) {
  if (typeof key !== 'string' || !KEY_RE.test(key)) return false;
  try {
    const r = await fetcher.get(keyFileUrl(site, key));
    return r.status === 200 && String(r.body ?? '').replace(/^﻿/, '').trim() === key;
  } catch {
    return false;
  }
}

/**
 * One batch ping: POST INDEXNOW_URL with { host, key, urlList }: the distinct `urls` of the site's host, at most
 * MAX_URLS (the rest dropped). No URL left → no request, { status: null, count: 0 }. A failed request throws
 * `indexnow: request failed (<code>)`.
 *
 * @param {{ site: string, key: string, urls: string[], fetch?: typeof fetch }} opts
 * @returns {Promise<{ status: number|null, count: number }>}
 */
export async function pingIndexNow({ site, key, urls, fetch: fetchImpl = globalThis.fetch }) {
  const host = new URL(site).host;
  const ofHost = (u) => { try { return new URL(u).host === host; } catch { return false; } };
  const urlList = [...new Set(urls ?? [])].filter(ofHost).slice(0, MAX_URLS);
  if (!urlList.length) return { status: null, count: 0 };
  let res;
  try {
    res = await fetchImpl(INDEXNOW_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, urlList }),
    });
  } catch (e) {
    throw new Error(`indexnow: request failed (${e.cause?.code || e.name})`);
  }
  await res.body?.cancel();
  return { status: res.status, count: urlList.length };
}

const failKey = (e) => [...new Set(e?.audit?.fail ?? [])].sort().join(' ');

/**
 * The URLs to ping: every URL the current ledger audited (an `audit` block) whose `audit.fail` set differs from the
 * previous ledger's (a URL the previous ledger did not audit counts as changed), or whose `lastmod` differs (when
 * the ledger entries carry one; the Task 5 ledger does not, so today it is the fail sets only). Sorted.
 *
 * @param {{ urls: Record<string, object> }} ledger
 * @param {{ urls: Record<string, object> } | null} previousLedger
 * @returns {string[]}
 */
export function changedUrls(ledger, previousLedger) {
  const before = previousLedger?.urls ?? {};
  return Object.entries(ledger?.urls ?? {})
    .filter(([url, e]) => {
      if (!e?.audit) return false;
      const p = before[url];
      if (!p?.audit) return true;
      return failKey(e) !== failKey(p) || (e.lastmod ?? null) !== (p.lastmod ?? null);
    })
    .map(([url]) => url)
    .sort();
}
