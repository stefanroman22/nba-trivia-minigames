// Selftest for stack.json bookkeeping (check-core/lib/stack.mjs): two processes recording stacks at the same moment
// (a checker stack and a pipeline lane) never lose each other's entries. Runs in a throwaway UI_CHECK_HOME, so the real
// stack.json is never touched. No browser, no server.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { ROOT } from '../../../check-core/lib/home.mjs';

const STACK = pathToFileURL(path.join(ROOT, 'scripts', 'check-core', 'lib', 'stack.mjs')).href;
const N = 40;

/** Run an ESM snippet in a child node with UI_CHECK_HOME=home; rejects with its stderr on a non-zero exit. */
const node = (home, code) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, UI_CHECK_HOME: home }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`child exited ${c}: ${err.slice(0, 500)}`))));
});

/** A child that waits for `startAt`, then records N port sets (each with one process entry) one after another. */
const writer = (home, base, startAt) => node(home, `
    const { updateStack } = await import(${JSON.stringify(STACK)});
    while (Date.now() < ${startAt}) {}
    for (let i = 0; i < ${N}; i++) {
      const ports = { django: ${base} + i, socket: ${base} + 1000 + i, web: ${base} + 2000 + i };
      updateStack(ports, { mode: 'dev', repo: 'r${base}', ports }, [{ name: 'django-' + ports.django, pid: ${base} + i, port: ports.django }]);
    }`);

test('[ST-STACKLOCK] two processes recording stacks at once both keep every entry (stack.json lock)', async () => {
  test.setTimeout(120_000);
  const home = mkdtempSync(path.join(os.tmpdir(), 'uic-stacklock-'));
  try {
    const startAt = Date.now() + 1500; // both children are loaded by then, so their writes really overlap
    await Promise.all([writer(home, 20000, startAt), writer(home, 30000, startAt)]);
    const data = JSON.parse(readFileSync(path.join(home, 'stack.json'), 'utf8'));
    const keys = Object.keys(data.stacks);
    expect(keys.filter((k) => k.startsWith('2')), 'every stack of writer A').toHaveLength(N);
    expect(keys.filter((k) => k.startsWith('3')), 'every stack of writer B').toHaveLength(N);
    expect(data.started, 'every process entry of both writers').toHaveLength(2 * N);
    expect(readFileSync(path.join(home, 'stack.json'), 'utf8')).toContain('"r30000"');
    let lockLeft = true;
    try { readFileSync(path.join(home, 'stack.json.lock')); } catch { lockLeft = false; }
    expect(lockLeft, 'the lock is released').toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }

  // A stale lock (a crashed holder, 60 s old) with two takers at once: exactly one takes it over at a time, neither ever
  // deletes the other's live lock (the critical sections never overlap), and nothing is left behind.
  const home2 = mkdtempSync(path.join(os.tmpdir(), 'uic-stalelock-'));
  try {
    const lock = path.join(home2, 'stack.json.lock');
    writeFileSync(lock, 'crashed-holder');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const log = path.join(home2, 'sections.log');
    const startAt = Date.now() + 1500;
    await Promise.all(['A', 'B'].map((who) => node(home2, `
      const { withStackLock } = await import(${JSON.stringify(STACK)});
      const { appendFileSync } = await import('node:fs');
      while (Date.now() < ${startAt}) {}
      for (let i = 0; i < 5; i++) withStackLock(() => {
        appendFileSync(${JSON.stringify(log)}, 'in ${who}\\n');
        const t = Date.now(); while (Date.now() - t < 150) {}
        appendFileSync(${JSON.stringify(log)}, 'out ${who}\\n');
      });`)));
    const lines = readFileSync(log, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(20);
    for (let i = 0; i < lines.length; i += 2) {
      expect(lines[i].startsWith('in '), `section ${i / 2} opens`).toBe(true);
      expect(lines[i + 1], `section ${i / 2} closes before another opens`).toBe(lines[i].replace('in ', 'out '));
    }
    expect(readdirSync(home2).filter((f) => f.includes('lock')), 'no lock or moved stale lock left').toEqual([]);

    // The losing taker, deterministically: it saw the lock stale, but the winner has replaced it with its own live lock
    // by the time the loser acts. The loser's takeover must leave the winner's lock in place.
    writeFileSync(lock, 'winner-token');
    await node(home2, `
      const { takeOverStale } = await import(${JSON.stringify(STACK)});
      takeOverStale('loser-token');`);
    expect(readFileSync(lock, 'utf8'), 'the winner keeps its live lock').toBe('winner-token');
    expect(readdirSync(home2).filter((f) => f.includes('stale')), 'nothing moved aside is left').toEqual([]);
  } finally {
    rmSync(home2, { recursive: true, force: true });
  }
});
