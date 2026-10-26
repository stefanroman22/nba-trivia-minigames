// node --test scripts/check-core/stack.test.mjs — what ensureStack records in stack.json for a port set (stackMeta /
// sameMeta): a reused Django that the helper did not start never gets the requested repo or relay key stamped on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { busyBuildOwner, sameMeta, stackMeta } from './lib/stack.mjs';

// Paths are spelled for the platform the test runs on (sameDir resolves them with the host's path rules): on
// Windows the "other spelling" is the drive-letter case and slash direction, elsewhere a `./` segment and a trailing slash.
const WIN = process.platform === 'win32';
const REPO = WIN ? 'C:\\w\\check-main' : '/w/check-main';
const REPO_ALT = WIN ? 'c:/w/check-main' : '/w/./check-main/'; // the same dir, other spelling
const ELSEWHERE = WIN ? 'C:\\w\\elsewhere' : '/w/elsewhere';
const ELSEWHERE_ALT = WIN ? 'C:/w/elsewhere' : '/w/elsewhere/';
const PHASE_B = WIN ? 'C:\\w\\checks-phase-b' : '/w/checks-phase-b';
const PHASE_B_ALT = WIN ? 'C:/w/checks-phase-b' : '/w/checks-phase-b/';

const ports = { django: 8400, socket: 4400, web: 5574 };
const base = { mode: 'prod', repo: REPO, ports, base: 'http://localhost:5574', api: 'http://localhost:8400/api', socket: 'http://localhost:4400', relayKey: 'k1', keepStack: false };

test('stackMeta: a Django started by the helper records the repo and relay key; a reused one records null for both', () => {
  const ours = stackMeta({ ...base, djangoOurs: true });
  assert.equal(ours.repo, base.repo);
  assert.equal(ours.relayKey, 'k1');
  const reused = stackMeta({ ...base, djangoOurs: false });
  assert.equal(reused.repo, null);
  assert.equal(reused.relayKey, null);
  assert.deepEqual({ ...reused, repo: base.repo, relayKey: 'k1' }, ours); // nothing else differs
});

test('sameMeta: unchanged meta is not rewritten; a repo / key / null change is', () => {
  const ours = stackMeta({ ...base, djangoOurs: true });
  const reused = stackMeta({ ...base, djangoOurs: false });
  assert.equal(sameMeta(ours, stackMeta({ ...base, repo: REPO_ALT, djangoOurs: true })), true); // same dir, other spelling
  assert.equal(sameMeta(reused, stackMeta({ ...base, repo: ELSEWHERE, djangoOurs: false })), true); // null = null
  assert.equal(sameMeta(ours, reused), false); // a once-ours stack now reused: the stale repo/key must go
  assert.equal(sameMeta(reused, ours), false); // a reused stack now started by us: record repo + key
  assert.equal(sameMeta(ours, stackMeta({ ...base, repo: PHASE_B, djangoOurs: true })), false);
  assert.equal(sameMeta(ours, stackMeta({ ...base, relayKey: 'k2', djangoOurs: true })), false);
  assert.equal(sameMeta({ ...ours, relayKey: undefined }, reused), false); // an old entry without the key fields: rewrite once
  assert.equal(sameMeta(null, ours), false);
  assert.equal(sameMeta(ours, { ...ours, api: 'http://localhost:8401/api' }), false);
});

test('busyBuildOwner: a live prod web server of ours on another port set from the same checkout blocks a second stack there', () => {
  const other = { django: 8300, socket: 4300, web: 5474 };
  const web = { name: 'web-5474', pid: 11, port: 5474, image: 'node.exe', repo: REPO_ALT, ports: other };
  const raw = { stacks: {}, started: [
    { name: 'django-8300', pid: 10, port: 8300, image: 'python.exe', repo: REPO_ALT, ports: other },
    web,
    { name: 'web-5674', pid: 12, port: 5674, image: 'node.exe', repo: ELSEWHERE_ALT, ports: { django: 8500, socket: 4500, web: 5674 } },
  ] };
  const alive = () => true;
  assert.equal(busyBuildOwner(raw, base.repo, ports, alive), web); // same dir, other spelling; only the web server counts
  assert.equal(busyBuildOwner(raw, base.repo, other, alive), null); // the same port set is a reuse, not a second stack
  assert.equal(busyBuildOwner(raw, PHASE_B_ALT, ports, alive), null); // another checkout has its own .next
  assert.equal(busyBuildOwner(raw, base.repo, ports, () => false), null); // a dead entry owns nothing
  assert.equal(busyBuildOwner(null, base.repo, ports, alive), null);
});
