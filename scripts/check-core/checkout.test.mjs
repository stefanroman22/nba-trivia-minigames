// node --test scripts/check-core/checkout.test.mjs — the ui-fix branch worktree (no npm ci, no fetch: cut from HEAD).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from './lib/home.mjs';
import { ensureFixWorktree, removeFixWorktree, fixBranch, fixDir } from './lib/checkout.mjs';

const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }).stdout.trim();

test('ensureFixWorktree: branch worktree from a base, reused as is, main checkout untouched; removeFixWorktree cleans up', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'fixwt-'));
  const runId = `selftest-${process.pid}`;
  const mainBranch = git('branch', '--show-current');
  const mainHead = git('rev-parse', 'HEAD');
  const base = git('rev-parse', 'HEAD'); // HEAD, not HEAD~1: the cloud clone can be shallow
  const shared = ['backend/venv', 'backend/.venv', 'multiplayer_server/node_modules'].filter((t) => existsSync(path.join(ROOT, t, '.')));
  try {
    const a = await ensureFixWorktree(runId, base, { fetch: false, root, install: false });
    assert.equal(a.repo, fixDir(runId, root));
    assert.equal(a.branch, fixBranch(runId));
    assert.equal(a.branch, `fix/ui-check-${runId}`);
    assert.equal(a.created, true);
    assert.equal(a.head, base);
    assert.equal(spawnSync('git', ['branch', '--show-current'], { cwd: a.repo, encoding: 'utf8' }).stdout.trim(), a.branch);
    for (const [link, targets] of [['backend/.venv', ['backend/.venv', 'backend/venv']], ['multiplayer_server/node_modules', ['multiplayer_server/node_modules']]]) {
      if (!targets.some((t) => existsSync(path.join(ROOT, t)))) continue; // nothing to link on this machine
      assert.ok(lstatSync(path.join(a.repo, link)).isSymbolicLink(), `${link} is a junction`);
    }
    // the main checkout did not move
    assert.equal(git('branch', '--show-current'), mainBranch);
    assert.equal(git('rev-parse', 'HEAD'), mainHead);

    // a fix in progress survives a second call
    writeFileSync(path.join(a.repo, 'FIX-IN-PROGRESS.txt'), 'x');
    const b = await ensureFixWorktree(runId, 'main', { fetch: false, root, install: false });
    assert.equal(b.created, false);
    assert.ok(existsSync(path.join(a.repo, 'FIX-IN-PROGRESS.txt')));

    assert.equal(await removeFixWorktree(runId, { root }), true);
    assert.ok(!existsSync(a.repo));
    assert.equal(git('rev-parse', '--verify', '--quiet', `refs/heads/${a.branch}`), '');
    // the junction targets in the main checkout survive the removal (git would follow a junction)
    for (const t of shared) assert.ok(existsSync(path.join(ROOT, t, '.')), `${t} survives`);
  } finally {
    await removeFixWorktree(runId, { root }).catch(() => {});
    rmSync(root, { recursive: true, force: true });
  }
});
