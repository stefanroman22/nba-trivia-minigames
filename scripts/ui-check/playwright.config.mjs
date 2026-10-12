// UI check — Playwright Test config. Run through node, never the npx string form:
//   node node_modules/@playwright/test/cli.js test -c scripts/ui-check --project selftest
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { VIEWPORTS, MP_PAIRS, contextOptions } from './lib/viewports.mjs';
import { UIC_ROOT, runId } from './lib/run-id.mjs';
import { MODES } from './lib/stack.mjs';

// Fix the run id in the main process so every worker inherits the same UI_CHECK_RUN.
runId();

// Stack mode (spec §4): run.mjs sets UI_CHECK_MODE; a direct invocation defaults to prod, like stack-setup.
const MODE = process.env.UI_CHECK_MODE || 'prod';
if (!MODES[MODE]) throw new Error(`UI_CHECK_MODE must be prod or dev, got "${MODE}"`);
const BASE_URL = `http://localhost:${MODES[MODE].web}`;

/**
 * Browser channel, mirroring scripts/qa-browser.mjs#launchBrowser: installed Chrome on win32,
 * then Edge, else Playwright's bundled Chromium. Chosen by checking the install paths so a missing
 * channel never hard-fails the run. UI_CHECK_CHANNEL overrides ('' = bundled).
 */
export function pickChannel() {
  if (process.env.UI_CHECK_CHANNEL !== undefined) return process.env.UI_CHECK_CHANNEL || undefined;
  if (process.platform !== 'win32') return undefined;
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const has = (rel) => roots.some((r) => existsSync(path.join(r, rel)));
  if (has('Google/Chrome/Application/chrome.exe')) return 'chrome';
  if (has('Microsoft/Edge/Application/msedge.exe')) return 'msedge';
  return undefined;
}

/** One project per viewport for a suite: `<suite>@<vpId>`, carrying {vpId, persona, suite} in `use`. */
export function suiteProjects(suite, { vps = Object.keys(VIEWPORTS), persona = 'guest', testDir = `./specs/${suite}` } = {}) {
  return vps.map((id) => ({
    name: `${suite}@${id}`,
    testDir,
    use: { ...contextOptions(id), vpId: id, persona, suite },
  }));
}

/** A project that runs against the app: needs the stack (stack-setup) and the mode's baseURL. */
const onApp = (p) => ({ ...p, dependencies: ['stack-setup'], use: { ...p.use, baseURL: BASE_URL } });

export default defineConfig({
  testDir: './specs',
  outputDir: path.join(UIC_ROOT, 'pw-output'),
  fullyParallel: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['./lib/digest-reporter.mjs']],
  use: {
    channel: pickChannel(),
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'selftest',
      testDir: './specs/selftest',
      use: { ...contextOptions('phone-360'), vpId: 'phone-360', persona: 'guest', suite: 'selftest' },
    },
    // Local stack as project dependencies (not globalSetup), so selftest never starts a server.
    // Teardown stops what setup started unless UI_CHECK_KEEP_STACK=1 (run.mjs stops it itself).
    { name: 'stack-setup', testDir: './lib', testMatch: /stack\.setup\.mjs$/, teardown: 'stack-teardown' },
    { name: 'stack-teardown', testDir: './lib', testMatch: /stack\.teardown\.mjs$/ },
    ...suiteProjects('guest', { persona: 'guest' }).map(onApp),
    ...suiteProjects('account', { persona: 'solo' }).map(onApp),
    ...suiteProjects('games', { persona: 'solo' }).map(onApp),
    ...Object.keys(MP_PAIRS).map((pair) => onApp({
      name: `mp@${pair}`,
      testDir: './specs/multiplayer',
      use: { mpPair: pair, persona: 'pair', suite: 'multiplayer' },
    })),
  ],
});
