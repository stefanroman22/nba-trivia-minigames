// Logic Check selftests (project `selftest`, no app server): the live guard as Logic uses it, the --skip-blocked
// mapping with a fake channel, and the scripted live triage. Nothing leaves the machine: the remote origin is
// fulfilled by page.route, the node guard refuses before fetching, and .invalid names never resolve (RFC 2606).
//   node node_modules/@playwright/test/cli.js test -c scripts/logic-check --project selftest
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test, expect, createLc } from '../../lib/fixtures.mjs';
import { createGuard, makeApi } from '../../lib/api.mjs';
import { findingOf, nextState, slackLine, stampValidation, triageFindings, FILES } from '../../lib/live-triage.mjs';
import { blockedChecks, grepInvertFor, inSelection, recordDeferrals, serviceMapOf } from '../../../check-core/lib/blocked.mjs';
import { ROOT } from '../../../check-core/lib/home.mjs';
import { acceptanceHash, fingerprint, validateFinding } from '../../../check-core/lib/findings.mjs';
import { blockedLine, buildDigest } from '../../../ui-check/lib/digest-reporter.mjs';

const ORIGIN = 'https://live.example.invalid';

test('[LC-ST-GUARD] env live: a page POST is aborted and the node api refuses a POST, both recorded as live-write; GETs are counted', async ({ browser }, testInfo) => {
  const prev = process.env.UI_CHECK_ENV;
  process.env.UI_CHECK_ENV = 'live'; // createAudit (lc.page) reads the env of the test
  const context = await browser.newContext();
  try {
    const guard = createGuard();
    const lc = createLc(testInfo, { env: 'live', guard });
    const page = await context.newPage();
    await page.route(`${ORIGIN}/**`, (r) => (r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>live</title><p>live</p>', headers: { 'access-control-allow-origin': '*' } })
      : r.fallback()));
    const audit = await lc.page(page, { label: 'live' });
    await page.goto(`${ORIGIN}/`);
    const post = await page.evaluate((o) => fetch(`${o}/api/write`, { method: 'POST', body: 'x' }).then((r) => `status ${r.status}`, (e) => `error ${e.message}`), ORIGIN);
    expect(post, 'the page POST never reached a server').toMatch(/^error /);
    expect(audit.violations.map((v) => `${v.rule} ${v.selector}`)).toEqual([`live-write POST ${ORIGIN}/api/write`]);
    // Narrowed: no detector of the UI check is reachable through lc.page() (spec §5).
    expect(Object.keys(audit).sort()).toEqual(['console', 'goto', 'page', 'shot', 'violation', 'violations']);
    for (const k of ['layout', 'motion', 'a11y', 'perf', 'timing']) expect(audit[k], k).toBeUndefined();

    const api = makeApi({ base: `${ORIGIN}/api`, guard, env: 'live' });
    await expect(api.call('guest', 'POST', '/signup/', { username: 'x' })).rejects.toThrow(/POST .*refused — the live site is GET\/HEAD only/);
    expect(guard.allow('GET', `${ORIGIN}/api/health/`)).toBe(true);
    expect(guard.allow('POST', 'http://localhost:8200/api/login/')).toBe(true); // local writes are the local suites' business
    expect({ read: guard.read, write: guard.write }).toEqual({ read: 1, write: 1 });
    expect(lc.violations.map((v) => `${v.rule} ${v.selector}`)).toEqual([`live-write POST ${ORIGIN}/api/signup/`]);

    await expect(lc.done()).rejects.toThrow(/2 logic violation\(s\) in LC-ST-GUARD/);
    const atts = testInfo.attachments.filter((a) => a.name === 'uicheck').map((a) => JSON.parse(a.body.toString('utf8')));
    const mine = atts.find((a) => a.liveRequests && a.label === null && a.violations.length);
    expect(mine).toMatchObject({ checkId: 'LC-ST-GUARD', env: 'live', liveRequests: { read: 1, write: 1 }, shots: [] });
    expect(atts.some((a) => a.label === 'live' && a.liveRequests && a.liveRequests.write === 1)).toBe(true); // the page audit's own counters
  } finally {
    await context.close();
    if (prev === undefined) delete process.env.UI_CHECK_ENV; else process.env.UI_CHECK_ENV = prev;
  }
});

/** A channel with fixed blocks that records defer() calls. */
function fakeChannel(blocks) {
  const deferred = [];
  return {
    deferred,
    blockedServices: () => new Set(blocks.map((b) => b.service)),
    blockFor: (s) => blocks.find((b) => b.service === s) || null,
    defer: (d) => { deferred.push(d); return { added: true, item: d }; },
  };
}
const titled = (re, title) => new RegExp(re).test(title);

test('[LC-ST-BLOCKED] --skip-blocked maps blocked services to the checks tagged with them, greps them out and defers each', async () => {
  const ui = serviceMapOf('ui');
  const auth = fakeChannel([{ service: 'auth', by: 'LC-AUTH-01', card: 'card-1', finding: 'UIC-x-logic-001' }]);
  const list = blockedChecks({ checker: 'ui', map: ui, channel: auth });
  const ids = list.map((x) => x.checkId);
  for (const id of ['AC-LOGIN-01', 'AC-GOOGLE-01', 'G-PERM-01', 'AC-BLOCK-01']) expect(ids, id).toContain(id);
  for (const id of ['G-NAV-01', 'AC-PROFILE-01', 'MP-ROOM-01']) expect(ids, id).not.toContain(id);
  expect(list.find((x) => x.checkId === 'AC-LOGIN-01')).toEqual({ checkId: 'AC-LOGIN-01', service: 'auth', blockedBy: 'LC-AUTH-01', card: 'card-1', finding: 'UIC-x-logic-001' });
  const grep = grepInvertFor(list);
  expect(titled(grep, '[AC-LOGIN-01] log in by email')).toBe(true);
  expect(titled(grep, '[G-NAV-01] nav links')).toBe(false);
  expect(recordDeferrals(list, { checker: 'ui', runId: 'r1', channel: auth })).toBe(list.length);
  expect(auth.deferred[0]).toMatchObject({ checker: 'ui', project: null, blockedBy: 'LC-AUTH-01', service: 'auth', runId: 'r1' });
  // The digest lists them under Coverage gaps (run.mjs writes <runDir>/blocked.json, the reporter reads it).
  const md = buildDigest([], { runId: 'r1', blocked: list.slice(0, 1) }).split('\n');
  expect(md.slice(md.indexOf('## Coverage gaps'), md.indexOf('## Coverage gaps') + 2)).toEqual(['## Coverage gaps', blockedLine(list[0])]);
  expect(blockedLine(list[0])).toBe(`- ${list[0].checkId} (not run): blocked by LC-AUTH-01 (card card-1) — service auth`);

  // A one-game block narrows the families to that game; game-data hits every game (families in --only form).
  const wordle = blockedChecks({ checker: 'ui', map: ui, channel: fakeChannel([{ service: 'games.wordle', by: 'LC-GAMEDATA-01', card: 'c' }]) }).map((x) => x.checkId);
  expect(wordle).toEqual(expect.arrayContaining(['GM-wordle-*', 'GM-LATENCY-wordle', 'MP-GAME-wordle']));
  const wg = grepInvertFor(blockedChecks({ checker: 'ui', map: ui, channel: fakeChannel([{ service: 'games.wordle', by: 'LC-GAMEDATA-01', card: 'c' }]) }));
  expect(titled(wg, '[GM-wordle-perfect] wordle perfect')).toBe(true);
  expect(titled(wg, '[GM-contexto-perfect] contexto perfect')).toBe(false);
  expect(titled(wg, '[GM-SHELL-01] shell')).toBe(false);
  const dataList = blockedChecks({ checker: 'ui', map: ui, channel: fakeChannel([{ service: 'game-data', by: 'LC-LIVE-03', card: 'c' }]) });
  expect(dataList.map((x) => x.checkId)).toEqual(expect.arrayContaining(['GM-*-*', 'GM-SHELL-01']));
  expect(dataList.find((x) => x.checkId === 'GM-*-*').pattern).toBe('GM-<game>-<scenario>');
  // The family keeps its placeholders' classes: a game-data block never greps out the adapter rows (games.<game> only).
  const dg = grepInvertFor(dataList);
  expect(titled(dg, '[GM-wordle-perfect] wordle perfect')).toBe(true);
  expect(titled(dg, '[GM-who-are-ya-daily-lock] who are ya daily lock')).toBe(true);
  expect(titled(dg, '[GM-wordle-adapter] wordle has no adapter')).toBe(false);
  expect(titled(grepInvertFor(blockedChecks({ checker: 'ui', map: ui, channel: fakeChannel([{ service: 'games.wordle', by: 'LC-GAMEDATA-01', card: 'c' }]) })), '[GM-wordle-adapter] wordle')).toBe(true);

  // Logic's own catalogue: a relay block leaves out the relay handshake check; nothing blocked → nothing skipped.
  const relay = blockedChecks({ checker: 'logic', map: serviceMapOf('logic'), channel: fakeChannel([{ service: 'relay', by: 'LC-ROOMS-01', card: 'c' }]) }).map((x) => x.checkId);
  expect(relay).toEqual(['LC-LIVE-06', ...Array.from({ length: 10 }, (_, i) => `LC-ROOMS-${String(i + 1).padStart(2, '0')}`)]);
  expect(blockedChecks({ checker: 'ui', map: ui, channel: fakeChannel([]) })).toEqual([]);
  expect(grepInvertFor([])).toBeNull();

  // Only what the run selects is deferred: its suites' prefixes and, with --only, overlapping ids/patterns.
  const sel = (ids, o) => inSelection(ids.map((checkId) => ({ checkId })), o).map((x) => x.checkId);
  expect(sel(['G-MODAL-01', 'AC-SURF-01', 'GM-*-*'], { prefixes: ['G-'] })).toEqual(['G-MODAL-01']);
  expect(sel(['G-MODAL-01', 'G-PERF-01', 'GM-*-*', 'GM-wordle-*'], { only: 'G-PERF-01,GM-wordle-perfect' })).toEqual(['G-PERF-01', 'GM-*-*', 'GM-wordle-*']);
  expect(sel(['GM-wordle-*', 'GM-contexto-*'], { only: 'GM-*' })).toEqual(['GM-wordle-*', 'GM-contexto-*']);
});

test('[LC-ST-TRIAGE] live triage: failing LC-LIVE results become valid ci findings, validation is stamped from the run, cards only for checks failing twice in a row', async () => {
  const results = [
    { checkId: 'LC-LIVE-03', project: 'live', suite: 'live', status: 'failed', metrics: [{ label: 'rows mvps', value: 71, unit: '' }],
      violations: [{ rule: 'game-data', route: '/wordle', selector: 'GET /trivia/wordle/daily-status/', measured: 'HTTP 500', expected: '200 JSON (the Wordle daily status)' }] },
    { checkId: 'LC-LIVE-01', project: 'live', suite: 'live', status: 'passed', violations: [] },
    { checkId: 'LC-LIVE-06', project: 'live', suite: 'live', status: 'timedOut', error: 'Test timeout of 60000ms exceeded.', violations: [] },
    { checkId: 'LC-AUTH-01', project: 'api', suite: 'auth', status: 'failed', violations: [] },
  ];
  const fs = triageFindings(results);
  expect(fs.map((f) => f.where.selector)).toEqual(['LC-LIVE-03', 'LC-LIVE-06']);
  for (const f of fs) expect(validateFinding(f), f.title).toEqual([]);
  expect(fs[0]).toMatchObject({ checker: 'logic', owner: 'ci', suite: 'live', persona: 'guest', severity: 'major', where: { env: ['live'], viewports: ['api'] }, acceptance: { checks: [{ lc: 'LC-LIVE-03', projects: ['live'] }] } });
  expect(fingerprint(fs[0])).toBe('lc-live|/|LC-LIVE-03'); // stable across runs: notion-push dedupes on it
  expect(fs[0].current).toContain('HTTP 500');
  expect(fs[1].current).toContain('Test timeout');
  expect(findingOf({ checkId: 'LC-LIVE-02', status: 'failed', violations: [] }).severity).toBe('blocker');
  for (const [p] of Object.values(FILES).flat()) expect(existsSync(path.join(ROOT, p)), p).toBe(true);
  expect(triageFindings(results, { ids: ['LC-LIVE-06'] }).map((f) => f.where.selector)).toEqual(['LC-LIVE-06']); // --ids = state's cards

  // Local equivalents (verifiable in --mode dev) and the TTFB finding on UI check's G-PERF-01 fingerprint (spec §8).
  const routes = findingOf({ checkId: 'LC-LIVE-01', status: 'failed', violations: [] });
  expect(routes.acceptance.checks).toEqual([{ lc: 'LC-LIVE-01', projects: ['live'] }, { lc: 'LC-PAGES-01', projects: ['pages'] }]);
  expect(validateFinding(routes)).toEqual([]);
  const ttfb = findingOf({ checkId: 'LC-LIVE-07', status: 'failed', violations: [{ rule: 'ttfb', route: '/wordle', selector: 'GET /wordle', measured: 'TTFB 1200ms (best of 2)', expected: '≤ 800ms' }] });
  expect(fingerprint(ttfb)).toBe('perf|/|document');
  expect(validateFinding(ttfb)).toEqual([]);

  const doc = { runId: 'r', findings: [{ ...fs[0], id: 'UIC-r-001' }, { ...fs[1], id: 'UIC-r-002', acceptance: { criteria: ['x'], checks: [{ lc: 'LC-LIVE-02' }] } },
    { ...routes, id: 'UIC-r-003' }] };
  const { doc: out, stamped } = stampValidation(doc, [...results, { checkId: 'LC-LIVE-01', project: 'live', status: 'failed' }], { now: '2026-10-16T00:00:00.000Z' });
  expect(stamped).toBe(2);
  expect(out.findings[0]).toMatchObject({ validatedAt: '2026-10-16T00:00:00.000Z', validatedMode: 'prod', validatedHash: acceptanceHash(fs[0]) });
  expect(out.findings[1].validatedAt).toBeUndefined(); // LC-LIVE-02 did not fail in this run
  expect(out.findings[2].validatedAt).toBe('2026-10-16T00:00:00.000Z'); // its live criterion failed; LC-PAGES-01 runs locally later

  // Consecutive failures per check id: a card only for an id that failed in the previous run too.
  let s = nextState(null, 1, ['LC-LIVE-03']);
  expect(s).toEqual({ lastOutcome: 'fail', consecutiveFailures: 1, failing: ['LC-LIVE-03'], cards: [], action: 'slack' });
  s = nextState(s, 1, ['LC-LIVE-06']); // a different check fails: still no card
  expect(s).toEqual({ lastOutcome: 'fail', consecutiveFailures: 2, failing: ['LC-LIVE-06'], cards: [], action: 'slack' });
  s = nextState(s, 1, ['LC-LIVE-06', 'LC-LIVE-03']);
  expect(s).toEqual({ lastOutcome: 'fail', consecutiveFailures: 3, failing: ['LC-LIVE-06', 'LC-LIVE-03'], cards: ['LC-LIVE-06'], action: 'cards' });
  expect(slackLine(s)).toBe('Logic live check failing on https://swishquest.com: LC-LIVE-06, LC-LIVE-03 — cards for LC-LIVE-06 (failed twice in a row); first failure LC-LIVE-03 (no card yet)');
  // exit 1 with no failing id (guard mismatch, crash) and exit 2 are infra: no cards, the previous ids kept.
  const crash = nextState(s, 1, []);
  expect(crash).toMatchObject({ lastOutcome: 'infra', consecutiveFailures: 3, failing: ['LC-LIVE-06', 'LC-LIVE-03'], cards: [], action: 'slack' });
  expect(slackLine(crash, { url: 'https://github.com/x/actions/runs/1' })).toBe('logic-live infra: exit 1 with no failing check (guard mismatch or crash) against https://swishquest.com, no cards — https://github.com/x/actions/runs/1');
  expect(nextState(crash, 1, ['LC-LIVE-03']).cards).toEqual(['LC-LIVE-03']); // infra in between keeps the previous run's ids
  expect(nextState(s, 2, [])).toMatchObject({ lastOutcome: 'infra', cards: [], action: 'slack' });
  expect(nextState(s, 0, [])).toEqual({ lastOutcome: 'pass', consecutiveFailures: 0, failing: [], cards: [], action: 'none' });
  const line = slackLine(nextState(null, 1, ['LC-LIVE-03']), { url: 'https://github.com/x/actions/runs/1' });
  expect(line).toBe('Logic live check failing on https://swishquest.com: LC-LIVE-03 — first failure LC-LIVE-03 (no card yet) — https://github.com/x/actions/runs/1');
  expect(line).not.toContain('\n');
});
