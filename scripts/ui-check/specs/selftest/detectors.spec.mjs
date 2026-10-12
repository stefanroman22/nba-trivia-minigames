// Selftest: every detector fires on its bad page and stays quiet on the good ones.
// Pages load from file:// — the selftest project needs no app server.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, createAudit } from '../../lib/fixtures.mjs';
import DigestReporter, { buildDigest } from '../../lib/digest-reporter.mjs';
import { VIEWPORTS } from '../../lib/viewports.mjs';
import { runDir } from '../../lib/run-id.mjs';

const FX = fileURLToPath(new URL('../../fixtures/detectors/', import.meta.url));
const fx = (name) => pathToFileURL(path.join(FX, name)).href;
const open = (audit, name) => audit.goto(fx(name), { waitFor: 'main' });
const rulesOf = (vs) => [...new Set(vs.map((v) => v.rule))];

test('[ST-OVERFLOW] overflow-x fires on a 600px box at 360px and stays quiet on good pages', async ({ audit }) => {
  await open(audit, 'overflow-bad.html');
  const bad = await audit.layout({ rules: ['overflow-x'] });
  expect(rulesOf(bad)).toEqual(['overflow-x']);
  expect(bad[0].selector).toContain('wide');
  expect(bad[0].route).toBe('overflow-bad.html');

  await open(audit, 'overflow-good.html');
  expect(await audit.layout()).toEqual([]);
  await open(audit, 'good.html');
  expect(await audit.layout()).toEqual([]);
});

test('[ST-OFFSCREEN] offscreen fires on a control past the right edge, not on one inside a scroller', async ({ audit }) => {
  await open(audit, 'overflow-bad.html');
  const bad = await audit.layout({ rules: ['offscreen'] });
  expect(rulesOf(bad)).toEqual(['offscreen']);
  expect(bad[0].selector).toContain('far');

  await open(audit, 'overflow-good.html');
  expect(await audit.layout({ rules: ['offscreen'] })).toEqual([]);
  await open(audit, 'good.html');
  expect(await audit.layout({ rules: ['offscreen'] })).toEqual([]);
});

test('[ST-SNAP] snap fires on an instant 100→300px panel, quiet on CSS and rAF animated ones', async ({ page, audit }) => {
  await open(audit, 'snap-bad.html');
  const bad = await audit.motion(() => page.click('#toggle'), { watch: ['.panel'] });
  expect(rulesOf(bad)).toContain('snap');
  expect(bad.find((v) => v.rule === 'snap').selector).toContain('panel');
  const badAuto = await audit.motion(() => page.click('#toggle'), { watch: 'auto' });
  expect(rulesOf(badAuto)).toContain('snap');

  await open(audit, 'snap-good.html');
  const good = await audit.motion(() => page.click('#toggle'), { watch: ['.panel', '.below'] });
  expect(rulesOf(good)).not.toContain('snap');
  const goodAuto = await audit.motion(() => page.click('#toggle'), { watch: 'auto' });
  expect(rulesOf(goodAuto)).not.toContain('snap');

  // framer-motion style animation: rAF-driven inline style writes, no WAAPI.
  await open(audit, 'snap-raf-good.html');
  const raf = await audit.motion(() => page.click('#toggle'), { watch: 'auto' });
  expect(rulesOf(raf)).not.toContain('snap');
});

test('[ST-CLS] cls fires when a block is inserted above content without input', async ({ page, audit }) => {
  await audit.goto(fx('cls-bad.html') + '#manual', { waitFor: 'main' });
  const bad = await audit.motion(() => page.evaluate(() => window.scheduleShift()), { watch: [], settleMs: 900 });
  expect(rulesOf(bad)).toContain('cls');
  expect(bad.find((v) => v.rule === 'cls').measured).toMatch(/^CLS \d/);

  await open(audit, 'good.html');
  const good = await audit.motion(() => page.waitForTimeout(400), { watch: [], settleMs: 500 });
  expect(rulesOf(good)).not.toContain('cls');
});

test('[ST-OCCLUDED] occluded fires under a fixed layer, not under the sticky nav after scroll', async ({ page, audit }) => {
  await open(audit, 'occluded-bad.html');
  const bad = await audit.layout({ rules: ['occluded'] });
  expect(rulesOf(bad)).toEqual(['occluded']);
  expect(bad[0].selector).toContain('covered');
  expect(bad[0].measured).toContain('cover');

  await open(audit, 'good.html');
  await page.evaluate(() => {
    const b = document.querySelector('#under-nav');
    window.scrollTo(0, b.getBoundingClientRect().top + window.scrollY - 20);
  });
  expect(await audit.layout({ rules: ['occluded'] })).toEqual([]);
  expect(await audit.layout()).toEqual([]);
});

test('[ST-TAP] tap-target fires on a 16×16 button, not on 48px buttons or inline links', async ({ audit, vp }) => {
  await open(audit, 'tap-bad.html');
  const bad = await audit.layout({ rules: ['tap-target'] });
  expect(rulesOf(bad)).toEqual(['tap-target']);
  expect(bad[0].measured).toBe('16×16px');
  expect(bad[0].expected).toBe(vp.hasTouch ? '≥ 44×44px' : '≥ 24×24px');

  await open(audit, 'good.html');
  expect(await audit.layout({ rules: ['tap-target'] })).toEqual([]);
});

test('[ST-CLIPPED] clipped fires on text cut by overflow:hidden, not on sr-only or fitting labels', async ({ audit }) => {
  await open(audit, 'clipped-bad.html');
  const bad = await audit.layout({ rules: ['clipped'] });
  expect(rulesOf(bad)).toEqual(['clipped']);
  expect(bad[0].selector).toContain('clip');

  await open(audit, 'good.html');
  expect(await audit.layout({ rules: ['clipped'] })).toEqual([]);
});

test('[ST-PROBES] console, timing, perf and a11y record what they should', async ({ page, audit }) => {
  await open(audit, 'good.html');
  await page.evaluate(() => console.error('selftest boom'));
  await page.evaluate(() => setTimeout(() => { throw new Error('selftest thrown'); }, 0));
  await page.waitForTimeout(100);
  const allowed = await audit.console({ allow: [/selftest boom/, /selftest thrown/] });
  expect(allowed).toEqual([]);
  await page.evaluate(() => console.error('selftest boom 2'));
  await page.waitForTimeout(50);
  const logged = await audit.console();
  expect(rulesOf(logged)).toEqual(['console']);
  expect(logged[0].measured).toContain('selftest boom 2');

  const slow = await audit.timing('selftest wait', () => page.waitForTimeout(120), async () => {}, 50);
  expect(rulesOf(slow)).toEqual(['slow-action']);
  const fast = await audit.timing('selftest fast', async () => {}, async () => {}, 5000);
  expect(fast).toEqual([]);
  expect(audit.metrics.find((m) => m.label === 'selftest wait').value).toBeGreaterThanOrEqual(100);

  await audit.perf('good');
  const fcp = audit.metrics.find((m) => m.label === 'good fcp');
  expect(fcp && typeof fcp.value).toBe('number');

  expect(await audit.a11y()).toEqual([]);
  await open(audit, 'tap-bad.html');
  await page.evaluate(() => { document.documentElement.removeAttribute('lang'); document.querySelector('button').removeAttribute('aria-label'); });
  expect(rulesOf(await audit.a11y())).toEqual(['a11y']);
});

test('[ST-EVIDENCE] shots are JPEG files under the run dir and done() fails with a compact message', async ({ page, context, audit }, testInfo) => {
  await open(audit, 'tap-bad.html');
  const full = await audit.shot('state');
  // the selftest project name does not name its viewport, so the vp id is part of the file name
  expect(full).toBe('shots/ST-EVIDENCE/selftest-phone-360-state.jpg');
  await expect(audit.shot('state')).rejects.toThrow(/already taken/);
  const crop = await audit.shot('tiny', page.locator('button.tiny'));

  // A second audit in the same test (multiplayer style) at another viewport never overwrites the first one's shots.
  const page2 = await context.newPage();
  const second = await createAudit(page2, testInfo, { vp: VIEWPORTS['desktop-1366'] });
  await open(second, 'tap-bad.html');
  const other = await second.shot('state');
  expect(other).toBe('shots/ST-EVIDENCE/selftest-desktop-1366-state.jpg');
  const twin = await createAudit(page2, testInfo, { vp: VIEWPORTS['desktop-1366'] });
  await expect(twin.shot('state')).rejects.toThrow(/already taken/);
  const host = await createAudit(page2, testInfo, { vp: VIEWPORTS['desktop-1366'], label: 'host' });
  expect(await host.shot('state')).toBe('shots/ST-EVIDENCE/selftest-host-state.jpg');
  await Promise.all([second.finalize(), twin.finalize(), host.finalize()]);

  for (const rel of [full, crop, other]) {
    const file = path.join(runDir(), rel);
    expect(existsSync(file)).toBe(true);
    const head = readFileSync(file).subarray(0, 2);
    expect([head[0], head[1]]).toEqual([0xff, 0xd8]);
  }
  const vs = await audit.layout({ rules: ['tap-target'] });
  expect(vs[0].shot).toMatch(/^shots\/ST-EVIDENCE\/selftest-.+\.jpg$/);
  await expect(audit.done()).rejects.toThrow(/1 UI violation[\s\S]*tap-target/);
});

test('[ST-DIGEST] buildDigest collapses identical violations across viewports and caps at 400 lines', async () => {
  const vps = ['phone-360', 'phone-390', 'phone-414', 'tablet-768', 'tablet-1280', 'desktop-1366', 'desktop-1920'];
  const base = { checkId: 'G-HOME', title: '[G-HOME] home layout', suite: 'guest', durationMs: 1000, metrics: [] };
  const results = vps.map((vp, i) => ({
    ...base, project: `guest@${vp}`, vp, status: 'failed', shots: [`shots/G-HOME/guest@${vp}-home.jpg`],
    violations: [
      { rule: 'overflow-x', route: '/', selector: 'div.wide', measured: `scrollWidth ${600 + i}px`, expected: `≤ ${300 + i}px`, shot: `shots/G-HOME/guest@${vp}-overflow-x-1.jpg` },
      ...(vp === 'phone-360' ? [{ rule: 'tap-target', route: '/', selector: 'button.x', measured: '16×16px', expected: '≥ 44×44px' }] : []),
    ],
    metrics: [{ kind: 'perf', label: 'home lcp', value: 1000 + i, unit: 'ms' }],
  }));
  results.push({ ...base, checkId: 'G-ROOM', title: '[G-ROOM] room', project: 'guest@phone-390', vp: 'phone-390', status: 'skipped', violations: [], shots: [], skipReason: 'needs a friend room' });
  results.push({ ...base, checkId: 'G-OK', title: '[G-OK] ok', project: 'guest@phone-390', vp: 'phone-390', status: 'passed', violations: [], shots: [] });

  const md = buildDigest(results, { runId: '20261011-1200', mode: 'dev', durationMs: 65000 });
  const lines = md.split('\n');
  expect(lines[0]).toBe('# UI check digest — run 20261011-1200 · mode dev · 9 tests · 1m5s');
  expect(md).toContain('| guest | 1 | 7 | 1 |');
  expect(md).toContain('## FAIL G-HOME [G-HOME] home layout');
  const overflow = lines.filter((l) => l.startsWith('- overflow-x'));
  expect(overflow).toHaveLength(1);
  expect(overflow[0]).toBe('- overflow-x `div.wide` on /: scrollWidth 600px (expected ≤ 300px) — ' + vps.join(', ') + ' — shot: shots/G-HOME/guest@phone-360-overflow-x-1.jpg');
  expect(lines.filter((l) => l.startsWith('- tap-target'))).toEqual(['- tap-target `button.x` on /: 16×16px (expected ≥ 44×44px) — phone-360 — shot: shots/G-HOME/guest@phone-360-home.jpg']);
  expect(md).toContain('## Coverage gaps');
  expect(md).toMatch(/G-ROOM .*needs a friend room/);
  expect(md).toContain('## Metrics');
  expect(md).toMatch(/\| home lcp \| 1000ms \| 1001ms/);

  // Two audits in one test (multiplayer pair): the reporter tags each audit's records with its vp/label …
  const rep = new DigestReporter();
  const att = (d) => ({ name: 'uicheck', contentType: 'application/json', body: Buffer.from(JSON.stringify(d)) });
  const same = { rule: 'overflow-x', route: '/room', selector: 'div.room', measured: 'right edge 500px', expected: '≤ 390px' };
  rep.onTestEnd(
    { id: 'mp1', repeatEachIndex: 0, title: '[MP-ROOM] room', annotations: [], parent: { project: () => ({ name: 'mp@pairA', use: { suite: 'multiplayer' } }) } },
    { status: 'failed', duration: 10, annotations: [], attachments: [
      att({ checkId: 'MP-ROOM', project: 'mp@pairA', vp: 'desktop-1366', label: 'host', routes: ['/room'], shots: [],
        violations: [same], metrics: [{ kind: 'timing', label: 'start match', value: 300, unit: 'ms' }] }),
      att({ checkId: 'MP-ROOM', project: 'mp@pairA', vp: 'phone-390', label: 'joiner', routes: ['/room'], shots: [],
        violations: [{ ...same, measured: 'right edge 520px' }, { rule: 'tap-target', route: '/room', selector: 'button.ready', measured: '30×30px', expected: '≥ 44×44px' }],
        metrics: [{ kind: 'timing', label: 'start match', value: 450, unit: 'ms' }] }),
    ] });
  const [mp] = [...rep.entries.values()];
  expect(mp.vp).toBe('desktop-1366+phone-390');
  expect(mp.violations.map((v) => `${v.rule}@${v.vp}/${v.label}`)).toEqual(['overflow-x@desktop-1366/host', 'overflow-x@phone-390/joiner', 'tap-target@phone-390/joiner']);
  expect(mp.metrics.map((m) => `${m.label}@${m.vp}/${m.auditLabel}`)).toEqual(['start match@desktop-1366/host', 'start match@phone-390/joiner']);
  // … and the digest attributes each line to the right player: shared violation lists both, the joiner-only one only the joiner.
  const mpLines = buildDigest([mp], { runId: 'mp', mode: 'dev', durationMs: 0 }).split('\n');
  expect(mpLines.filter((l) => l.startsWith('- overflow-x'))).toEqual(['- overflow-x `div.room` on /room: right edge 500px (expected ≤ 390px) — phone-390 (joiner), desktop-1366 (host)']);
  expect(mpLines.filter((l) => l.startsWith('- tap-target'))).toEqual(['- tap-target `button.ready` on /room: 30×30px (expected ≥ 44×44px) — phone-390 (joiner)']);
  expect(mpLines).toContain('| label | phone-390 (joiner) | desktop-1366 (host) |');
  expect(mpLines).toContain('| start match | 450ms | 300ms |');

  const many = [];
  for (let i = 0; i < 600; i++) {
    many.push({ ...base, checkId: `G-X${i}`, title: `[G-X${i}] x`, project: 'guest@phone-390', vp: 'phone-390', status: 'failed', shots: [],
      violations: [{ rule: 'clipped', route: `/r${i}`, selector: `p.t${i}`, measured: 'text 90px in 40px box', expected: 'no clipping' }] });
  }
  const big = buildDigest(many, { runId: 'x', mode: 'prod', durationMs: 1000 }).split('\n');
  expect(big.length).toBeLessThanOrEqual(400);
  expect(big[big.length - 1]).toMatch(/^\+\d+ more \(see results\.json\)$/);
});
