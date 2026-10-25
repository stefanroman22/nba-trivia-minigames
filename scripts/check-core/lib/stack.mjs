// Local app stack for the checks (spec §4). Starts only what is not already listening, records
// what it started in <uicHome>/stack.json and stops only those processes.
//   prod: Django :8200 (sqlite) + socket :4200 + `next build` (only when the source stamp changed) and
//         `next start` :5374 — real speed numbers, no dev overlay.
//   dev:  Django :8000 + `npm run dev` :5173 (which starts the socket on :4000) — HMR for fix loops.
//         On other ports (a pipeline lane): our socket + `next dev -p <web>` pinned to the lane's Django and socket.
// `repo` is the checkout whose code runs (the main checkout, or a worktree from checkout.mjs); `ports` the port set.
// stack.json keeps one `stacks` entry per port set and every started process with its {repo, ports}, so a lane
// stack and a checker stack coexist and stopping one never touches the other.
// Servers are detached with their output in <uicHome>/logs/, so they outlive the process that
// started them (a Playwright worker) until stopStack().
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { ROOT, uicHome } from './home.mjs';
import { PORT_SETS, activePorts, portsKey } from './ports.mjs';

/** The checker port sets per mode (kept under its old name for the ui-check imports). */
export const MODES = PORT_SETS;

const UIC_ROOT = uicHome();
const WIN = process.platform === 'win32';
const STACK_FILE = path.join(UIC_ROOT, 'stack.json');
const LOG_DIR = path.join(UIC_ROOT, 'logs');
const stampFile = (repo) => path.join(repo, '.next', 'UICHECK_STAMP');
const nextBin = (repo) => path.join(repo, 'node_modules', 'next', 'dist', 'bin', 'next');
// Everything `next build` reads from the repo. A change elsewhere (scripts, docs, backend code)
// does not invalidate the build, so committing a runner fix never costs a rebuild.
const BUILD_PATHS = ['src', 'public', 'backend/trivia/data', 'next.config.ts', 'package.json', 'package-lock.json',
  'postcss.config.js', 'tailwind.config.js', 'tsconfig.json'];
// The browser-side env next.config.ts inlines, and the files Next reads them from for `next build`.
const INLINED_ENV = ['VITE_BACKEND_URL', 'VITE_SOCKET_URL', 'VITE_DATA_BASE', 'VITE_QUESTIONS_BASE'];
const BUILD_ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];

const log = (m) => console.log(`stack: ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The checkout whose app this process tests: UI_CHECK_REPO (set by run.mjs / verify.mjs) or the main checkout. */
export const appRepo = () => path.resolve(process.env.UI_CHECK_REPO || ROOT);
const sameDir = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

/** True when something accepts a TCP connection on localhost:<port>. */
export function isPortOpen(port, timeout = 400) {
  return new Promise((resolve) => {
    const socket = connect({ host: 'localhost', port });
    const done = (v) => { socket.destroy(); resolve(v); };
    socket.setTimeout(timeout);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** Poll a URL until it answers below 500. With `entry` (a process we started), fail at once if it exits. */
export async function waitForUrl(url, timeoutMs, entry = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    if (entry && !stillOurs(entry)) {
      throw new Error(`${entry.name} (pid ${entry.pid}) exited before ${url} answered
${tail(entry.log, 15)}`);
    }
    await sleep(1000);
  }
  throw new Error(`${url} did not answer within ${Math.round(timeoutMs / 1000)}s`);
}

/** The backend venv's python (as scripts/team/qa.mjs finds it): the repo's (a checkout's is a junction), then the main checkout's. */
export function venvPython(repo = appRepo()) {
  const rel = WIN ? ['backend/.venv/Scripts/python.exe', 'backend/venv/Scripts/python.exe'] : ['backend/.venv/bin/python', 'backend/venv/bin/python'];
  for (const root of [repo, ROOT]) for (const c of rel) if (existsSync(path.join(root, c))) return path.join(root, c);
  return WIN ? 'python' : 'python3';
}

/** The check stack's settings module (djsettings/check_settings.py: the app's settings + sqlite IMMEDIATE/timeout). */
export const CHECK_SETTINGS_DIR = path.join(ROOT, 'scripts', 'check-core', 'lib', 'djsettings');
export const checkSettingsEnv = () => ({
  DJANGO_SETTINGS_MODULE: 'check_settings',
  PYTHONPATH: [CHECK_SETTINGS_DIR, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
});

/** Env for anything Django: always the local sqlite DB and locmem cache, never the dev-env probe. */
export function djangoEnv(extra = {}) {
  return { ...process.env, DATABASE_URL: '', REDIS_URL: '', NBA_DEV_ENV_SKIP: '1', PYTHONUNBUFFERED: '1', ...checkSettingsEnv(), ...extra };
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * The whole <uicHome>/stack.json → { stacks: { "<django>-<socket>-<web>": { mode, repo, ports, base, api, socket,
 * relayKey, keepStack } }, started: [{ name, pid, port, image, log, repo, ports }] }, or null when there is none. A file
 * of the old single-stack form reads as one stack on its mode's ports. A parse error (a concurrent writer) gets one retry.
 */
export function readStackFile() {
  let data = null;
  for (let attempt = 0; !data; attempt++) {
    let text;
    try { text = readFileSync(STACK_FILE, 'utf8'); } catch { return null; }
    try { data = JSON.parse(text); } catch {
      if (attempt) return null;
      sleepSync(50);
    }
  }
  if (data.stacks) return { stacks: data.stacks, started: data.started || [] };
  const stacks = {};
  const p = PORT_SETS[data.mode];
  if (p) stacks[portsKey(p)] = { mode: data.mode, repo: ROOT, ports: p, base: data.base, api: data.api, socket: data.socket, relayKey: data.relayKey };
  return { stacks, started: (data.started || []).map((e) => ({ repo: ROOT, ...e })) };
}

const onPorts = (ports) => (e) => Object.values(ports).includes(e.port);

/**
 * The stack on `ports` (default: this process's — UI_CHECK_PORTS, else the mode's set) → { mode, repo, ports, base,
 * api, socket, relayKey, started: [its processes] }, or null when stack.json knows nothing about those ports.
 */
export function readStack({ ports = activePorts() } = {}) {
  const raw = readStackFile();
  if (!raw) return null;
  const meta = raw.stacks[portsKey(ports)];
  const started = raw.started.filter(onPorts(ports));
  if (!meta && !started.length) return null;
  return { ...(meta || {}), ports, started };
}

/** Atomic: write a temp file, then rename it over stack.json, so a reader never sees a half-written file. */
function writeStack(data) {
  mkdirSync(UIC_ROOT, { recursive: true });
  const tmp = `${STACK_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ stacks: data.stacks || {}, started: data.started || [], updatedAt: new Date().toISOString() }, null, 2));
  for (let attempt = 0; ; attempt++) {
    try { renameSync(tmp, STACK_FILE); return; } catch (e) {
      // Windows: a reader holding stack.json open makes the rename fail for a moment.
      if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { rmSync(tmp, { force: true }); throw e; }
      sleepSync(25);
    }
  }
}

const LOCK_FILE = `${STACK_FILE}.lock`;
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 15_000;

/**
 * Run fn() holding <uicHome>/stack.json.lock (created with 'wx', so one holder at a time across processes): every
 * read-modify-write of stack.json goes through here, so a checker stack and a pipeline lane writing at once never
 * lose an entry. The lock holds a unique token and is released only while it still holds ours. A lock older than 30 s
 * is a crashed holder's: it is taken over by renaming it to a unique name (only one taker can rename a given file),
 * re-checking the renamed file's age (another taker may have replaced the stale lock with its own live one meanwhile:
 * then it is linked back, never deleted) and deleting it only when it is really stale. Waiting longer than 15 s throws.
 */
export function withStackLock(fn) {
  mkdirSync(UIC_ROOT, { recursive: true });
  const token = `${process.pid}-${randomBytes(6).toString('hex')}`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  const ageOf = (file) => Date.now() - statSync(file).mtimeMs;
  let fd = null;
  while (fd === null) {
    try { fd = openSync(LOCK_FILE, 'wx'); } catch (e) {
      if (e.code !== 'EEXIST' && e.code !== 'EPERM' && e.code !== 'EBUSY') throw e;
      let age = 0;
      try { age = ageOf(LOCK_FILE); } catch { continue; } // released meanwhile: retry now
      if (age > LOCK_STALE_MS) { takeOverStale(token, ageOf); continue; }
      if (Date.now() > deadline) throw new Error(`stack.json is locked by another process (${LOCK_FILE}, ${Math.round(age / 1000)}s old)`);
      sleepSync(10 + Math.floor(Math.random() * 20));
    }
  }
  try {
    writeSync(fd, token);
    closeSync(fd);
    fd = null;
    return fn();
  } finally {
    if (fd !== null) closeSync(fd);
    let held = null;
    try { held = readFileSync(LOCK_FILE, 'utf8'); } catch { /* already gone */ }
    if (held === token) rmSync(LOCK_FILE, { force: true });
  }
}

/** Move a stale lock out of the way; a live lock moved by mistake (a race with another taker) is linked back. Exported for the selftest. */
export function takeOverStale(token, ageOf = (file) => Date.now() - statSync(file).mtimeMs) {
  const moved = `${LOCK_FILE}.stale-${token}`;
  try { renameSync(LOCK_FILE, moved); } catch { return; } // another taker moved it first: retry
  let age = 0;
  try { age = ageOf(moved); } catch { return; }
  if (age > LOCK_STALE_MS) { rmSync(moved, { force: true }); return; }
  try { linkSync(moved, LOCK_FILE); } catch { /* a new lock exists already: its holder owns the path now */ }
  rmSync(moved, { force: true });
}

/** Replace the record of one port set (its meta and its processes), re-reading the file so other stacks' entries survive. */
export function updateStack(ports, meta, entries) {
  withStackLock(() => {
    const raw = readStackFile() || { stacks: {}, started: [] };
    writeStack({ stacks: { ...raw.stacks, [portsKey(ports)]: meta }, started: [...raw.started.filter((e) => !onPorts(ports)(e)), ...entries] });
  });
}

/** Image name of a live pid ('python.exe', 'node'…) or null when it is gone. */
function processImage(pid) {
  if (!pid) return null;
  if (WIN) {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
    const m = /^"([^"]+)","(\d+)"/m.exec(r.stdout || '');
    return m && Number(m[2]) === pid ? m[1].toLowerCase() : null;
  }
  try { process.kill(pid, 0); return 'alive'; } catch { return null; }
}

/** A recorded process is still ours: alive, and the pid was not reused by another program. */
function stillOurs(entry) {
  const image = processImage(entry.pid);
  if (!image) return false;
  return !WIN || !entry.image || image === entry.image;
}

function killTree(entry) {
  if (!stillOurs(entry)) return false;
  try {
    if (WIN) spawnSync('taskkill', ['/PID', String(entry.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else process.kill(-entry.pid, 'SIGTERM');
    return true;
  } catch { return false; }
}

/**
 * A prod web server of ours on ANOTHER port set that serves `repo`'s .next, or null. `next build` writes one .next per
 * checkout with the API base baked in, so a second prod stack from the same checkout would rebuild it under that
 * running `next start` (which then serves a build pointing at the other set's Django, or nothing at all).
 * `alive` is injectable for the unit test.
 */
export function busyBuildOwner(raw, repo, ports, alive = stillOurs) {
  for (const e of raw?.started || []) {
    if (onPorts(ports)(e) || !/^web-/.test(e.name || '') || !e.repo || !sameDir(e.repo, repo)) continue;
    if (alive(e)) return e;
  }
  return null;
}

/** Spawn a detached server whose output goes to <uicHome>/logs/<name>.log. */
function startDetached(name, port, cmd, args, { repo, ports, cwd = repo, env = process.env, shell = false }) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${name}.log`);
  const fd = openSync(logFile, 'a');
  writeSync(fd, `\n===== ${new Date().toISOString()} (${repo}) ${shell ? cmd : [cmd, ...args].join(' ')}\n`);
  const child = shell
    ? spawn(cmd, { cwd, env, shell: true, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
    : spawn(cmd, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.unref();
  const image = WIN ? (shell ? 'cmd.exe' : path.basename(cmd).toLowerCase()) : null;
  log(`started ${name} on :${port} from ${repo} (pid ${child.pid}, log ${logFile})`);
  return { name, pid: child.pid, port, image, log: logFile, repo, ports };
}

function tail(file, n = 25) {
  try { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n).join('\n'); } catch { return ''; }
}

function git(args, repo) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr || '').slice(0, 300)}`);
  return r.stdout;
}

function parseEnvFile(file, repo = appRepo()) {
  const out = {};
  try {
    for (const line of readFileSync(path.join(repo, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* missing file */ }
  return out;
}

/** The env the prod build bakes in: ours for backend/socket, the repo's env files (Next's order) for the rest. */
function prodBuildEnv(ports, repo) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITE_') && !k.startsWith('NEXT_PUBLIC_')) env[k] = v;
  Object.assign(env, {
    VITE_BACKEND_URL: `http://localhost:${ports.django}/api`,
    VITE_SOCKET_URL: `http://localhost:${ports.socket}`,
    NBA_DEV_ENV_SKIP: '1',
  });
  const files = BUILD_ENV_FILES.map((f) => parseEnvFile(f, repo));
  const resolved = {};
  for (const k of INLINED_ENV) resolved[k] = env[k] ?? files.find((f) => k in f)?.[k] ?? '';
  return { env, resolved };
}

/** Source stamp: the build inputs at HEAD + their uncommitted diff + untracked files + the baked env. */
function buildStamp(resolved, repo) {
  const h = createHash('sha256');
  h.update(git(['ls-tree', 'HEAD', '--', ...BUILD_PATHS], repo));
  h.update(git(['diff', 'HEAD', '--binary', '--', ...BUILD_PATHS], repo));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...BUILD_PATHS], repo).toString('utf8').split('\0').filter(Boolean).sort();
  for (const f of untracked) {
    h.update(f);
    try { h.update(readFileSync(path.join(repo, f))); } catch { /* vanished */ }
  }
  let nextVersion = '';
  try { nextVersion = JSON.parse(readFileSync(path.join(repo, 'node_modules', 'next', 'package.json'), 'utf8')).version; } catch { /* none */ }
  h.update(JSON.stringify({ env: resolved, next: nextVersion }));
  return h.digest('hex').slice(0, 16);
}

// The app's code (what a check result depends on). scripts/ui-check is left out on purpose: a runner/doc commit
// does not make a run's results stale.
const APP_PATHS = ['src', 'backend', 'multiplayer_server'];
const CODE_KEYS = ['mode', 'appTree', 'diffHash', 'buildStamp'];

/**
 * The app code a run tested, for run-meta.json: { mode, head, appTree, dirty, diffHash, buildStamp }.
 * head is informational; equality (sameCode) compares mode, the HEAD trees of src/ backend/ multiplayer_server/
 * (appTree), their uncommitted diff + untracked files (diffHash, null when clean) and the frontend build stamp.
 * `repo`: the checkout under test (default UI_CHECK_REPO or the main checkout); `ports`: the stack's (baked into the build).
 */
export function codeState(mode, { repo = appRepo(), ports = PORT_SETS[mode] } = {}) {
  const sha = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return h.digest('hex').slice(0, 16); };
  const head = git(['rev-parse', 'HEAD'], repo).toString('utf8').trim();
  const appTree = sha(git(['ls-tree', 'HEAD', '--', ...APP_PATHS], repo));
  const diff = git(['diff', 'HEAD', '--binary', '--', ...APP_PATHS], repo);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...APP_PATHS], repo).toString('utf8').split('\0').filter(Boolean).sort();
  const dirty = diff.length > 0 || untracked.length > 0;
  const files = untracked.flatMap((f) => { try { return [f, readFileSync(path.join(repo, f))]; } catch { return [f]; } });
  return { mode, head, appTree, dirty, diffHash: dirty ? sha(diff, ...files) : null, buildStamp: buildStamp(prodBuildEnv(ports, repo).resolved, repo) };
}

/** Keys on which two codeState()s differ ([] = the same app code; a missing state differs on every key). */
export function codeDiff(a, b) {
  if (!a || !b) return [...CODE_KEYS];
  return CODE_KEYS.filter((k) => (a[k] ?? null) !== (b[k] ?? null));
}

function readStamp(repo) {
  try { return readFileSync(stampFile(repo), 'utf8').trim(); } catch { return null; }
}

/** scripts/copy-data.mjs of the repo (what `npm run build` / `npm run dev` run first). */
function copyData(repo, env) {
  const copy = spawnSync(process.execPath, [path.join(repo, 'scripts', 'copy-data.mjs')], { cwd: repo, env, encoding: 'utf8', windowsHide: true });
  if (copy.status !== 0) throw new Error(`copy-data failed: ${(copy.stderr || copy.stdout || '').slice(-400)}`);
}

function nextBuild(env, stamp, repo) {
  rmSync(stampFile(repo), { force: true }); // a failed build must not leave a matching stamp behind
  copyData(repo, env);
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, 'next-build.log');
  log(`building the frontend in ${repo} (next build, stamp ${stamp}) — log ${logFile}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [nextBin(repo), 'build'], { cwd: repo, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  writeFileSync(logFile, `${r.stdout || ''}\n${r.stderr || ''}`);
  if (r.status !== 0) throw new Error(`next build failed (exit ${r.status}):\n${tail(logFile, 30)}`);
  writeFileSync(stampFile(repo), stamp + '\n');
  log(`next build done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

const PREPARE_SQLITE = path.join(ROOT, 'scripts', 'check-core', 'lib', 'prepare_sqlite.py');
const SQLITE_SIDECARS = ['backend/db.sqlite3-wal', 'backend/db.sqlite3-shm'];

/** WAL mode (prepare_sqlite.py) keeps db.sqlite3-wal / -shm next to the database. Older refs' .gitignore names only
 *  db.sqlite3, and an untracked file under backend/ marks the tested code dirty (codeState): list them in the clone's
 *  shared info/exclude, which every worktree of it honours whatever ref it checks out. */
export function excludeSqliteSidecars(repo) {
  try {
    const common = path.resolve(repo, git(['rev-parse', '--git-common-dir'], repo).toString('utf8').trim());
    const file = path.join(common, 'info', 'exclude');
    const have = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const lines = have.split(/\r?\n/);
    const add = SQLITE_SIDECARS.filter((p) => !lines.includes(p));
    if (!add.length) return;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${have}${have && !have.endsWith('\n') ? '\n' : ''}${add.join('\n')}\n`);
  } catch (e) { log(`warning: info/exclude not updated (${String(e.message).split('\n')[0]})`); }
}

function migrate(repo) {
  const r = spawnSync(venvPython(repo), ['manage.py', 'migrate', '--noinput', '-v', '0'], { cwd: path.join(repo, 'backend'), env: djangoEnv(), encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`manage.py migrate failed: ${((r.stderr || '') + (r.stdout || '')).slice(-600)}`);
  // WAL (no more `database is locked` 500s under parallel checks) + Player rows (Wordle's words): prepare_sqlite.py.
  excludeSqliteSidecars(repo);
  const p = spawnSync(venvPython(repo), ['manage.py', 'shell', '-c', `import runpy; runpy.run_path(r'${PREPARE_SQLITE}', run_name='prepare')`], { cwd: path.join(repo, 'backend'), env: djangoEnv(), encoding: 'utf8', windowsHide: true });
  const line = String(p.stdout || '').split(/\r?\n/).find((l) => l.startsWith('PREPARE_SQLITE:'));
  if (p.status !== 0 || !line) log(`warning: prepare_sqlite.py failed, the checks run on a plain sqlite (expect "database is locked" and Wordle 500s): ${((p.stderr || '') + (p.stdout || '')).trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`);
  else log(line.replace('PREPARE_SQLITE: ', 'sqlite: '));
}

/**
 * How to run `manage.py runserver <port> --noreload`. On Windows the venv's python.exe is a launcher stub:
 * started detached it is killed within seconds (exit 0xC000013A, no log output) or never gets going, which made
 * the first Django start flaky. The base interpreter it points to (pyvenv.cfg `executable`) survives, so run that
 * one with the venv's site-packages added. Elsewhere (or when the cfg is unreadable) use the venv python as is.
 */
function djangoCommand(port, repo) {
  const py = venvPython(repo);
  const manage = ['manage.py', 'runserver', String(port), '--noreload'];
  if (WIN) {
    try {
      const venv = path.dirname(path.dirname(py));
      const cfg = readFileSync(path.join(venv, 'pyvenv.cfg'), 'utf8');
      const base = /^executable\s*=\s*(.+)$/m.exec(cfg)?.[1]?.trim();
      const sitePackages = path.join(venv, 'Lib', 'site-packages');
      if (base && existsSync(base) && existsSync(sitePackages)) {
        // addsitedir appends: move the venv's entries in front of the base interpreter's own site-packages (after the
        // stdlib, as in a real venv) so a package installed in both resolves to the venv's version.
        const code = `import site,sys,runpy
n=len(sys.path)
site.addsitedir(${JSON.stringify(sitePackages)})
venv=sys.path[n:]
del sys.path[n:]
i=next((k for k,p in enumerate(sys.path) if 'site-packages' in p.lower()),len(sys.path))
sys.path[i:i]=venv
sys.argv=${JSON.stringify(manage)}
runpy.run_path('manage.py', run_name='__main__')`;
        return { cmd: base, args: ['-c', code] };
      }
    } catch { /* fall back to the venv python */ }
  }
  return { cmd: py, args: manage };
}

/**
 * Shared key between the local relay and the local Django (MULTIPLAYER_SHARED_SECRET, X-Relay-Key), so a finished 1v1
 * match is credited like in production (`/trivia/multiplayer-result/`, "+N pts" in the results). Random per stack
 * (`randomBytes`, made by the ensureStack that starts the first of the two and kept in <uicHome>/stack.json, outside the
 * repo, while either process lives), never logged. A Django or relay not started by ui-check lacks it: nothing is credited,
 * unless its starter shares the key through UI_CHECK_RELAY_KEY (scripts/team/qa.mjs gives its lane Django the same key).
 */
function relayKeyFor(prev, known) {
  if (process.env.UI_CHECK_RELAY_KEY) return process.env.UI_CHECK_RELAY_KEY;
  return (prev && prev.relayKey && known.length) ? prev.relayKey : randomBytes(24).toString('hex');
}

function startDjango(port, webPort, relayKey, repo, ports) {
  migrate(repo);
  const { cmd, args } = djangoCommand(port, repo);
  return startDetached(`django-${port}`, port, cmd, args, {
    repo, ports,
    cwd: path.join(repo, 'backend'),
    env: djangoEnv({ CORS_ALLOWED_ORIGINS: `http://localhost:${webPort}`, MULTIPLAYER_SHARED_SECRET: relayKey }),
  });
}

/**
 * The relay's data hosts as production sets them (docs/constraints/MULTIPLAYER_CONSTRAINTS.md env table): the same public,
 * read-only hosts the site's build reads (VITE_DATA_BASE / VITE_QUESTIONS_BASE, env files in Next's order). Without them
 * the relay cannot deal the question games (career-path, who-are-ya, contexto) nor Tic-Tac-Toe: `roundDataError`.
 */
export function relayDataEnv(repo = appRepo()) {
  const files = BUILD_ENV_FILES.map((f) => parseEnvFile(f, repo));
  const pick = (k) => process.env[k] || files.find((f) => k in f)?.[k] || '';
  return { DATA_PUBLIC_BASE: process.env.DATA_PUBLIC_BASE || pick('VITE_DATA_BASE'), QUESTIONS_PUBLIC_BASE: process.env.QUESTIONS_PUBLIC_BASE || pick('VITE_QUESTIONS_BASE') };
}

/** The socket server with the env scripts/dev.mjs passes, on the given ports, plus the data hosts and the relay key. */
function startSocket(port, webPort, djangoPort, relayKey, repo, ports) {
  if (!existsSync(path.join(repo, 'multiplayer_server', 'node_modules'))) {
    throw new Error(`${repo}: multiplayer_server has no node_modules — run \`npm ci --prefix multiplayer_server\` in the main checkout (a checkout junctions it)`);
  }
  return startDetached(`socket-${port}`, port, process.execPath, ['multiplayer_server/src/index.js'], {
    repo, ports,
    env: { ...process.env, ...relayDataEnv(repo), MULTIPLAYER_SHARED_SECRET: relayKey, PORT: String(port), CORS_ORIGINS: `http://localhost:${webPort}`, API_BASE_URL: `http://localhost:${djangoPort}` },
  });
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

/** VITE_BACKEND_URL the running `npm run dev` read (scripts/dev-env.mjs writes it to .env.local). */
function devBackendUrl(repo) {
  return parseEnvFile('.env.local', repo).VITE_BACKEND_URL || parseEnvFile('.env', repo).VITE_BACKEND_URL || '';
}

/**
 * The stack.json meta of a port set. `djangoOurs`: its Django was started by this helper (now or recorded earlier).
 * A Django that was reused but not started by us runs code and a relay key nobody recorded: its entry gets
 * `repo: null, relayKey: null` — never the requested repo / key stamped onto a stack that may serve another checkout.
 */
export function stackMeta({ mode, repo, ports, base, api, socket, relayKey, keepStack, djangoOurs }) {
  return { mode, repo: djangoOurs ? repo : null, ports, base, api, socket, relayKey: djangoOurs ? relayKey : null, keepStack };
}

/** True when the recorded meta `prev` already says what `meta` says (then stack.json is not rewritten). */
export function sameMeta(prev, meta) {
  if (!prev || prev.mode !== meta.mode || prev.base !== meta.base || prev.api !== meta.api) return false;
  if ((prev.relayKey ?? null) !== meta.relayKey) return false;
  if (!prev.repo || !meta.repo) return !prev.repo && !meta.repo;
  return sameDir(prev.repo, meta.repo);
}

/**
 * Bring the stack for `mode` up on `ports` from `repo`, starting only what is not listening.
 * A process of ours on those ports that runs another repo's code is restarted from `repo`.
 * → { mode, repo, ports, base, api, socket, started } (`started`: what this call started; <uicHome>/stack.json keeps
 *   every process the helper started and has not stopped yet, per port set).
 * keepStack is recorded in the stack's entry (informational: `run.mjs --stop` stops it).
 */
export async function ensureStack(mode = 'prod', { repo = ROOT, ports = PORT_SETS[mode], keepStack = false } = {}) {
  if (!PORT_SETS[mode]) throw new Error(`unknown stack mode "${mode}" (prod|dev)`);
  if (!ports) throw new Error('ensureStack: no ports');
  repo = path.resolve(repo);
  const lane = portsKey(ports) !== portsKey(PORT_SETS.dev); // dev mode off the default ports: no `npm run dev`
  const prevRaw = readStackFile();
  const prev = prevRaw?.stacks?.[portsKey(ports)] || null;
  const prevStarted = (prevRaw?.started || []).filter(onPorts(ports));
  // Keep earlier entries on these ports whose process is still ours; drop the dead ones. Other port sets are not touched.
  const known = prevStarted.filter(stillOurs);
  const started = [];
  const ours = (port) => known.find((e) => e.port === port);
  // A port counts as up when it accepts connections. A process of ours that is still booting (recorded in
  // stack.json by whoever spawned it, possibly another process) is waited for, never spawned twice.
  const up = async (port) => isPortOpen(port);
  const booting = (port) => ours(port) || started.find((e) => e.port === port);
  const relayKey = relayKeyFor(prev, known);
  const base = `http://localhost:${ports.web}`;
  let api = `http://localhost:${ports.django}/api`;
  const socket = `http://localhost:${ports.socket}`;
  // Before waiting: the "starting" entry. Nothing started or dropped and the same meta: no rewrite, so the
  // Playwright workers that all ensure the same running stack do not race each other on stack.json.
  const record = () => {
    const djangoOurs = !!(ours(ports.django) || started.find((e) => e.port === ports.django));
    const meta = stackMeta({ mode, repo, ports, base, api, socket, relayKey, keepStack, djangoOurs });
    if (prev && !started.length && known.length === prevStarted.length && sameMeta(prev, meta)) return;
    updateStack(ports, meta, [...known, ...started]);
  };
  const reuse = (what, port) => log(`${what} :${port} already up — reusing${ours(port) ? ' (started by ui-check)' : ` (not ours: never stopped${sameDir(repo, ROOT) ? '' : `; its code may not be ${repo}`})`}`);

  if (mode === 'prod') {
    const owner = busyBuildOwner(prevRaw, repo, ports);
    if (owner) {
      throw new Error(`${repo} already serves the ${owner.ports ? portsKey(owner.ports) : `:${owner.port}`} stack (${owner.name}, pid ${owner.pid}) from its .next — `
        + 'a second prod stack from the same checkout would rebuild .next under it. Run from another checkout (--repo) or stop that stack first (--stop --ports <its set>)');
    }
  }

  // Ours but serving another checkout (e.g. the main checkout's Django while main is under test): restart from `repo`.
  for (const port of [ports.django, ports.socket, ports.web]) {
    const e = ours(port);
    if (!e || !e.repo || sameDir(e.repo, repo)) continue;
    log(`${e.name} :${port} runs ${e.repo}, not ${repo} — restarting it`);
    killTree(e);
    known.splice(known.indexOf(e), 1);
    for (let i = 0; i < 30 && (await up(port)); i++) await sleep(500);
  }

  const spawnDjango = () => { const e = startDjango(ports.django, ports.web, relayKey, repo, ports); started.push(e); record(); return e; };
  if (await up(ports.django)) reuse('django', ports.django);
  else if (booting(ports.django)) log(`django :${ports.django} is still starting (pid ${booting(ports.django).pid}) — waiting, not spawning`);
  else spawnDjango();

  if (mode === 'prod') {
    if (await up(ports.socket)) reuse('socket', ports.socket);
    else if (booting(ports.socket)) log(`socket :${ports.socket} is still starting — waiting, not spawning`);
    else { started.push(startSocket(ports.socket, ports.web, ports.django, relayKey, repo, ports)); record(); }

    const { env, resolved } = prodBuildEnv(ports, repo);
    const stamp = buildStamp(resolved, repo);
    const fresh = readStamp(repo) === stamp && existsSync(path.join(repo, '.next', 'BUILD_ID'));
    let webUp = await up(ports.web);
    if (webUp && !fresh && ours(ports.web)) {
      log(`source changed since the running build — restarting next start :${ports.web}`);
      killTree(ours(ports.web));
      known.splice(known.indexOf(ours(ports.web)), 1);
      for (let i = 0; i < 30 && (await up(ports.web)); i++) await sleep(500);
      webUp = false;
    }
    if (!webUp && booting(ports.web)) {
      log(`web :${ports.web} is still starting — waiting, not spawning`);
    } else if (webUp) {
      reuse('web', ports.web);
      if (!fresh) {
        log(`WARNING: the source changed since the last ui-check build (stamp ${readStamp(repo) || 'none'} ≠ ${stamp}), but the server on :${ports.web} `
          + 'was not started by ui-check, so it is reused as is — it may serve a STALE build. Stop it to get a rebuild.');
      }
    } else {
      if (fresh) log(`build up to date (stamp ${stamp}) — skipping next build`);
      else nextBuild(env, stamp, repo);
      started.push(startDetached(`web-${ports.web}`, ports.web, process.execPath, [nextBin(repo), 'start', '-p', String(ports.web)], { env, repo, ports }));
      record();
    }
  } else {
    await waitForUrl(`${api}/health/`, 150_000, booting(ports.django)); // dev-env.mjs (predev) must see :8000 up to pick the local backend
    const webUp = await up(ports.web);
    if (webUp) {
      reuse('web', ports.web);
      // `npm run dev` starts the socket; when the site is already up without one, start it here.
      if (await up(ports.socket)) reuse('socket', ports.socket);
      else started.push(startSocket(ports.socket, ports.web, ports.django, relayKey, repo, ports));
    } else {
      // Our relay first (data hosts + relay key): scripts/dev.mjs reuses a socket already listening on its port.
      if (await up(ports.socket)) reuse('socket', ports.socket);
      else {
        started.push(startSocket(ports.socket, ports.web, ports.django, relayKey, repo, ports));
        record();
        for (let i = 0; i < 40 && !(await up(ports.socket)); i++) await sleep(250);
      }
      const env = {};
      for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITE_') && k !== 'NBA_DEV_ENV_SKIP') env[k] = v;
      if (lane) {
        // A lane: never touch the default ports (no dev-env probe, no dev.mjs socket), pin the lane's backend and socket.
        // Next 16 allows one `next dev` per directory: a lane runs from its own worktree (--repo).
        Object.assign(env, { NBA_DEV_ENV_SKIP: '1', VITE_BACKEND_URL: api, VITE_SOCKET_URL: socket });
        copyData(repo, env);
        started.push(startDetached(`web-${ports.web}`, ports.web, process.execPath, [nextBin(repo), 'dev', '-p', String(ports.web)], { env, repo, ports }));
      } else {
        started.push(startDetached(`web-${ports.web}`, ports.web, 'npm run dev', [], { env, shell: true, repo, ports }));
      }
    }
  }

  record();
  try {
    try {
      await waitForUrl(`${api}/health/`, 150_000, booting(ports.django));
    } catch (e) {
      // Django that never answered (or died while booting): kill that process and start it once more.
      const dead = booting(ports.django);
      if (!dead) {
        throw new Error(`django :${ports.django} is not ours (not started by ui-check) and failed its health check: ${String(e.message).slice(0, 200)} - stop whatever listens on that port; ui-check will not start a second server on it`);
      }
      log(`django :${ports.django} did not come up (${String(e.message).slice(0, 120)}) — restarting it once`);
      killTree(dead);
      for (const list of [known, started]) { const i = list.indexOf(dead); if (i >= 0) list.splice(i, 1); }
      spawnDjango();
      await waitForUrl(`${api}/health/`, 150_000, booting(ports.django));
    }
    await waitForUrl(base, mode === 'dev' ? 300_000 : 120_000, booting(ports.web));
  } catch (e) {
    const logs = [...known, ...started].map((s) => `--- ${s.name} (${s.log})\n${tail(s.log, 15)}`).join('\n');
    throw new Error(`${e.message}${logs ? `\n${logs}` : ''}`);
  }
  if (mode === 'dev' && !lane) {
    // The dev site must talk to the local Django, never the deployed one. Read after the site
    // answered, so a dev server started above has already had dev-env.mjs rewrite .env.local.
    const backend = devBackendUrl(repo);
    if (hostOf(backend) !== 'localhost') {
      throw new Error(`dev site backend is "${backend || '(unset)'}" (.env.local), not localhost — restart \`npm run dev\` while Django runs on :8000`);
    }
    api = backend.replace(/\/+$/, '');
    record();
  }
  log(`${mode} stack ready from ${repo}: web ${base} · api ${api} · socket ${socket}${started.length ? ` · started ${started.map((s) => s.name).join(', ')}` : ' · nothing started'}`);
  return { mode, repo, ports, base, api, socket, started: started.map(({ name, pid, port }) => ({ name, pid, port })) };
}

/**
 * Stop processes recorded in <uicHome>/stack.json (only those — never anything else).
 * `ports`: only the entries on that port set (a lane's stack, or one checker mode's); the other stacks keep running.
 * `only`: [{ pid }] — just these (e.g. what one ensureStack call started). Neither: every recorded process.
 */
export async function stopStack({ only = null, ports = null } = {}) {
  const raw = readStackFile();
  if (!raw || !raw.started.length) { log('nothing to stop'); return []; }
  let targets = raw.started;
  if (ports) targets = targets.filter(onPorts(ports));
  if (only) { const pids = new Set(only.map((e) => e.pid)); targets = targets.filter((e) => pids.has(e.pid)); }
  if (!targets.length) { log('nothing of ours to stop — the rest of the stack keeps running'); return []; }
  const stopped = [];
  for (const entry of targets) {
    if (killTree(entry)) stopped.push(entry.name);
  }
  const gone = (e) => targets.some((t) => t.pid === e.pid && t.port === e.port);
  withStackLock(() => {
    const fresh = readStackFile() || raw; // re-read: another stack may have written meanwhile
    writeStack({ stacks: fresh.stacks, started: fresh.started.filter((e) => !gone(e)) });
  });
  log(stopped.length ? `stopped ${stopped.join(', ')}` : 'recorded processes were already gone');
  return stopped;
}
