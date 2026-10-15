// node --test scripts/check-core/channel.test.mjs — block / defer / resolve on a temp channel.json with fake
// isDone (Notion) and isOnMain (git) lookups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { block, blockFor, blockedServices, defer, readChannel, resolve, writeChannel } from './lib/channel.mjs';

const tmp = () => ({ file: path.join(mkdtempSync(path.join(os.tmpdir(), 'channel-')), 'channel.json') });

test('a missing or broken file reads as an empty channel', () => {
  const o = tmp();
  assert.deepEqual(readChannel(o), { blocks: [], deferred: [], resolved: [] });
  writeFileSync(o.file, '{not json');
  assert.deepEqual(readChannel(o), { blocks: [], deferred: [], resolved: [] });
  writeChannel({ blocks: [{ service: 'auth', by: 'LC-AUTH-01' }] }, o);
  assert.deepEqual(readChannel(o).deferred, []);
});

test('block is idempotent per (service, by) and keeps since', () => {
  const o = tmp();
  const a = block({ service: 'auth', by: 'LC-AUTH-01', finding: 'F1', card: 'c1', runId: 'r1' }, { ...o, now: '2026-10-16T02:00:00Z' });
  const b = block({ service: 'auth', by: 'LC-AUTH-01', finding: 'F1', card: 'c1', runId: 'r2' }, { ...o, now: '2026-10-17T02:00:00Z' });
  block({ service: 'signup', by: 'LC-AUTH-01', card: 'c1' }, o);
  block({ service: 'auth', by: 'LC-AUTH-03', card: 'c2' }, { ...o, now: '2026-10-17T03:00:00Z' });
  assert.equal(a.added, true);
  assert.equal(b.added, false);
  const c = readChannel(o);
  assert.equal(c.blocks.length, 3);
  assert.equal(c.blocks[0].since, '2026-10-16T02:00:00.000Z');
  assert.equal(c.blocks[0].runId, 'r2');
  assert.deepEqual([...blockedServices(o)].sort(), ['auth', 'signup']);
  assert.equal(blockFor('auth', o).by, 'LC-AUTH-01');
  assert.equal(blockFor('rooms', o), null);
  assert.throws(() => block({ service: 'auth' }, o), /needs \{ service, by \}/);
});

test('defer is idempotent per (checker, checkId, project, blockedBy)', () => {
  const o = tmp();
  defer({ checker: 'ui', checkId: 'AC-LOGIN-01', project: 'account@phone-390', blockedBy: 'LC-AUTH-01', service: 'auth', runId: 'r1' }, o);
  const again = defer({ checker: 'ui', checkId: 'AC-LOGIN-01', project: 'account@phone-390', blockedBy: 'LC-AUTH-01', runId: 'r2' }, o);
  defer({ checker: 'ui', checkId: 'AC-LOGIN-01', project: 'account@desktop-1366', blockedBy: 'LC-AUTH-01' }, o);
  assert.equal(again.added, false);
  assert.equal(readChannel(o).deferred.length, 2);
  assert.equal(readChannel(o).deferred[0].service, 'auth');
});

test('resolve: Done + commit on main resolves; open card, unshipped commit and lookup errors keep the block', async () => {
  const o = tmp();
  block({ service: 'auth', by: 'LC-AUTH-01', card: 'done-main' }, o);
  block({ service: 'signup', by: 'LC-AUTH-01', card: 'done-main' }, o);
  block({ service: 'friends', by: 'LC-FRIENDS-02', card: 'open' }, o);
  block({ service: 'profile', by: 'LC-PROFILE-01', card: 'done-dev' }, o);
  block({ service: 'rooms', by: 'LC-ROOMS-01', card: 'boom' }, o);
  block({ service: 'leaderboard', by: 'LC-GAMEDATA-02', card: 'by-hand' }, o);
  defer({ checkId: 'AC-LOGIN-01', project: 'account@phone-390', blockedBy: 'LC-AUTH-01' }, o);
  defer({ checkId: 'AC-SIGNUP-02', project: 'account@phone-390', blockedBy: 'LC-AUTH-01' }, o);
  defer({ checkId: 'AC-SIGNUP-02', project: 'account@phone-390', blockedBy: 'LC-PROFILE-01' }, o); // still blocked
  defer({ checkId: 'AC-SURF-02', project: 'account@phone-390', blockedBy: 'LC-FRIENDS-02' }, o);
  defer({ checkId: 'G-MODAL-01', project: 'guest@phone-390', blockedBy: 'LC-GAMEDATA-02' }, o);
  const cards = { 'done-main': { done: true, commit: 'aaa' }, open: { done: false }, 'done-dev': { done: true, commit: 'bbb' }, 'by-hand': true };
  const asked = [];
  const r = await resolve({
    isDone: async (card) => { if (card === 'boom') throw new Error('notion down\nstack'); return cards[card]; },
    isOnMain: (sha) => { asked.push(sha); return sha === 'aaa'; },
  }, { ...o, now: '2026-10-18T02:00:00Z' });
  assert.deepEqual(asked.sort(), ['aaa', 'bbb']);
  assert.deepEqual(r.resolved.map((b) => `${b.service}:${b.how}`).sort(), ['auth:fix on main', 'leaderboard:closed without commit', 'signup:fix on main']);
  assert.deepEqual(r.catchUp.logic.sort(), ['auth', 'leaderboard', 'signup']);
  assert.deepEqual(r.catchUp.ui.sort(), ['AC-LOGIN-01', 'G-MODAL-01']); // AC-SIGNUP-02 still waits on LC-PROFILE-01
  assert.deepEqual(r.errors, [{ card: 'boom', error: 'notion down' }]);
  const c = readChannel(o);
  assert.deepEqual(c.blocks.map((b) => b.service).sort(), ['friends', 'profile', 'rooms']);
  assert.equal(c.resolved.length, 3);
  assert.equal(c.resolved[0].resolvedAt, '2026-10-18T02:00:00.000Z');
  assert.equal(c.deferred.filter((d) => d.resolvedAt).length, 3);
  // a second resolve with nothing new changes nothing
  const r2 = await resolve({ isDone: (card) => cards[card] || { done: false }, isOnMain: () => false }, o);
  assert.deepEqual(r2.resolved, []);
  assert.deepEqual(r2.catchUp, { ui: [], logic: [] });
  assert.ok(readFileSync(o.file, 'utf8').endsWith('\n'));
});
