// node --test scripts/check-core/findings-logic.test.mjs — the findings schema's Logic Check forms: checker, logic
// suites/personas, `lc` check criteria, API assertions; and that clusters / REPORT.md / cards handle them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, checkLabel, describeAssertion, mergeFindings, parseAssertion, validateFinding } from './lib/findings.mjs';
import { planClusters } from './lib/clusters.mjs';
import { renderBody } from './lib/card-body.mjs';

const API = { api: { persona: 'guest', method: 'POST', path: '/api/signup/', body: { username: 'lgc12345', email: 'lgc12345@uicheck.test', password: 'short' } },
  expect: { status: 400, json: [['error', '==', 'password_too_short']] } };
const logicFinding = () => ({
  checker: 'logic', rule: 'signup-matrix', title: 'Sign-up accepts a 5-character password', severity: 'major', category: 'data', owner: 'backend',
  suite: 'signup', persona: 'guest', where: { route: '/api/signup/', viewports: ['api'], selector: 'POST /api/signup/ password' },
  current: '201 Created', expected: '400 password_too_short', evidence: { checkId: 'LC-SIGNUP-03', metrics: ['status 201'], shots: [] },
  files: [{ path: 'backend/users/views.py', why: 'signup_view skips validate_password' }], fix: { change: ['run validate_password'] },
  acceptance: { checks: [{ lc: 'LC-SIGNUP-03', projects: ['api'] }, { lc: 'LC-SIGNUP-00' }], assertions: [API], criteria: ['short passwords are refused'] },
  id: 'UIC-20261016-0200-logic-001', fingerprint: 'signup-matrix|/api/signup|POST /api/signup/ password',
});

test('a Logic finding with lc checks and an API assertion is valid', () => {
  assert.deepEqual(validateFinding(logicFinding()), []);
});

test('bad lc / api forms are named precisely', () => {
  const f = logicFinding();
  f.acceptance.checks = [{ lc: 'G-NAV-01' }, { lc: 'LC-X-01', projects: ['guest@phone-390'] }, { lc: 'LC-X-02', id: 'G-NAV-01' }, { id: 'LC-X-03', projects: ['api'] }];
  const e = validateFinding(f).join('\n');
  assert.match(e, /acceptance\.checks\[0\]\.lc: "G-NAV-01" does not match/);
  assert.match(e, /acceptance\.checks\[1\]\.projects\[0\]: must be one of live, pages, api, rooms/);
  assert.match(e, /acceptance\.checks\[2\]\.id: unknown field/);
  assert.match(e, /acceptance\.checks\[3\]\.id: "LC-X-03" does not match/);
  const g = logicFinding();
  g.checker = 'robot';
  g.acceptance.assertions = [{ ...API, api: { ...API.api, persona: 'solo' } }];
  const e2 = validateFinding(g).join('\n');
  assert.match(e2, /checker: must be one of ui, logic/);
  assert.match(e2, /acceptance\.assertions\[0\]\.api\.persona: must be one of guest, logic\.actor/);
  assert.throws(() => parseAssertion({ ...API, expect: { status: 400, json: [['a', 'like', 1]] } }), /operator must be one of/);
  assert.deepEqual(parseAssertion(API), { kind: 'api', api: API.api, expect: API.expect });
  assert.match(describeAssertion(API), /^api guest · POST `\/api\/signup\/`/);
});

test('UI check criteria keep their exact form and messages', () => {
  const f = logicFinding();
  f.acceptance.checks = [{ id: 'G-MOTION-02', projects: ['guest@phone-999'] }];
  assert.match(validateFinding(f).join('\n'), /acceptance\.checks\[0\]\.projects\[0\]: "guest@phone-999" does not match/);
});

test('clusters, REPORT.md and the card body handle lc checks and API assertions', () => {
  const [f] = mergeFindings([logicFinding()]).map((x) => ({ ...x, id: 'UIC-20261016-0200-logic-001' }));
  const clusters = planClusters([f], { perfIds: [] });
  assert.deepEqual(clusters[0].keys, ['f:backend/users/views.py', 'c:LC-SIGNUP-03', 'c:LC-SIGNUP-00']);
  assert.equal(clusters[0].engine, 'backend-engine');
  const md = buildReport({ runId: '20261016-0200-logic', findings: [{ ...f, guards: [checkLabel('LC-SIGNUP-00', null)] }], results: [{ checkId: 'LC-SIGNUP-03', suite: 'signup', project: 'api', status: 'failed', title: '[LC-SIGNUP-03] x' }] });
  assert.ok(md.includes('- check `LC-SIGNUP-03` passes on api'));
  assert.ok(md.includes('- check `LC-SIGNUP-00` passes on its project — guard (passes before fix)'));
  assert.ok(md.includes('- assertion #1: api guest · POST `/api/signup/`'));
  assert.match(md, /\| severity \| guest \| account \| games \| multiplayer \| signup \| total \|/);
  const { markdown } = renderBody(clusters[0], { checker: 'logic', runId: '20261016-0200-logic', runDir: '/runs/x' });
  assert.ok(markdown.includes('- check LC-SIGNUP-03 @ api passes'));
  assert.ok(markdown.includes('- check LC-SIGNUP-00 passes'));
  assert.ok(markdown.includes('- verify: node scripts/ui-check/verify.mjs UIC-20261016-0200-logic-001 --run 20261016-0200-logic'));
});
