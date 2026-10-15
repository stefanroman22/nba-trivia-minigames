// node --test scripts/check-core/retain.test.mjs — retention on a fixture home dir (runs, notes, channel, ledger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bulletDate, pruneNotes, retain, runChecker } from './lib/retain.mjs';

const NOW = Date.parse('2026-10-16T03:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86_400_000).toISOString();

function fixtureHome() {
  const home = mkdtempSync(path.join(os.tmpdir(), 'retain-'));
  const run = (id, meta) => {
    const d = path.join(home, 'runs', id);
    mkdirSync(path.join(d, 'shots', 'G-X'), { recursive: true });
    writeFileSync(path.join(d, 'shots', 'G-X', 'a.jpg'), 'x');
    if (meta) writeFileSync(path.join(d, 'run-meta.json'), JSON.stringify(meta));
  };
  for (let i = 1; i <= 8; i++) run(`2026100${i}-0200`); // 8 ui runs
  run('20261001-0100-logic');
  run('20261002-0100-logic');
  run('20261003-0100-x', { checker: 'logic' }); // checker from run-meta
  run('20261009-0300-live'); // a ui --live run
  const notes = path.join(home, 'notes');
  mkdirSync(notes);
  writeFileSync(path.join(notes, 'guest.md'), [
    '# Guest notes', '', '## Flaky spots', '',
    '- (2026-01-02) old bullet, nothing open',
    '  continuation line of the old bullet',
    '- (20260601-0200) old run-id bullet naming UIC-20260601-0200-004',
    '- (2026-06-01) old bullet naming UIC-20260601-0200-007 (still open)',
    '- (2026-10-10) recent bullet',
    '- undated bullet stays',
    '',
  ].join('\n'));
  writeFileSync(path.join(home, 'channel.json'), JSON.stringify({
    blocks: [{ service: 'auth', by: 'LC-AUTH-01', card: 'c9', since: daysAgo(90) }],
    deferred: [
      { checker: 'ui', checkId: 'AC-LOGIN-01', blockedBy: 'LC-AUTH-02', since: daysAgo(50), resolvedAt: daysAgo(40) },
      { checker: 'ui', checkId: 'AC-LOGIN-02', blockedBy: 'LC-AUTH-03', since: daysAgo(5), resolvedAt: daysAgo(2) },
      { checker: 'ui', checkId: 'AC-LOGIN-01', blockedBy: 'LC-AUTH-01', since: daysAgo(90) },
    ],
    resolved: [
      { service: 'auth', by: 'LC-AUTH-02', resolvedAt: daysAgo(40) },
      { service: 'auth', by: 'LC-AUTH-03', resolvedAt: daysAgo(2) },
    ],
  }));
  writeFileSync(path.join(home, 'notion-cards.json'), JSON.stringify({
    'fp-old-done': { card: 'a', status: 'Done', run: '20261001-0200', at: daysAgo(61), id: 'UIC-20261001-0200-001' },
    'fp-new-done': { card: 'b', status: 'Done', run: '20261001-0200', at: daysAgo(5) },
    'fp-open': { card: 'c', status: 'To Do', run: '20261002-0200', at: daysAgo(70), id: 'UIC-20260601-0200-007' },
  }));
  return { home, notes };
}

test('helpers: run checker, bullet dates', () => {
  const { home } = fixtureHome();
  assert.equal(runChecker(home, '20261001-0100-logic'), 'logic');
  assert.equal(runChecker(home, '20261003-0100-x'), 'logic');
  assert.equal(runChecker(home, '20261009-0300-live'), 'ui');
  assert.equal(bulletDate('- (2026-01-02) x'), Date.UTC(2026, 0, 2));
  assert.equal(bulletDate('- (20260601-0200x) x'), Date.UTC(2026, 5, 1));
  assert.equal(bulletDate('- no date'), null);
});

test('pruneNotes caps the line count with the oldest dated bullets, never an open one', () => {
  const text = ['# t', '- (2026-10-01) a', '- (2026-10-02) b UIC-20261002-0200-001', '- (2026-10-03) c', '- undated', ''].join('\n');
  const r = pruneNotes(text, { now: NOW, notesMax: 4, notesDays: 90, openIds: new Set(['UIC-20261002-0200-001']) });
  assert.deepEqual(r.archived, ['- (2026-10-01) a', '- (2026-10-03) c']);
  assert.equal(r.overCap, false);
  const r2 = pruneNotes(text, { now: NOW, notesMax: 2, notesDays: 90, openIds: new Set(['UIC-20261002-0200-001']) });
  assert.equal(r2.overCap, true);
});

test('dry run reports and changes nothing', async () => {
  const { home, notes } = fixtureHome();
  const lines = [];
  const before = readFileSync(path.join(notes, 'guest.md'), 'utf8');
  const r = await retain({ home, dryRun: true, notesDirs: [notes], now: NOW, log: (m) => lines.push(m) });
  assert.ok(r.runs.deleted.length > 0);
  assert.ok(lines.some((l) => /^retain \(dry run\): delete run 20261001-0200 \(ui\)/.test(l)));
  assert.ok(existsSync(path.join(home, 'runs', '20261001-0200', 'shots')));
  assert.equal(readFileSync(path.join(notes, 'guest.md'), 'utf8'), before);
  assert.equal(JSON.parse(readFileSync(path.join(home, 'channel.json'), 'utf8')).resolved.length, 2);
});

test('retain keeps the newest N per checker plus open-card runs; prunes notes, channel and ledger', async () => {
  const { home, notes } = fixtureHome();
  const r = await retain({ home, keepRuns: 3, openRunIds: new Set(['20261003-0200']), notesDirs: [notes], now: NOW, log: () => {} });
  const left = (id) => existsSync(path.join(home, 'runs', id));
  // ui: newest 3 = live 1009, 1008, 1007; open: 1003 (caller), 1002 (ledger, not Done); 1001/1004/1005/1006 go
  for (const id of ['20261009-0300-live', '20261008-0200', '20261007-0200', '20261003-0200', '20261002-0200']) assert.ok(left(id), `${id} kept`);
  for (const id of ['20261001-0200', '20261004-0200', '20261005-0200', '20261006-0200']) assert.ok(!left(id), `${id} deleted`);
  // logic: 3 runs, all within keepRuns
  for (const id of ['20261001-0100-logic', '20261002-0100-logic', '20261003-0100-x']) assert.ok(left(id), `${id} kept`);
  assert.equal(r.runs.deleted.length, 4);
  assert.ok(r.runs.kept.some((k) => k.id === '20261003-0200' && k.why === 'open card'));

  const guest = readFileSync(path.join(notes, 'guest.md'), 'utf8');
  assert.ok(!guest.includes('old bullet, nothing open') && !guest.includes('continuation line'));
  assert.ok(!guest.includes('old run-id bullet'));
  assert.ok(guest.includes('still open') && guest.includes('recent bullet') && guest.includes('undated bullet stays'));
  const arch = readFileSync(path.join(notes, 'archive', 'guest.md'), 'utf8');
  assert.ok(arch.includes('- (2026-01-02) old bullet, nothing open\n  continuation line of the old bullet'));

  const ch = JSON.parse(readFileSync(path.join(home, 'channel.json'), 'utf8'));
  assert.deepEqual(ch.resolved.map((b) => b.by), ['LC-AUTH-03']);
  assert.deepEqual(ch.deferred.map((d) => d.blockedBy), ['LC-AUTH-03', 'LC-AUTH-01']); // pending ones always stay
  assert.equal(ch.blocks.length, 1);
  const ledger = JSON.parse(readFileSync(path.join(home, 'notion-cards.json'), 'utf8'));
  assert.deepEqual(Object.keys(ledger).sort(), ['fp-new-done', 'fp-open']);
});

test('the newest run of each checker survives keepRuns 0', async () => {
  const { home, notes } = fixtureHome();
  await retain({ home, keepRuns: 0, notesDirs: [notes], now: NOW, log: () => {} });
  assert.ok(existsSync(path.join(home, 'runs', '20261009-0300-live')));
  assert.ok(existsSync(path.join(home, 'runs', '20261003-0100-x')));
});
