// Selftest for the acceptance runner (lib/accept.mjs) on a file:// fixture, no app server: a noSnap `watch` selector
// whose element exists only DURING the steps (fixtures/detectors/snap-transient.html: a panel added on click and
// removed 600 ms later, 0 matches before and after) is watched — no error — and a snap while it is present is still
// caught; a watch selector that never matches in any sampled frame is an error.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, createAudit } from '../../lib/fixtures.mjs';
import { runAssertion } from '../../lib/accept.mjs';

// Routes must start with "/": against baseURL file:/// the fixture's URL pathname resolves to the file.
const ROUTE = pathToFileURL(path.join(fileURLToPath(new URL('../../fixtures/detectors/', import.meta.url)), 'snap-transient.html')).pathname;
test.use({ baseURL: 'file:///' });

const transient = (mode, watch = ['#transient']) => ({
  persona: 'guest', viewport: 'phone-360', route: `${ROUTE}?mode=${mode}`,
  steps: [{ click: '#open' }, { wait: 900 }],
  watch,
  expect: [{ noSnap: true }],
});

test('[ST-ACCEPT] noSnap watches an element that exists only during the steps; a snap while present still fails; a never-matching watch errors', async ({ page, audit, context, vp }, testInfo) => {
  test.setTimeout(90_000);
  const audits = [];
  const fresh = async (label) => {
    const p = await context.newPage();
    const a = await createAudit(p, testInfo, { vp, label });
    audits.push(a);
    return { page: p, audit: a };
  };

  await test.step('still panel: 0 matches before and after, matched during → pass, no error', async () => {
    const r = await runAssertion({ page, audit, assertion: transient('still') });
    expect(r.lines.filter((l) => l.error), JSON.stringify(r.lines)).toEqual([]);
    expect(r.outcome).toBe('pass');
    expect(r.lines[0].text).toMatch(/noSnap: no element jumped \(watch #transient\)/);
  });

  await test.step('snapping panel: the 100→300px jump while it exists is caught (clean fail)', async () => {
    const { page: p, audit: a } = await fresh('snap');
    const r = await runAssertion({ page: p, audit: a, assertion: transient('snap') });
    expect(r.outcome, JSON.stringify(r.lines)).toBe('fail');
    expect(r.lines[0]).toMatchObject({ ok: false, error: false });
    expect(r.lines[0].text).toMatch(/noSnap: .*#transient.*height 100→300px in one frame/);
  });

  await test.step('a watch selector that matches in no sampled frame is an error', async () => {
    const { page: p, audit: a } = await fresh('nomatch');
    const r = await runAssertion({ page: p, audit: a, assertion: transient('still', ['#transient', '#no-such-panel']) });
    expect(r.outcome).toBe('error');
    expect(r.lines[0].text).toMatch(/noSnap watch #no-such-panel: 0 in DOM in every sampled frame/);
  });

  for (const a of audits) await a.finalize();
});
