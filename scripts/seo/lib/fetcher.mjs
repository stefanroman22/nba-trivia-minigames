// The SEO audit's only door to a site: GET and HEAD with a Googlebot-like mobile user agent, at most `concurrency`
// requests in flight, a per-request timeout that covers the body, and redirects never followed (a 301 comes back as a
// 301 with its Location, so the audit sees exactly what a crawler's first hop sees).

export const DEFAULT_UA =
  'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; swishquest-seo-audit/1.0)';

/**
 * @typedef {{ status: number, headers: Record<string, string>, body: string, location: string|null }} FetchResult
 *   `headers` lowercased; `body` '' for HEAD; `location` the Location header resolved against the request URL, or null.
 */

/** The waits before the second and the third attempt of a request that could not complete. */
export const RETRY_DELAYS_MS = [500, 1500];

/**
 * A rate-limited, non-following HTTP client. A request that cannot complete (DNS, refused, timeout) is tried again
 * after each of `retryDelaysMs` (the slot is freed while it waits); when the last attempt fails too it rejects with an
 * Error naming the method, the URL and the cause. Any HTTP status, 4xx/5xx included, resolves (never retried).
 *
 * @param {{ ua?: string, concurrency?: number, timeoutMs?: number, redirect?: 'manual', retryDelaysMs?: number[], fetch?: typeof fetch }} [opts]
 * @returns {{ get(url: string): Promise<FetchResult>, head(url: string): Promise<FetchResult> }}
 */
export function fetcher({ ua = DEFAULT_UA, concurrency = 4, timeoutMs = 15000, redirect = 'manual', retryDelaysMs = RETRY_DELAYS_MS, fetch: fetchImpl = globalThis.fetch } = {}) {
  if (redirect !== 'manual') throw new Error(`fetcher: redirect must be 'manual' (the audit never follows a redirect), got ${redirect}`);
  let active = 0;
  const waiting = [];
  const acquire = () => new Promise((resolve) => {
    if (active < concurrency) { active += 1; resolve(); } else waiting.push(resolve);
  });
  // A freed slot goes straight to the next waiter, so `active` never exceeds `concurrency`.
  const release = () => { const next = waiting.shift(); if (next) next(); else active -= 1; };

  async function attempt(method, url) {
    await acquire();
    try {
      const signal = AbortSignal.timeout(timeoutMs);
      const res = await fetchImpl(url, {
        method,
        redirect: 'manual',
        signal,
        headers: { 'user-agent': ua, accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      });
      const body = method === 'HEAD' ? '' : await res.text();
      const raw = res.headers.get('location');
      let location = null;
      if (raw) { try { location = new URL(raw, url).href; } catch { location = raw; } }
      return { status: res.status, headers: Object.fromEntries(res.headers), body, location };
    } catch (e) {
      const why = e.name === 'TimeoutError' ? `timed out after ${timeoutMs} ms` : e.cause?.message || e.message;
      throw new Error(`${method} ${url}: ${why}`);
    } finally {
      release();
    }
  }

  async function request(method, url) {
    for (let i = 0; ; i++) {
      try {
        return await attempt(method, url);
      } catch (e) {
        if (i >= retryDelaysMs.length) throw e;
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[i]));
      }
    }
  }

  return { get: (url) => request('GET', url), head: (url) => request('HEAD', url) };
}
