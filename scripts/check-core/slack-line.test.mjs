// node --test scripts/check-core/slack-line.test.mjs — one-line Slack posts with an injected runner (no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LINE_MAX, oneLine, postLine } from './lib/slack-line.mjs';

test('oneLine squeezes newlines and caps the length', () => {
  assert.equal(oneLine('logic-check 3 FAIL\n  auth blocked\n'), 'logic-check 3 FAIL · auth blocked');
  assert.equal(oneLine('x'.repeat(1000)).length, LINE_MAX);
});

test('postLine calls slack.mjs post-text once and never throws', () => {
  const calls = [];
  const ok = postLine('nightly: logic 0 fail\nui 2 fail', { run: (a) => { calls.push(a); return { status: 0 }; }, log: () => {} });
  assert.deepEqual(calls, [['post-text', 'general', 'nightly: logic 0 fail · ui 2 fail']]);
  assert.equal(ok.ok, true);
  const logs = [];
  const bad = postLine('x', { channel: 'C123', run: () => ({ status: 1, stderr: 'boom\nSLACK_BOT_TOKEN missing' }), log: (m) => logs.push(m) });
  assert.deepEqual([bad.ok, bad.error], [false, 'SLACK_BOT_TOKEN missing']);
  assert.equal(postLine('x', { run: () => { throw new Error('spawn failed'); }, log: () => {} }).ok, false);
  assert.equal(postLine('y', { dryRun: true, run: () => assert.fail('no post in dry run'), log: () => {} }).dryRun, true);
  assert.equal(postLine('  ', { run: () => assert.fail('no post'), log: () => {} }).ok, false);
});
