// node --test scripts/check-core/check-run.test.mjs — the weekly orchestrator's pure parts (scripts/check-run.mjs).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkerResult, judgesPrompt, lastMatch, parseArgs, stepArgs, triagePrompt } from '../check-run.mjs';

const RUN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-run.mjs');

test('parseArgs: defaults are the PC task\'s port set and the checks-state store', () => {
  const o = parseArgs([]);
  assert.equal(o.ports, 'django=8210,socket=4210,web=5384');
  assert.equal(o.stateBranch, process.env.CHECKS_STATE_BRANCH || 'checks-state');
  assert.equal(o.notion, 'live'); assert.equal(o.slack, true); assert.equal(o.agents, true);
});

test('parseArgs: refuses main/dev as the store, bad ports, unknown args', () => {
  assert.throws(() => parseArgs(['--state-branch', 'main']), /never main or dev/);
  assert.throws(() => parseArgs(['--state-branch', 'dev']), /never main or dev/);
  assert.throws(() => parseArgs(['--ports', '8200']), /--ports/);
  assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  assert.throws(() => parseArgs(['--slack', 'maybe']), /on\|off/);
});

test('stepArgs: the full run is the old check-run.ps1 command lines', () => {
  const s = stepArgs(parseArgs([]));
  assert.deepEqual(s.logic, ['scripts/logic-check/run.mjs', '--suite', 'all', '--ref', 'main', '--live', '--keep-stack', '--ports', 'django=8210,socket=4210,web=5384']);
  assert.deepEqual(s.ui, ['scripts/ui-check/run.mjs', '--suite', 'all', '--ref', 'main', '--keep-stack', '--ports', 'django=8210,socket=4210,web=5384']);
  assert.deepEqual(s.uiLive, ['scripts/ui-check/run.mjs', '--live']);
  assert.deepEqual(s.push('r1', 'ui'), ['scripts/check-core/notion-push.mjs', '--run', 'r1', '--checker', 'ui', '--target', 'main']);
  assert.deepEqual(s.summary('st.json'), ['scripts/check-core/lib/check-summary.mjs', '--state', 'st.json', '--post']);
});

test('stepArgs: a smoke run (CI verification) narrows the suites, dries Notion and keeps Slack quiet', () => {
  const s = stepArgs(parseArgs(['--logic-suite', 'pages', '--ui-suite', 'guest', '--ui-vp', 'desktop-1366', '--notion', 'dry', '--slack', 'off', '--ports', 'django=8300,socket=4300,web=5474']));
  assert.deepEqual(s.logic, ['scripts/logic-check/run.mjs', '--suite', 'pages', '--ref', 'main', '--keep-stack', '--ports', 'django=8300,socket=4300,web=5474']);
  assert.ok(s.ui.includes('--vp') && s.ui.includes('desktop-1366'));
  assert.ok(s.push('r', 'logic').includes('--dry-run'));
  assert.ok(!s.summary('x').includes('--post'));
  assert.equal(stepArgs(parseArgs(['--ui-suite', 'none', '--ui-live', 'off'])).ui, null);
});

test('checkerResult and lastMatch read the run id, digest and FAIL count', () => {
  const lines = ['logic-check: run 20261018-0200-logic · mode prod', 'x', 'logic-check: digest /h/runs/20261018-0200-logic/digest.md'];
  const r = checkerResult('logic', lines, 1, () => true, () => '# d\n## FAIL a\n## PASS b\n## FAIL c\n');
  assert.deepEqual(r, { id: '20261018-0200-logic', code: 1, digest: '/h/runs/20261018-0200-logic/digest.md', runDir: path.dirname('/h/runs/20261018-0200-logic/digest.md'), fails: 2 });
  assert.equal(checkerResult('ui', ['nothing'], 2).fails, -1);
  assert.equal(lastMatch(['a 1', 'a 2'], /^a (\d)/)[1], '2');
});

test('agent prompts name the run and leave the scripted steps to check-run.mjs', () => {
  const run = { id: 'r1', runDir: '/d/r1' };
  assert.match(triagePrompt(run, 'django=1,socket=2,web=3'), /step 2 \(Triage\).*runId r1.*scripts\/check-run\.mjs runs those/);
  assert.match(judgesPrompt(run, 'p'), /steps 2 and 3 of the ui-check skill.*--run r1 --validate/);
});

test('--dry-run prints the plan and runs nothing', () => {
  const r = spawnSync(process.execPath, [RUN, '--dry-run', '--no-state', '--ports', 'django=8300,socket=4300,web=5474'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /check-run \(dry run\) - nothing is executed/);
  assert.match(r.stdout, /store {4}off/);
  assert.match(r.stdout, /3a\. node scripts\/logic-check\/run\.mjs --suite all --ref main --live --keep-stack --ports django=8300/);
  assert.match(r.stdout, /6d\. remove /);
});
