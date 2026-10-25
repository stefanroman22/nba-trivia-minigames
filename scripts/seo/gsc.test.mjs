// node --test scripts/seo/gsc.test.mjs — the Google token source, the Search Console client (URL inspection mapping,
// the quota guard, sitemaps, Search Analytics dates), credential lookup and the auth URL. Every Google call goes to an
// injected fetch fake that records the request and answers from a fixture; nothing touches the network.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tokenSource, credentialsFromEnv } from './lib/google-auth.mjs';
import { gscClient } from './lib/gsc-client.mjs';
import { buildAuthUrl } from './auth.mjs';

const PROPERTY = 'sc-domain:swishquest.com';
const SECRETS = { clientId: 'cid-123.apps.googleusercontent.com', clientSecret: 'GOCSPX-very-secret', refreshToken: '1//refresh-secret' };
const tmpDirs = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

/**
 * A fetch fake: `answer(req)` → { status, json } for each request; `requests` keeps { url, method, headers, body }
 * (body parsed as JSON when it is JSON, else the raw string).
 */
function fakeFetch(answer) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const raw = init.body === undefined ? undefined : String(init.body);
    let body = raw;
    try { body = raw === undefined ? undefined : JSON.parse(raw); } catch { /* form-encoded */ }
    const req = { url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), body };
    requests.push(req);
    const { status = 200, json = {} } = answer(req, requests.length);
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  };
  return { fetch, requests };
}

const staticToken = { access: async () => 'tok' };

const INSPECTION = {
  inspectionResult: {
    inspectionResultLink: 'https://search.google.com/search-console/inspect?resource_id=sc-domain%3Aswishquest.com&id=abc',
    indexStatusResult: {
      verdict: 'PASS',
      coverageState: 'Submitted and indexed',
      robotsTxtState: 'ALLOWED',
      indexingState: 'INDEXING_ALLOWED',
      lastCrawlTime: '2026-10-20T08:15:00Z',
      pageFetchState: 'SUCCESSFUL',
      googleCanonical: 'https://swishquest.com/wordle',
      userCanonical: 'https://swishquest.com/wordle',
      crawledAs: 'MOBILE',
      sitemap: ['https://swishquest.com/sitemap.xml'],
      referringUrls: ['https://swishquest.com/'],
    },
    richResultsResult: {
      verdict: 'PARTIAL',
      detectedItems: [
        { richResultType: 'Breadcrumbs', items: [{ name: 'a', issues: [{ severity: 'WARNING', issueMessage: 'w' }] }, { name: 'b' }] },
        { richResultType: 'FAQ', items: [{ name: 'c', issues: [{ severity: 'ERROR', issueMessage: 'e1' }, { severity: 'ERROR', issueMessage: 'e2' }] }] },
      ],
    },
  },
};

test('tokenSource posts grant_type=refresh_token once and caches the access token', async () => {
  let clock = 1_000_000;
  const { fetch, requests } = fakeFetch(() => ({ json: { access_token: `at-${requests.length}`, expires_in: 3600 } }));
  const source = tokenSource({ ...SECRETS, fetch, now: () => clock });
  assert.equal(await source.access(), 'at-1');
  assert.equal(await source.access(), 'at-1');
  assert.equal(requests.length, 1);
  const [req] = requests;
  assert.equal(req.url, 'https://oauth2.googleapis.com/token');
  assert.equal(req.method, 'POST');
  assert.match(req.headers['content-type'], /application\/x-www-form-urlencoded/);
  const form = new URLSearchParams(req.body);
  assert.deepEqual(Object.fromEntries(form), {
    client_id: SECRETS.clientId, client_secret: SECRETS.clientSecret, refresh_token: SECRETS.refreshToken, grant_type: 'refresh_token',
  });
  clock += (3600 - 61) * 1000; // still more than 60 s left
  assert.equal(await source.access(), 'at-1');
  clock += 2000; // now inside the last 60 s
  assert.equal(await source.access(), 'at-2');
  assert.equal(requests.length, 2);
});

test('inspect maps indexStatusResult and richResultsResult to the Inspection shape', async () => {
  const { fetch, requests } = fakeFetch(() => ({ json: INSPECTION }));
  const now = new Date('2026-10-25T10:00:00Z');
  const client = gscClient({ token: staticToken, property: PROPERTY, fetch, now: () => now });
  const got = await client.inspect('https://swishquest.com/wordle');
  assert.deepEqual(got, {
    verdict: 'PASS',
    coverageState: 'Submitted and indexed',
    indexingState: 'INDEXING_ALLOWED',
    pageFetchState: 'SUCCESSFUL',
    robotsTxtState: 'ALLOWED',
    lastCrawlTime: '2026-10-20T08:15:00Z',
    googleCanonical: 'https://swishquest.com/wordle',
    userCanonical: 'https://swishquest.com/wordle',
    crawledAs: 'MOBILE',
    richResults: { verdict: 'PARTIAL', items: 3, errors: 2 },
    inspectedAt: '2026-10-25T10:00:00.000Z',
    link: INSPECTION.inspectionResult.inspectionResultLink,
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://searchconsole.googleapis.com/v1/urlInspection/index:inspect');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers.authorization, 'Bearer tok');
  assert.deepEqual(requests[0].body, { inspectionUrl: 'https://swishquest.com/wordle', siteUrl: PROPERTY, languageCode: 'en-US' });
  assert.equal(client.used(), 1);
});

test('inspect: a 429 marks that url error and every later call resolves { error: "budget" } with no request', async () => {
  const { fetch, requests } = fakeFetch(() => ({ status: 429, json: { error: { code: 429, message: 'Quota exceeded' } } }));
  const now = new Date('2026-10-25T10:00:00Z');
  const client = gscClient({ token: staticToken, property: PROPERTY, fetch, now: () => now });
  assert.deepEqual(await client.inspect('https://swishquest.com/a'), { error: '429', inspectedAt: '2026-10-25T10:00:00.000Z' });
  assert.deepEqual(await client.inspect('https://swishquest.com/b'), { error: 'budget' });
  assert.deepEqual(await client.inspect('https://swishquest.com/c'), { error: 'budget' });
  assert.equal(requests.length, 1);
  assert.equal(client.used(), 1);

  const forbidden = fakeFetch(() => ({ status: 403, json: {} }));
  const client403 = gscClient({ token: staticToken, property: PROPERTY, fetch: forbidden.fetch, now: () => now });
  assert.equal((await client403.inspect('https://swishquest.com/a')).error, '403');
  assert.deepEqual(await client403.inspect('https://swishquest.com/b'), { error: 'budget' });
  assert.equal(forbidden.requests.length, 1);

  const broken = fakeFetch(() => ({ status: 500, json: {} }));
  const client500 = gscClient({ token: staticToken, property: PROPERTY, fetch: broken.fetch, now: () => now });
  assert.equal((await client500.inspect('https://swishquest.com/a')).error, '500');
  assert.equal((await client500.inspect('https://swishquest.com/b')).error, '500'); // a 5xx is that url's error, not a stop
  assert.equal(broken.requests.length, 2);
});

test('inspect stops at budget (budget 2 → third call makes no request)', async () => {
  const { fetch, requests } = fakeFetch(() => ({ json: INSPECTION }));
  const client = gscClient({ token: staticToken, property: PROPERTY, fetch, budget: 2 });
  assert.equal((await client.inspect('https://swishquest.com/a')).verdict, 'PASS');
  assert.equal((await client.inspect('https://swishquest.com/b')).verdict, 'PASS');
  assert.deepEqual(await client.inspect('https://swishquest.com/c'), { error: 'budget' });
  assert.equal(requests.length, 2);
  assert.equal(client.used(), 2);
});

test('analytics posts startDate/endDate (days back, two-day lag), dimensions, rowLimit 25000, dataState final', async () => {
  const rows = [{ keys: ['https://swishquest.com/wordle'], clicks: 4, impressions: 120, ctr: 0.0333, position: 8.2 }];
  const { fetch, requests } = fakeFetch(() => ({ json: { rows } }));
  const now = new Date('2026-10-25T10:00:00Z');
  const client = gscClient({ token: staticToken, property: PROPERTY, fetch, now: () => now });
  assert.deepEqual(await client.analytics(), rows);
  assert.equal(requests[0].url, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`);
  assert.equal(requests[0].method, 'POST');
  assert.deepEqual(requests[0].body, { startDate: '2026-09-25', endDate: '2026-10-23', dimensions: ['page'], rowLimit: 25000, dataState: 'final' });

  assert.deepEqual(await client.analytics({ days: 7, dimensions: ['query', 'page'] }), rows);
  assert.deepEqual(requests[1].body, { startDate: '2026-10-16', endDate: '2026-10-23', dimensions: ['query', 'page'], rowLimit: 25000, dataState: 'final' });

  const empty = fakeFetch(() => ({ json: {} })); // the API omits `rows` when there is no data
  const quiet = gscClient({ token: staticToken, property: PROPERTY, fetch: empty.fetch, now: () => now });
  assert.deepEqual(await quiet.analytics(), []);
});

test('sitemaps lists the property sitemaps and submitSitemap PUTs the encoded feedpath', async () => {
  const list = { sitemap: [{ path: 'https://swishquest.com/sitemap.xml', lastSubmitted: '2026-10-01T00:00:00Z', lastDownloaded: '2026-10-24T00:00:00Z', isPending: false, errors: '0', warnings: '1', type: 'sitemap' }] };
  const { fetch, requests } = fakeFetch((req) => ({ json: req.method === 'GET' ? list : {} }));
  const client = gscClient({ token: staticToken, property: PROPERTY, fetch });
  assert.deepEqual(await client.sitemaps(), [
    { path: 'https://swishquest.com/sitemap.xml', lastSubmitted: '2026-10-01T00:00:00Z', lastDownloaded: '2026-10-24T00:00:00Z', errors: 0, warnings: 1, isPending: false },
  ]);
  const base = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/sitemaps`;
  assert.equal(requests[0].url, base);
  await client.submitSitemap('https://swishquest.com/sitemap.xml');
  assert.equal(requests[1].method, 'PUT');
  assert.equal(requests[1].url, `${base}/${encodeURIComponent('https://swishquest.com/sitemap.xml')}`);
  assert.equal(client.used(), 0); // only inspections count against the budget
});

test('credentialsFromEnv prefers env over the file and returns null when neither exists', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'seo-gsc-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'google-oauth.json');
  writeFileSync(file, JSON.stringify({ clientId: 'file-id', clientSecret: 'file-secret', refreshToken: 'file-refresh' }));
  const env = { GOOGLE_SEO_CLIENT_ID: 'env-id', GOOGLE_SEO_CLIENT_SECRET: 'env-secret', GOOGLE_SEO_REFRESH_TOKEN: 'env-refresh' };
  assert.deepEqual(credentialsFromEnv({ env, file }), { clientId: 'env-id', clientSecret: 'env-secret', refreshToken: 'env-refresh' });
  assert.deepEqual(credentialsFromEnv({ env: { GOOGLE_SEO_CLIENT_ID: 'env-id' }, file }), { clientId: 'file-id', clientSecret: 'file-secret', refreshToken: 'file-refresh' });
  assert.equal(credentialsFromEnv({ env: {}, file: path.join(dir, 'missing.json') }), null);
});

test('no secret in a thrown error message (token 401 → message is "google auth: 401")', async () => {
  const { fetch } = fakeFetch(() => ({ status: 401, json: { error: 'invalid_client', error_description: `bad ${SECRETS.clientSecret} ${SECRETS.refreshToken}` } }));
  const source = tokenSource({ ...SECRETS, fetch });
  const err = await source.access().then(() => null, (e) => e);
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'google auth: 401');
  for (const s of Object.values(SECRETS)) assert.ok(!String(err.stack).includes(s));

  // A body that is not JSON (and would echo itself in a SyntaxError) never reaches the message either.
  const garbled = async () => new Response(`not json ${SECRETS.refreshToken}`, { status: 200 });
  const err2 = await tokenSource({ ...SECRETS, fetch: garbled }).access().then(() => null, (e) => e);
  assert.ok(err2 instanceof Error);
  assert.ok(!String(err2.stack).includes(SECRETS.refreshToken));
  assert.match(err2.message, /^google auth: /);

  // The client propagates the token failure unchanged.
  const client = gscClient({ token: source, property: PROPERTY, fetch: async () => { throw new Error('unreachable'); } });
  await assert.rejects(client.inspect('https://swishquest.com/'), { message: 'google auth: 401' });
});

test('buildAuthUrl asks for both scopes, offline access and the consent prompt', () => {
  const u = new URL(buildAuthUrl({ clientId: SECRETS.clientId, redirectUri: 'http://127.0.0.1:54321', state: 's1' }));
  assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/webmasters https://www.googleapis.com/auth/drive');
  assert.equal(u.searchParams.get('access_type'), 'offline');
  assert.equal(u.searchParams.get('prompt'), 'consent');
  assert.equal(u.searchParams.get('response_type'), 'code');
  assert.equal(u.searchParams.get('client_id'), SECRETS.clientId);
  assert.equal(u.searchParams.get('redirect_uri'), 'http://127.0.0.1:54321');
  assert.equal(u.searchParams.get('state'), 's1');
});
