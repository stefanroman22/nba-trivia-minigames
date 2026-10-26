// node --test scripts/seo/indexnow.test.mjs — the IndexNow key file check, the batch ping (body shape, the 10,000 cap),
// changedUrls() between two ledgers and indexnow.mjs's degradation. Injected fetch/fetcher fakes; never hits the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { INDEXNOW_URL, MAX_URLS, changedUrls, keyFileLive, pingIndexNow } from './lib/indexnow.mjs';
import { cli } from './indexnow.mjs';

const SITE = 'https://swishquest.com';
const KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'seo-indexnow-'));

/** A fetcher fake: `routes` { url: { status, body } }; every GET is recorded. */
function fakeFetcher(routes) {
  const calls = [];
  return {
    calls,
    async get(url) {
      calls.push(url);
      const r = routes[url] ?? { status: 404, body: 'not found' };
      return { status: r.status, headers: {}, body: r.body, location: null };
    },
    async head() { throw new Error('keyFileLive must GET'); },
  };
}

/** A fetch fake answering `status`; every call recorded as { url, method, headers, body }. */
function fakeFetch(status = 200) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method, headers: init.headers ?? {}, body: init.body });
    return new Response('', { status });
  };
  f.calls = calls;
  return f;
}

const entry = (fail, extra = {}) => ({ inSitemap: true, expectNoindex: false, audit: { runId: 'r', pass: [], fail }, gsc: null, requests: [], indexnow: null, decision: null, ...extra });
const ledgerOf = (urls) => ({ dataAsOf: { audit: null, gsc: null, indexnow: null }, urls, history: [] });

test('keyFileLive: 200 with the key is live; 404, another body or a failed request is not', async () => {
  const url = `${SITE}/${KEY}.txt`;
  const live = fakeFetcher({ [url]: { status: 200, body: `${KEY}\n` } });
  assert.equal(await keyFileLive({ site: SITE, key: KEY, fetcher: live }), true);
  assert.deepEqual(live.calls, [url]);
  assert.equal(await keyFileLive({ site: `${SITE}/`, key: KEY, fetcher: live }), true, 'a trailing slash on site');

  assert.equal(await keyFileLive({ site: SITE, key: KEY, fetcher: fakeFetcher({}) }), false, '404');
  assert.equal(await keyFileLive({ site: SITE, key: KEY, fetcher: fakeFetcher({ [url]: { status: 200, body: 'another-key-123' } }) }), false, 'body mismatch');
  assert.equal(await keyFileLive({ site: SITE, key: KEY, fetcher: fakeFetcher({ [url]: { status: 301, body: KEY } }) }), false, 'a redirect is not live');
  const down = { async get() { throw new Error(`GET ${url}: ECONNREFUSED`); } };
  assert.equal(await keyFileLive({ site: SITE, key: KEY, fetcher: down }), false, 'network failure');
  // A key outside the protocol's 8-128 [A-Za-z0-9-] is never live, and no request is made.
  const none = fakeFetcher({});
  assert.equal(await keyFileLive({ site: SITE, key: 'short', fetcher: none }), false);
  assert.equal(await keyFileLive({ site: SITE, key: 'has spaces in it', fetcher: none }), false);
  assert.deepEqual(none.calls, []);
});

test('pingIndexNow: one JSON POST { host, key, urlList } to api.indexnow.org', async () => {
  const f = fakeFetch(202);
  const urls = [`${SITE}/wordle`, `${SITE}/connections`, `${SITE}/wordle`];
  const r = await pingIndexNow({ site: SITE, key: KEY, urls, fetch: f });
  assert.deepEqual(r, { status: 202, count: 2 });
  assert.equal(f.calls.length, 1);
  const [c] = f.calls;
  assert.equal(c.url, INDEXNOW_URL);
  assert.equal(INDEXNOW_URL, 'https://api.indexnow.org/indexnow');
  assert.equal(c.method, 'POST');
  assert.equal(c.headers['content-type'], 'application/json; charset=utf-8');
  assert.deepEqual(JSON.parse(c.body), { host: 'swishquest.com', key: KEY, urlList: [`${SITE}/wordle`, `${SITE}/connections`] });
});

test('pingIndexNow: at most 10,000 URLs, only URLs of the host, no request for none', async () => {
  assert.equal(MAX_URLS, 10_000);
  const f = fakeFetch(200);
  const urls = Array.from({ length: 10_050 }, (_, i) => `${SITE}/p/${i}`);
  const r = await pingIndexNow({ site: SITE, key: KEY, urls: [...urls, 'https://elsewhere.example/x'], fetch: f });
  assert.deepEqual(r, { status: 200, count: 10_000 });
  const body = JSON.parse(f.calls[0].body);
  assert.equal(body.urlList.length, 10_000);
  assert.deepEqual(body.urlList, urls.slice(0, 10_000));

  const g = fakeFetch(200);
  assert.deepEqual(await pingIndexNow({ site: SITE, key: KEY, urls: ['https://elsewhere.example/x'], fetch: g }), { status: null, count: 0 });
  assert.deepEqual(g.calls, []);
});

test('pingIndexNow: a failed request throws naming the endpoint only', async () => {
  const boom = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(pingIndexNow({ site: SITE, key: KEY, urls: [`${SITE}/`], fetch: boom }), (e) => {
    assert.equal(e.message, 'indexnow: request failed (ENOTFOUND)');
    return true;
  });
});

test('changedUrls: a URL whose audit.fail set changed, a new audited URL, a changed lastmod; never an unaudited one', () => {
  const previous = ledgerOf({
    [`${SITE}/`]: entry([]),
    [`${SITE}/wordle`]: entry(['IX-04']),
    [`${SITE}/connections`]: entry(['IX-04', 'IX-05']),
    [`${SITE}/privacy`]: entry([], { lastmod: '2026-10-01' }),
    [`${SITE}/gone`]: entry([]),
  });
  const ledger = ledgerOf({
    [`${SITE}/`]: entry([]), // unchanged
    [`${SITE}/wordle`]: entry([]), // IX-04 fixed
    [`${SITE}/connections`]: entry(['IX-05', 'IX-04']), // same set, another order
    [`${SITE}/privacy`]: entry([], { lastmod: '2026-10-20' }), // lastmod moved
    [`${SITE}/new-game`]: entry([]), // first audited this run
    [`${SITE}/gone`]: entry([], { audit: null }), // no longer audited
    [`${SITE}/inspected-only`]: entry([], { audit: null }),
  });
  assert.deepEqual(changedUrls(ledger, previous), [`${SITE}/new-game`, `${SITE}/privacy`, `${SITE}/wordle`]);
  // No previous ledger: every audited URL is new.
  assert.deepEqual(changedUrls(ledger, null), [`${SITE}/`, `${SITE}/connections`, `${SITE}/new-game`, `${SITE}/privacy`, `${SITE}/wordle`]);
  assert.deepEqual(changedUrls(ledger, ledger), []);
});

/** A run dir with ledger.json (current) and ledger-previous.json; → { runDir, ledgerFile, previousFile }. */
function runFixture() {
  const dir = tmp();
  const runDir = path.join(dir, 'run');
  const ledgerFile = path.join(dir, 'ledger.json');
  const previousFile = path.join(dir, 'previous.json');
  writeFileSync(ledgerFile, JSON.stringify(ledgerOf({ [`${SITE}/`]: entry([]), [`${SITE}/wordle`]: entry([]) })));
  writeFileSync(previousFile, JSON.stringify(ledgerOf({ [`${SITE}/`]: entry([]), [`${SITE}/wordle`]: entry(['IX-04']) })));
  return { runDir, ledgerFile, previousFile };
}
const capture = () => {
  const out = [];
  return { out, log: (s) => out.push(String(s)), err: (s) => out.push(`ERR ${s}`) };
};

test('indexnow.mjs: no indexNowKey → one skipped line, exit 0, no request', async () => {
  const { runDir, ledgerFile, previousFile } = runFixture();
  const f = fakeFetch(200);
  const fx = fakeFetcher({});
  const io = capture();
  const code = await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--previous', previousFile],
    { ...io, config: { site: SITE, indexNowKey: null }, fetch: f, fetcher: fx });
  assert.equal(code, 0);
  assert.deepEqual(io.out, ['indexnow: skipped (no indexNowKey in config.json)']);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(fx.calls, []);
});

test('indexnow.mjs: key file not live → one skipped line, exit 0, no ping', async () => {
  const { runDir, ledgerFile, previousFile } = runFixture();
  const f = fakeFetch(200);
  const io = capture();
  const code = await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--previous', previousFile],
    { ...io, config: { site: SITE, indexNowKey: KEY }, fetch: f, fetcher: fakeFetcher({}) });
  assert.equal(code, 0);
  assert.deepEqual(io.out, [`indexnow: skipped (key file ${SITE}/${KEY}.txt not live)`]);
  assert.deepEqual(f.calls, []);
});

test('indexnow.mjs: a live key pings the changed URLs and records indexnow.json; --dry-run pings nothing', async () => {
  const { runDir, ledgerFile, previousFile } = runFixture();
  const live = { [`${SITE}/${KEY}.txt`]: { status: 200, body: KEY } };
  const config = { site: SITE, indexNowKey: KEY };
  const f = fakeFetch(202);
  const io = capture();
  const now = Date.parse('2026-10-26T04:10:00Z');
  const code = await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--previous', previousFile], { ...io, config, fetch: f, fetcher: fakeFetcher(live), now });
  assert.equal(code, 0);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(JSON.parse(f.calls[0].body).urlList, [`${SITE}/wordle`]);
  assert.deepEqual(io.out, ['indexnow: 202 accepted (key pending) · 1 url(s)']);
  const rec = JSON.parse(readFileSync(path.join(runDir, 'indexnow.json'), 'utf8'));
  assert.deepEqual(rec, { at: '2026-10-26T04:10:00.000Z', status: 202, count: 1, urls: [`${SITE}/wordle`], dryRun: false });

  const { runDir: dryDir, ledgerFile: l2, previousFile: p2 } = runFixture();
  const g = fakeFetch(200);
  const io2 = capture();
  assert.equal(await cli(['--run-dir', dryDir, '--ledger', l2, '--previous', p2, '--dry-run'], { ...io2, config, fetch: g, fetcher: fakeFetcher(live), now }), 0);
  assert.deepEqual(g.calls, []);
  assert.deepEqual(io2.out, ['indexnow: dry · 1 url(s) would be pinged']);
  assert.equal(JSON.parse(readFileSync(path.join(dryDir, 'indexnow.json'), 'utf8')).dryRun, true);
});

test('indexnow.mjs: a rejected ping exits 1; bad arguments exit 2', async () => {
  const { runDir, ledgerFile, previousFile } = runFixture();
  const live = { [`${SITE}/${KEY}.txt`]: { status: 200, body: KEY } };
  const io = capture();
  const code = await cli(['--run-dir', runDir, '--ledger', ledgerFile, '--previous', previousFile],
    { ...io, config: { site: SITE, indexNowKey: KEY }, fetch: fakeFetch(403), fetcher: fakeFetcher(live) });
  assert.equal(code, 1);
  assert.deepEqual(io.out, ['ERR indexnow: 403 key invalid · 1 url(s)']);

  const io2 = capture();
  assert.equal(await cli(['--bogus'], { ...io2, config: { site: SITE, indexNowKey: KEY } }), 2);
  const io3 = capture();
  assert.equal(await cli([], { ...io3, config: { site: SITE, indexNowKey: KEY } }), 2, '--run or --run-dir is required');
});
