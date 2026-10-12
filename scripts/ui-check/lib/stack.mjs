// Local app stack for the UI check (spec §4). Starts only what is not already listening, records
// what it started in .ui-check/stack.json and stops only those processes.
//   prod: Django :8200 (sqlite) + socket :4200 + `next build` (only when the source stamp changed) and
//         `next start` :5374 — real speed numbers, no dev overlay.
//   dev:  Django :8000 + `npm run dev` :5173 (which starts the socket on :4000) — HMR for fix loops.
// Servers are detached with their output in .ui-check/logs/, so they outlive the process that
// started them (a Playwright worker) until stopStack().
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { connect } from 'node:net';
import path from 'node:path';
import { REPO_ROOT, UIC_ROOT } from './run-id.mjs';

export const MODES = {
  prod: { django: 8200, socket: 4200, web: 5374 },
  dev: { django: 8000, socket: 4000, web: 5173 },
};

const WIN = process.platform === 'win32';
const STACK_FILE = path.join(UIC_ROOT, 'stack.json');
const LOG_DIR = path.join(UIC_ROOT, 'logs');
const STAMP_FILE = path.join(REPO_ROOT, '.next', 'UICHECK_STAMP');
const NEXT_BIN = path.join(REPO_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
// Everything `next build` reads from the repo. A change elsewhere (scripts, docs, backend code)
// does not invalidate the build, so committing a runner fix never costs a rebuild.
const BUILD_PATHS = ['src', 'public', 'backend/trivia/data', 'next.config.ts', 'package.json', 'package-lock.json',
  'postcss.config.js', 'tailwind.config.js', 'tsconfig.json'];
// The browser-side env next.config.ts inlines, and the files Next reads them from for `next build`.
const INLINED_ENV = ['VITE_BACKEND_URL', 'VITE_SOCKET_URL', 'VITE_DATA_BASE', 'VITE_QUESTIONS_BASE'];
const BUILD_ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];

const log = (m) => console.log(`stack: ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** Poll a URL until it answers below 500. */
export async function waitForUrl(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.status < 500) return true;
    } catch { /* not up yet */ }
    await sleep(1000);
  }
  throw new Error(`${url} did not answer within ${Math.round(timeoutMs / 1000)}s`);
}

/** The backend venv's python (as scripts/team/qa.mjs finds it). */
export function venvPython() {
  const rel = WIN ? ['backend/.venv/Scripts/python.exe', 'backend/venv/Scripts/python.exe'] : ['backend/.venv/bin/python', 'backend/venv/bin/python'];
  for (const c of rel) if (existsSync(path.join(REPO_ROOT, c))) return path.join(REPO_ROOT, c);
  return WIN ? 'python' : 'python3';
}

/** Env for anything Django: always the local sqlite DB and locmem cache, never the dev-env probe. */
export function djangoEnv(extra = {}) {
  return { ...process.env, DATABASE_URL: '', REDIS_URL: '', NBA_DEV_ENV_SKIP: '1', PYTHONUNBUFFERED: '1', ...extra };
}

export function readStack() {
  try { return JSON.parse(readFileSync(STACK_FILE, 'utf8')); } catch { return null; }
}

function writeStack(data) {
  mkdirSync(UIC_ROOT, { recursive: true });
  writeFileSync(STACK_FILE, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }, null, 2));
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

/** Spawn a detached server whose output goes to .ui-check/logs/<name>.log. */
function startDetached(name, port, cmd, args, { cwd = REPO_ROOT, env = process.env, shell = false } = {}) {
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, `${name}.log`);
  const fd = openSync(logFile, 'a');
  writeSync(fd, `\n===== ${new Date().toISOString()} ${shell ? cmd : [cmd, ...args].join(' ')}\n`);
  const child = shell
    ? spawn(cmd, { cwd, env, shell: true, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] })
    : spawn(cmd, args, { cwd, env, detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  child.unref();
  const image = WIN ? (shell ? 'cmd.exe' : path.basename(cmd).toLowerCase()) : null;
  log(`started ${name} on :${port} (pid ${child.pid}, log ${path.relative(REPO_ROOT, logFile)})`);
  return { name, pid: child.pid, port, image, log: logFile };
}

function tail(file, n = 25) {
  try { return readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).slice(-n).join('\n'); } catch { return ''; }
}

function git(args) {
  const r = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(r.stderr || '').slice(0, 300)}`);
  return r.stdout;
}

function parseEnvFile(file) {
  const out = {};
  try {
    for (const line of readFileSync(path.join(REPO_ROOT, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in out)) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  } catch { /* missing file */ }
  return out;
}

/** The env the prod build bakes in: ours for backend/socket, the env files (Next's order) for the rest. */
function prodBuildEnv(ports) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITE_') && !k.startsWith('NEXT_PUBLIC_')) env[k] = v;
  Object.assign(env, {
    VITE_BACKEND_URL: `http://localhost:${ports.django}/api`,
    VITE_SOCKET_URL: `http://localhost:${ports.socket}`,
    NBA_DEV_ENV_SKIP: '1',
  });
  const files = BUILD_ENV_FILES.map(parseEnvFile);
  const resolved = {};
  for (const k of INLINED_ENV) resolved[k] = env[k] ?? files.find((f) => k in f)?.[k] ?? '';
  return { env, resolved };
}

/** Source stamp: the build inputs at HEAD + their uncommitted diff + untracked files + the baked env. */
function buildStamp(resolved) {
  const h = createHash('sha256');
  h.update(git(['ls-tree', 'HEAD', '--', ...BUILD_PATHS]));
  h.update(git(['diff', 'HEAD', '--binary', '--', ...BUILD_PATHS]));
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z', '--', ...BUILD_PATHS]).toString('utf8').split('\0').filter(Boolean).sort();
  for (const f of untracked) {
    h.update(f);
    try { h.update(readFileSync(path.join(REPO_ROOT, f))); } catch { /* vanished */ }
  }
  let nextVersion = '';
  try { nextVersion = JSON.parse(readFileSync(path.join(REPO_ROOT, 'node_modules', 'next', 'package.json'), 'utf8')).version; } catch { /* none */ }
  h.update(JSON.stringify({ env: resolved, next: nextVersion }));
  return h.digest('hex').slice(0, 16);
}

function readStamp() {
  try { return readFileSync(STAMP_FILE, 'utf8').trim(); } catch { return null; }
}

function nextBuild(env, stamp) {
  rmSync(STAMP_FILE, { force: true }); // a failed build must not leave a matching stamp behind
  const copy = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts', 'copy-data.mjs')], { cwd: REPO_ROOT, env, encoding: 'utf8', windowsHide: true });
  if (copy.status !== 0) throw new Error(`copy-data failed: ${(copy.stderr || copy.stdout || '').slice(-400)}`);
  mkdirSync(LOG_DIR, { recursive: true });
  const logFile = path.join(LOG_DIR, 'next-build.log');
  log(`building the frontend (next build, stamp ${stamp}) — log ${path.relative(REPO_ROOT, logFile)}`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [NEXT_BIN, 'build'], { cwd: REPO_ROOT, env, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });
  writeFileSync(logFile, `${r.stdout || ''}\n${r.stderr || ''}`);
  if (r.status !== 0) throw new Error(`next build failed (exit ${r.status}):\n${tail(logFile, 30)}`);
  writeFileSync(STAMP_FILE, stamp + '\n');
  log(`next build done in ${Math.round((Date.now() - t0) / 1000)}s`);
}

function migrate() {
  const r = spawnSync(venvPython(), ['manage.py', 'migrate', '--noinput', '-v', '0'], { cwd: path.join(REPO_ROOT, 'backend'), env: djangoEnv(), encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`manage.py migrate failed: ${((r.stderr || '') + (r.stdout || '')).slice(-600)}`);
}

function startDjango(port, webPort) {
  migrate();
  return startDetached(`django-${port}`, port, venvPython(), ['manage.py', 'runserver', String(port), '--noreload'], {
    cwd: path.join(REPO_ROOT, 'backend'),
    env: djangoEnv({ CORS_ALLOWED_ORIGINS: `http://localhost:${webPort}` }),
  });
}

/** The socket server with the env scripts/dev.mjs passes, on the given ports. */
function startSocket(port, webPort, djangoPort) {
  if (!existsSync(path.join(REPO_ROOT, 'multiplayer_server', 'node_modules'))) {
    throw new Error('multiplayer_server has no node_modules — run `npm ci --prefix multiplayer_server`');
  }
  return startDetached(`socket-${port}`, port, process.execPath, ['multiplayer_server/src/index.js'], {
    env: { ...process.env, PORT: String(port), CORS_ORIGINS: `http://localhost:${webPort}`, API_BASE_URL: `http://localhost:${djangoPort}` },
  });
}

const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };

/** VITE_BACKEND_URL the running `npm run dev` read (scripts/dev-env.mjs writes it to .env.local). */
function devBackendUrl() {
  return parseEnvFile('.env.local').VITE_BACKEND_URL || parseEnvFile('.env').VITE_BACKEND_URL || '';
}

/**
 * Bring the stack for `mode` up, starting only what is not listening.
 * → { mode, base, api, socket, started } (`started`: what this call started; .ui-check/stack.json keeps
 *   every process the helper started and has not stopped yet).
 */
export async function ensureStack(mode = 'prod') {
  const ports = MODES[mode];
  if (!ports) throw new Error(`unknown stack mode "${mode}" (prod|dev)`);
  const prev = readStack();
  // Keep earlier entries (any mode) whose process is still ours; drop the dead ones.
  const known = (prev?.started || []).filter(stillOurs);
  const started = [];
  const ours = (port) => known.find((e) => e.port === port);
  const up = async (port) => isPortOpen(port);
  const reuse = (what, port) => log(`${what} :${port} already up — reusing${ours(port) ? ' (started by ui-check)' : ' (not ours: never stopped)'}`);

  const base = `http://localhost:${ports.web}`;
  let api = `http://localhost:${ports.django}/api`;
  const socket = `http://localhost:${ports.socket}`;

  if (await up(ports.django)) reuse('django', ports.django);
  else started.push(startDjango(ports.django, ports.web));

  if (mode === 'prod') {
    if (await up(ports.socket)) reuse('socket', ports.socket);
    else started.push(startSocket(ports.socket, ports.web, ports.django));

    const { env, resolved } = prodBuildEnv(ports);
    const stamp = buildStamp(resolved);
    const fresh = readStamp() === stamp && existsSync(path.join(REPO_ROOT, '.next', 'BUILD_ID'));
    let webUp = await up(ports.web);
    if (webUp && !fresh && ours(ports.web)) {
      log(`source changed since the running build — restarting next start :${ports.web}`);
      killTree(ours(ports.web));
      known.splice(known.indexOf(ours(ports.web)), 1);
      for (let i = 0; i < 30 && (await up(ports.web)); i++) await sleep(500);
      webUp = false;
    }
    if (webUp) {
      reuse('web', ports.web);
      if (!fresh) {
        log(`WARNING: the source changed since the last ui-check build (stamp ${readStamp() || 'none'} ≠ ${stamp}), but the server on :${ports.web} `
          + 'was not started by ui-check, so it is reused as is — it may serve a STALE build. Stop it to get a rebuild.');
      }
    } else {
      if (fresh) log(`build up to date (stamp ${stamp}) — skipping next build`);
      else nextBuild(env, stamp);
      started.push(startDetached(`web-${ports.web}`, ports.web, process.execPath, [NEXT_BIN, 'start', '-p', String(ports.web)], { env }));
    }
  } else {
    await waitForUrl(`${api}/health/`, 90_000); // dev-env.mjs (predev) must see :8000 up to pick the local backend
    const webUp = await up(ports.web);
    if (webUp) {
      reuse('web', ports.web);
      // `npm run dev` starts the socket; when the site is already up without one, start it here.
      if (await up(ports.socket)) reuse('socket', ports.socket);
      else started.push(startSocket(ports.socket, ports.web, ports.django));
    } else {
      const env = {};
      for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('VITE_') && k !== 'NBA_DEV_ENV_SKIP') env[k] = v;
      started.push(startDetached(`web-${ports.web}`, ports.web, 'npm run dev', [], { env, shell: true }));
    }
  }

  const all = [...known, ...started];
  writeStack({ mode, base, api, socket, started: all });
  try {
    await waitForUrl(`${api}/health/`, 90_000);
    await waitForUrl(base, mode === 'dev' ? 300_000 : 120_000);
  } catch (e) {
    const logs = started.map((s) => `--- ${s.name} (${path.relative(REPO_ROOT, s.log)})\n${tail(s.log, 15)}`).join('\n');
    throw new Error(`${e.message}${logs ? `\n${logs}` : ''}`);
  }
  if (mode === 'dev') {
    // The dev site must talk to the local Django, never the deployed one. Read after the site
    // answered, so a dev server started above has already had dev-env.mjs rewrite .env.local.
    const backend = devBackendUrl();
    if (hostOf(backend) !== 'localhost') {
      throw new Error(`dev site backend is "${backend || '(unset)'}" (.env.local), not localhost — restart \`npm run dev\` while Django runs on :8000`);
    }
    api = backend.replace(/\/+$/, '');
    writeStack({ mode, base, api, socket, started: all });
  }
  log(`${mode} stack ready: web ${base} · api ${api} · socket ${socket}${started.length ? ` · started ${started.map((s) => s.name).join(', ')}` : ' · nothing started'}`);
  return { mode, base, api, socket, started: started.map(({ name, pid, port }) => ({ name, pid, port })) };
}

/** Stop every process recorded in .ui-check/stack.json (only those — never anything else). */
export async function stopStack() {
  const stack = readStack();
  if (!stack || !stack.started?.length) { log('nothing to stop'); return []; }
  const stopped = [];
  for (const entry of stack.started) {
    if (killTree(entry)) stopped.push(entry.name);
  }
  writeStack({ ...stack, started: [] });
  log(stopped.length ? `stopped ${stopped.join(', ')}` : 'recorded processes were already gone');
  return stopped;
}
