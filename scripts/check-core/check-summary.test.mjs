// node --test scripts/check-core/check-summary.test.mjs — the nightly run's one Slack line (check-run.ps1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { duration, summaryLine } from './lib/check-summary.mjs';
import { LINE_MAX } from './lib/slack-line.mjs';
import { defer } from './lib/channel.mjs';

test('duration formats seconds', () => {
  assert.deepEqual([duration(40), duration(720), duration(6125), duration(-3)], ['40s', '12m', '1h 42m', '0s']);
});

test('summaryLine: cards per checker, blocks, resolved, deferred, run ids, duration — one line', () => {
  const line = summaryLine({
    startedAt: '2026-10-17T00:00:00Z', endedAt: '2026-10-17T01:42:05Z',
    runs: { logicCatchUp: '20261017-0201-logic', uiCatchUp: '20261017-0210', logic: '20261017-0215-logic', ui: '20261017-0240', uiLive: '20261017-0400-live' },
    exits: { logicCatchUp: 0, uiCatchUp: 0, logic: 1, ui: 1, uiLive: 0 },
    cards: { logic: { new: 2, regression: 1, skipped: 3, errors: 0 }, ui: { new: 4, regression: 0, skipped: 1, errors: 1 } },
    blocks: { new: 3, kept: 2 }, resolved: 1, notes: ['triage needed (no claude on PATH): C:/h/runs/x/digest.md'],
  }, { deferred: 5 });
  assert.equal(line, 'nba-checks 1h 42m · catch-up logic 20261017-0201-logic exit 0, ui 20261017-0210 exit 0 · logic 20261017-0215-logic exit 1: 3 card(s) created (1 regression), 3 block(s) written (+2 kept) · ui 20261017-0240 exit 1 + live 20261017-0400-live exit 0: 4 card(s) created, 1 push error(s) · resolved 1 · deferred 5 · triage needed (no claude on PATH): C:/h/runs/x/digest.md');
  assert.ok(!line.includes('\n'));
});

test('summaryLine: an empty night and a capped long line', () => {
  assert.equal(summaryLine({ durationSec: 30 }), 'nba-checks 30s · logic not run: no cards pushed, 0 block(s) written · ui not run + live not run: no cards pushed · resolved 0 · deferred 0');
  assert.equal(summaryLine({ durationSec: 1, notes: ['x'.repeat(800)] }).length, LINE_MAX);
});

test('CLI reads the state file and the pending deferrals of channel.json', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'summary-'));
  defer({ checkId: 'AC-LOGIN-01', blockedBy: 'LC-AUTH-01' }, { file: path.join(home, 'channel.json') });
  const state = path.join(home, 'state.json');
  writeFileSync(state, '\uFEFF' + JSON.stringify({ durationSec: 61, runs: { logic: 'r1' }, exits: { logic: 0 } }));
  const cli = fileURLToPath(new URL('./lib/check-summary.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [cli, '--state', state, '--home', home], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'nba-checks 1m · logic r1 exit 0: no cards pushed, 0 block(s) written · ui not run + live not run: no cards pushed · resolved 0 · deferred 1');
  assert.equal(spawnSync(process.execPath, [cli], { encoding: 'utf8' }).status, 2);
});

test('summaryLine: checks dropped as check bugs are named as unverified, with their cards', () => {
  const line = summaryLine({
    durationSec: 60,
    cards: { checkBugs: { new: 2, seen: 1, errors: 0 } },
    unverified: { checks: ['LC-GAMEDATA-02', 'AC-LOGIN-01', 'AC-PROFILE-02'] },
  });
  assert.ok(line.includes(' · UNVERIFIED 3 check(s) (LC-GAMEDATA-02, AC-LOGIN-01, AC-PROFILE-02): 2 new check-bug card(s), 1 still open'), line);
  assert.ok(!summaryLine({ durationSec: 60, unverified: { checks: [] } }).includes('UNVERIFIED'));
});
