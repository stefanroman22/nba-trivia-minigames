// Selftest for the --live guard (lib/fixtures.mjs): in env 'live' an audit counts every remote request, records any
// non-GET/HEAD one as a `live-write` violation (so done() fails), and the attachment carries env + the counters.
// The remote origin is fulfilled by page.route, so nothing leaves the machine.
import { test, expect } from '@playwright/test';
import { createAudit, isRemote } from '../../lib/fixtures.mjs';

test('[ST-LIVEGUARD] in env live a POST to a remote origin is a live-write violation; GETs are only counted', async ({ browser }, testInfo) => {
  const prev = process.env.UI_CHECK_ENV;
  process.env.UI_CHECK_ENV = 'live';
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.route('https://live.example.invalid/**', (r) => r.fulfill({ status: 200, contentType: 'text/plain', body: 'ok', headers: { 'access-control-allow-origin': '*' } }));
    const audit = await createAudit(page, testInfo, { label: 'live' });
    await page.goto('https://live.example.invalid/');
    await page.evaluate(async () => {
      await fetch('https://live.example.invalid/api/read');
      await fetch('https://live.example.invalid/api/write?x=1', { method: 'POST', body: 'x' });
    });
    expect(audit.violations.map((v) => `${v.rule} ${v.selector}`)).toEqual(['live-write POST https://live.example.invalid/api/write']);
    await expect(audit.done()).rejects.toThrow(/live-write/);
    const att = JSON.parse(testInfo.attachments.filter((a) => a.name === 'uicheck').at(-1).body.toString('utf8'));
    expect(att).toMatchObject({ env: 'live', liveRequests: { read: 2, write: 1 } }); // the page load + the GET
  } finally {
    await context.close();
    if (prev === undefined) delete process.env.UI_CHECK_ENV; else process.env.UI_CHECK_ENV = prev;
  }
  expect(isRemote('http://localhost:5374/api/x')).toBe(false);
  expect(isRemote('data:text/plain,x')).toBe(false);
  expect(isRemote('wss://relay.example.com/socket.io/')).toBe(true);
});
