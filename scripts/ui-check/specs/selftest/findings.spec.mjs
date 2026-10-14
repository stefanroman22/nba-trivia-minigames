// Selftest for the findings layer (lib/findings.mjs): schema validation, the acceptance DSL parser, fingerprints,
// dedupe/merge, accepted.json filtering, id stability across runs, and the REPORT.md layout. Pure node, no browser.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  validateFinding, assertionErrors, parseAssertion, fingerprint, normRoute, normSelector,
  mergeFindings, dropAccepted, assignIds, buildReport, sortFindings, loadJudgeFindings,
} from '../../lib/findings.mjs';

const SAMPLE = fileURLToPath(new URL('../../fixtures/findings/sample.json', import.meta.url));
const sample = () => JSON.parse(readFileSync(SAMPLE, 'utf8'));

/** Every documented step and expect key in one assertion. */
const FULL = {
  persona: 'solo', viewport: 'tablet-768', route: '/profile',
  steps: [
    { click: 'role=button[name="Log in"]' }, { fill: ['@guest.gamesSearch', 'wordle'] }, { press: 'Escape' },
    { hover: 'text=Games' }, { waitFor: '@common.navBrand' }, { wait: 300 }, { scroll: 'bottom' }, { scroll: 'top' }, { scroll: 400 },
  ],
  watch: ['.modal-panel'],
  expect: [
    { visible: '@guest.footer' }, { hidden: '.modal-backdrop' }, { count: ['#games-grid .gtile', '>=', 1] },
    { text: ['h1', 'Profile'] }, { noOverflow: true }, { withinViewport: '.modal-panel' }, { minSize: ['.auth-pw-toggle', 44, 44] },
    { style: ['.modal-panel', 'opacity', '1'] }, { transition: ['.seg-thumb', 'transform'] }, { noSnap: true },
    { maxCls: 0.1 }, { maxLoafMs: 100 }, { status: ['/api/admin/', 403] }, { url: '/profile$' },
    { noConsoleErrors: true }, { axe: ['target-size', 'color-contrast'] },
  ],
};

test('[ST-FINDINGS] schema, acceptance DSL parser, fingerprint dedupe, accepted.json and run-stable ids', async () => {
  await test.step('schema accepts the sample and rejects a finding without machine-checkable acceptance', () => {
    for (const f of sample()) expect(validateFinding(f), f.title).toEqual([]);

    const noAcceptance = sample()[0];
    delete noAcceptance.acceptance;
    expect(validateFinding(noAcceptance).join('\n')).toMatch(/acceptance.*required/);

    const empty = sample()[0];
    empty.acceptance = { checks: [], assertions: [], criteria: ['looks right'] };
    expect(validateFinding(empty).join('\n')).toMatch(/acceptance: needs at least one check or assertion/);

    const badEnum = sample()[0];
    badEnum.severity = 'critical';
    expect(validateFinding(badEnum).join('\n')).toMatch(/severity: must be one of blocker, major, minor, polish/);

    const badProject = sample()[0];
    badProject.acceptance.checks = [{ id: 'G-MOTION-02', projects: ['guest@phone-999'] }];
    expect(validateFinding(badProject).join('\n')).toMatch(/projects\[0\].*guest@phone-999/);

    // A DSL error inside acceptance surfaces through validateFinding with its path.
    const badStep = sample()[0];
    badStep.acceptance.assertions[0].steps.push({ tap: '.x' });
    expect(validateFinding(badStep).join('\n')).toMatch(/acceptance\.assertions\[0\]\.steps\[2\]: unknown step key "tap"/);
  });

  await test.step('DSL parser accepts every documented key and rejects unknown keys with a clear message', () => {
    expect(assertionErrors(FULL)).toEqual([]);
    expect(parseAssertion(FULL).steps).toHaveLength(9);

    const unknownStep = { ...FULL, steps: [{ tap: '.x' }] };
    expect(() => parseAssertion(unknownStep)).toThrow(/steps\[0\]: unknown step key "tap" \(known: click, fill, press, hover, waitFor, wait, scroll\)/);
    const unknownExpect = { ...FULL, expect: [{ isShown: '.x' }] };
    expect(() => parseAssertion(unknownExpect)).toThrow(/expect\[0\]: unknown expect key "isShown" \(known: visible, hidden, count, text, noOverflow, withinViewport, minSize, style, transition, noSnap, maxCls, maxLoafMs, status, url, noConsoleErrors, axe\)/);
    expect(assertionErrors({ ...FULL, colour: 'red' }).join('\n')).toMatch(/unknown key "colour"/);
    expect(assertionErrors({ ...FULL, steps: [{ click: '.a', hover: '.b' }] }).join('\n')).toMatch(/steps\[0\]: one key per step, got click, hover/);
    expect(assertionErrors({ ...FULL, viewport: 'phone-999' }).join('\n')).toMatch(/viewport: unknown viewport "phone-999"/);
    expect(assertionErrors({ ...FULL, persona: 'pair' }).join('\n')).toMatch(/persona: must be guest or solo/);
    expect(assertionErrors({ ...FULL, route: 'profile' }).join('\n')).toMatch(/route: must start with "\/"/);
    expect(assertionErrors({ ...FULL, expect: [] }).join('\n')).toMatch(/expect: needs at least one item/);
    expect(assertionErrors({ ...FULL, expect: [{ count: ['.a', '>', 1] }] }).join('\n')).toMatch(/count.*>=, <=, ==/);
    expect(assertionErrors({ ...FULL, expect: [{ minSize: ['.a', 44] }] }).join('\n')).toMatch(/minSize: needs \["<loc>", width, height\]/);
    expect(assertionErrors({ ...FULL, expect: [{ url: '([' }] }).join('\n')).toMatch(/url: invalid regex/);
    expect(assertionErrors({ ...FULL, steps: [{ scroll: 'middle' }] }).join('\n')).toMatch(/scroll: needs "bottom", "top" or a pixel offset/);
    expect(assertionErrors({ ...FULL, steps: [{ click: '@guest.noSuchKey' }] }).join('\n')).toMatch(/pagemap: no "noSuchKey" in pagemap\/guest\.json/);
    expect(assertionErrors({ ...FULL, steps: [{ click: '@nodot' }] }).join('\n')).toMatch(/must look like "@area\.key"/);
  });

  await test.step('fingerprints normalise route and selector; dedupe merges equal fingerprints', () => {
    expect(normRoute('/?login=1')).toBe('/');
    expect(normRoute('/room/G8RW2B?x=1#y')).toBe('/room/:param');
    expect(normRoute('/u/12345/')).toBe('/u/:param');
    expect(normRoute('/who-are-ya')).toBe('/who-are-ya');
    expect(normRoute('/p/3f2b8c1e-0d4a-4b7e-9a1c-5e6f7a8b9c0d')).toBe('/p/:param');
    expect(normSelector('div.a  >button.b\n  span')).toBe('div.a > button.b span');

    const [a, b, c, d] = sample();
    expect(fingerprint(a)).toBe('tap-target|/|div.auth-pw-wrap > button.auth-pw-toggle');
    expect(fingerprint(a)).toBe(fingerprint(b));
    expect(fingerprint(d)).toBe('contrast|/room/:param|.lobby-code');

    const merged = mergeFindings([a, b, c, d]);
    expect(merged).toHaveLength(3);
    const m = merged.find((f) => f.rule === 'tap-target');
    expect(m.severity).toBe('major'); // highest
    expect(m.where.viewports).toEqual(['phone-390', 'desktop-1366']); // union, viewport order
    expect(m.current).toBe(b.current); // longest
    expect(m.expected).toBe(a.expected); // longest
    expect(m.files.map((f) => `${f.path}:${f.line}`)).toEqual(['src/components/AuthForm.tsx:120', 'src/styles/auth.css:44']);
    expect(m.evidence.shots).toHaveLength(2);
    expect(m.evidence.metrics).toHaveLength(2); // the phone-390 metric is in both: deduped
    expect(m.acceptance.checks).toHaveLength(1);
    expect(m.acceptance.assertions).toHaveLength(2); // a's assertion equals b's first one: deduped
    expect(m.acceptance.criteria).toEqual(['The toggle is at least 24×24 px', 'axe target-size passes']);
    expect(m.fix.reuse).toEqual(['the .icon-btn padding']);
    expect(m.fingerprint).toBe(fingerprint(a));
    expect(m.mergedFrom).toEqual(['account', 'guest']);
  });

  await test.step('accepted.json drops fingerprints; ids are stable within a run and carried across runs', () => {
    const merged = mergeFindings(sample());
    const { kept, dropped } = dropAccepted(merged, [{ fingerprint: 'contrast|/room/G8RW2B|.lobby-code', reason: 'owner accepted' }]);
    expect(dropped.map((f) => f.rule)).toEqual(['contrast']);
    expect(kept).toHaveLength(2);
    expect(dropAccepted(merged, ['cls|/|document']).kept).toHaveLength(2); // plain fingerprint strings work too

    // Numbered after sorting by severity, then suite, then fingerprint.
    const first = assignIds(sortFindings(merged), '20261014-1000', new Map());
    expect(first.map((f) => [f.id, f.rule])).toEqual([
      ['UIC-20261014-1000-001', 'cls'], // major, guest
      ['UIC-20261014-1000-002', 'tap-target'], // major, account (merged; the base is the highest-severity member)
      ['UIC-20261014-1000-003', 'contrast'], // polish
    ]);
    // Same input again → same ids.
    const again = assignIds(sortFindings(mergeFindings(sample())), '20261014-1000', new Map());
    expect(again.map((f) => f.id)).toEqual(first.map((f) => f.id));

    // A later run: a finding whose fingerprint was in the earlier run keeps its id; new ones number from 001.
    const known = new Map([[first[1].fingerprint, { id: first[1].id }]]);
    const next = sample().slice(0, 3);
    next.push({ ...sample()[2], rule: 'loaf', title: 'Long frame on /' });
    const later = assignIds(sortFindings(mergeFindings(next)), '20261015-0900', known);
    expect(later.find((f) => f.rule === 'tap-target').id).toBe('UIC-20261014-1000-002');
    expect(later.filter((f) => f.rule !== 'tap-target').map((f) => f.id)).toEqual(['UIC-20261015-0900-001', 'UIC-20261015-0900-002']);

    // Within a run, an existing id of that run is kept and new findings number after the highest one.
    const sameRun = new Map([[first[2].fingerprint, { id: 'UIC-20261014-1000-007' }]]);
    const re = assignIds(sortFindings(mergeFindings(sample())), '20261014-1000', sameRun);
    expect(re.map((f) => f.id)).toEqual(['UIC-20261014-1000-008', 'UIC-20261014-1000-009', 'UIC-20261014-1000-007']);
  });

  await test.step('judge files load as an array or { findings }, with or without a UTF-8 BOM; broken files are reported', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'uic-findings-'));
    mkdirSync(path.join(dir, 'findings'));
    writeFileSync(path.join(dir, 'findings', 'account.json'), `﻿${JSON.stringify(sample().slice(0, 2))}`);
    writeFileSync(path.join(dir, 'findings', 'games.json'), JSON.stringify({ findings: [sample()[2]] }));
    writeFileSync(path.join(dir, 'findings', 'multiplayer.json'), '{ not json');
    const { items, errors } = loadJudgeFindings(dir);
    expect(items.map((x) => x.source)).toEqual(['account.json[0]', 'account.json[1]', 'games.json[0]']);
    expect(errors.map((e) => e.source)).toEqual(['multiplayer.json']);
    rmSync(dir, { recursive: true, force: true });
  });
});

test('[ST-REPORT] REPORT.md has the sections in order, a coverage matrix, gaps and one verify command per finding', () => {
  const findings = assignIds(sortFindings(mergeFindings(sample())), '20261014-1000', new Map());
  findings[0].status = 'fixed';
  findings[0].fixedAt = '2026-10-14T10:30:00.000Z';
  const results = [
    { checkId: 'G-MOTION-02', title: '[G-MOTION-02] tabs', project: 'guest@phone-390', suite: 'guest', vp: 'phone-390', status: 'failed' },
    { checkId: 'G-MOTION-02', title: '[G-MOTION-02] tabs', project: 'guest@desktop-1366', suite: 'guest', vp: 'desktop-1366', status: 'passed' },
    { checkId: 'G-NAV-01', title: '[G-NAV-01] nav', project: 'guest@phone-390', suite: 'guest', vp: 'phone-390', status: 'skipped', skipReason: 'drawer only' },
    { checkId: 'MP-ROOM-01', title: '[MP-ROOM-01] rooms', project: 'mp@pairA', suite: 'multiplayer', vp: 'desktop-1366+phone-390', status: 'passed' },
  ];
  const md = buildReport({ runId: '20261014-1000', mode: 'prod', date: '2026-10-14 10:00', findings, results, rejected: [{ title: 'x', reason: 'r' }] });
  const lines = md.split('\n');
  const at = (re) => lines.findIndex((l) => re.test(l));

  // Top-level order.
  const order = [/^# UI check report — run 20261014-1000/, /^## Summary/, /^## Coverage matrix/, /^## Coverage gaps/, /^## Findings/];
  const idx = order.map(at);
  for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
  expect([...idx].sort((p, q) => p - q)).toEqual(idx);
  expect(md).toMatch(/mode prod/);
  expect(md).toMatch(/Suites: guest, multiplayer/);
  expect(md).toMatch(/Viewports: phone-390, desktop-1366, mp@pairA/);

  // Summary tables: severity × owner and severity × suite, with totals.
  expect(md).toMatch(/\| severity \| frontend \| backend \| ci \| total \|/);
  expect(md).toMatch(/\| major \| 2 \| 0 \| 0 \| 2 \|/);
  expect(md).toMatch(/\| severity \| guest \| account \| games \| multiplayer \| total \|/);
  expect(md).toMatch(/\| polish \| 0 \| 0 \| 0 \| 1 \| 1 \|/);

  // Coverage matrix: check × viewport, compact symbols; and the gaps list.
  expect(md).toMatch(/\| check \| phone-390 \| desktop-1366 \| mp@pairA \|/);
  expect(md).toMatch(/\| G-MOTION-02 \| ✗ \| ✓ \|  \|/);
  expect(md).toMatch(/\| G-NAV-01 \| – \|  \|  \|/);
  expect(md).toMatch(/- G-NAV-01 \[G-NAV-01\] nav \(phone-390\): drawer only/);

  // Findings sorted by severity, each with its subsections in order and the exact verify command.
  const heads = lines.filter((l) => /^### UIC-/.test(l));
  expect(heads).toHaveLength(3);
  expect(heads[2]).toMatch(/UIC-20261014-1000-003/);
  for (const f of findings) {
    const start = at(new RegExp(`^### ${f.id}\\b`));
    const end = (() => { const n = lines.findIndex((l, i) => i > start && /^### /.test(l)); return n < 0 ? lines.length : n; })();
    const block = lines.slice(start, end);
    const sub = ['**Current**', '**Expected**', '**Evidence**', '**Files**', '**How to fix**', '**Acceptance criteria**'].map((s) => block.findIndex((l) => l.startsWith(s)));
    for (const i of sub) expect(i, `${f.id} subsection`).toBeGreaterThan(0);
    expect([...sub].sort((p, q) => p - q)).toEqual(sub);
    expect(block.join('\n')).toContain(`\`node scripts/ui-check/verify.mjs ${f.id}\``);
  }
  const fixed = lines.slice(at(new RegExp(`^### ${findings[0].id}`))).slice(0, 3).join('\n');
  expect(fixed).toMatch(/fixed 2026-10-14/);
  expect(md).toMatch(/Rejected: 1/);
  expect(md).toContain('· account (also seen by: guest) ·'); // the merged finding names the other suite
  expect(md).toContain('- Change: Give .auth-pw-toggle a 24×24 hit area');
  expect(md).toContain('[guest@phone-390-tap-target-1.jpg](shots/G-MOTION-02/guest@phone-390-tap-target-1.jpg)');
});
