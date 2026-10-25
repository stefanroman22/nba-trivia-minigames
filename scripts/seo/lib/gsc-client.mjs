// Search Console client for the SEO agent: URL inspection (with a per-run quota guard), the property's sitemaps, a
// sitemap submit and Search Analytics. Google allows 2,000 inspections a day and 600 a minute per property, so after
// the first 429/403, or once `budget` inspections were sent, `inspect` resolves { error: 'budget' } without a request.
// Errors carry the endpoint and the HTTP status only, never a token or a response body.
import { readJson } from './google-auth.mjs';

export const INSPECT_URL = 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect';
export const WEBMASTERS = 'https://www.googleapis.com/webmasters/v3';

/**
 * @typedef {{ verdict: string|null, coverageState: string|null, indexingState: string|null, pageFetchState: string|null,
 *   robotsTxtState: string|null, lastCrawlTime: string|null, googleCanonical: string|null, userCanonical: string|null,
 *   crawledAs: string|null, richResults: { verdict: string|null, items: number, errors: number }, inspectedAt: string,
 *   link: string|null } | { error: string, inspectedAt?: string }} Inspection
 *   `error`: '429' | '403' | another HTTP status | 'network' for that url, or 'budget' (no request was made).
 *   `richResults.items` counts the detected items of every rich result type, `errors` their ERROR-severity issues.
 */

const DAY_MS = 86_400_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * The Search Analytics date range for `days` back: endDate = today (UTC) − 2 days (Google's data lag), startDate =
 * endDate − days. The only date arithmetic of the client.
 *
 * @returns {{ startDate: string, endDate: string }}
 */
export function analyticsRange(days, now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const end = today - 2 * DAY_MS;
  return { startDate: isoDay(end - days * DAY_MS), endDate: isoDay(end) };
}

/** One indexStatusResult + richResultsResult → the Inspection shape (absent fields null). */
function toInspection(result, inspectedAt) {
  const s = result?.indexStatusResult ?? {};
  const rich = result?.richResultsResult;
  const items = (rich?.detectedItems ?? []).flatMap((d) => d.items ?? []);
  const pick = (k) => s[k] ?? null;
  return {
    verdict: pick('verdict'),
    coverageState: pick('coverageState'),
    indexingState: pick('indexingState'),
    pageFetchState: pick('pageFetchState'),
    robotsTxtState: pick('robotsTxtState'),
    lastCrawlTime: pick('lastCrawlTime'),
    googleCanonical: pick('googleCanonical'),
    userCanonical: pick('userCanonical'),
    crawledAs: pick('crawledAs'),
    richResults: {
      verdict: rich?.verdict ?? null,
      items: items.length,
      errors: items.flatMap((i) => i.issues ?? []).filter((x) => x.severity === 'ERROR').length,
    },
    inspectedAt,
    link: result?.inspectionResultLink ?? null,
  };
}

/**
 * A Search Console client for `property` (e.g. 'sc-domain:swishquest.com').
 *
 * @param {{ token: { access(): Promise<string> } | string, property: string, fetch?: typeof fetch, budget?: number,
 *   now?: () => Date }} opts `token` a tokenSource (or a fixed access token)
 * @returns {{ inspect(url: string): Promise<Inspection>,
 *   sitemaps(): Promise<Array<{ path: string, lastSubmitted: string|null, lastDownloaded: string|null, errors: number, warnings: number, isPending: boolean }>>,
 *   submitSitemap(feedpath: string): Promise<void>,
 *   analytics(opts?: { days?: number, dimensions?: string[] }): Promise<Array<{ keys: string[], clicks: number, impressions: number, ctr: number, position: number }>>,
 *   used(): number }}
 */
export function gscClient({ token, property, fetch: fetchImpl = globalThis.fetch, budget = 200, now = () => new Date() }) {
  const site = `${WEBMASTERS}/sites/${encodeURIComponent(property)}`;
  let sent = 0;
  let stopped = false;

  /** One authorised request → the Response (a network failure rejects with `gsc <what>: request failed`). */
  async function call(what, method, url, body) {
    const access = typeof token === 'string' ? token : await token.access();
    const headers = { authorization: `Bearer ${access}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    try {
      return await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw Object.assign(new Error(`gsc ${what}: request failed (${e.cause?.code || e.name})`), { network: true });
    }
  }

  /** A request whose non-2xx status throws `gsc <what>: <status>`; → the parsed body. */
  async function json(what, method, url, body) {
    const res = await call(what, method, url, body);
    if (!res.ok) throw new Error(`gsc ${what}: ${res.status}`);
    return readJson(res, `gsc ${what}`);
  }

  return {
    async inspect(url) {
      if (stopped || sent >= budget) return { error: 'budget' };
      sent += 1;
      let res;
      try {
        res = await call('inspect', 'POST', INSPECT_URL, { inspectionUrl: url, siteUrl: property, languageCode: 'en-US' });
      } catch (e) {
        if (e.network) return { error: 'network', inspectedAt: now().toISOString() };
        throw e; // the token source failed: every later call would too
      }
      const inspectedAt = now().toISOString();
      if (res.status === 429 || res.status === 403) { stopped = true; return { error: String(res.status), inspectedAt }; }
      if (!res.ok) return { error: String(res.status), inspectedAt };
      const body = await readJson(res, 'gsc inspect');
      return toInspection(body.inspectionResult, inspectedAt);
    },

    async sitemaps() {
      const body = await json('sitemaps', 'GET', `${site}/sitemaps`);
      return (body.sitemap ?? []).map((s) => ({
        path: s.path,
        lastSubmitted: s.lastSubmitted ?? null,
        lastDownloaded: s.lastDownloaded ?? null,
        errors: Number(s.errors ?? 0),
        warnings: Number(s.warnings ?? 0),
        isPending: Boolean(s.isPending),
      }));
    },

    async submitSitemap(feedpath) {
      const res = await call('submit-sitemap', 'PUT', `${site}/sitemaps/${encodeURIComponent(feedpath)}`);
      if (!res.ok) throw new Error(`gsc submit-sitemap: ${res.status}`);
    },

    async analytics({ days = 28, dimensions = ['page'] } = {}) {
      const { startDate, endDate } = analyticsRange(days, now());
      const body = await json('analytics', 'POST', `${site}/searchAnalytics/query`, { startDate, endDate, dimensions, rowLimit: 25000, dataState: 'final' });
      return body.rows ?? [];
    },

    used: () => sent,
  };
}
