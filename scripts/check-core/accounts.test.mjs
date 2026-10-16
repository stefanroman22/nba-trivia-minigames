// node --test scripts/check-core/accounts.test.mjs — the shared test-user registry (spec §4): roles, the ui.solo pool,
// throwaway names; no database (the mint ops are covered by mint_tokens.py against a local sqlite only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCOUNTS, ROLES, credentials, isTestUsername, soloUsername, userForRole } from './lib/accounts.mjs';

test('roles map to exclusive users', () => {
  assert.deepEqual(ROLES, { 'ui.host': 'testuser1', 'ui.joiner': 'testuser2', 'ui.solo': 'testuser3', 'logic.actor': 'testuser4', 'logic.peer': 'testuser5', 'logic.admin': 'testuser6' });
  assert.equal(new Set(Object.values(ROLES)).size, Object.keys(ROLES).length);
  for (const u of Object.values(ROLES)) assert.ok(ACCOUNTS[u], `${u} is a persistent account`);
});

test('userForRole: fixed roles, the ui.solo pool per worker, unknown roles throw', () => {
  assert.equal(userForRole('logic.actor'), 'testuser4');
  assert.equal(userForRole('logic.admin'), 'testuser6');
  assert.equal(userForRole('ui.solo'), 'testuser3');
  assert.equal(userForRole('ui.solo', 7), 'testuser3w7');
  assert.equal(userForRole('ui.solo', 3), soloUsername(3));
  assert.throws(() => userForRole('logic.ghost'), /unknown test-user role "logic.ghost"/);
});

test('isTestUsername: testuser1-6 (+w workers), uic/lgc throwaways; nothing else', () => {
  for (const u of ['testuser1', 'testuser6', 'testuser3w15', 'uic20261016123401', 'lgc2026101612340', 'lgc1234']) assert.ok(isTestUsername(u), u);
  for (const u of ['testuser', 'testuser3w123', 'lgc123', 'lgc123456789012345678', 'lgcabc1234', 'admin', 'Stefan', 'xlgc12345']) assert.ok(!isTestUsername(u), u);
});

test('credentials refuse a non-test username before touching accounts.json', () => {
  assert.throws(() => credentials('stefan'), /unknown test account "stefan"/);
});
