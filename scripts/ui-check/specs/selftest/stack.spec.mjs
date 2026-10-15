// Selftest for stack.json bookkeeping (check-core/lib/stack.mjs): two processes recording stacks at the same moment
// (a checker stack and a pipeline lane) never lose each other's entries. Runs in a throwaway UI_CHECK_HOME, so the real
// stack.json is never touched. No browser, no server.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { ROOT } from '../../../check-core/lib/home.mjs';

const STACK = pathToFileURL(path.join(ROOT, 'scripts', 'check-core', 'lib', 'stack.mjs')).href;
const N = 40;

/** A child that waits for `startAt`, then records N port sets (each with one process entry) one after another. */
const writer = (home, base, startAt) => new Promise((resolve, reject) => {
  const code = `
    const { updateStack } = await import(${JSON.stringify(STACK)});
    while (Date.now() < ${startAt}) {}
    for (let i = 0; i < ${N}; i++) {
      const ports = { django: ${base} + i, socket: ${base} + 1000 + i, web: ${base} + 2000 + i };
      updateStack(ports, { mode: 'dev', repo: 'r${base}', ports }, [{ name: 'django-' + ports.django, pid: ${base} + i, port: ports.django }]);
    }`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env: { ...process.env, UI_CHECK_HOME: home }, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  child.on('error', reject);
  child.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`writer ${base} exited ${c}: ${err.slice(0, 500)}`))));
});

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
});
