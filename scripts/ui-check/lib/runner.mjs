// Shared by run.mjs, verify.mjs, probe.mjs and report.mjs: one Playwright invocation at a time (async, so signal
// handlers can run meanwhile), --only → --grep, and the emergency stop that takes the child and the stack down.
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './run-id.mjs';
import { stopStack } from './stack.mjs';

export const UIC = path.join(REPO_ROOT, 'scripts', 'ui-check');
const PW_CLI = path.join(REPO_ROOT, 'node_modules', '@playwright', 'test', 'cli.js');

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
  let fd = null;
  if (log) { mkdirSync(path.dirname(log), { recursive: true }); fd = openSync(log, 'a'); }
  else console.log(`\nui-check: playwright ${projects.length} project(s), ${workers} worker(s)${grep ? `, --grep ${grep}` : ''}${grepInvert ? `, --grep-invert ${grepInvert}` : ''}`);
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
 * `onExit` runs first (e.g. restore a pointer file).
 */
export function installEmergencyStop(keepStack, onExit = null) {
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
    if (!keepStack) await stopStack().catch((e) => console.error(`ui-check: stopStack failed: ${e.message}`));
    process.exit(code);
  };
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP', ...(process.platform === 'win32' ? ['SIGBREAK'] : [])];
  for (const sig of signals) process.on(sig, () => bail(`received ${sig}`, 130));
  process.on('uncaughtException', (e) => bail(`uncaught error: ${(e && e.stack) || e}`, 1));
  process.on('unhandledRejection', (e) => bail(`unhandled rejection: ${(e && e.stack) || e}`, 1));
}
