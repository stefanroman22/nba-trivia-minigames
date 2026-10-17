// node --test scripts/check-core/state-store.test.mjs — the checks-state store (lib/state-store.mjs) against a real
// local bare repo: two weekly runs on different machines, a live-probe writer in between, concurrent writers, the
// lease, the notes overlay. Nothing here touches a real remote or a real home.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { acquireLease, baseDir, readStore, releaseLease, releaseNotes, storeGit, sync } from './lib/state-store.mjs';
import { block, defer, readChannel, resolve } from './lib/channel.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const git = (cwd, ...a) => {
  const r = spawnSync('git', a, { cwd, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A bare "origin" and `n` clones of it (each a machine), each with a dev-like commit holding notes. */
function world(n = 2) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'state-store-test-'));
  const bare = path.join(root, 'origin.git');
  git(root, 'init', '--bare', '-q', bare);
  const seed = path.join(root, 'seed');
  git(root, 'init', '-q', '-b', 'dev', seed);
  for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['core.autocrlf', 'false']]) git(seed, 'config', k, v);
  mkdirSync(path.join(seed, 'scripts', 'ui-check', 'notes'), { recursive: true });
  mkdirSync(path.join(seed, 'scripts', 'logic-check', 'notes'), { recursive: true });
  writeFileSync(path.join(seed, 'scripts', 'ui-check', 'notes', 'guest.md'), '# guest\n- a (2026-10-01)\n');
  writeFileSync(path.join(seed, 'scripts', 'logic-check', 'notes', 'logic.md'), '# logic\n- x (2026-10-01)\n');
  git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'seed');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-q', 'origin', 'dev');
  const machines = [];
  for (let i = 0; i < n; i++) {
    const dir = path.join(root, `m${i}`);
    git(root, 'clone', '-q', '-b', 'dev', bare, dir);
    for (const [k, v] of [['user.name', 't'], ['user.email', 't@t'], ['core.autocrlf', 'false'], ['gc.auto', '0'], ['maintenance.auto', 'false']]) git(dir, 'config', k, v);
    const home = path.join(root, `home${i}`);
    mkdirSync(home, { recursive: true });
    machines.push({ dir, home, git: storeGit({ cwd: dir, branch: 'checks-state' }) });
  }
  return { root, bare, seed, machines, cleanup: () => { try { rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* a git child still closing on Windows: the temp dir is left */ } } };
}

const chan = (m) => path.join(m.home, 'channel.json');
const storeJson = (m, f) => JSON.parse(String(readStore(m.git).files[f]));

test('two weekly runs on two machines + a live writer between them: blocks carry over, nothing is clobbered', async () => {
  const w = world(3);
  try {
    const [cloud, pc, live] = w.machines;
    // Run 1 (cloud, fresh home): Logic blocks signup, UI defers a check; the store is created.
    sync({ git: cloud.git, home: cloud.home });
    block({ service: 'signup', by: 'LC-SIGNUP-03', finding: 'F1', card: 'card-1', runId: 'r1' }, { file: chan(cloud) });
    defer({ checker: 'ui', checkId: 'AC-SIGNUP-01', blockedBy: 'LC-SIGNUP-03', service: 'signup', runId: 'r1u' }, { file: chan(cloud) });
    const s1 = sync({ git: cloud.git, home: cloud.home });
    assert.equal(s1.pushed, true);
    assert.deepEqual(storeJson(cloud, 'channel.json').blocks.map((b) => b.service), ['signup']);

    // The live probes (a third writer, fresh home) block pages in between.
    sync({ git: live.git, home: live.home });
    block({ service: 'pages', by: 'LC-LIVE-01', finding: 'F2', card: 'card-2', runId: 'live1' }, { file: chan(live) });
    sync({ git: live.git, home: live.home });

    // Run 2 (the PC, a home that had an OLD local channel with an unrelated block nobody pushed yet).
    writeFileSync(chan(pc), JSON.stringify({ blocks: [{ service: 'rooms', by: 'LC-ROOMS-07', finding: 'F0', card: 'card-0', runId: 'r0', since: 't0' }], deferred: [], resolved: [] }));
    sync({ git: pc.git, home: pc.home });
    assert.deepEqual(readChannel({ file: chan(pc) }).blocks.map((b) => b.service).sort(), ['pages', 'rooms', 'signup']);
    // The PC resolves signup (card Done, commit on main) …
    {
      const r = await resolve({ isDone: (c) => ({ done: c === 'card-1', commit: 'abc' }), isOnMain: () => true }, { file: chan(pc) });
      assert.deepEqual(r.catchUp.ui, ['AC-SIGNUP-01']);
      // … while the cloud, still holding its run-1 copy, adds a deferral (a concurrent writer with a stale base).
      defer({ checker: 'ui', checkId: 'AC-BLOCK-01', blockedBy: 'LC-SIGNUP-03', service: 'signup', runId: 'r1u' }, { file: chan(cloud) });
      sync({ git: pc.git, home: pc.home });
      sync({ git: cloud.git, home: cloud.home });
      const c = storeJson(pc, 'channel.json');
      assert.deepEqual(c.blocks.map((b) => b.service).sort(), ['pages', 'rooms']);
      assert.equal(c.resolved.length, 1);
      assert.deepEqual(c.deferred.map((d) => `${d.checkId}${d.resolvedAt ? '*' : ''}`).sort(), ['AC-BLOCK-01', 'AC-SIGNUP-01*']);
      // Every home converges on the next sync.
      sync({ git: live.git, home: live.home });
      assert.deepEqual(readChannel({ file: chan(live) }), c);
      assert.deepEqual(readChannel({ file: chan(cloud) }), c);
    }
  } finally { w.cleanup(); }
});

test('concurrent writers (6 processes, own clones) all land, none lost', async () => {
  const w = world(6);
  try {
    sync({ git: w.machines[0].git, home: w.machines[0].home }); // create the branch first
    const lib = path.join(HERE, 'lib');
    const script = `
      import { storeGit, sync } from ${JSON.stringify('file://' + path.join(lib, 'state-store.mjs').replace(/\\/g, '/'))};
      import { block } from ${JSON.stringify('file://' + path.join(lib, 'channel.mjs').replace(/\\/g, '/'))};
      const [dir, home, i] = process.argv.slice(1);
      const git = storeGit({ cwd: dir, branch: 'checks-state' });
      sync({ git, home });
      block({ service: 'games.g' + i, by: 'LC-GAMEDATA-01', finding: 'F' + i, card: 'card-' + i, runId: 'r' + i }, { file: home + '/channel.json' });
      const r = sync({ git, home });
      console.log(JSON.stringify({ i, attempts: r.attempts }));`;
    const procs = w.machines.map((m, i) => new Promise((res, rej) => {
      const p = spawn(process.execPath, ['--input-type=module', '-e', script, m.dir, m.home, String(i)], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '', er = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { er += d; });
      p.on('exit', (code) => (code === 0 ? res(JSON.parse(out.trim().split('\n').pop())) : rej(new Error(`writer ${i} exit ${code}: ${er}`))));
    }));
    const results = await Promise.all(procs);
    const blocks = storeJson(w.machines[0], 'channel.json').blocks.map((b) => b.service).sort();
    assert.deepEqual(blocks, [0, 1, 2, 3, 4, 5].map((i) => `games.g${i}`).sort());
    console.log(`push attempts per writer: ${results.map((r) => r.attempts).join(' ')}`);
  } finally { w.cleanup(); }
});

test('lease: one weekly run at a time; a finished run makes the next scheduled one skip until --force', () => {
  const w = world(2);
  try {
    const [a, b] = w.machines;
    const now = Date.parse('2026-10-18T00:00:05Z'); // Sunday 02:00:05 Paris
    assert.equal(acquireLease(a.git, { holder: 'cloud-1', now }).status, 'acquired');
    const busy = acquireLease(b.git, { holder: 'windows-pc', now: now + 1000 });
    assert.equal(busy.status, 'busy'); assert.equal(busy.lease.holder, 'cloud-1');
    releaseLease(a.git, { holder: 'cloud-1', status: 'ok', now: now + 3 * 3600_000 });
    // The PC's task starts late (StartWhenAvailable, Monday): the cloud already ran this week.
    assert.equal(acquireLease(b.git, { holder: 'windows-pc', now: now + 30 * 3600_000 }).status, 'done');
    assert.equal(acquireLease(b.git, { holder: 'windows-pc', now: now + 30 * 3600_000, force: true }).status, 'acquired');
    // An expired lease (a killed run) is taken over.
    assert.equal(acquireLease(a.git, { holder: 'cloud-2', now: now + 7 * 86400_000 + 8 * 3600_000 }).status, 'acquired');
    const runs = storeJson(a, 'weekly.json').runs.map((r) => `${r.holder}:${r.status}`);
    assert.deepEqual(runs, ['cloud-1:ok', 'windows-pc:running', 'cloud-2:running']);
  } finally { w.cleanup(); }
});

test('notes: seeded from the checkout, overlaid, local edits and a dev edit both merge in, released after', () => {
  const w = world(2);
  try {
    const [cloud, pc] = w.machines;
    const guest = (m) => path.join(m.dir, 'scripts', 'ui-check', 'notes', 'guest.md');
    sync({ git: cloud.git, home: cloud.home, notes: true });
    assert.match(String(readStore(cloud.git).files['notes/ui-check/guest.md']), /- a \(2026-10-01\)/);
    // The cloud judge appends a bullet; the run ends (sync + release).
    writeFileSync(guest(cloud), readFileSync(guest(cloud), 'utf8') + '- cloud (2026-10-18)\n');
    sync({ git: cloud.git, home: cloud.home, notes: true });
    releaseNotes({ home: cloud.home, repo: cloud.dir });
    assert.equal(readFileSync(guest(cloud), 'utf8'), '# guest\n- a (2026-10-01)\n');
    assert.equal(existsSync(path.join(baseDir(cloud.home), 'notes')), false);
    // Meanwhile dev gets a human notes edit (a new bullet at the top).
    writeFileSync(path.join(w.seed, 'scripts', 'ui-check', 'notes', 'guest.md'), '# guest\n- human (2026-10-19)\n- a (2026-10-01)\n');
    git(w.seed, 'commit', '-q', '-am', 'notes on dev'); git(w.seed, 'push', '-q', 'origin', 'dev');
    git(pc.dir, 'pull', '-q', '--ff-only');
    // The PC's run: overlay = the store's notes + dev's edit; then the PC's judge appends; then a killed run (no release).
    sync({ git: pc.git, home: pc.home, notes: true });
    const overlay = readFileSync(guest(pc), 'utf8');
    assert.match(overlay, /- human \(2026-10-19\)/); assert.match(overlay, /- cloud \(2026-10-18\)/);
    writeFileSync(guest(pc), overlay + '- pc (2026-10-25)\n');
    // The next run's first sync recovers the killed run's leftovers before releasing.
    sync({ git: pc.git, home: pc.home, notes: true });
    releaseNotes({ home: pc.home, repo: pc.dir });
    const store = String(readStore(pc.git).files['notes/ui-check/guest.md']);
    for (const b of ['- a (2026-10-01)', '- human (2026-10-19)', '- cloud (2026-10-18)', '- pc (2026-10-25)']) assert.ok(store.includes(b), `${b} in ${store}`);
    assert.equal(store.split('- a (2026-10-01)').length, 2, 'no duplicated lines');
  } finally { w.cleanup(); }
});

test('the ledger reaches the store without card titles', () => {
  const w = world(1);
  try {
    const [m] = w.machines;
    writeFileSync(path.join(m.home, 'notion-cards.json'), JSON.stringify({ fp1: { key: 'k', card: 'c', status: 'To Do', run: 'r', title: '[ui-check] private defect', url: 'https://www.notion.so/private-defect-c' } }));
    sync({ git: m.git, home: m.home });
    const text = String(readStore(m.git).files['notion-cards.json']);
    assert.equal(text.includes('private'), false);
    assert.equal(JSON.parse(readFileSync(path.join(m.home, 'notion-cards.json'), 'utf8')).fp1.title, '[ui-check] private defect');
  } finally { w.cleanup(); }
});
