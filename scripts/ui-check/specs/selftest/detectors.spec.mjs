// Selftest: every detector fires on its bad page and stays quiet on the good ones.
// Pages load from file:// — the selftest project needs no app server.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect, createAudit } from '../../lib/fixtures.mjs';
import DigestReporter, { buildDigest, mergeRun } from '../../lib/digest-reporter.mjs';
import { VIEWPORTS } from '../../lib/viewports.mjs';
import { runDir } from '../../lib/run-id.mjs';
import { measureInPage, offCentre, shellFailures } from '../../../lib/game-shell.mjs';
import { checkEndCentre, checkEndOverlay, checkLossLabel, watchEndOverlay } from '../../lib/game-driver.mjs';

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

test('[ST-TAP] tap-target fires on a crowded <24px target only; spaced and inline pass; <44px on touch is just a warning', async ({ context, audit, vp }, testInfo) => {
  // Hard failures on a separate audit, so this test's own done() below sees only warnings.
  const strict = await createAudit(await context.newPage(), testInfo, { vp, label: 'strict' });
  await open(strict, 'tap-bad.html');
  const bad = await strict.layout({ rules: ['tap-target'] });
  expect(rulesOf(bad)).toEqual(['tap-target']);
  expect(bad[0].measured).toBe('16×16px');
  expect(bad[0].expected).toBe('≥ 24×24px');
  expect(bad[0].note).toMatch(/^undersized and within 24px of .*button/);
  await open(strict, 'tap-spacing.html');
  const crowded = await strict.layout({ scope: '#crowded', rules: ['tap-target'] });
  expect(crowded.map((v) => v.measured)).toEqual(['16×16px', '16×16px']);
  await strict.finalize();

  // WCAG 2.5.8 exceptions: spaced small targets, a link inside a sentence, a stacked footer-style list.
  await open(audit, 'tap-spacing.html');
  for (const scope of ['#spaced', '#inline', '#list', '#touch38']) {
    expect(await audit.layout({ scope, rules: ['tap-target'] })).toEqual([]);
  }
  // On touch every target under 44px except the inline link is a soft tap-target-touch warning.
  expect(vp.hasTouch).toBe(true);
  expect(rulesOf(audit.warnings)).toEqual(['tap-target-touch']);
  const warnedIn = (id) => audit.warnings.filter((w) => w.selector.includes(id)).map((w) => w.measured);
  expect(warnedIn('#spaced')).toEqual(['16×16px', '16×16px']);
  expect(warnedIn('#list')).toHaveLength(3);
  expect(warnedIn('#touch38')).toEqual(['38×38px']);
  expect(warnedIn('#inline')).toEqual([]);
  expect(audit.warnings[0].expected).toBe('≥ 44×44px on touch');
  expect(audit.violations).toEqual([]);

  // Not on a non-touch viewport.
  const desk = await createAudit(await context.newPage(), testInfo, { vp: VIEWPORTS['desktop-1366'] });
  await open(desk, 'tap-spacing.html');
  expect(await desk.layout({ scope: '#touch38' })).toEqual([]);
  expect(desk.warnings).toEqual([]);
  await desk.finalize();

  await open(audit, 'good.html');
  expect(await audit.layout({ rules: ['tap-target'] })).toEqual([]);
  await audit.done(); // warnings never fail a test
});

test('[ST-CLIPPED] clipped fires on text cut by overflow:hidden, not on sr-only or fitting labels', async ({ audit }) => {
  await open(audit, 'clipped-bad.html');
  const bad = await audit.layout({ rules: ['clipped'] });
  expect(rulesOf(bad)).toEqual(['clipped']);
  expect(bad[0].selector).toContain('clip');

  await open(audit, 'good.html');
  expect(await audit.layout({ rules: ['clipped'] })).toEqual([]);
});

test('[ST-CENTRE] off-centre fires on a field pushed aside by its buttons, score-line ink pushed right by its number box and a visible off-centre card; quiet when centred', async ({ page, audit }) => {
  const fake = { id: 'fixture' };
  await audit.goto(fx('centre.html') + '?mode=bad', { waitFor: 'main' });
  const bad = await page.evaluate(measureInPage);
  expect(bad.mounted).toBe(true);
  const off = Object.fromEntries(offCentre(bad.centre).map((c) => [c.what, c]));
  expect(Object.keys(off).sort()).toEqual(['.gf-board > div.ghost', '.gf-inputrow input', '.scorepanel-line']);
  expect(off['.gf-inputrow input'].off).toBeLessThan(-20);
  expect(off['.scorepanel-line'].by).toBe('ink');
  expect(off['.scorepanel-line'].off).toBeGreaterThan(2);
  // The score line's BOX is centred: only its ink shows the reserved width.
  const lineBox = await page.evaluate(() => {
    const l = document.querySelector('.scorepanel-line').getBoundingClientRect();
    const g = document.querySelector('.gf').getBoundingClientRect();
    return (l.left + l.right) / 2 - (g.left + g.right) / 2;
  });
  expect(Math.abs(lineBox)).toBeLessThan(1);
  // The status row (left/right by design) is never measured; the input row's buttons are not counted.
  expect(bad.centre.some((c) => /gf-status|inputrow-actions|Confirm/.test(c.what))).toBe(false);
  // shellFailures (ui-audit, GM-SHELL-01) words it like the other shell rules …
  const fails = shellFailures({ id: 'fixture', ...bad }).filter((f) => f.endsWith(' off centre — Rule 4.7'));
  expect(fails).toHaveLength(3);
  expect(fails).toContain(`fixture: .scorepanel-line is ${off['.scorepanel-line'].off}px off centre — Rule 4.7`);
  // … and the games end-state check records each as `off-centre`.
  await checkEndCentre(audit, fake);
  expect(rulesOf(audit.violations)).toEqual(['off-centre']);
  expect(audit.violations).toHaveLength(3);
  audit.violations.length = 0; // the failures were the point

  await audit.goto(fx('centre.html'), { waitFor: 'main' });
  const good = await page.evaluate(measureInPage);
  expect(offCentre(good.centre)).toEqual([]);
  expect(good.centre.map((c) => c.what)).toEqual(expect.arrayContaining(['.gf-prompt > span.gf-eyebrow', '.gf-prompt > h2.gf-title',
    '.scorepanel-line', '.scorepanel-actions', '.gf-inputrow input', '.gf-board > div.card', '.gf-action div.scorepanel']));
  expect(good.centre.some((c) => c.what.includes('ghost'))).toBe(false); // effective opacity 0.03: skipped
  expect(shellFailures({ id: 'fixture', ...good }).filter((f) => f.endsWith(' off centre — Rule 4.7'))).toEqual([]);
  await checkEndCentre(audit, fake);
  await audit.done();
});

test('[ST-END-OVERLAY] feedback-over-end fires on a popup animated over the end buttons, quiet when the shell hides it first', async ({ page, audit }) => {
  await audit.goto(fx('end-overlay.html') + '?mode=bad', { waitFor: 'main' });
  await watchEndOverlay(page);
  await page.evaluate(() => window.finish());
  const bad = await checkEndOverlay(audit);
  expect(bad.done).toBe(true);
  expect(bad.endAt).not.toBeNull();
  expect(bad.bad).toBeGreaterThan(5);
  expect(bad.first.text).toBe('Board cleared! +300');
  expect(bad.first.t).toBeLessThan(100);
  expect(rulesOf(audit.violations)).toEqual(['feedback-over-end']);
  expect(audit.violations[0].measured).toMatch(/^"Board cleared! \+300" \(opacity [\d.]+\) over button "(Play again|Close game)" \d+ms after .* \d+ of \d+ frames$/);
  audit.violations.length = 0; // the overlap was the point

  await audit.goto(fx('end-overlay.html'), { waitFor: 'main' });
  await watchEndOverlay(page);
  await page.evaluate(() => window.finish());
  const good = await checkEndOverlay(audit);
  expect(good.done).toBe(true);
  expect(good.frames).toBeGreaterThan(30); // sampled every frame of the window
  expect(good.bad).toBe(0);
  await audit.done();
});

test('[ST-LOSS-LABEL] loss-label fires on a score-line label after a loss, quiet on a win and on a loss without one', async ({ audit }) => {
  const fake = { id: 'fixture' };
  await audit.goto(fx('centre.html'), { waitFor: 'main' }); // "Board cleared!" on the score line
  expect(await checkLossLabel(audit, fake, 'perfect', [{ correct: true }])).toBe('Board cleared!');
  await checkLossLabel(audit, fake, 'partial', [{ correct: false }, { correct: true }]); // misses first, then finished
  await checkLossLabel(audit, { id: 'fixture', won: () => true }, 'timeout', []); // the adapter's own won()
  expect(audit.violations).toEqual([]);
  await checkLossLabel(audit, fake, 'wrong', [{ correct: false }]);
  await checkLossLabel(audit, fake, 'giveup', []);
  await checkLossLabel(audit, fake, 'partial', [{ correct: true }, { correct: false }]); // ended on a miss
  expect(rulesOf(audit.violations)).toEqual(['loss-label']);
  expect(audit.violations).toHaveLength(3);
  expect(audit.violations[0].measured).toBe('"Board cleared!" on the end score line after a loss (scenario wrong)');
  audit.violations.length = 0;

  await audit.goto(fx('centre.html') + '?mode=bad', { waitFor: 'main' }); // no label
  expect(await checkLossLabel(audit, fake, 'wrong', [])).toBeNull();
  await audit.done();
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

test('[ST-DIGEST] buildDigest collapses identical violations across viewports and caps each section per suite', async () => {
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
  // A per-viewport threshold collapses into one row that lists every expected value (3 shown, then +N).
  expect(overflow[0]).toBe('- overflow-x `div.wide` on /: scrollWidth 600px (expected ≤ 300px [phone-360] | ≤ 301px [phone-390] | ≤ 302px [phone-414] | +4 more) — '
    + vps.join(', ') + ' — shot: shots/G-HOME/guest@phone-360-overflow-x-1.jpg');
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

  // A collapsed row: expected differs per viewport → both shown; its shot is the member's own crop,
  // not another crop of the first member (r.shots[0]).
  const tap = (vp, expected, shot) => ({ ...base, checkId: 'G-TAP', title: '[G-TAP] tap', project: `guest@${vp}`, vp, status: 'failed',
    shots: [`shots/G-TAP/guest@${vp}-tap-target-1.jpg`],
    violations: [{ rule: 'tap-target', route: '/', selector: 'a.x', measured: '20×20px', expected, ...(shot ? { shot } : {}) }] });
  const tapLines = buildDigest([tap('phone-390', '≥ 44×44px'), tap('desktop-1366', '≥ 24×24px', 'shots/G-TAP/guest@desktop-1366-tap-target-2.jpg')],
    { runId: 't', mode: 'dev', durationMs: 0 }).split('\n');
  expect(tapLines.filter((l) => l.startsWith('- tap-target'))).toEqual([
    '- tap-target `a.x` on /: 20×20px (expected ≥ 44×44px [phone-390] | ≥ 24×24px [desktop-1366]) — phone-390, desktop-1366 — shot: shots/G-TAP/guest@desktop-1366-tap-target-2.jpg']);

  // Warnings (soft rules): never a FAIL, one collapsed line per rule+selector+route, capped at 20 lines per suite.
  const warn = (i) => ({ rule: 'tap-target-touch', route: '/', selector: `a.w${i}`, measured: '38×38px', expected: '≥ 44×44px on touch' });
  const soft = ['phone-360', 'tablet-768'].map((vp) => ({ ...base, checkId: 'G-W', title: '[G-W] w', project: `guest@${vp}`, vp, status: 'passed', violations: [], shots: [],
    warnings: [warn(0)] }));
  const softMd = buildDigest(soft, { runId: 'w', mode: 'dev', durationMs: 0 });
  expect(softMd).not.toContain('## FAIL');
  expect(softMd).toContain('## Warnings\n- tap-target-touch `a.w0` on /: 38×38px (expected ≥ 44×44px on touch) — phone-360, tablet-768 — G-W\n');
  const lotsMd = buildDigest([{ ...soft[0], warnings: Array.from({ length: 100 }, (_, i) => warn(i)) }], { runId: 'w', mode: 'dev', durationMs: 0 }).split('\n');
  const from = lotsMd.indexOf('## Warnings');
  const section = lotsMd.slice(from + 1, lotsMd.indexOf('', from));
  expect(section).toHaveLength(20);
  expect(section[19]).toBe('- +81 more warning(s) (suite guest) — see results.json in the run dir (`node scripts/ui-check/run.mjs --where`), filter by suite "guest"');
  // … and the reporter carries them from the uicheck attachment into results.json entries.
  const wrep = new DigestReporter();
  wrep.onTestEnd(
    { id: 'w1', repeatEachIndex: 0, title: '[G-W] w', annotations: [], parent: { project: () => ({ name: 'guest@phone-390', use: { suite: 'guest', vpId: 'phone-390' } }) } },
    { status: 'passed', duration: 5, annotations: [], attachments: [att({ checkId: 'G-W', vp: 'phone-390', routes: ['/'], shots: [], violations: [], metrics: [], warnings: [warn(1)] })] });
  expect([...wrep.entries.values()][0].warnings).toEqual([{ ...warn(1), vp: 'phone-390' }]);

  // Several invocations of one run (UI_CHECK_APPEND): results merge and the header spans first start → last end.
  const merged = mergeRun({
    entries: [{ project: 'mp@pairA', title: '[MP-X] x', status: 'passed' }],
    prior: [{ project: 'guest@phone-390', title: '[G-X] x', status: 'passed' }, { project: 'mp@pairA', title: '[MP-X] x', status: 'failed' }],
    priorMeta: { startedAt: 1_000, endedAt: 50_000 }, start: 61_000, end: 91_000,
  });
  expect(merged.results.map((r) => `${r.project} ${r.status}`)).toEqual(['guest@phone-390 passed', 'mp@pairA passed']);
  expect(merged.meta).toEqual({ startedAt: 1_000, endedAt: 91_000 });
  expect(buildDigest(merged.results, { runId: 'm', mode: 'dev', durationMs: merged.durationMs }).split('\n')[0]).toBe('# UI check digest — run m · mode dev · 2 tests · 1m30s');
  expect(mergeRun({ entries: [], start: 5_000, end: 7_000 }).durationMs).toBe(2_000);

  const many = [];
  for (let i = 0; i < 600; i++) {
    many.push({ ...base, checkId: `G-X${i}`, title: `[G-X${i}] x`, project: 'guest@phone-390', vp: 'phone-390', status: 'failed', shots: [],
      violations: [{ rule: 'clipped', route: `/r${i}`, selector: `p.t${i}`, measured: 'text 90px in 40px box', expected: 'no clipping' }] });
  }
  // Caps are per section and suite: a huge guest FAIL section must not push out the other suites' FAIL
  // sections, the coverage gaps, the warnings or the metrics; each capped part ends with its own trailer.
  const other = (suite, extra) => ({ ...base, suite, project: `${suite}@phone-390`, vp: 'phone-390', shots: [], violations: [], ...extra });
  many.push(other('games', { checkId: 'GM-x-perfect', title: '[GM-x-perfect] x', status: 'failed',
    violations: [{ rule: 'snap', route: '/x', selector: 'div.stage-shell', measured: 'height 400→480px in one frame', expected: '≤ 8px per frame' }] }));
  for (let i = 0; i < 30; i++) many.push(other('games', { checkId: `GM-g${i}-timeout`, title: `[GM-g${i}-timeout] t`, status: 'skipped', skipReason: `no clock ${i}` }));
  many.push(other('account', { checkId: 'AC-W', title: '[AC-W] w', status: 'passed', warnings: [warn(1)], metrics: [{ kind: 'timing', label: 'login', value: 900, unit: 'ms' }] }));
  many.push(other('games', { checkId: null, title: 'no id', status: 'passed', warnings: [warn(2)] }));
  const big = buildDigest(many, { runId: 'x', mode: 'prod', durationMs: 1000 }).split('\n');
  // A warning that no check id saw is tagged with the suite that saw it, so that suite's judge picks it up.
  expect(big).toContain('- tap-target-touch `a.w2` on /: 38×38px (expected ≥ 44×44px on touch) — phone-390 — (suite games)');
  expect(big.length).toBeLessThanOrEqual(620);
  const failGuest = big.filter((l) => l.startsWith('## FAIL G-X'));
  expect(failGuest.length).toBeGreaterThan(20);
  expect(big).toContain('- +' + (600 * 3 - 1 - 79) + ' more FAIL line(s) (suite guest) — see results.json in the run dir (`node scripts/ui-check/run.mjs --where`), filter by suite "guest"');
  expect(big).toContain('## FAIL GM-x-perfect [GM-x-perfect] x');
  expect(big).toContain('- GM-g0-timeout [GM-g0-timeout] t (phone-390): no clock 0');
  expect(big).toContain('- +16 more coverage gap(s) (suite games) — see results.json in the run dir (`node scripts/ui-check/run.mjs --where`), filter by suite "games"');
  expect(big.filter((l) => l.startsWith('- tap-target-touch `a.w1`'))).toHaveLength(1);
  expect(big).toContain('### account');
  expect(big.some((l) => l.startsWith('| login |'))).toBe(true);
});
