// node --test scripts/check-core/channel-cli.test.mjs — channel.mjs's CLI (block, block-run, resolve --fake) on a temp
// home (--home), and planBlocks / servicesToBlock with fixture runs. No Notion, no git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { block, catchUpLogicIds, defer, planBlocks, readChannel, servicesToBlock } from './lib/channel.mjs';

const CLI = fileURLToPath(new URL('./lib/channel.mjs', import.meta.url));
const tmpHome = () => mkdtempSync(path.join(os.tmpdir(), 'channel-cli-'));
const run = (home, ...args) => {
  const r = spawnSync(process.execPath, [CLI, ...args, '--home', home], { encoding: 'utf8' });
  return { code: r.status, out: r.stdout.trim().split(/\r?\n/), err: r.stderr.trim() };
};
const MAPS = [new Map([['G-PERF-01', ['pages', 'leaderboard']]]), new Map([
  ['LC-AUTH-01', ['auth']], ['LC-AUTH-03', ['auth']], ['LC-LIVE-03', ['game-data']], ['LC-PROFILE-06', ['profile', 'auth']], ['LC-SIGNUP-03', ['signup']],
])];

test('block CLI: one block, idempotent, needs service/by/card', () => {
  const home = tmpHome();
  const a = run(home, 'block', '--service', 'auth', '--by', 'LC-AUTH-01', '--finding', 'UIC-20261017-0200-logic-001', '--card', 'card-1', '--run', '20261017-0200-logic');
  assert.equal(a.code, 0, a.err);
  assert.deepEqual(a.out, ['block auth by LC-AUTH-01 card card-1 (new)']);
  assert.deepEqual(run(home, 'block', '--service', 'auth', '--by', 'LC-AUTH-01', '--finding', 'UIC-20261017-0200-logic-001', '--card', 'card-1').out, ['block auth by LC-AUTH-01 card card-1 (kept)']);
  const c = readChannel({ file: path.join(home, 'channel.json') });
  assert.equal(c.blocks.length, 1);
  assert.deepEqual([c.blocks[0].finding, c.blocks[0].runId], ['UIC-20261017-0200-logic-001', '20261017-0200-logic']);
  const bad = run(home, 'block', '--service', 'auth', '--by', 'LC-AUTH-02', '--card', 'card-2');
  assert.equal(bad.code, 2);
  assert.match(bad.err, /needs --service, --by, --finding and --card/);
  assert.equal(run(home, 'nonsense').code, 2);
});

test('servicesToBlock: per-game notes narrow game-data to games.<id>; unnoted violations keep the row', () => {
  const v = (note) => ({ rule: 'game-data', note });
  assert.deepEqual(servicesToBlock('LC-LIVE-03', [{ violations: [v('service games.wordle'), v('service games.contexto')] }], MAPS), ['games.wordle', 'games.contexto']);
  assert.deepEqual(servicesToBlock('LC-LIVE-03', [{ violations: [v('service games.wordle'), v(undefined)] }], MAPS), ['games.wordle', 'game-data']);
  assert.deepEqual(servicesToBlock('LC-AUTH-01', [{ violations: [] }], MAPS), ['auth']);
  assert.deepEqual(servicesToBlock('LC-NOPE-01', [{}], MAPS), []);
});

test('planBlocks: pushed findings of this run only, failing lc checks only, never a card closed by hand', () => {
  const runId = '20261017-0200-logic';
  const f = (id, fp, lcs, extra = {}) => ({ id, fingerprint: fp, validatedAt: 'x', acceptance: { criteria: ['c'], checks: lcs.map((lc) => ({ lc })) }, ...extra });
  const doc = { findings: [
    f('F1', 'a|/|1', ['LC-AUTH-01', 'LC-AUTH-03']), // LC-AUTH-03 passed in the run → no block for it
    f('F2', 'b|/|2', ['LC-PROFILE-06']), // closed by hand
    f('F3', 'c|/|3', ['LC-LIVE-03']), // per-game
    f('F4', 'd|/|4', ['LC-SIGNUP-03'], { validatedAt: undefined }), // not validated
    f('F5', 'e|/|5', ['LC-SIGNUP-03']), // pushed by another run
    f('F6', 'f|/|6', ['LC-SIGNUP-03'], { fingerprint: 'z|/|z', mergedFingerprints: ['g|/|7'] }), // merged fp in the ledger
    f('F7', 'h|/|8', ['LC-SIGNUP-03']), // dry run
  ] };
  const results = [
    { checkId: 'LC-AUTH-01', status: 'failed', violations: [{ rule: 'status' }] },
    { checkId: 'LC-AUTH-03', status: 'passed' },
    { checkId: 'LC-PROFILE-06', status: 'failed' },
    { checkId: 'LC-LIVE-03', status: 'failed', violations: [{ rule: 'game-data', note: 'service games.wordle' }] },
    { checkId: 'LC-SIGNUP-03', status: 'timedOut' },
  ];
  const ledger = {
    'a|/|1': { card: 'card-A', run: runId, decision: 'create' },
    'b|/|2': { card: 'card-B', run: runId, decision: 'skip:byHand' },
    'c|/|3': { card: 'card-C', run: runId, decision: 'skip:open' },
    'd|/|4': { card: 'card-D', run: runId, decision: 'create' },
    'e|/|5': { card: 'card-E', run: '20261016-0200-logic', decision: 'create' },
    'g|/|7': { card: 'card-G', run: runId, decision: 'regression' },
    'h|/|8': { card: 'DRY', run: runId, decision: 'create' },
  };
  const { blocks, skipped } = planBlocks({ doc, results, ledger, runId, maps: MAPS });
  assert.deepEqual(blocks.map((b) => `${b.service}|${b.by}|${b.card}|${b.finding}`), [
    'auth|LC-AUTH-01|card-A|F1', 'games.wordle|LC-LIVE-03|card-C|F3', 'signup|LC-SIGNUP-03|card-G|F6',
  ]);
  assert.deepEqual(skipped, [{ finding: 'F2', card: 'card-B', why: 'closed by hand' }]);
});

test('block-run CLI writes the planned blocks from a run dir + ledger (and nothing in --dry-run)', () => {
  const home = tmpHome();
  const runId = '20261017-0200-logic';
  const dir = path.join(home, 'runs', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'findings.json'), JSON.stringify({ findings: [
    { id: 'UIC-20261017-0200-logic-001', fingerprint: 'validation-gap|/api/signup|x', validatedAt: 'x', acceptance: { criteria: ['c'], checks: [{ lc: 'LC-SIGNUP-03' }] } },
    { id: 'UIC-20261017-0200-logic-002', fingerprint: 'status|/api/me|y', validatedAt: 'x', acceptance: { criteria: ['c'], checks: [{ lc: 'LC-AUTH-03' }] } },
  ] }));
  writeFileSync(path.join(dir, 'results.json'), JSON.stringify([{ checkId: 'LC-SIGNUP-03', status: 'failed', violations: [] }, { checkId: 'LC-AUTH-03', status: 'failed', violations: [] }]));
  writeFileSync(path.join(home, 'notion-cards.json'), JSON.stringify({
    'validation-gap|/api/signup|x': { card: 'card-1', run: runId, decision: 'create' },
    'status|/api/me|y': { card: 'card-2', run: runId, decision: 'skip:byHand' },
  }));
  const dry = run(home, 'block-run', '--run', runId, '--dry-run');
  assert.equal(dry.code, 0, dry.err);
  assert.equal(dry.out.at(-1), 'block-run: 1 planned (dry run) · 1 skipped (closed by hand)');
  assert.equal(readChannel({ file: path.join(home, 'channel.json') }).blocks.length, 0);
  const r = run(home, 'block-run', '--run', runId);
  assert.deepEqual(r.out, [
    'block signup by LC-SIGNUP-03 card card-1 finding UIC-20261017-0200-logic-001 (new)',
    'skip UIC-20261017-0200-logic-002 card card-2: closed by hand (no block)',
    'block-run: 1 new · 0 kept · 1 skipped (closed by hand)',
  ]);
  assert.deepEqual(readChannel({ file: path.join(home, 'channel.json') }).blocks.map((b) => b.service), ['signup']);
  assert.match(run(home, 'block-run', '--run', '20990101-0000-logic').out[0], /no findings\.json/);
});

test('resolve CLI with --fake: Done + commit on main resolves, catch-up lists Logic ids and released UI checks', () => {
  const home = tmpHome();
  const file = path.join(home, 'channel.json');
  block({ service: 'signup', by: 'LC-SIGNUP-03', finding: 'F1', card: 'card-1' }, { file });
  block({ service: 'auth', by: 'LC-AUTH-03', finding: 'F2', card: 'card-2' }, { file });
  block({ service: 'friends', by: 'LC-FRIENDS-01', finding: 'F3', card: 'card-3' }, { file });
  defer({ checker: 'ui', checkId: 'AC-SIGNUP-01', blockedBy: 'LC-SIGNUP-03', service: 'signup' }, { file });
  defer({ checker: 'ui', checkId: 'AC-LOGIN-01', blockedBy: 'LC-AUTH-03', service: 'auth' }, { file });
  const fake = path.join(home, 'fake.json');
  writeFileSync(fake, JSON.stringify({ cards: { 'card-1': { done: true, commit: 'abc1234def' }, 'card-2': { done: true, commit: 'notonmain' }, 'card-3': { error: 'Notion 502' } }, onMain: ['abc1234def'] }));
  const r = run(home, 'resolve', '--fake', fake);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out[0], 'resolved signup by LC-SIGNUP-03 card card-1 (fix on main abc1234)');
  assert.ok(r.out.includes('error card card-3: Notion 502'));
  const logic = r.out.find((l) => l.startsWith('catchup-logic ')).slice('catchup-logic '.length).split(',');
  assert.ok(logic.includes('LC-SIGNUP-03') && logic.every((id) => id.startsWith('LC-')), logic.join(','));
  assert.ok(logic.includes('LC-AUTH-06'), 'LC-AUTH-06 is tagged auth, signup: it re-runs with signup');
  assert.ok(!logic.includes('LC-AUTH-01'), 'an auth-only check waits: auth is still blocked');
  assert.equal(r.out.find((l) => l.startsWith('catchup-ui ')), 'catchup-ui AC-SIGNUP-01');
  assert.equal(r.out.at(-1), 'resolve: 1 resolved · 2 still blocking · 1 error(s)');
  const again = run(home, 'resolve', '--fake', fake);
  assert.deepEqual(again.out.filter((l) => l.startsWith('catchup-')), ['catchup-logic -', 'catchup-ui -']);
  assert.equal(run(home, 'resolve', '--fake', path.join(home, 'missing.json')).code, 2);
});

test('catchUpLogicIds: local checks only, a game block re-runs LC-GAMEDATA-01 (+ the round-dealing rooms checks when online)', () => {
  const logic = new Map([
    ['LC-LIVE-03', ['game-data']], ['LC-LIVE-06', ['relay']], ['LC-GAMEDATA-01', ['game-data']], ['LC-GAMEDATA-04', ['games.wordle', 'game-data']],
    ['LC-ROOMS-01', ['relay']], ['LC-ROOMS-07', ['rooms', 'relay']], ['LC-ROOMS-10', ['matchmaking', 'relay']], ['LC-SIGNUP-03', ['signup']],
  ]);
  const online = (id) => id === 'contexto';
  assert.deepEqual(catchUpLogicIds(['relay'], logic), ['LC-ROOMS-01', 'LC-ROOMS-07', 'LC-ROOMS-10']);
  assert.deepEqual(catchUpLogicIds(['games.wordle'], logic, { isOnline: online }), ['LC-GAMEDATA-04', 'LC-GAMEDATA-01']);
  assert.deepEqual(catchUpLogicIds(['games.contexto'], logic, { isOnline: online }), ['LC-GAMEDATA-01', 'LC-ROOMS-07', 'LC-ROOMS-10']);
  assert.deepEqual(catchUpLogicIds(['game-data'], logic), ['LC-GAMEDATA-01', 'LC-GAMEDATA-04']);
  assert.deepEqual(catchUpLogicIds([], logic), []);
  assert.deepEqual(catchUpLogicIds(['signup'], null), []);
});
