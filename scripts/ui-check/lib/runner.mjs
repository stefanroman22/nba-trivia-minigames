// Shared by run.mjs, verify.mjs, probe.mjs and report.mjs: one Playwright invocation at a time (async, so signal
// handlers can run meanwhile), --only → --grep, and the emergency stop that takes the child and the stack down.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './run-id.mjs';
import { stopStack } from './stack.mjs';
import { activePorts } from '../../check-core/lib/ports.mjs';

export const UIC = path.join(REPO_ROOT, 'scripts', 'ui-check');
const PW_CLI = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
/** The Logic Check runner (scripts/logic-check/run.mjs); verify's `lc` criteria run through it. */
export const LOGIC_RUN = path.join(REPO_ROOT, 'scripts', 'logic-check', 'run.mjs');

const list = (s) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

/** --only ids (`*` matches within an id) → a --grep for `[ID]` titles, or null. */
export function grepFor(only) {
  if (!only) return null;
  const ids = list(only).map((id) => id.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\w.-]*'));
  return `\\[(${ids.join('|')})\\]`;
}

// The running Playwright child, so an interrupt can take it down with the stack.
let child = null;

/**
 * Run one Playwright invocation → its exit code. `log`: a file that takes the child's stdout/stderr instead of this
 * terminal (verify/probe keep their own output compact); without it the child inherits stdio and a header is printed.
 */
export function playwright(projects, { workers, grep, grepInvert, headed, env, log = null }) {
  const args = [PW_CLI, 'test', '-c', path.relative(REPO_ROOT, UIC), '--workers', String(workers), '--pass-with-no-tests'];
  for (const p of projects) args.push('--project', p);
  if (grep) args.push('--grep', grep);
  if (grepInvert) args.push('--grep-invert', grepInvert);
  if (headed) args.push('--headed');
  if (!log) console.log(`\nui-check: playwright ${projects.length} project(s), ${workers} worker(s)${grep ? `, --grep ${grep}` : ''}${grepInvert ? `, --grep-invert ${grepInvert}` : ''}`);
  return runChild(args, { env, log });
}

/**
 * `node scripts/logic-check/run.mjs --only <ids> --mode <mode> --keep-stack` → its exit code (output to `log`). The
 * caller points UI_CHECK_RUN at a scratch run in `env` and reads that run's results.json (the shared reporter shape).
 */
export function logicCheck(ids, { mode, env, log = null }) {
  return runChild([LOGIC_RUN, '--only', ids.join(','), '--mode', mode, '--keep-stack'], { env, log });
}

/** One child node process (the interruptible `child`), stdout/stderr to `log` or inherited → its exit code. */
function runChild(args, { env, log }) {
  let fd = null;
  if (log) { mkdirSync(path.dirname(log), { recursive: true }); fd = openSync(log, 'a'); }
  return new Promise((resolve) => {
    const done = (code) => { child = null; if (fd !== null) closeSync(fd); resolve(code); };
    child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: fd === null ? 'inherit' : ['ignore', fd, fd], env: { ...process.env, ...env } });
    child.on('error', () => done(1));
    child.on('exit', (code) => done(code ?? 1));
  });
}

/**
 * Ctrl+C / SIGTERM / an uncaught error: kill the Playwright child and stop the stack (unless keepStack),
 * since the caller's `finally` never runs then. A hard kill (taskkill /F, SIGKILL) can't be caught: use run.mjs --stop.
 * `onExit` runs first (e.g. restore a pointer file). `stop` replaces the default stop of this process's stack (the
 * ports of UI_CHECK_PORTS or the mode; verify/probe/report stop only what they started).
 */
export function installEmergencyStop(keepStack, onExit = null, stop = () => stopStack({ ports: activePorts() })) {
  let stopping = false;
  const bail = async (why, code) => {
    if (stopping) return;
    stopping = true;
    console.error(`\nui-check: ${why} — stopping${keepStack ? ' (stack kept: --keep-stack)' : ' the stack'}`);
    if (child?.pid) {
      try {
        if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
        else child.kill('SIGTERM');
      } catch { /* already gone */ }
    }
    try { if (onExit) onExit(); } catch { /* best effort */ }
    if (!keepStack) await Promise.resolve().then(stop).catch((e) => console.error(`ui-check: stopStack failed: ${e.message}`));
    process.exit(code);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  for (const sig of signals) process.on(sig, () => bail(`received ${sig}`, 130));
  process.on('uncaughtException', (e) => bail(`uncaught error: ${(e && e.stack) || e}`, 1));
  process.on('unhandledRejection', (e) => bail(`unhandled rejection: ${(e && e.stack) || e}`, 1));
}
