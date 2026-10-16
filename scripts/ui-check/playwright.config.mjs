// UI check — Playwright Test config. Run through node, never the npx string form:
//   node node_modules/@playwright/test/cli.js test -c scripts/ui-check --project selftest
import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { pickChannel } from './lib/browser-channel.mjs';
import { VIEWPORTS, MP_PAIRS, CORE, contextOptions } from './lib/viewports.mjs';
import { UIC_ROOT, runId } from './lib/run-id.mjs';
import { MODES } from './lib/stack.mjs';
import { activePorts } from '../check-core/lib/ports.mjs';

// Fix the run id in the main process so every worker inherits the same UI_CHECK_RUN.
runId();

// Stack mode (spec §4): run.mjs sets UI_CHECK_MODE; a direct invocation defaults to prod, like stack-setup.
// baseURL: UI_CHECK_BASE when set, else the web port of UI_CHECK_PORTS or of the mode.
const MODE = process.env.UI_CHECK_MODE || 'prod';
if (!MODES[MODE]) throw new Error(`UI_CHECK_MODE must be prod or dev, got "${MODE}"`);
const BASE_URL = process.env.UI_CHECK_BASE || `http://localhost:${activePorts(MODE).web}`;
// The live site for `run.mjs --live` (guest-live@<vp> projects): read-only, no stack, no accounts.
const LIVE_URL = process.env.UI_CHECK_LIVE_URL || 'https://swishquest.com';

/** Browser channel (installed Chrome / Edge on win32, else bundled Chromium; UI_CHECK_CHANNEL overrides). */
export { pickChannel };

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

/**
 * The live site, read-only (run.mjs --live): only tests tagged @live (project grep, so a direct --project run cannot
 * pick up anything else), no stack-setup dependency, service workers blocked so every request passes the audit's
 * live-write guard (lib/fixtures.mjs), env 'live' on every result.
 */
const onLive = (p) => ({ ...p, name: p.name.replace(/^guest@/, 'guest-live@'), grep: /@live\b/, use: { ...p.use, baseURL: LIVE_URL, env: 'live', serviceWorkers: 'block' } });

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
    ...suiteProjects('guest', { persona: 'guest', vps: CORE }).map(onLive),
    ...suiteProjects('account', { persona: 'solo' }).map(onApp),
    ...suiteProjects('games', { persona: 'solo' }).map(onApp),
    // Multiplayer: the two accounts are shared, so tests of a file run one after another in file order (fullyParallel
    // off; run.mjs also gives mp one worker) without the skip-the-rest of serial mode: a finding in one test never
    // hides the next. One full match per online game (games.spec) and the real-time timeouts (timeouts.spec) run on
    // pair A only (spec §5); the other pairs do not load those files.
    ...Object.keys(MP_PAIRS).map((pair) => onApp({
      name: `mp@${pair}`,
      testDir: './specs/multiplayer',
      fullyParallel: false,
      ...(pair === 'pairA' ? {} : { testIgnore: /[\\/](games|timeouts)\.spec\.mjs$/ }),
      use: { mpPair: pair, persona: 'pair', suite: 'multiplayer' },
    })),
    // Acceptance assertions (verify.mjs / probe.mjs / report.mjs --validate): the spec sets each assertion's
    // viewport and persona itself (grouped describes), from the file in UI_CHECK_ASSERT_FILE.
    onApp({ name: 'accept', testDir: './specs/accept', use: { suite: 'accept' } }),
  ],
});
