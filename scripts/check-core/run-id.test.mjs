// node --test scripts/check-core/run-id.test.mjs — run ids of the checkers (scripts/ui-check/lib/run-id.mjs): two runs in
// one minute never refuse each other (the nightly catch-up then the full Logic run, a selftest in the same minute), a
// selftest-only invocation never writes a run dir, and `latest` only ever names a real UI check run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = mkdtempSync(path.join(os.tmpdir(), 'run-id-'));
process.env.UI_CHECK_HOME = home;
delete process.env.UI_CHECK_RUN;
delete process.env.UI_CHECK_CHECKER;
const { freshRunId, isolateSelftest, isRunId, runDir, runId } = await import('../ui-check/lib/run-id.mjs');

const at = new Date(2026, 9, 16, 9, 7, 30);
const withEnv = (env, fn) => {
  const keep = { UI_CHECK_RUN: process.env.UI_CHECK_RUN, UI_CHECK_CHECKER: process.env.UI_CHECK_CHECKER };
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
};
const used = (id) => { mkdirSync(path.join(home, 'runs', id), { recursive: true }); writeFileSync(path.join(home, 'runs', id, 'results.json'), '[]'); };

test('freshRunId: the minute id when free; a used one moves to the next free minute; a caller-set id is kept (preset)', () => {
  withEnv({ UI_CHECK_RUN: undefined, UI_CHECK_CHECKER: 'logic' }, () => {
    assert.deepEqual(freshRunId('-logic', { now: at }), { id: '20261016-0907-logic', preset: false });
  });
  used('20261016-0907-logic'); // a catch-up run (or a selftest) finished in this minute
  withEnv({ UI_CHECK_RUN: undefined, UI_CHECK_CHECKER: 'logic' }, () => {
    assert.deepEqual(freshRunId('-logic', { now: at }), { id: '20261016-0908-logic', preset: false });
    assert.equal(process.env.UI_CHECK_RUN, '20261016-0908-logic'); // the children inherit it
  });
  used('20261016-0908-logic');
  withEnv({ UI_CHECK_RUN: undefined, UI_CHECK_CHECKER: 'logic' }, () => {
    assert.equal(freshRunId('-logic', { now: at }).id, '20261016-0909-logic');
  });
  withEnv({ UI_CHECK_RUN: '20261016-0907-logic', UI_CHECK_CHECKER: 'logic' }, () => {
    assert.deepEqual(freshRunId('-logic', { now: at }), { id: '20261016-0907-logic', preset: true }); // run.mjs refuses this one
  });
});

test('isolateSelftest: only a selftest-only invocation goes to <home>/selftest/; a caller-set id or other projects stay', () => {
  withEnv({ UI_CHECK_RUN: undefined }, () => {
    assert.equal(isolateSelftest(['node', 'cli.js', 'test', '-c', 'scripts/ui-check', '--project', 'selftest']), true);
    assert.match(process.env.UI_CHECK_RUN, /^\.\.\/selftest\/\d{8}-\d{6}$/);
    assert.equal(path.dirname(runDir()), path.join(home, 'selftest'));
  });
  withEnv({ UI_CHECK_RUN: undefined }, () => {
    assert.equal(isolateSelftest(['node', 'cli.js', 'test', '--project=selftest', '--project', 'live']), false);
    assert.equal(isolateSelftest(['node', 'cli.js', 'test']), false);
    assert.equal(process.env.UI_CHECK_RUN, undefined);
  });
  withEnv({ UI_CHECK_RUN: '20261016-0907' }, () => assert.equal(isolateSelftest(['x', '--project', 'selftest']), false));
});

test('latest: moved by a real UI run id only — never by a Logic run, a selftest or a verify/probe scratch run', () => {
  const latest = path.join(home, 'latest');
  const read = () => (existsSync(latest) ? readFileSync(latest, 'utf8').trim() : null);
  withEnv({ UI_CHECK_RUN: '20261016-0906', UI_CHECK_CHECKER: undefined }, () => runId());
  assert.equal(read(), '20261016-0906');
  for (const id of ['20261016-0907-logic', '../selftest/20261016-090712', '20261016-0906/verify/pw-x-checks-1', '../adhoc/20261016-0907/verify/pw-x-logic']) {
    withEnv({ UI_CHECK_RUN: id, UI_CHECK_CHECKER: id.endsWith('-logic') ? 'logic' : undefined }, () => runId());
    assert.equal(read(), '20261016-0906', id);
  }
  withEnv({ UI_CHECK_RUN: '20261016-0910-live', UI_CHECK_CHECKER: undefined }, () => runId());
  assert.equal(read(), '20261016-0910-live');
  assert.equal(isRunId('20261014-1153x'), true);
  assert.equal(isRunId('explore'), false);
});
