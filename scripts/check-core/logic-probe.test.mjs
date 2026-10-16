// node --test scripts/check-core/logic-probe.test.mjs — scripts/logic-check/probe.mjs argument parsing (no stack) and the
// owner advisories it confirms (scripts/logic-check/lib/advisories.mjs: schema-valid, fixed fingerprints, filed once).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../logic-check/probe.mjs';
import { ADVISORIES, appendFindings, pendingAdvisories } from '../logic-check/lib/advisories.mjs';
import { fingerprint, validateFinding } from './lib/findings.mjs';

const ME = '{"api":{"persona":"logic.actor","method":"GET","path":"/api/me/"},"expect":{"status":200,"json":[["username","==","testuser4"]]}}';

test('probe parseArgs: --api / --api-file, run, mode, repo, keep-stack', () => {
  const o = parseArgs(['--api', ME, '--run', '20261017-0200-logic', '--keep-stack']);
  assert.deepEqual([o.api.api.path, o.run, o.mode, o.keepStack, o.repo], ['/api/me/', '20261017-0200-logic', null, true, null]);
  const f = parseArgs(['--api-file', 'x.json', '--mode', 'dev', '--repo', 'C:/w'], { readFile: (p) => (p === 'x.json' ? `\uFEFF${ME}` : '') });
  assert.deepEqual([f.api.expect.status, f.mode, f.repo], [200, 'dev', 'C:/w']);
  assert.equal(parseArgs(['--help']).help, true);
});

test('probe parseArgs refuses bad usage with one message', () => {
  assert.throws(() => parseArgs([]), /--api <json> or --api-file <file> is required/);
  assert.throws(() => parseArgs(['--api']), /--api needs a value/);
  assert.throws(() => parseArgs(['--api', ME, '--bogus']), /unknown argument --bogus/);
  assert.throws(() => parseArgs(['--api', ME, '--mode', 'live']), /--mode must be prod or dev/);
  assert.throws(() => parseArgs(['--api', '{nope']), /not JSON/);
  assert.throws(() => parseArgs(['--api', '{"persona":"guest","viewport":"phone-390","route":"/","expect":[]}']), /scripts\/ui-check\/probe\.mjs/);
  assert.throws(() => parseArgs(['--api', '{"api":{"persona":"admin","method":"GET","path":"/api/me/"},"expect":{"status":200}}']), /persona/);
});

test('probe CLI: usage exit 2 without an assertion, --help exit 0', () => {
  const cli = fileURLToPath(new URL('../logic-check/probe.mjs', import.meta.url));
  const bad = spawnSync(process.execPath, [cli], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /usage: node scripts\/logic-check\/probe\.mjs/);
  assert.equal(spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' }).status, 0);
});

test('owner advisories: valid logic findings with fixed fingerprints, filed only while uncarded', () => {
  for (const a of ADVISORIES) assert.deepEqual(validateFinding(a), [], a.title);
  assert.deepEqual(ADVISORIES.map(fingerprint), ['advisory|/api/signup|x-forwarded-for', 'advisory|/trivia/log-session|log-session-replay']);
  assert.deepEqual(ADVISORIES.map((a) => [a.severity, a.owner]), [['minor', 'ci'], ['minor', 'backend']]);
  assert.equal(pendingAdvisories({}).length, 2);
  assert.deepEqual(pendingAdvisories({ 'advisory|/api/signup|x-forwarded-for': { card: 'c', decision: 'skip:byHand' } }).map(fingerprint), ['advisory|/trivia/log-session|log-session-replay']);
  assert.deepEqual(appendFindings([{ a: 1 }], [{ b: 2 }]), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(appendFindings({ findings: [{ a: 1 }] }, [{ b: 2 }]), { findings: [{ a: 1 }, { b: 2 }] });
  assert.deepEqual(appendFindings(null, [{ b: 2 }]), [{ b: 2 }]);
});
