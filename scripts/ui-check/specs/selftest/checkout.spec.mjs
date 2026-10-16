// Selftest for the worktree checkout helper (check-core/lib/checkout.mjs): a checkout of the current HEAD sha gets the
// venv and relay node_modules as junctions to the main checkout's, is reused as is on a second call, and removeCheckout
// deletes it without touching what the junctions point to. Runs `npm ci` once in the new worktree (up to ~15 min here).
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { ensureCheckout, removeCheckout, worktreeRoot } from '../../../check-core/lib/checkout.mjs';
import { ROOT } from '../../../check-core/lib/home.mjs';

const isLink = (p) => { try { return lstatSync(p).isSymbolicLink(); } catch { return false; } };
const PY = process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python'];

test('[ST-CHECKOUT] ensureCheckout makes a worktree of a sha with venv and relay junctions, reuses it, removeCheckout deletes it', async () => {
  test.setTimeout(30 * 60_000); // npm ci in a fresh worktree took 11 min on this machine
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dir = path.join(worktreeRoot(), `check-${sha.slice(0, 7)}`);
  await removeCheckout(sha); // a leftover of an interrupted selftest
  try {
    const first = await ensureCheckout(sha);
    expect(first).toMatchObject({ repo: dir, ref: sha, head: sha, created: true });
    for (const rel of ['backend/.venv', 'multiplayer_server/node_modules']) expect(isLink(path.join(dir, rel)), `${rel} is a junction`).toBe(true);
    expect(existsSync(path.join(dir, 'backend', '.venv', ...PY)), 'the venv python resolves through the junction').toBe(true);
    expect(existsSync(path.join(dir, 'node_modules', 'next', 'package.json')), 'npm ci installed the worktree').toBe(true);

    const second = await ensureCheckout(sha);
    expect(second).toMatchObject({ repo: dir, head: sha, created: false, reinstalled: false });

    const here = await ensureCheckout('.');
    expect(here).toMatchObject({ repo: ROOT, ref: '.', created: false, reinstalled: false });
  } finally {
    await removeCheckout(sha);
  }
  expect(existsSync(dir), 'the worktree is gone').toBe(false);
  const list = spawnSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  expect(list.toLowerCase()).not.toContain(dir.replace(/\\/g, '/').toLowerCase());
  // Removing the worktree must never follow a junction into the main checkout.
  expect(existsSync(path.join(ROOT, 'multiplayer_server', 'node_modules')), 'main relay node_modules kept').toBe(true);
  expect(['.venv', 'venv'].some((v) => existsSync(path.join(ROOT, 'backend', v, ...PY))), 'main venv kept').toBe(true);
});
