// node --test scripts/seo/notion-push.test.mjs — the findings contract (validateFindings, Task 3's regression findings
// included), the card a finding becomes (renderCard), and notion-push's dedupe decisions against an injected fake Notion
// client (as scripts/check-core/notion-push.test.mjs). Never calls the real Notion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fpKey } from '../check-core/lib/card-body.mjs';
import { seenText } from '../check-core/notion-push.mjs';
import { validateFindings, readFindings } from './lib/findings.mjs';
import { renderCard } from './lib/card-body.mjs';
import { pushFindings, cliClient, cli } from './notion-push.mjs';
import { writeRegressionFindings } from './lib/digest.mjs';

const RUN = '20261027-0600-seo';
const SITE = 'https://swishquest.com';
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'seo-notion-push-'));

/** A valid `card` finding; `over` replaces fields (the fingerprint follows check and urls unless given). */
function finding(over = {}) {
  const f = {
    id: `SEO-${RUN}-001`,
    check: 'IX-04',
    severity: 'major',
    urls: [`${SITE}/wordle`, `${SITE}/connections`],
    current: `${SITE}/connections: canonical is ${SITE}/; ${SITE}/wordle: no <link rel="canonical">`,
    expected: 'exactly one <link rel="canonical">, absolute, equal to the sitemap URL; ?ref=x variants keep it',
    files: ['src/app/[game]/page.tsx'],
    howToFix: 'Set alternates.canonical in generateMetadata to the absolute game URL (docs/seo/indexing-guide.md step 4).',
    acceptance: {
      audit: `node scripts/seo/audit.mjs --only IX-04 --site ${SITE}`,
      qa: [{ route: '/wordle', selector: 'link[rel=canonical]', expect: `href=${SITE}/wordle` }],
    },
    decision: 'card',
    ...over,
  };
  if (!('fingerprint' in over)) f.fingerprint = `${f.check}|${[...f.urls].sort().join(',')}`;
  return f;
}
const docOf = (...findings) => ({ runId: RUN, findings });

test('validateFindings rejects a finding without urls, with an unknown check id, or with decision card but no files', () => {
  assert.deepEqual(validateFindings(docOf(finding())), []);
  const noUrls = validateFindings(docOf(finding({ urls: [], fingerprint: 'IX-04|' })));
  assert.ok(noUrls.some((e) => /urls/.test(e)), noUrls.join('\n'));
  const unknown = validateFindings(docOf(finding({ check: 'IX-13' })));
  assert.ok(unknown.some((e) => /check/.test(e) && /IX-13/.test(e)), unknown.join('\n'));
  const noFiles = validateFindings(docOf(finding({ files: [] })));
  assert.ok(noFiles.some((e) => /files/.test(e)), noFiles.join('\n'));
  // Not a card: files may be empty; an owner decision needs its action and click path, a wait its re-check date.
  assert.deepEqual(validateFindings(docOf(finding({ decision: 'none', files: [] }))), []);
  assert.ok(validateFindings(docOf(finding({ decision: 'owner' }))).some((e) => /owner/.test(e)));
  assert.deepEqual(validateFindings(docOf(finding({ decision: 'owner', owner: { action: 'Request indexing', clickPath: 'Search Console → URL Inspection → Request indexing' } }))), []);
  assert.ok(validateFindings(docOf(finding({ decision: 'wait' }))).some((e) => /recheckAfter/.test(e)));
  // Every error names the finding; a bad document names itself.
  assert.ok(noFiles.every((e) => e.includes(`SEO-${RUN}-001`)), noFiles.join('\n'));
  assert.ok(validateFindings({ findings: 'x' }).length >= 2);
  assert.ok(validateFindings(docOf(finding({ fingerprint: 'IX-04|x' }))).some((e) => /fingerprint/.test(e)));
});

test("Task 3's regression findings.json validates (R1)", () => {
  const dir = tmp();
  const evidence = '<meta name="robots" content="noindex">';
  const result = {
    runId: RUN, site: SITE, only: null, gaps: [], counts: { urls: 2, pass: 1, fail: 1 },
    urls: { [`${SITE}/`]: { failures: [] }, [`${SITE}/wordle`]: { failures: [{ id: 'IX-03', url: `${SITE}/wordle`, evidence }] } },
    siteFailures: [{ id: 'IX-11', url: `${SITE}/`, evidence: `${SITE}/wordle is linked from no sitemap URL` }],
    regressions: [{ id: 'IX-03', url: `${SITE}/wordle`, evidence }, { id: 'IX-11', url: `${SITE}/`, evidence: 'orphan' }],
  };
  writeRegressionFindings(result, dir);
  const doc = readFindings(dir);
  assert.equal(doc.findings.length, 2);
  assert.ok(doc.findings.some((f) => f.files.some((x) => /\(/.test(x))), 'CHECKS.md prose in files is accepted');
  assert.deepEqual(validateFindings(doc), []);
  assert.equal(readFindings(path.join(dir, 'missing')), null);
});

test('renderCard: title, P0 for IX-02 on a sitemap url, P2 for IX-12, source prefix seo-check, no attachment field', () => {
  const f = finding();
  const card = renderCard(f, { runId: RUN, site: SITE });
  assert.equal(card.title, '[seo] IX-04 canonical on 2 page(s)');
  assert.deepEqual([card.category, card.priority, card.difficulty, card.target], ['frontend', 'P0', 'standard', 'dev']);
  assert.equal(card.source, `seo-check fp:${fpKey(f.fingerprint)} run:${RUN}`);
  assert.match(fpKey(f.fingerprint), /^[0-9a-f]{12}$/);
  for (const k of ['attach', 'attachment', 'attachments']) assert.equal(k in card, false, k);

  const ix02 = renderCard(finding({ check: 'IX-02', urls: [`${SITE}/wordle`] }), { runId: RUN, site: SITE });
  assert.equal(ix02.priority, 'P0');
  assert.equal(ix02.title, '[seo] IX-02 status on 1 page(s)');
  assert.equal(renderCard(finding({ check: 'IX-12', severity: 'minor' }), { runId: RUN, site: SITE }).priority, 'P2');
  assert.equal(renderCard(finding({ check: 'IX-06' }), { runId: RUN, site: SITE }).priority, 'P1');
  // IX-03 on an expected-noindex page only (not a sitemap URL) is not "the page cannot be indexed"; a regression always is.
  const admin = finding({ check: 'IX-03', urls: [`${SITE}/admin`] });
  assert.equal(renderCard(admin, { runId: RUN, site: SITE }).priority, 'P1');
  assert.equal(renderCard({ ...finding({ check: 'IX-12' }), regression: true }, { runId: RUN, site: SITE }).priority, 'P0');
  assert.equal(renderCard(finding({ files: ['.github/workflows/seo-audit.yml'] }), { runId: RUN, site: SITE }).category, 'CI/CD');

  // The body: every section, the QA assertions and the finding as fenced JSON, the finding last.
  const body = card.body.replace(/\r/g, '');
  for (const h of ['## Current', '## Expected', '## Files', '## How to fix', '## Acceptance', '## QA assertions', '## Finding']) assert.ok(body.includes(`\n${h}\n`), h);
  assert.ok(body.includes(`- ${f.acceptance.audit}`));
  const fences = [...body.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]));
  assert.deepEqual(fences, [f.acceptance.qa, f]);
  assert.ok(body.trimEnd().endsWith('```'));
  assert.ok(body.split('\n').every((l) => l.length <= 1900));
});

// ---- dedupe with a fake client

function fakeClient({ cards = [], shipped = () => true } = {}) {
  const calls = { create: [], comment: [], find: [] };
  const comments = {};
  return {
    calls,
    findCards: (keys) => { calls.find.push(keys); return cards.filter((c) => keys.some((k) => c.source.includes(k))); },
    listComments: (id) => (comments[id] || []).map((text) => ({ text })),
    comment: (id, text) => { calls.comment.push([id, text]); (comments[id] ||= []).push(text); },
    createCard: (m, bodyFile, ...rest) => {
      calls.create.push({ m, body: readFileSync(bodyFile, 'utf8'), rest });
      const id = `new-${calls.create.length}`;
      cards.push({ id, title: m.title, source: m.source, status: 'To Do', commit: '', url: `https://notion.test/${id}` });
      return id;
    },
    isShipped: shipped,
  };
}
const push = (client, doc = docOf(finding()), opts = {}) => {
  const out = [];
  const results = pushFindings(doc, client, { site: SITE, log: (l) => out.push(l), workDir: tmp(), ...opts });
  return { results, out };
};
const K = fpKey(finding().fingerprint);

test('pushFindings: open card → comment once per run, no card', () => {
  const client = fakeClient({ cards: [{ id: 'open-1', title: 't', source: `seo-check fp:${K} run:20261020-0600-seo`, status: 'To Do', commit: '' }] });
  const { results, out } = push(client);
  push(client);
  assert.equal(client.calls.create.length, 0);
  assert.deepEqual(client.calls.comment, [['open-1', seenText(RUN)]]);
  assert.deepEqual(results, [{ action: 'skip', id: `SEO-${RUN}-001`, cardId: 'open-1', why: 'open' }]);
  assert.ok(out.some((l) => l === `skip ${K} already open card open-1`), out.join('\n'));
  // The run that created the card does not comment on it.
  const own = fakeClient({ cards: [{ id: 'own-1', title: 't', source: `seo-check fp:${K} run:${RUN}`, status: 'In Progress', commit: '' }] });
  push(own);
  assert.deepEqual(own.calls.comment, []);
});

test('pushFindings: Done card with Commit not on main → skip, no comment', () => {
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `seo-check fp:${K} run:r0`, status: 'Done', commit: 'abc1234' }], shipped: () => false });
  const { results } = push(client);
  assert.deepEqual(results, [{ action: 'skip', id: `SEO-${RUN}-001`, cardId: 'old-1', why: 'pending' }]);
  assert.equal(client.calls.create.length + client.calls.comment.length, 0);
  const byHand = fakeClient({ cards: [{ id: 'old-2', title: 'old', source: `seo-check fp:${K} run:r0`, status: 'Done', commit: '' }] });
  assert.equal(push(byHand).results[0].why, 'byHand');
  assert.equal(byHand.calls.create.length + byHand.calls.comment.length, 0);
});

test('pushFindings: Done card with Commit on main → regression card', () => {
  const client = fakeClient({ cards: [{ id: 'old-1', title: 'old', source: `seo-check fp:${K} run:r0`, status: 'Done', commit: 'abc1234', url: 'https://notion.test/old-1' }] });
  const { results, out } = push(client);
  assert.equal(client.calls.create.length, 1);
  const { m, body } = client.calls.create[0];
  assert.equal(m.title, '[seo] Regression: IX-04 canonical on 2 page(s)');
  assert.ok(body.includes('https://notion.test/old-1'));
  assert.deepEqual(results, [{ action: 'regression', id: `SEO-${RUN}-001`, cardId: 'new-1', why: 'regression of old-1' }]);
  assert.ok(out.includes('regression old-1 → new-1'), out.join('\n'));
  assert.equal(client.calls.comment.length, 0);
  // A regression is P0 whatever its check (IX-06 alone would be P1).
  const ix06 = finding({ check: 'IX-06' });
  const k06 = fpKey(ix06.fingerprint);
  const back = fakeClient({ cards: [{ id: 'old-6', title: 'old', source: `seo-check fp:${k06} run:r0`, status: 'Done', commit: 'abc1234', url: 'https://notion.test/old-6' }] });
  assert.equal(renderCard(ix06, { runId: RUN, site: SITE }).priority, 'P1');
  assert.equal(push(back, docOf(ix06)).results[0].action, 'regression');
  assert.equal(back.calls.create[0].m.priority, 'P0');
});

test('pushFindings: decision owner/wait/none → no card', () => {
  const client = fakeClient();
  const doc = docOf(
    finding({ id: `SEO-${RUN}-001`, decision: 'owner', owner: { action: 'Request indexing', clickPath: 'Search Console → URL Inspection → Request indexing' } }),
    finding({ id: `SEO-${RUN}-002`, check: 'IX-05', decision: 'wait', recheckAfter: '2026-11-10T00:00:00.000Z' }),
    finding({ id: `SEO-${RUN}-003`, check: 'IX-06', decision: 'none' }),
  );
  const { results } = push(client, doc);
  assert.equal(client.calls.create.length + client.calls.find.length + client.calls.comment.length, 0);
  assert.deepEqual(results.map((r) => [r.action, r.cardId, r.why]), [['skip', null, 'decision owner'], ['skip', null, 'decision wait'], ['skip', null, 'decision none']]);
  // A new card finding gets exactly one card; --regressions-only keeps only `regression: true` findings.
  const fresh = fakeClient();
  const two = docOf(finding(), { ...finding({ id: `SEO-${RUN}-002`, check: 'IX-03', urls: [`${SITE}/wordle`] }), regression: true });
  assert.deepEqual(push(fresh, two, { regressionsOnly: true }).results.map((r) => [r.action, r.id]), [['card', `SEO-${RUN}-002`]]);
  assert.equal(fresh.calls.create.length, 1);
  // --dry-run reads Notion but writes nothing.
  const dry = fakeClient();
  const { out } = push(dry, docOf(finding()), { dryRun: true });
  assert.equal(dry.calls.create.length, 0);
  assert.equal(out.filter((l) => l.startsWith('card DRY ')).length, 1);
});

test('createCard is called with --target dev always', () => {
  // pushFindings: Target dev and no attachment argument, even with a priority override.
  const client = fakeClient();
  push(client, docOf(finding()), { priorityOverride: 'P0' });
  const { m, rest } = client.calls.create[0];
  assert.deepEqual([m.target, m.priority], ['dev', 'P0']);
  assert.deepEqual(rest, []);
  // cliClient: whatever the card says, the notion.mjs argv has --target dev and never --attach.
  const argv = [];
  const spawn = (cmd, args) => { argv.push(args); return { status: 0, stdout: 'https://www.notion.so/x\ncard-id-1\n', stderr: '' }; };
  const cli = cliClient({ root: tmp(), spawn });
  const id = cli.createCard({ ...m, target: 'main' }, 'body.md', ['findings.json']);
  assert.equal(id, 'card-id-1');
  const a = argv[0];
  assert.equal(a[a.indexOf('--target') + 1], 'dev');
  assert.equal(a.filter((x) => x === '--target').length, 1);
  assert.equal(a.includes('--attach'), false);
  assert.deepEqual(a.slice(1, 3), ['create-card', m.title]);
  assert.equal(a[a.indexOf('--source') + 1], m.source);
});

// ---- phase 2: the OP checks

const opFinding = (check, over = {}) => finding({
  check, urls: [`${SITE}/wordle`], current: '10 unique words, no how-to-play section', expected: '>= 150 unique words and a How to play H2',
  files: ['src/views/Trivia/MiniGame.tsx'], acceptance: { audit: `node scripts/seo/onpage.mjs --site ${SITE}`, qa: [] }, ...over,
});

test('validateFindings: OP-01..OP-11 are checks; OP-07 and OP-11 never with decision card; OP-12 is unknown', () => {
  for (const id of ['OP-01', 'OP-02', 'OP-03', 'OP-04', 'OP-05', 'OP-06', 'OP-08', 'OP-09', 'OP-10']) {
    assert.deepEqual(validateFindings(docOf(opFinding(id))), [], id);
  }
  for (const id of ['OP-07', 'OP-11']) {
    const errors = validateFindings(docOf(opFinding(id)));
    assert.ok(errors.some((e) => e.includes(id) && /decision card/.test(e)), `${id}: ${errors.join('\n')}`);
    assert.deepEqual(validateFindings(docOf(opFinding(id, { decision: 'none', files: [] }))), [], `${id} none`);
  }
  const unknown = validateFindings(docOf(opFinding('OP-12')));
  assert.ok(unknown.some((e) => /unknown check "OP-12"/.test(e) && /OP-01\.\.OP-11/.test(e) && /IX-01\.\.IX-12/.test(e)), unknown.join('\n'));
  // The GSC rule is unchanged.
  assert.ok(validateFindings(docOf(finding({ check: 'GSC' }))).some((e) => e.endsWith('decision card needs an IX check (GSC findings carry no code change)')));
});

test('renderCard: OP-01/02/05 are P1, the other OP ids P2, category frontend, the area in the title; no P0 for an OP regression', () => {
  for (const id of ['OP-01', 'OP-02', 'OP-05']) assert.equal(renderCard(opFinding(id), { runId: RUN, site: SITE }).priority, 'P1', id);
  for (const id of ['OP-03', 'OP-04', 'OP-06', 'OP-08', 'OP-09', 'OP-10']) assert.equal(renderCard(opFinding(id), { runId: RUN, site: SITE }).priority, 'P2', id);
  const card = renderCard(opFinding('OP-05'), { runId: RUN, site: SITE });
  assert.equal(card.title, '[seo] OP-05 content on 1 page(s)');
  assert.equal(card.category, 'frontend');
  assert.equal(renderCard(opFinding('OP-08', { files: ['.github/workflows/x.yml'] }), { runId: RUN, site: SITE }).category, 'frontend');
  // A regression (a Done card back, or regression: true) stays the OP priority; for an IX id it is still P0.
  const back = [{ id: 'old-1', url: 'https://notion.test/old-1', commit: 'abc1234' }];
  assert.equal(renderCard(opFinding('OP-05'), { runId: RUN, site: SITE, regressionOf: back }).priority, 'P1');
  assert.equal(renderCard(opFinding('OP-09'), { runId: RUN, site: SITE, regressionOf: back }).priority, 'P2');
  assert.equal(renderCard({ ...opFinding('OP-04'), regression: true }, { runId: RUN, site: SITE }).priority, 'P2');
  assert.equal(renderCard(finding({ check: 'IX-06' }), { runId: RUN, site: SITE, regressionOf: back }).priority, 'P0');
});

test('pushFindings: an OP card back after a Done card on main → a regression card at the OP priority, not P0', () => {
  const f = opFinding('OP-02');
  const k = fpKey(f.fingerprint);
  const client = fakeClient({ cards: [{ id: 'old-2', title: 'old', source: `seo-check fp:${k} run:r0`, status: 'Done', commit: 'abc1234', url: 'https://notion.test/old-2' }] });
  const { results } = push(client, docOf(f));
  assert.equal(results[0].action, 'regression');
  assert.equal(client.calls.create[0].m.title, '[seo] Regression: OP-02 title on 1 page(s)');
  assert.equal(client.calls.create[0].m.priority, 'P1');
});

test('--validate-only: a valid findings.json → exit 0, "findings: valid (n)", no Notion client; an invalid one → exit 2', () => {
  const run = (doc, extra = []) => {
    const dir = tmp();
    writeFileSync(path.join(dir, 'findings.json'), JSON.stringify(doc));
    const out = [];
    let made = 0;
    const code = cli(['--run-dir', dir, '--validate-only', ...extra], { log: (m) => out.push(m), err: (m) => out.push(m), client: () => { made += 1; throw new Error('no Notion'); } });
    return { code, out, made };
  };
  const ok = run(docOf(finding(), finding({ id: `SEO-${RUN}-002`, check: 'GSC', decision: 'wait', recheckAfter: '2026-11-10', files: undefined, howToFix: undefined, acceptance: undefined })));
  assert.equal(ok.code, 0, ok.out.join('\n'));
  assert.deepEqual(ok.out, ['findings: valid (2)']);
  assert.equal(ok.made, 0);
  const bad = run(docOf(finding({ files: [] }), finding({ id: `SEO-${RUN}-002`, check: 'GSC' })));
  assert.equal(bad.code, 2);
  assert.equal(bad.made, 0);
  assert.ok(bad.out.length >= 2 && bad.out.every((l) => l.startsWith('notion-push: invalid findings.json: ')), bad.out.join('\n'));
});
