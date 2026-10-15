// Selftest for the --live guard (lib/fixtures.mjs guardLive): in env 'live' a request to a remote origin with a method
// other than GET/HEAD is ABORTED (the page sees a network error) and recorded as a `live-write` violation (so done()
// fails); a remote websocket is refused; GETs pass and are counted; the attachment carries env + the counters. With
// detection only (@perf tests) nothing is routed. The remote origin is fulfilled by page.route: nothing leaves the machine.
import { test, expect } from '@playwright/test';
import { createAudit, guardLive, isRemote } from '../../lib/fixtures.mjs';

const ORIGIN = 'https://live.example.invalid';
/** Serve the fake live origin for GETs only; anything else falls through to the context's guard route. */
const serveGets = (page) => page.route(`${ORIGIN}/**`, (r) => (r.request().method() === 'GET'
  ? r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>live</title><p>live</p>', headers: { 'access-control-allow-origin': '*' } })
  : r.fallback()));

test('[ST-LIVEGUARD] in env live a POST to a remote origin is aborted and recorded as live-write; a websocket is refused; GETs pass', async ({ browser }, testInfo) => {
  const prev = process.env.UI_CHECK_ENV;
  process.env.UI_CHECK_ENV = 'live';
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await serveGets(page);
    const audit = await createAudit(page, testInfo, { label: 'live' });
    await page.goto(`${ORIGIN}/`);
    const seen = await page.evaluate(async (origin) => {
      const get = await fetch(`${origin}/api/read`).then((r) => r.status, (e) => `error ${e.message}`);
      const post = await fetch(`${origin}/api/write?x=1`, { method: 'POST', body: 'x' }).then((r) => `status ${r.status}`, (e) => `error ${e.message}`);
      const ws = await new Promise((resolve) => {
        const s = new WebSocket('wss://live.example.invalid/socket.io/?EIO=4');
        s.onopen = () => resolve('open');
        s.onclose = (e) => resolve(`closed ${e.code}`);
        s.onerror = () => resolve('error');
        setTimeout(() => resolve('timeout'), 5000);
      });
      return { get, post, ws };
    }, ORIGIN);
    expect(seen.get).toBe(200);
    expect(seen.post, 'the POST never reached a server').toMatch(/^error /);
    expect(seen.ws, 'the websocket was refused').not.toBe('timeout');
    expect(audit.violations.map((v) => `${v.rule} ${v.selector}`)).toEqual([
      `live-write POST ${ORIGIN}/api/write`, 'live-write WEBSOCKET wss://live.example.invalid/socket.io/']);
    await expect(audit.done()).rejects.toThrow(/live-write/);
    const att = JSON.parse(testInfo.attachments.filter((a) => a.name === 'uicheck').at(-1).body.toString('utf8'));
    expect(att).toMatchObject({ env: 'live', liveRequests: { read: 2, write: 2 } }); // the page load + the GET; POST + websocket
  } finally {
    await context.close();
    if (prev === undefined) delete process.env.UI_CHECK_ENV; else process.env.UI_CHECK_ENV = prev;
  }

  // Detection only (block: false, what @perf tests get): nothing is routed, the write is still recorded.
  const context2 = await browser.newContext();
  try {
    const page = await context2.newPage();
    await serveGets(page);
    const g = await guardLive(context2, { block: false });
    await page.goto(`${ORIGIN}/`);
    // The POST is not routed: it goes out and fails on the .invalid name (RFC 2606, never resolves).
    await page.evaluate((origin) => fetch(`${origin}/api/write`, { method: 'POST', body: 'x' }).catch(() => null), ORIGIN);
    expect(g.writes.map((w) => `${w.method} ${w.what}`)).toEqual(['POST a POST request left the browser']);
  } finally {
    await context2.close();
  }

  expect(isRemote('http://localhost:5374/api/x')).toBe(false);
  expect(isRemote('data:text/plain,x')).toBe(false);
  expect(isRemote('wss://relay.example.com/socket.io/')).toBe(true);
});
