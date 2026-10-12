// UI check — Playwright Test config. Run through node, never the npx string form:
//   node node_modules/@playwright/test/cli.js test -c scripts/ui-check --project selftest
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { VIEWPORTS, contextOptions } from './lib/viewports.mjs';
import { UIC_ROOT, runId } from './lib/run-id.mjs';

// Fix the run id in the main process so every worker inherits the same UI_CHECK_RUN.
runId();

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
  ],
});
