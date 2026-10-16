// Logic Check — Playwright Test config (spec §5). Run through run.mjs, or node directly (never the npx string form):
//   node node_modules/@playwright/test/cli.js test -c scripts/logic-check --project selftest
// Projects:
//   live      the live site, read-only (GET/HEAD only), no stack, no accounts: `request`/node fetch through the api
//             fixture's guard; a browser context, if a check opens one, is guarded like ui-check --live (guardLive)
//   pages     the local stack (stack-setup), one Chromium context at desktop-1366: HTTP status, shell, hydration
//   api       the local stack, API only (the api fixture; no browser is launched unless a test asks for `page`)
//   rooms     the local stack, socket.io clients in node (lib/socket.mjs, Task 5)
//   selftest  harness tests (LC-ST-…), no app server
// Results/digest: ui-check's digest reporter, UI_CHECK_CHECKER=logic (run id YYYYMMDD-HHmm-logic, `checker: 'logic'` in
// run-meta.json and every result); a result's suite comes from its check id's prefix (SUITE_BY_PREFIX).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { contextOptions } from '../ui-check/lib/viewports.mjs';
import { UIC_ROOT, isolateSelftest, runId } from '../ui-check/lib/run-id.mjs';
import { MODES } from '../ui-check/lib/stack.mjs';
import { pickChannel } from '../ui-check/lib/browser-channel.mjs';
import { activePorts } from '../check-core/lib/ports.mjs';
import { SUITE_BY_PREFIX } from './lib/suites.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const UIC_LIB = path.join(HERE, '..', 'ui-check', 'lib');

// Every worker and the reporter see one checker and one run id (set before the workers start).
process.env.UI_CHECK_CHECKER = 'logic';
isolateSelftest(); // `--project selftest` alone writes under <home>/selftest/, never a run dir
runId('-logic');

const MODE = process.env.UI_CHECK_MODE || 'prod';
if (!MODES[MODE]) throw new Error(`UI_CHECK_MODE must be prod or dev, got "${MODE}"`);
const BASE_URL = process.env.UI_CHECK_BASE || `http://localhost:${activePorts(MODE).web}`;
const LIVE_URL = process.env.UI_CHECK_LIVE_URL || 'https://swishquest.com';

const local = (name, use = {}) => ({
  name,
  testDir: `./specs/${name}`,
  dependencies: ['stack-setup'],
  use: { suite: name, suiteByPrefix: SUITE_BY_PREFIX, baseURL: BASE_URL, env: 'local', ...use },
});

export default defineConfig({
  testDir: './specs',
  outputDir: path.join(UIC_ROOT, 'pw-output-logic'),
  fullyParallel: true,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], [path.join(UIC_LIB, 'digest-reporter.mjs')]],
  use: {
    channel: pickChannel(),
    headless: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    { name: 'selftest', testDir: './specs/selftest', use: { suite: 'selftest', suiteByPrefix: SUITE_BY_PREFIX } },
    // The local stack: ui-check's setup (stack up or verified, test accounts, a minted token accepted), Logic's own
    // teardown (sweep scope 'logic': lgc throwaways, testuser4/5/6 restored; stop unless UI_CHECK_KEEP_STACK=1).
    { name: 'stack-setup', testDir: UIC_LIB, testMatch: /stack\.setup\.mjs$/, teardown: 'stack-teardown' },
    { name: 'stack-teardown', testDir: './lib', testMatch: /stack\.teardown\.mjs$/ },
    {
      name: 'live',
      testDir: './specs/live',
      use: { suite: 'live', suiteByPrefix: SUITE_BY_PREFIX, baseURL: LIVE_URL, env: 'live', serviceWorkers: 'block' },
    },
    local('pages', { ...contextOptions('desktop-1366'), vpId: 'desktop-1366' }),
    local('api'),
    local('rooms'),
  ],
});
