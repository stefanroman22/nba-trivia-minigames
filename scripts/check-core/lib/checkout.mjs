// Worktree checkouts of a ref, so a check audits the code that ref holds (prod code = origin/main) and never the
// working tree the owner is editing. `<worktreeRoot>/check-<ref>` (a sha → check-<sha7>), detached at origin/<ref>.
// backend/.venv and multiplayer_server/node_modules are junctions to the main checkout's (both git-ignored); the
// root node_modules is the worktree's own (`npm ci`, only when package-lock.json changed since the last install —
// a junctioned root node_modules gets deleted through the link when the worktree is removed).
// Ref '.' is the main checkout itself, returned untouched.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './home.mjs';

const WIN = process.platform === 'win32';
// Inside node_modules: git-ignored (git clean keeps it) and gone with node_modules, which forces a reinstall.
const LOCK_STAMP = path.join('node_modules', '.check-lock-stamp');
const LINKS = [
  { link: 'backend/.venv', targets: ['backend/.venv', 'backend/venv'] },
  { link: 'multiplayer_server/node_modules', targets: ['multiplayer_server/node_modules'] },
];
const log = (m) => console.log(`checkout: ${m}`);
const norm = (p) => path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function git(args, cwd = ROOT, { allowFail = false } = {}) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 400)}`);
  }
  return r.stdout.trim();
}

/** Where checkouts live: `worktreeRoot` of .claude/team/config.json (the pipeline's root); else next to the repo. */
export function worktreeRoot() {
  try {
    const cfg = JSON.parse(readFileSync(path.join(ROOT, '.claude', 'team', 'config.json'), 'utf8'));
    const root = cfg.worktreeRoot;
    // A Windows path in the config means nothing on the cloud VM.
    if (root && (WIN || !/^[A-Za-z]:[\\/]/.test(root))) return path.resolve(root);
  } catch { /* no config */ }
  return WIN ? path.join(os.homedir(), '.team-worktrees') : path.dirname(ROOT);
}

const isSha = (ref) => /^[0-9a-f]{7,40}$/i.test(ref);
const dirName = (ref) => `check-${isSha(ref) ? ref.slice(0, 7).toLowerCase() : ref.replace(/[^\w.-]+/g, '-')}`;
export const checkoutDir = (ref) => path.join(worktreeRoot(), dirName(ref));

/** The commit a ref checks out: origin/<ref> for a branch (fetched first), the commit itself for a sha. */
function resolveTarget(ref, fetch) {
  if (!isSha(ref)) {
    if (fetch && git(['fetch', '--quiet', 'origin', ref], ROOT, { allowFail: true }) === null) log(`WARNING: git fetch origin ${ref} failed — using the local origin/${ref}`);
    const sha = git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}^{commit}`], ROOT, { allowFail: true });
    if (sha) return sha;
  }
  let sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], ROOT, { allowFail: true });
  if (!sha && fetch && isSha(ref)) {
    git(['fetch', '--quiet', 'origin', ref], ROOT, { allowFail: true });
    sha = git(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], ROOT, { allowFail: true });
  }
  if (!sha) throw new Error(`checkout: unknown ref "${ref}" (neither origin/${ref} nor a commit)`);
  return sha;
}

function isWorktree(dir) {
  const list = git(['worktree', 'list', '--porcelain']) || '';
  return list.split('\n').some((l) => l.startsWith('worktree ') && norm(l.slice(9)) === norm(dir));
}

/** Junctions to the main checkout's venv and relay node_modules; an existing one is reused, a dangling one replaced. */
function linkShared(dir) {
  for (const { link, targets } of LINKS) {
    const at = path.join(dir, link);
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (st && (!st.isSymbolicLink() || existsSync(at))) continue;
    if (st) unlinkLink(at);
    const target = targets.map((t) => path.join(ROOT, t)).find((t) => existsSync(t));
    if (!target) { log(`WARNING: no ${targets.join(' or ')} in ${ROOT} — ${link} not linked`); continue; }
    mkdirSync(path.dirname(at), { recursive: true });
    symlinkSync(target, at, 'junction');
  }
}

function unlinkLink(at) {
  try { unlinkSync(at); } catch { rmdirSync(at); }
  if (lstatSync(at, { throwIfNoEntry: false })) throw new Error(`checkout: could not remove the junction ${at}`);
}

/** `npm ci` when package-lock.json differs from the last install (stamp) or next is missing. → reinstalled */
function installIfLockChanged(dir) {
  const hash = createHash('sha256').update(readFileSync(path.join(dir, 'package-lock.json'))).digest('hex').slice(0, 16);
  const stampFile = path.join(dir, LOCK_STAMP);
  let prev = null;
  try { prev = readFileSync(stampFile, 'utf8').trim(); } catch { /* never installed */ }
  if (prev === hash && existsSync(path.join(dir, 'node_modules', 'next', 'package.json'))) return false;
  log(`npm ci in ${dir} (${prev ? 'package-lock.json changed' : 'first install'})`);
  const t0 = Date.now();
  const r = spawnSync('npm', ['ci', '--prefer-offline', '--no-audit', '--no-fund'], { cwd: dir, shell: WIN, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`npm ci failed in ${dir} (exit ${r.status}): ${`${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n').slice(-8).join('\n')}`);
  writeFileSync(stampFile, hash + '\n');
  log(`npm ci done in ${Math.round((Date.now() - t0) / 1000)}s`);
  return true;
}

/**
 * A worktree of `ref` ('main' | 'dev' | '<sha>' | '.') ready for the stack → { repo, ref, head, created, reinstalled }.
 * Existing checkout: a dirty tree is reset (tracked changes and untracked files; ignored ones like node_modules and
 * .next stay), a moved ref re-detaches, junctions are reused. '.' → the main checkout, untouched (no worktree, no npm ci).
 */
export async function ensureCheckout(ref, { fetch = true } = {}) {
  if (!ref || ref === '.') return { repo: ROOT, ref: '.', head: git(['rev-parse', 'HEAD']), created: false, reinstalled: false };
  const target = resolveTarget(ref, fetch);
  const dir = checkoutDir(ref);
  let created = false;
  if (!isWorktree(dir)) {
    if (existsSync(dir)) throw new Error(`checkout: ${dir} exists but is not a worktree of ${ROOT} — remove it first`);
    git(['worktree', 'prune']);
    mkdirSync(path.dirname(dir), { recursive: true });
    log(`adding ${dir} at ${target.slice(0, 7)} (${ref})`);
    git(['worktree', 'add', '--detach', dir, target]);
    created = true;
  } else {
    if (git(['status', '--porcelain'], dir)) {
      log(`${path.basename(dir)} has local changes — resetting`);
      git(['reset', '--hard', '--quiet'], dir);
      git(['clean', '-fdq'], dir);
    }
    const head = git(['rev-parse', 'HEAD'], dir);
    if (head !== target) {
      log(`${path.basename(dir)}: ${head.slice(0, 7)} → ${target.slice(0, 7)}`);
      git(['checkout', '--detach', '--force', '--quiet', target], dir);
    }
  }
  linkShared(dir);
  const reinstalled = installIfLockChanged(dir);
  return { repo: dir, ref, head: git(['rev-parse', 'HEAD'], dir), created, reinstalled };
}

/** Remove the checkout of `ref`: junctions first (git would follow them into the main checkout), then the worktree. */
export async function removeCheckout(ref) {
  if (!ref || ref === '.') throw new Error('removeCheckout: refusing to remove the main checkout');
  return removeWorktreeDir(checkoutDir(ref));
}

function removeWorktreeDir(dir) {
  const registered = isWorktree(dir);
  if (!registered && !existsSync(dir)) return false;
  for (const { link } of LINKS) {
    const at = path.join(dir, link);
    const st = lstatSync(at, { throwIfNoEntry: false });
    if (st && st.isSymbolicLink()) unlinkLink(at);
  }
  if (registered) git(['worktree', 'remove', '--force', dir], ROOT, { allowFail: true });
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  git(['worktree', 'prune']);
  log(`removed ${dir}`);
  return true;
}

// --- ui-fix: a branch worktree, so the fix never moves the main checkout (which holds the checker tooling) ---
export const fixBranch = (runId) => `fix/ui-check-${runId}`;
export const fixDir = (runId, root = worktreeRoot()) => path.join(root, `fix-ui-check-${String(runId).replace(/[^\w.-]+/g, '-')}`);

/**
 * The worktree `<worktreeRoot>/fix-ui-check-<runId>` on branch `fix/ui-check-<runId>`, cut from origin/<target>
 * (or a sha) when new → { repo, branch, base, head, created, reinstalled }. An existing one is reused as it is (a fix
 * in progress is never reset); a leftover branch without a worktree is checked out again. Junctions as ensureCheckout;
 * `npm ci` only when node_modules is missing or package-lock.json changed. The main checkout is never switched.
 */
export async function ensureFixWorktree(runId, target = 'main', { fetch = true, root = worktreeRoot(), install = true } = {}) {
  if (!runId) throw new Error('ensureFixWorktree: runId required');
  const dir = fixDir(runId, root);
  const branch = fixBranch(runId);
  let created = false;
  let base = null;
  if (!isWorktree(dir)) {
    if (existsSync(dir)) throw new Error(`checkout: ${dir} exists but is not a worktree of ${ROOT} — remove it first`);
    git(['worktree', 'prune']);
    mkdirSync(path.dirname(dir), { recursive: true });
    if (git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], ROOT, { allowFail: true })) {
      log(`adding ${dir} on the existing branch ${branch}`);
      git(['worktree', 'add', dir, branch]);
    } else {
      base = resolveTarget(target, fetch);
      log(`adding ${dir} on ${branch} from ${base.slice(0, 7)} (${target})`);
      git(['worktree', 'add', '-b', branch, dir, base]);
    }
    created = true;
  }
  linkShared(dir);
  const reinstalled = install ? installIfLockChanged(dir) : false;
  return { repo: dir, branch, base, head: git(['rev-parse', 'HEAD'], dir), created, reinstalled };
}

/** Remove the fix worktree (junctions first) and, with deleteBranch, its local branch. */
export async function removeFixWorktree(runId, { root = worktreeRoot(), deleteBranch = true } = {}) {
  const removed = removeWorktreeDir(fixDir(runId, root));
  if (deleteBranch) git(['branch', '-D', fixBranch(runId)], ROOT, { allowFail: true });
  return removed;
}

// CLI (ui-fix skill): node scripts/check-core/lib/checkout.mjs fix <runId> <main|dev>  → JSON { repo, branch, … }
//                     node scripts/check-core/lib/checkout.mjs remove-fix <runId>
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, runId, target] = process.argv.slice(2);
  try {
    if (cmd === 'fix' && runId && ['main', 'dev'].includes(target)) console.log(JSON.stringify(await ensureFixWorktree(runId, target), null, 2));
    else if (cmd === 'remove-fix' && runId) console.log(JSON.stringify({ removed: await removeFixWorktree(runId) }));
    else { console.error('usage: node scripts/check-core/lib/checkout.mjs fix <runId> <main|dev> | remove-fix <runId>'); process.exit(2); }
  } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
