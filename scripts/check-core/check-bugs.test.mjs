// node --test scripts/check-core/check-bugs.test.mjs — check-bugs.json validation, the card it makes and its dedupe
// against an injected fake Notion client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateBug, bugKey, bugFingerprint, cardFor, renderBugBody, pushBugs, loadBugs } from './check-bugs.mjs';
import { seenText } from './notion-push.mjs';

const RUN = '20261025-0128';
const bug = (o = {}) => ({
  kind: 'spec',
  checks: ['AC-PROFILE-02', 'AC-BLOCK-01'],
  title: 'the age prompt is the custom Select, the specs call selectOption',
  current: 'pagemap ageMonth/ageYear target a native select; the prompt renders Select (role combobox).',
  expected: 'the specs pick the birth month and year through the Select as a player does.',
  lost: 'photo upload + age prompt, and the double-submit guard on every form.',
  files: [{ path: 'scripts/ui-check/pagemap/account.json', line: 38, why: 'native select locators' }, { path: 'src/components/PhotoAgePrompt.tsx', line: 57, why: 'renders Select' }],
  fix: ['point ageMonth/ageYear at the combobox', 'use pick() instead of selectOption'],
  ...o,
});

function fakeClient(cards = []) {
  const made = [], comments = [];
  return {
    made, comments,
    findCards: (keys) => cards.filter((c) => keys.some((k) => String(c.source).includes(k))),
    listComments: () => [],
    comment: (id, text) => comments.push({ id, text }),
    createCard: (m) => { made.push(m); return `card-${made.length}`; },
  };
}
const quiet = () => {};
const tmpLedger = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'cb-')), 'notion-cards.json');

test('validateBug: a full entry is fine; missing pieces are named', () => {
  assert.deepEqual(validateBug(bug()), []);
  const p = validateBug({ kind: 'oops', checks: ['nope'], files: [], fix: [] });
  assert.ok(p.some((x) => x.startsWith('kind')) && p.some((x) => x.startsWith('checks')) && p.some((x) => x.startsWith('title')) && p.some((x) => x.startsWith('files')) && p.some((x) => x.startsWith('fix')));
  assert.ok(validateBug(bug({ key: 'Bad Key!' })).some((x) => x.startsWith('key')));
});

test('the dedupe key ignores check order and honours an explicit key', () => {
  assert.equal(bugKey(bug()), 'spec|AC-BLOCK-01,AC-PROFILE-02');
  assert.equal(bugFingerprint(bug()), bugFingerprint(bug({ checks: ['AC-BLOCK-01', 'AC-PROFILE-02'] })));
  assert.equal(bugKey(bug({ kind: 'env', key: 'sqlite-locked' })), 'env|sqlite-locked');
  assert.match(bugFingerprint(bug()), /^[0-9a-f]{12}$/);
});

test('card: a pipeline card on dev with the fingerprint in Source, body names what went unverified', () => {
  const m = cardFor(bug(), { checker: 'ui', runId: RUN });
  assert.deepEqual([m.category, m.priority, m.difficulty, m.target], ['pipeline', 'P1', 'standard', 'dev']);
  assert.ok(m.title.startsWith('[check-bug] AC-PROFILE-02, AC-BLOCK-01: ') && m.title.length <= 110);
  assert.equal(m.source, `check-bug fp:${bugFingerprint(bug())} checker:ui checks:AC-PROFILE-02,AC-BLOCK-01 run:${RUN}`);
  const body = renderBugBody(bug(), { checker: 'ui', runId: RUN });
  assert.match(body, /## What went unverified\n\nphoto upload/);
  assert.match(body, /node scripts\/ui-check\/run\.mjs --only "AC-PROFILE-02,AC-BLOCK-01" --vp all --ref main/);
  assert.match(renderBugBody(bug({ checks: ['LC-GAMEDATA-02'] }), { checker: 'logic', runId: `${RUN}-logic` }), /node scripts\/logic-check\/run\.mjs --only LC-GAMEDATA-02 --ref main/);
});

test('pushBugs: new → card; open card → one "seen again" comment, no card; invalid → error, the rest still run', () => {
  const open = { id: 'open-1', title: 't', status: 'To Do', source: `check-bug fp:${bugFingerprint(bug({ checks: ['LC-ROOMS-10'] }))} run:20261018-0200-logic` };
  const c = fakeClient([open]);
  const r = pushBugs({ bugs: [bug(), bug({ checks: ['LC-ROOMS-10'] }), { kind: 'spec' }], runId: RUN, checker: 'ui', client: c, log: quiet, ledgerFile: tmpLedger(), workDir: mkdtempSync(path.join(os.tmpdir(), 'cbw-')) });
  assert.deepEqual(r.map((x) => x.action), ['create', 'seen', 'error']);
  assert.equal(c.made.length, 1);
  assert.deepEqual(c.comments, [{ id: 'open-1', text: seenText(RUN) }]);
});

test('pushBugs: a Done card does not stop a new card (the drift came back)', () => {
  const done = { id: 'done-1', title: 't', status: 'Done', source: `check-bug fp:${bugFingerprint(bug())} run:x` };
  const c = fakeClient([done]);
  const r = pushBugs({ bugs: [bug()], runId: RUN, checker: 'ui', client: c, log: quiet, ledgerFile: tmpLedger(), workDir: mkdtempSync(path.join(os.tmpdir(), 'cbw-')) });
  assert.deepEqual(r.map((x) => x.action), ['create']);
});

test('loadBugs: one file per writer; one key from two judges is one entry with both checks; a bad file is named', () => {
  const runDir = mkdtempSync(path.join(os.tmpdir(), 'cbr-'));
  assert.deepEqual(loadBugs(runDir), { bugs: [], bad: [] });
  mkdirSync(path.join(runDir, 'check-bugs'));
  const env = (checks) => bug({ kind: 'env', key: 'sqlite-locked', checks });
  writeFileSync(path.join(runDir, 'check-bugs', 'games.json'), JSON.stringify([env(['GM-wordle-perfect']), bug()]));
  writeFileSync(path.join(runDir, 'check-bugs', 'multiplayer.json'), JSON.stringify([env(['MP-RESULT-01', 'GM-wordle-perfect'])]));
  writeFileSync(path.join(runDir, 'check-bugs', 'guest.json'), '{"not": "an array"}');
  const { bugs, bad } = loadBugs(runDir);
  assert.deepEqual(bad, ['guest.json: not a JSON array']);
  assert.equal(bugs.length, 2);
  assert.deepEqual(bugs.find((b) => b.kind === 'env').checks, ['GM-wordle-perfect', 'MP-RESULT-01']);
});

test('pushBugs --dry-run writes nothing', () => {
  const c = fakeClient();
  const r = pushBugs({ bugs: [bug()], runId: RUN, checker: 'ui', client: c, dryRun: true, log: quiet, ledgerFile: tmpLedger() });
  assert.deepEqual(r.map((x) => [x.action, x.card]), [['create', 'DRY']]);
  assert.equal(c.made.length, 0);
});
