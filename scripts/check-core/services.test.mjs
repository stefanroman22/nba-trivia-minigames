// node --test scripts/check-core/services.test.mjs — services column parser, family lookup, the real ui-check
// CHECKS.md, and the no-overlap lint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SERVICES, UI_CHECKS_MD, parseServices, servicesOf, checksForServices, overlapErrors, isService, loadServiceMaps } from './lib/services.mjs';

const MD = `# x

| ID | services | live | proves |
|---|---|---|---|
| \`G-MODAL-01\` | pages, leaderboard |  | modals |
| \`G-NAV-01\` | \`pages\` | ✓ | nav |

| ID | services | proves |
|---|---|---|
| \`GM-<game>-<scenario>\` | games.<game>, game-data | scenarios |
| \`GM-<game>-adapter\` | games.<game> | no adapter |
| \`GM-LATENCY-<game>\` | games.<game>,game-data | latency |
| \`GM-SHELL-01\` | game-data | shell |
| \`ST-SNAP\` | - | selftest |

| suite | prefix | owns |
|---|---|---|
| guest | \`G-\` | not a check row |
`;

test('taxonomy is exactly the spec list', () => {
  assert.deepEqual(SERVICES, ['pages', 'auth', 'signup', 'profile', 'friends', 'leaderboard', 'game-data', 'rooms', 'matchmaking', 'relay']);
  assert.ok(isService('games.wordle') && isService('games.who-would-win') && !isService('games.') && !isService('auths'));
});

test('parseServices reads the services column of every table, backticks and spaces ignored', () => {
  const m = parseServices(MD);
  assert.deepEqual(m.get('G-MODAL-01'), ['pages', 'leaderboard']);
  assert.deepEqual(m.get('G-NAV-01'), ['pages']);
  assert.deepEqual(m.get('GM-<game>-<scenario>'), ['games.<game>', 'game-data']);
  assert.deepEqual(m.get('ST-SNAP'), []);
  assert.equal(m.size, 7);
});

test('parseServices throws on a row without services, a table without the column, unknown names, "-" on a product row', () => {
  assert.throws(() => parseServices('| ID | services | proves |\n|---|---|---|\n| `G-X-01` |  | x |\n'), /G-X-01: services cell is empty/);
  assert.throws(() => parseServices('| ID | proves |\n|---|---|\n| `AC-X-01` | x |\n'), /AC-X-01: its table has no services column/);
  assert.throws(() => parseServices('| ID | services |\n|---|---|\n| `MP-X-01` | rooms, sockets |\n'), /unknown service\(s\) sockets/);
  assert.throws(() => parseServices('| ID | services |\n|---|---|\n| `LC-X-01` | - |\n'), /only for ST-\/ACCEPT rows/);
  assert.deepEqual(parseServices('| ID | services |\n|---|---|\n| `LC-ST-GUARD` | - |\n').get('LC-ST-GUARD'), []); // Logic selftests
  assert.throws(() => parseServices('| ID | services |\n|---|---|\n| `G-X-01` | games.<game> |\n'), /needs a <game> placeholder/);
});

test('servicesOf: exact rows, families by most literal characters, games.<game> filled in', () => {
  const m = parseServices(MD);
  assert.deepEqual(servicesOf('G-MODAL-01', [m]), ['pages', 'leaderboard']);
  assert.deepEqual(servicesOf('GM-wordle-perfect', [m]), ['games.wordle', 'game-data']);
  assert.deepEqual(servicesOf('GM-who-would-win-daily-lock', [m]), ['games.who-would-win', 'game-data']);
  assert.deepEqual(servicesOf('GM-career-path-adapter', [m]), ['games.career-path']);
  assert.deepEqual(servicesOf('GM-LATENCY-wordle', [m]), ['games.wordle', 'game-data']);
  assert.deepEqual(servicesOf('GM-SHELL-01', [m]), ['game-data']);
  assert.equal(servicesOf('G-NOPE-01', [m]), null);
});

test('checksForServices: plain hits return the row; a blocked game narrows a family to it', () => {
  const m = parseServices(MD);
  assert.deepEqual(checksForServices(['leaderboard'], [m]), ['G-MODAL-01']);
  assert.deepEqual(checksForServices(new Set(['game-data']), [m]), ['GM-<game>-<scenario>', 'GM-LATENCY-<game>', 'GM-SHELL-01']);
  assert.deepEqual(checksForServices(['games.wordle'], [m]), ['GM-wordle-<scenario>', 'GM-wordle-adapter', 'GM-LATENCY-wordle']);
});

test('the real ui-check CHECKS.md has services on every row', () => {
  const m = parseServices(readFileSync(UI_CHECKS_MD, 'utf8'));
  for (const id of ['G-MODAL-01', 'AC-LOGIN-01', 'GM-<game>-<scenario>', 'MP-ROOM-01', 'ST-SNAP', 'ACCEPT']) assert.ok(m.has(id), id);
  assert.deepEqual(m.get('AC-LOGIN-01'), ['auth']);
  assert.deepEqual(servicesOf('GM-wordle-perfect', [m]), ['games.wordle', 'game-data']);
  for (const [id, list] of m) if (!/^(ST-|ACCEPT)/.test(id)) assert.ok(list.length, `${id} has services`);
  assert.ok(loadServiceMaps().length >= 1); // the logic catalogue may not exist yet: not an error
});

test('no-overlap lint: LC specs never call audit.layout/motion/a11y/perf; UI specs never import the logic lib', () => {
  const lc = "test('[LC-PAGES-01] x', async ({ audit }) => {\n  await audit.layout(page);\n  await audit . motion (x);\n  audit.timing('a');\n});";
  const e = overlapErrors(lc, { checker: 'logic', file: 'pages.spec.mjs' });
  assert.equal(e.length, 2);
  assert.match(e[0], /pages\.spec\.mjs:2 calls audit\.layout\(\)/);
  assert.match(e[1], /:3 calls audit\.motion\(\)/);
  assert.deepEqual(overlapErrors("import { api } from '../lib/api.mjs';\nawait lc.done();", { checker: 'logic' }), []);
  const ui = "import { test } from '../../lib/fixtures.mjs';\nimport { call } from '../../../logic-check/lib/api.mjs';\nconst s = await import('../../../logic-check/lib/socket.mjs');";
  const u = overlapErrors(ui, { checker: 'ui', file: 'surfaces.spec.mjs' });
  assert.equal(u.length, 2);
  assert.match(u[0], /surfaces\.spec\.mjs:2 imports \.\.\/\.\.\/\.\.\/logic-check\/lib\/api\.mjs/);
  assert.deepEqual(overlapErrors("await audit.layout(page);", { checker: 'ui' }), []);
});
