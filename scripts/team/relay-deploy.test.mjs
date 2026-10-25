// node --test scripts/team/relay-deploy.test.mjs — the pure parts of relay-deploy.mjs: which Vercel status gates the
// relay, how a new instance is told from the old one, and the report line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { frontendState, isNewInstance, reportLine } from './relay-deploy.mjs';

test('frontendState reads the newest nba-minigames Vercel status only', () => {
  assert.equal(frontendState([]), null);
  assert.equal(frontendState([{ context: 'Vercel – backend', state: 'success' }]), null);
  assert.equal(frontendState([{ context: 'Vercel – nba-minigames', state: 'pending' }, { context: 'Vercel – nba-minigames', state: 'success' }]), 'pending');
  assert.equal(frontendState([{ context: 'Vercel – nba-minigames', state: 'success' }]), 'success');
  assert.equal(frontendState([{ context: 'Vercel - nba-minigames', state: 'error' }]), 'failure');
});

test('isNewInstance: only an instance younger than the deploy counts', () => {
  const since = 1_000_000, now = since + 120_000;
  assert.equal(isNewInstance({ ok: true, uptimeS: 30 }, since, now), true);
  assert.equal(isNewInstance({ ok: true, uptimeS: 403394 }, since, now), false);
  assert.equal(isNewInstance({ ok: false, uptimeS: 3 }, since, now), false);
  assert.equal(isNewInstance(null, since, now), false);
});

test('reportLine names the commit, the run and what happened', () => {
  assert.equal(reportLine({ ok: true, sha: 'abcdef1234', runUrl: 'https://x/run/1', uptimeS: 41 }), '🚀 relay deployed (abcdef1 · https://x/run/1): new instance up, uptime 41s');
  assert.match(reportLine({ ok: true, sha: 'abcdef1234', liveRooms: 2 }), /deployed with 2 live room\(s\) after the idle wait/);
  assert.equal(reportLine({ ok: false, sha: 'abcdef1234', error: 'the RAILWAY_TOKEN secret is not set' }), '❌ relay NOT deployed (abcdef1): the RAILWAY_TOKEN secret is not set');
});
